import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SheetSnapshot } from '../src/google/sheets.js';
import { MessageLedger } from '../src/queue/messageLedger.js';
import { runBilingualCycle, type BilingualDependencies, type BilingualOptions } from '../src/services/bilingualWorker.js';

const ledgers: MessageLedger[] = [];

function snapshot(status = ''): SheetSnapshot {
  return {
    headers: [],
    columns: {
      customerId: 0, mobile: 1, product: 2, consent: 3, reviewSent: 4,
      status: 5, sentAt: 6, error: 7, completed: 8,
    },
    rows: [{
      rowNumber: 2,
      customerId: 'T-1',
      name: 'Asha',
      mobile: '9876543210',
      product: 'repair',
      serviceType: '',
      consent: 'Yes',
      reviewSent: 'No',
      status,
      sentAt: '',
      error: '',
      completed: 'Yes',
    }],
  };
}

function setup(sheet = snapshot()): { deps: BilingualDependencies; options: BilingualOptions; ledger: MessageLedger } {
  const ledger = new MessageLedger(join(mkdtempSync(join(tmpdir(), 'swastik-worker-')), 'queue.sqlite'));
  ledgers.push(ledger);
  return {
    ledger,
    deps: {
      ledger,
      sheets: {
        readSnapshot: vi.fn().mockResolvedValue(sheet),
        updateRowField: vi.fn().mockResolvedValue(undefined),
      },
      openwa: {
        getSession: vi.fn().mockResolvedValue({
          id: 'f81b63f4-8d31-4e9b-912c-f54af6d3fe38',
          name: 'swastik-shop',
          status: 'ready',
          phone: '919999999999',
          lastError: null,
        }),
        sendText: vi.fn()
          .mockResolvedValueOnce({ providerMessageId: 'english-id' })
          .mockResolvedValueOnce({ providerMessageId: 'gujarati-id' }),
      },
    },
    options: {
      sessionId: 'f81b63f4-8d31-4e9b-912c-f54af6d3fe38',
      sessionName: 'swastik-shop',
      reviewUrl: 'https://example.com/review',
      send: true,
      sendEnabledByConfig: true,
      maxCustomers: 1,
      now: () => new Date('2026-08-08T12:00:00.000Z'),
    },
  };
}

afterEach(() => {
  while (ledgers.length) ledgers.pop()?.close();
});

