import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type PairState = 'queued' | 'english_sent' | 'complete' | 'ambiguous';

export interface LedgerRecord {
  transactionId: string;
  rowNumber: number;
  phoneHash: string;
  state: PairState;
  englishProviderId: string | null;
  gujaratiProviderId: string | null;
  lastError: string | null;
}

export interface FollowupRecord {
  transactionId: string;
  state: PairState;
}

interface LedgerRow {
  transaction_id: string;
  row_number: number;
  phone_hash: string;
  state: PairState;
  english_provider_id: string | null;
  gujarati_provider_id: string | null;
  last_error: string | null;
}

function fromRow(row: LedgerRow): LedgerRecord {
  return {
    transactionId: row.transaction_id,
    rowNumber: row.row_number,
    phoneHash: row.phone_hash,
    state: row.state,
    englishProviderId: row.english_provider_id,
    gujaratiProviderId: row.gujarati_provider_id,
    lastError: row.last_error,
  };
}

export function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex');
}

export class MessageLedger {
  private readonly database: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new Database(path);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('synchronous = FULL');
    chmodSync(path, 0o600);
    for (const sidecar of [`${path}-wal`, `${path}-shm`]) {
      if (existsSync(sidecar)) chmodSync(sidecar, 0o600);
    }
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS bilingual_messages (
        transaction_id TEXT PRIMARY KEY,
        row_number INTEGER NOT NULL,
        phone_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('queued','english_sent','complete','ambiguous')),
        english_provider_id TEXT,
        gujarati_provider_id TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS followup_messages (
        transaction_id TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK(state IN ('queued','english_sent','complete','ambiguous')),
        english_provider_id TEXT,
        gujarati_provider_id TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  close(): void {
    this.database.close();
  }

  get(transactionId: string): LedgerRecord | null {
    const row = this.database
      .prepare('SELECT * FROM bilingual_messages WHERE transaction_id = ?')
      .get(transactionId) as LedgerRow | undefined;
    return row ? fromRow(row) : null;
  }

  getByPhone(phone: string): LedgerRecord | null {
    const row = this.database
      .prepare('SELECT * FROM bilingual_messages WHERE phone_hash = ? ORDER BY created_at LIMIT 1')
      .get(hashPhone(phone)) as LedgerRow | undefined;
    return row ? fromRow(row) : null;
  }

  reserve(transactionId: string, rowNumber: number, phone: string, now: string): LedgerRecord {
    const existingPhone = this.getByPhone(phone);
    if (existingPhone && existingPhone.transactionId !== transactionId) {
      throw new Error('Phone number already has a message record; duplicate send blocked.');
    }
    this.database.prepare(`
      INSERT OR IGNORE INTO bilingual_messages
        (transaction_id, row_number, phone_hash, state, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, ?)
    `).run(transactionId, rowNumber, hashPhone(phone), now, now);
    const record = this.get(transactionId);
    if (!record) throw new Error('Failed to reserve bilingual message in the local ledger.');
    if (record.phoneHash !== hashPhone(phone)) {
      throw new Error('Customer ID is already associated with a different phone; manual review required.');
    }
    return record;
  }

  markEnglishSent(transactionId: string, providerId: string, now: string): void {
    this.database.prepare(`
      UPDATE bilingual_messages
      SET state = 'english_sent', english_provider_id = ?, last_error = NULL, updated_at = ?
      WHERE transaction_id = ? AND state = 'queued'
    `).run(providerId, now, transactionId);
  }

  markComplete(transactionId: string, providerId: string, now: string): void {
    this.database.prepare(`
      UPDATE bilingual_messages
      SET state = 'complete', gujarati_provider_id = ?, last_error = NULL, updated_at = ?
      WHERE transaction_id = ? AND state = 'english_sent'
    `).run(providerId, now, transactionId);
  }

  markAmbiguous(transactionId: string, error: string, now: string): void {
    this.database.prepare(`
      UPDATE bilingual_messages
      SET state = 'ambiguous', last_error = ?, updated_at = ?
      WHERE transaction_id = ? AND state != 'complete'
    `).run(error.slice(0, 500), now, transactionId);
  }

  getFollowup(transactionId: string): FollowupRecord | null {
    const row = this.database.prepare(
      'SELECT transaction_id, state FROM followup_messages WHERE transaction_id = ?',
    ).get(transactionId) as { transaction_id: string; state: PairState } | undefined;
    return row ? { transactionId: row.transaction_id, state: row.state } : null;
  }

  reserveFollowup(transactionId: string, now: string): FollowupRecord {
    this.database.prepare(`
      INSERT OR IGNORE INTO followup_messages (transaction_id, state, created_at, updated_at)
      VALUES (?, 'queued', ?, ?)
    `).run(transactionId, now, now);
    const record = this.getFollowup(transactionId);
    if (!record) throw new Error('Failed to reserve follow-up message.');
    return record;
  }

  markFollowupEnglishSent(transactionId: string, providerId: string, now: string): void {
    this.database.prepare(`UPDATE followup_messages SET state='english_sent', english_provider_id=?, updated_at=? WHERE transaction_id=? AND state='queued'`)
      .run(providerId, now, transactionId);
  }

  markFollowupComplete(transactionId: string, providerId: string, now: string): void {
    this.database.prepare(`UPDATE followup_messages SET state='complete', gujarati_provider_id=?, updated_at=? WHERE transaction_id=? AND state='english_sent'`)
      .run(providerId, now, transactionId);
  }

  markFollowupAmbiguous(transactionId: string, error: string, now: string): void {
    this.database.prepare(`UPDATE followup_messages SET state='ambiguous', last_error=?, updated_at=? WHERE transaction_id=? AND state!='complete'`)
      .run(error.slice(0, 500), now, transactionId);
  }
}
