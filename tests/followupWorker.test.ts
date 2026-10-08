import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SheetSnapshot } from '../src/google/sheets.js';
import { MessageLedger } from '../src/queue/messageLedger.js';
import { runFollowupCycle } from '../src/services/followupWorker.js';

const ledgers: MessageLedger[] = [];
function setup(reviewCompleted = '', sentAt = '2026-08-06T11:00:00.000Z') {
  const ledger = new MessageLedger(join(mkdtempSync(join(tmpdir(), 'followup-')), 'queue.sqlite'));
  ledgers.push(ledger);
  ledger.reserve('T-1', 2, '919876543210', '2026-08-06T10:59:00.000Z');
  ledger.markEnglishSent('T-1', 'e1', '2026-08-06T10:59:01.000Z');
  ledger.markComplete('T-1', 'g1', '2026-08-06T10:59:02.000Z');
  const sheet: SheetSnapshot = {
    headers: [],
    columns: { customerId: 0, mobile: 1, sentAt: 2, reviewCompleted: 3, followupStatus: 4, followupSentAt: 5 },
    rows: [{ rowNumber: 2, customerId: 'T-1', name: 'Asha', mobile: '9876543210', product: '', serviceType: '', consent: 'Yes', reviewSent: 'Yes', status: 'Sent', sentAt, error: '', completed: 'Yes', reviewCompleted, followupStatus: '', followupSentAt: '' }],
  };
  const sheets = { readSnapshot: vi.fn().mockResolvedValue(sheet), updateRowField: vi.fn().mockResolvedValue(undefined) };
  const openwa = { sendText: vi.fn().mockResolvedValueOnce({ providerMessageId: 'e2' }).mockResolvedValueOnce({ providerMessageId: 'g2' }) };
  return { ledger, sheets, openwa };
}

afterEach(() => { while (ledgers.length) ledgers.pop()?.close(); });

describe('follow-up cycle', () => {
  it('sends one English and Gujarati reminder after 48 hours', async () => {
    const deps = setup();
    const summary = await runFollowupCycle(deps, { sessionId: 'session', reviewUrl: 'https://example.com', delayHours: 48, send: true, enabled: true, maxCustomers: 1, now: () => new Date('2026-08-08T12:00:00.000Z') });
    expect(summary).toMatchObject({ customersCompleted: 1, messagesSent: 2 });
    expect(deps.openwa.sendText).toHaveBeenCalledTimes(2);
    expect(deps.openwa.sendText.mock.calls[0]?.[2]).toContain('share your experience');
    expect(deps.openwa.sendText.mock.calls[1]?.[2]).toContain('અનુભવ');
    expect(deps.ledger.getFollowup('T-1')?.state).toBe('complete');
  });

  it('does not remind a customer marked Review Completed', async () => {
    const deps = setup('Yes');
    const summary = await runFollowupCycle(deps, { sessionId: 'session', reviewUrl: 'https://example.com', delayHours: 48, send: true, enabled: true, maxCustomers: 1, now: () => new Date('2026-08-08T12:00:00.000Z') });
    expect(summary.skipped.review_completed).toBe(1);
    expect(deps.openwa.sendText).not.toHaveBeenCalled();
  });

  it('waits until the full delay has elapsed', async () => {
    const deps = setup('', '2026-08-07T12:00:01.000Z');
    const summary = await runFollowupCycle(deps, { sessionId: 'session', reviewUrl: 'https://example.com', delayHours: 48, send: true, enabled: true, maxCustomers: 1, now: () => new Date('2026-08-08T12:00:00.000Z') });
    expect(summary.skipped.waiting).toBe(1);
    expect(deps.openwa.sendText).not.toHaveBeenCalled();
  });
});