describe('bilingual polling cycle', () => {
  it('sends English then Gujarati and completes the durable pair', async () => {
    const { deps, options, ledger } = setup();
    const summary = await runBilingualCycle(deps, options);
    expect(summary).toMatchObject({ customersCompleted: 1, messagesSent: 2 });
    expect(deps.openwa.sendText).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(deps.openwa.sendText).mock.calls;
    expect(calls[0]?.[2]).toContain('Thank you for choosing');
    expect(calls[1]?.[2]).toContain('પસંદ કરવા બદલ આભાર');
    expect(ledger.get('T-1')?.state).toBe('complete');
  });

  it('resumes with only Gujarati after durable English progress', async () => {
    const sheet = snapshot('English Sent');
    const { deps, options, ledger } = setup(sheet);
    ledger.reserve('T-1', 2, '919876543210', '2026-08-08T11:59:00.000Z');
    ledger.markEnglishSent('T-1', 'english-id', '2026-08-08T11:59:01.000Z');
    vi.mocked(deps.openwa.sendText).mockReset().mockResolvedValue({ providerMessageId: 'gujarati-id' });
    const summary = await runBilingualCycle(deps, options);
    expect(summary.messagesSent).toBe(1);
    expect(deps.openwa.sendText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.openwa.sendText).mock.calls[0]?.[2]).toContain('પસંદ કરવા બદલ આભાર');
    expect(ledger.get('T-1')?.state).toBe('complete');
  });

  it('never resends a completed pair and reconciles the Sheet', async () => {
    const { deps, options, ledger } = setup();
    ledger.reserve('T-1', 2, '919876543210', '2026-08-08T11:59:00.000Z');
    ledger.markEnglishSent('T-1', 'english-id', '2026-08-08T11:59:01.000Z');
    ledger.markComplete('T-1', 'gujarati-id', '2026-08-08T11:59:02.000Z');
    const summary = await runBilingualCycle(deps, options);
    expect(summary.skipped.already_complete_local).toBe(1);
    expect(deps.openwa.sendText).not.toHaveBeenCalled();
    expect(deps.sheets.updateRowField).toHaveBeenCalledWith(2, expect.anything(), 'reviewSent', 'Yes');
  });

  it('never sends the same phone under a different customer ID', async () => {
    const repeated = snapshot();
    repeated.rows[0] = { ...repeated.rows[0]!, customerId: 'T-2', rowNumber: 3 };
    const { deps, options, ledger } = setup(repeated);
    ledger.reserve('T-1', 2, '919876543210', '2026-08-08T11:59:00.000Z');
    ledger.markEnglishSent('T-1', 'english-id', '2026-08-08T11:59:01.000Z');
    ledger.markComplete('T-1', 'gujarati-id', '2026-08-08T11:59:02.000Z');
    const summary = await runBilingualCycle(deps, options);
    expect(summary.skipped.duplicate_phone).toBe(1);
    expect(deps.openwa.sendText).not.toHaveBeenCalled();
  });

  it('uses the phone as the durable ID in explicit mobile-only mode', async () => {
    const mobileOnly = snapshot();
    mobileOnly.columns = { mobile: 0 };
    mobileOnly.rows[0] = {
      ...mobileOnly.rows[0]!, customerId: '', name: '', product: '', consent: '', completed: '',
    };
    const { deps, options, ledger } = setup(mobileOnly);
    options.mobileOnlyMode = true;
    const summary = await runBilingualCycle(deps, options);
    expect(summary).toMatchObject({ customersCompleted: 1, messagesSent: 2 });
    expect(summary.selected[0]?.customerId).toMatch(/^phone:[a-f0-9]{64}$/);
    const messages = vi.mocked(deps.openwa.sendText).mock.calls.map(call => call[2]);
    expect(messages[0]).toContain('Hello 👋');
    expect(messages[0]).not.toContain('Asha');
    expect(messages[0]).not.toContain('repair');
    expect(messages[1]).toContain('નમસ્તે 👋');
    expect(deps.sheets.updateRowField).not.toHaveBeenCalled();
    expect(ledger.getByPhone('919876543210')?.state).toBe('complete');
  });

  it('fails closed on queued plus Pending after a restart', async () => {
    const { deps, options, ledger } = setup(snapshot('Pending'));
    ledger.reserve('T-1', 2, '919876543210', '2026-08-08T11:59:00.000Z');
    const summary = await runBilingualCycle(deps, options);
    expect(summary.skipped.pending_manual_review).toBe(1);
    expect(deps.openwa.sendText).not.toHaveBeenCalled();
    expect(ledger.get('T-1')?.state).toBe('ambiguous');
  });

  it('aborts the remaining batch when OpenWA disconnects', async () => {
    const sheet = snapshot();
    sheet.rows.push({ ...sheet.rows[0]!, rowNumber: 3, customerId: 'T-2', mobile: '9123456789' });
    const { deps, options, ledger } = setup(sheet);
    options.maxCustomers = 10;
    vi.mocked(deps.openwa.getSession)
      .mockResolvedValueOnce({ id: 'session', name: 'swastik-shop', status: 'ready', phone: '919999999999', lastError: null })
      .mockResolvedValueOnce({ id: 'session', name: 'swastik-shop', status: 'qr_ready', phone: null, lastError: null });
    vi.mocked(deps.openwa.sendText).mockReset().mockRejectedValue(new Error('session disconnected'));
    await expect(runBilingualCycle(deps, options)).rejects.toThrow('remaining customers were not attempted');
    expect(deps.openwa.sendText).toHaveBeenCalledTimes(1);
    expect(ledger.get('T-1')?.state).toBe('ambiguous');
    expect(ledger.get('T-2')).toBeNull();
  });
});
