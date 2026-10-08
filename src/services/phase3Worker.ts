import type { ColumnMap } from '../google/headers.js';
import type { SheetCustomerRow } from '../google/rows.js';
import type { GoogleSheetsService, SheetSnapshot } from '../google/sheets.js';
import { maskPhone, normalizeIndianPhone } from '../utils/phone.js';
import type { OpenWAClient, OpenWASession } from '../whatsapp/openwa.js';
import { checkEligibility } from './eligibility.js';
import { buildReviewMessage } from './message.js';

const REQUIRED_COLUMNS: (keyof ColumnMap)[] = [
  'customerId', 'mobile', 'product', 'consent', 'reviewSent', 'status', 'sentAt', 'error', 'completed',
];

export interface Phase3Dependencies {
  sheets: Pick<GoogleSheetsService, 'readSnapshot' | 'updateRowField'>;
  openwa: Pick<OpenWAClient, 'getSession' | 'sendText'>;
}

export interface Phase3Options {
  sessionId: string;
  sessionName: string;
  reviewUrl: string;
  send: boolean;
  sendEnabledByConfig: boolean;
  testPhoneNumbers: string[];
  maxMessages: number;
  now?: () => Date;
}

export interface Phase3Summary {
  mode: 'dry-run' | 'send-test';
  rowsRead: number;
  eligibleRows: number;
  allowlistedRows: number;
  sent: number;
  candidates: { customerId: string; rowNumber: number; phone: string }[];
  skippedReasons: Record<string, number>;
}

function requireColumns(snapshot: SheetSnapshot): void {
  const missing = REQUIRED_COLUMNS.filter(column => snapshot.columns[column] === undefined);
  if (missing.length) throw new Error(`Sheet is missing required Phase 3 columns: ${missing.join(', ')}`);
}

function allowlist(session: OpenWASession, configured: string[]): Set<string> {
  const allowed = new Set<string>();
  for (const entry of configured) {
    if (entry.toLowerCase() === 'self') {
      const phone = normalizeIndianPhone(session.phone ?? '');
      if (!phone) throw new Error('TEST_PHONE_NUMBERS=self requires a valid phone on the ready OpenWA session.');
      allowed.add(phone);
    } else {
      const phone = normalizeIndianPhone(entry);
      if (!phone) throw new Error('TEST_PHONE_NUMBERS contains an invalid Indian phone number.');
      allowed.add(phone);
    }
  }
  return allowed;
}

async function mark(
  sheets: Phase3Dependencies['sheets'],
  row: SheetCustomerRow,
  columns: ColumnMap,
  field: keyof ColumnMap,
  value: string,
): Promise<void> {
  await sheets.updateRowField(row.rowNumber, columns, field, value);
}

export async function runPhase3Once(deps: Phase3Dependencies, options: Phase3Options): Promise<Phase3Summary> {
  if (options.send && !options.sendEnabledByConfig) {
    throw new Error('Live test sending is disabled. Set PHASE3_SEND_ENABLED=true only after reviewing dry-run output.');
  }
  const [snapshot, session] = await Promise.all([
    deps.sheets.readSnapshot(),
    deps.openwa.getSession(options.sessionId),
  ]);
  requireColumns(snapshot);
  if (session.name !== options.sessionName) throw new Error('Configured OpenWA session name does not match the session ID.');
  if (session.status !== 'ready' || !session.phone) throw new Error(`OpenWA session is not ready (status: ${session.status}).`);

  const evaluated = snapshot.rows.map(row => ({ row, result: checkEligibility(row) }));
  const skippedReasons: Record<string, number> = {};
  for (const item of evaluated) {
    if (!item.result.eligible) {
      const reason = item.result.reason ?? 'unknown';
      skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
    }
  }
  const eligible = evaluated
    .filter(item => item.result.eligible && item.result.phone) as { row: SheetCustomerRow; result: { phone: string } }[];
  const allowed = allowlist(session, options.testPhoneNumbers);
  const candidates = eligible
    .filter(item => allowed.has(item.result.phone))
    .slice(0, options.maxMessages);

  const summary: Phase3Summary = {
    mode: options.send ? 'send-test' : 'dry-run',
    rowsRead: snapshot.rows.length,
    eligibleRows: eligible.length,
    allowlistedRows: candidates.length,
    sent: 0,
    skippedReasons,
    candidates: candidates.map(item => ({
      customerId: item.row.customerId,
      rowNumber: item.row.rowNumber,
      phone: maskPhone(item.result.phone),
    })),
  };
  if (!options.send) return summary;

  for (const { row, result } of candidates) {
    await mark(deps.sheets, row, snapshot.columns, 'status', 'Pending');
    let providerAccepted = false;
    try {
      await deps.openwa.sendText(options.sessionId, result.phone, buildReviewMessage(row, options.reviewUrl));
      providerAccepted = true;
      await mark(deps.sheets, row, snapshot.columns, 'reviewSent', 'Yes');
      await mark(deps.sheets, row, snapshot.columns, 'status', 'Sent');
      await mark(deps.sheets, row, snapshot.columns, 'sentAt', (options.now ?? (() => new Date()))().toISOString());
      await mark(deps.sheets, row, snapshot.columns, 'error', '');
      summary.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Phase 3 send failure';
      if (!providerAccepted) {
        await mark(deps.sheets, row, snapshot.columns, 'status', 'Failed');
        await mark(deps.sheets, row, snapshot.columns, 'error', message.slice(0, 250));
      } else {
        // Keep Pending/Sent as a resend block. A provider-accepted message must never be
        // labelled retryable merely because a later Sheet update failed.
        try {
          await mark(
            deps.sheets,
            row,
            snapshot.columns,
            'error',
            `Provider accepted; Sheet update incomplete; manual reconciliation required: ${message}`.slice(0, 250),
          );
        } catch {
          // The pre-send Pending value remains the durable resend guard when Google is unavailable.
        }
      }
      throw error;
    }
  }
  return summary;
}
