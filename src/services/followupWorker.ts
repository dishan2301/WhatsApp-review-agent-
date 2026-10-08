import type { ColumnMap } from '../google/headers.js';
import type { GoogleSheetsService } from '../google/sheets.js';
import type { MessageLedger, FollowupRecord } from '../queue/messageLedger.js';
import { buildBilingualFollowupMessages } from './message.js';
import type { OpenWAClient } from '../whatsapp/openwa.js';
import { normalizeIndianPhone } from '../utils/phone.js';

export interface FollowupDependencies {
  sheets: Pick<GoogleSheetsService, 'readSnapshot' | 'updateRowField'>;
  openwa: Pick<OpenWAClient, 'sendText'>;
  ledger: Pick<MessageLedger, 'get' | 'getFollowup' | 'reserveFollowup' | 'markFollowupEnglishSent' | 'markFollowupComplete' | 'markFollowupAmbiguous'>;
}

export interface FollowupOptions {
  sessionId: string;
  reviewUrl: string;
  delayHours: number;
  send: boolean;
  enabled: boolean;
  maxCustomers: number;
  now?: () => Date;
}

export interface FollowupSummary {
  candidates: number;
  customersCompleted: number;
  messagesSent: number;
  skipped: Record<string, number>;
}

const yes = (value: string | undefined): boolean => ['yes', 'y', 'true', 'done'].includes((value ?? '').trim().toLowerCase());
const count = (summary: FollowupSummary, reason: string): void => {
  summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1;
};

export async function runFollowupCycle(deps: FollowupDependencies, options: FollowupOptions): Promise<FollowupSummary> {
  if (options.send && !options.enabled) throw new Error('Follow-up sending is disabled.');
  const snapshot = await deps.sheets.readSnapshot();
  const required: (keyof ColumnMap)[] = ['customerId', 'mobile', 'sentAt', 'reviewCompleted', 'followupStatus', 'followupSentAt'];
  const missing = required.filter(field => snapshot.columns[field] === undefined);
  if (missing.length) throw new Error(`Sheet is missing required follow-up columns: ${missing.join(', ')}`);
  const summary: FollowupSummary = { candidates: 0, customersCompleted: 0, messagesSent: 0, skipped: {} };
  const current = (options.now ?? (() => new Date()))();

  for (const row of snapshot.rows) {
    if (summary.candidates >= options.maxCustomers) break;
    if (yes(row.reviewCompleted)) { count(summary, 'review_completed'); continue; }
    if (deps.ledger.get(row.customerId)?.state !== 'complete') { count(summary, 'initial_message_incomplete'); continue; }
    const sentAt = new Date(row.sentAt);
    if (!row.sentAt || Number.isNaN(sentAt.getTime())) { count(summary, 'missing_initial_sent_at'); continue; }
    if (current.getTime() - sentAt.getTime() < options.delayHours * 3_600_000) { count(summary, 'waiting'); continue; }
    const phone = normalizeIndianPhone(row.mobile);
    if (!phone) { count(summary, 'invalid_phone'); continue; }
    let record = deps.ledger.getFollowup(row.customerId);
    if (record?.state === 'complete') { count(summary, 'already_followed_up'); continue; }
    if (record?.state === 'ambiguous') { count(summary, 'ambiguous_manual_review'); continue; }
    summary.candidates += 1;
    if (!options.send) continue;

    try {
      const now = current.toISOString();
      record = record ?? deps.ledger.reserveFollowup(row.customerId, now);
      const messages = buildBilingualFollowupMessages(row, options.reviewUrl);
      await deps.sheets.updateRowField(row.rowNumber, snapshot.columns, 'followupStatus', 'Pending');
      if (record.state === 'queued') {
        const result = await deps.openwa.sendText(options.sessionId, phone, messages.english);
        deps.ledger.markFollowupEnglishSent(row.customerId, result.providerMessageId, now);
        summary.messagesSent += 1;
        record = deps.ledger.getFollowup(row.customerId) as FollowupRecord;
      }
      if (record.state === 'english_sent') {
        const result = await deps.openwa.sendText(options.sessionId, phone, messages.gujarati);
        deps.ledger.markFollowupComplete(row.customerId, result.providerMessageId, now);
        summary.messagesSent += 1;
      }
      await deps.sheets.updateRowField(row.rowNumber, snapshot.columns, 'followupStatus', 'Sent');
      await deps.sheets.updateRowField(row.rowNumber, snapshot.columns, 'followupSentAt', now);
      summary.customersCompleted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown follow-up failure';
      deps.ledger.markFollowupAmbiguous(row.customerId, message, current.toISOString());
      try { await deps.sheets.updateRowField(row.rowNumber, snapshot.columns, 'followupStatus', 'Failed - manual review'); } catch {}
      count(summary, 'send_failed_manual_review');
    }
  }
  return summary;
}
