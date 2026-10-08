import type { ColumnMap } from '../google/headers.js';
import type { SheetCustomerRow } from '../google/rows.js';
import type { GoogleSheetsService } from '../google/sheets.js';
import type { MessageLedger, LedgerRecord } from '../queue/messageLedger.js';
import { hashPhone } from '../queue/messageLedger.js';
import { checkEligibility } from './eligibility.js';
import { buildBilingualReviewMessages } from './message.js';
import type { OpenWAClient } from '../whatsapp/openwa.js';
import { maskPhone } from '../utils/phone.js';

export interface BilingualDependencies {
  sheets: Pick<GoogleSheetsService, 'readSnapshot' | 'updateRowField'>;
  openwa: Pick<OpenWAClient, 'getSession' | 'sendText'>;
  ledger: Pick<
    MessageLedger,
    'get' | 'getByPhone' | 'reserve' | 'markEnglishSent' | 'markComplete' | 'markAmbiguous'
  >;
}

export interface BilingualOptions {
  sessionId: string;
  sessionName: string;
  reviewUrl: string;
  send: boolean;
  sendEnabledByConfig: boolean;
  mobileOnlyMode?: boolean;
  maxCustomers: number;
  now?: () => Date;
}

export interface BilingualCycleSummary {
  mode: 'dry-run' | 'send';
  rowsRead: number;
  candidates: number;
  customersCompleted: number;
  messagesSent: number;
  skipped: Record<string, number>;
  selected: { customerId: string; rowNumber: number; phone: string }[];
}

const REQUIRED_COLUMNS: (keyof ColumnMap)[] = [
  'customerId', 'mobile', 'product', 'consent', 'reviewSent', 'status', 'sentAt', 'error', 'completed',
];

function count(summary: BilingualCycleSummary, reason: string): void {
  summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1;
}

function iso(options: BilingualOptions): string {
  return (options.now ?? (() => new Date()))().toISOString();
}

async function update(
  sheets: BilingualDependencies['sheets'],
  row: SheetCustomerRow,
  columns: ColumnMap,
  field: keyof ColumnMap,
  value: string,
): Promise<void> {
  await sheets.updateRowField(row.rowNumber, columns, field, value);
}

async function updateIfPresent(
  sheets: BilingualDependencies['sheets'],
  row: SheetCustomerRow,
  columns: ColumnMap,
  field: keyof ColumnMap,
  value: string,
): Promise<void> {
  if (columns[field] !== undefined) await update(sheets, row, columns, field, value);
}

async function reconcileComplete(
  sheets: BilingualDependencies['sheets'],
  row: SheetCustomerRow,
  columns: ColumnMap,
  sentAt: string,
): Promise<void> {
  if (row.reviewSent.trim().toLowerCase() !== 'yes') await updateIfPresent(sheets, row, columns, 'reviewSent', 'Yes');
  if (row.status.trim().toLowerCase() !== 'sent') await updateIfPresent(sheets, row, columns, 'status', 'Sent');
  if (!row.sentAt) await updateIfPresent(sheets, row, columns, 'sentAt', sentAt);
  if (row.error) await updateIfPresent(sheets, row, columns, 'error', '');
}

function eligibilityForOwnedQueue(row: SheetCustomerRow): ReturnType<typeof checkEligibility> {
  return checkEligibility({ ...row, status: '' });
}

export async function runBilingualCycle(
  deps: BilingualDependencies,
  options: BilingualOptions,
): Promise<BilingualCycleSummary> {
  if (options.send && !options.sendEnabledByConfig) {
    throw new Error('Bilingual worker sending is disabled by WORKER_SEND_ENABLED=false.');
  }
  const [snapshot, session] = await Promise.all([
    deps.sheets.readSnapshot(),
    deps.openwa.getSession(options.sessionId),
  ]);
  const requiredColumns = options.mobileOnlyMode ? (['mobile'] as (keyof ColumnMap)[]) : REQUIRED_COLUMNS;
  const missing = requiredColumns.filter(field => snapshot.columns[field] === undefined);
  if (missing.length) throw new Error(`Sheet is missing required worker columns: ${missing.join(', ')}`);
  if (session.name !== options.sessionName || session.status !== 'ready' || !session.phone) {
    throw new Error(`OpenWA session is not ready or does not match (status: ${session.status}).`);
  }

  const summary: BilingualCycleSummary = {
    mode: options.send ? 'send' : 'dry-run',
    rowsRead: snapshot.rows.length,
    candidates: 0,
    customersCompleted: 0,
    messagesSent: 0,
    skipped: {},
    selected: [],
  };

  for (const row of snapshot.rows) {
    if (summary.candidates >= options.maxCustomers) break;
    const baseEligibility = checkEligibility(row);
    const mobileOnlyPhone = options.mobileOnlyMode ? baseEligibility.phone : null;
    const customerId = mobileOnlyPhone ? `phone:${hashPhone(mobileOnlyPhone)}` : row.customerId;
    if (customerId.length > 200) {
      count(summary, 'customer_id_too_long');
      continue;
    }
    let record = deps.ledger.get(customerId);
    if (record && record.rowNumber !== row.rowNumber) {
      count(summary, 'duplicate_customer_id');
      continue;
    }
    if (record?.state === 'complete') {
      if (options.send) await reconcileComplete(deps.sheets, row, snapshot.columns, iso(options));
      count(summary, 'already_complete_local');
      continue;
    }
    if (record?.state === 'ambiguous') {
      count(summary, 'ambiguous_manual_review');
      continue;
    }

    const eligibility = options.mobileOnlyMode
      ? (baseEligibility.phone ? { eligible: true, phone: baseEligibility.phone } : baseEligibility)
      : (record ? eligibilityForOwnedQueue(row) : baseEligibility);
    if (!eligibility.eligible || !eligibility.phone) {
      count(summary, eligibility.reason ?? 'ineligible');
      continue;
    }
    const phoneRecord = deps.ledger.getByPhone(eligibility.phone);
    if (phoneRecord && phoneRecord.transactionId !== customerId) {
      count(summary, 'duplicate_phone');
      continue;
    }
    if (record?.state === 'queued' && row.status.trim().toLowerCase() === 'pending') {
      // A restart cannot prove whether the English request reached OpenWA. Fail closed.
      if (options.send) {
        deps.ledger.markAmbiguous(customerId, 'Restart found queued + Pending; delivery state unknown', iso(options));
        await updateIfPresent(deps.sheets, row, snapshot.columns, 'status', 'Failed');
        await updateIfPresent(deps.sheets, row, snapshot.columns, 'error', 'Delivery state unknown; manual review required');
      }
      count(summary, 'pending_manual_review');
      continue;
    }

    summary.candidates += 1;
    summary.selected.push({
      customerId,
      rowNumber: row.rowNumber,
      phone: maskPhone(eligibility.phone),
    });
    if (!options.send) continue;

    const now = iso(options);
    record = record ?? deps.ledger.reserve(customerId, row.rowNumber, eligibility.phone, now);
    const messages = buildBilingualReviewMessages(row, options.reviewUrl);
    try {
      if (record.state === 'queued') {
        await updateIfPresent(deps.sheets, row, snapshot.columns, 'status', 'Pending');
        const english = await deps.openwa.sendText(options.sessionId, eligibility.phone, messages.english);
        deps.ledger.markEnglishSent(customerId, english.providerMessageId, iso(options));
        await updateIfPresent(deps.sheets, row, snapshot.columns, 'status', 'English Sent');
        summary.messagesSent += 1;
        record = deps.ledger.get(customerId) as LedgerRecord;
      }
      if (record.state === 'english_sent') {
        const gujarati = await deps.openwa.sendText(options.sessionId, eligibility.phone, messages.gujarati);
        deps.ledger.markComplete(customerId, gujarati.providerMessageId, iso(options));
        summary.messagesSent += 1;
      }
      await reconcileComplete(deps.sheets, row, snapshot.columns, iso(options));
      summary.customersCompleted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown bilingual send failure';
      deps.ledger.markAmbiguous(customerId, message, iso(options));
      try {
        await updateIfPresent(deps.sheets, row, snapshot.columns, 'status', 'Failed');
        await updateIfPresent(deps.sheets, row, snapshot.columns, 'error', `Manual review required: ${message}`.slice(0, 250));
      } catch {
        // The durable local ambiguous state still prevents automated resend.
      }
      count(summary, 'send_failed_manual_review');
      const sessionAfterFailure = await deps.openwa.getSession(options.sessionId).catch(() => null);
      if (!sessionAfterFailure || sessionAfterFailure.status !== 'ready') {
        throw new Error('OpenWA disconnected during the batch; remaining customers were not attempted.');
      }
    }
  }
  return summary;
}
