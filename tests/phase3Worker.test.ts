import { describe, expect, it, vi } from 'vitest';

import type { SheetSnapshot } from '../src/google/sheets.js';
import { runPhase3Once, type Phase3Dependencies, type Phase3Options } from '../src/services/phase3Worker.js';

const snapshot: SheetSnapshot = {
  headers: [],
  columns: {
    customerId: 0, mobile: 1, product: 2, consent: 3, reviewSent: 4,
    status: 5, sentAt: 6, error: 7, completed: 8,
  },
  rows: [{
    rowNumber: 2,
    customerId: 'TEST-1',
    name: '',
    mobile: '9876543210',
    product: 'repair',
    serviceType: '',
    consent: 'Yes',
    reviewSent: 'No',
    status: '',
    sentAt: '',
    error: '',
    completed: 'Completed',
  }],
};

function setup(): { deps: Phase3Dependencies; options: Phase3Options } {
  return {
    deps: {
      sheets: {
        readSnapshot: vi.fn().mockResolvedValue(snapshot),
        updateRowField: vi.fn().mockResolvedValue(undefined),
      },
      openwa: {
        getSession: vi.fn().mockResolvedValue({
          id: 'f81b63f4-8d31-4e9b-912c-f54af6d3fe38',
          name: 'swastik-shop',
          status: 'ready',
          phone: '919876543210',
          lastError: null,
        }),
        sendText: vi.fn().mockResolvedValue({ providerMessageId: 'provider-1' }),
      },
    },
    options: {
      sessionId: 'f81b63f4-8d31-4e9b-912c-f54af6d3fe38',
      sessionName: 'swastik-shop',
      reviewUrl: 'https://example.com/review',
      send: false,
      sendEnabledByConfig: false,
      testPhoneNumbers: ['self'],
      maxMessages: 1,
    },
  };
}

describe('Phase 3 integration worker', () => {
  it('dry-runs an eligible allowlisted row without writes or sends', async () => {
    const { deps, options } = setup();
    const summary = await runPhase3Once(deps, options);
    expect(summary).toMatchObject({
      mode: 'dry-run', rowsRead: 1, eligibleRows: 1, allowlistedRows: 1, sent: 0, skippedReasons: {},
    });
    expect(deps.openwa.sendText).not.toHaveBeenCalled();
    expect(deps.sheets.updateRowField).not.toHaveBeenCalled();
  });

  it('refuses send mode unless the independent config gate is enabled', async () => {
    const { deps, options } = setup();
    await expect(runPhase3Once(deps, { ...options, send: true })).rejects.toThrow('disabled');
    expect(deps.openwa.sendText).not.toHaveBeenCalled();
  });

  it('sends only the self-allowlisted row and records the result', async () => {
    const { deps, options } = setup();
    const summary = await runPhase3Once(deps, {
      ...options,
      send: true,
      sendEnabledByConfig: true,
      now: () => new Date('2026-08-08T12:00:00.000Z'),
    });
    expect(summary.sent).toBe(1);
    expect(deps.openwa.sendText).toHaveBeenCalledTimes(1);
    expect(deps.sheets.updateRowField).toHaveBeenCalledWith(2, snapshot.columns, 'reviewSent', 'Yes');
    expect(deps.sheets.updateRowField).toHaveBeenCalledWith(2, snapshot.columns, 'sentAt', '2026-08-08T12:00:00.000Z');
  });

  it('does not mark a provider-accepted message Failed when a later Sheet update fails', async () => {
    const { deps, options } = setup();
    vi.mocked(deps.sheets.updateRowField)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Google unavailable'))
      .mockResolvedValueOnce(undefined);
    await expect(runPhase3Once(deps, {
      ...options,
      send: true,
      sendEnabledByConfig: true,
    })).rejects.toThrow('Google unavailable');
    expect(deps.openwa.sendText).toHaveBeenCalledTimes(1);
    expect(deps.sheets.updateRowField).not.toHaveBeenCalledWith(2, snapshot.columns, 'status', 'Failed');
    expect(deps.sheets.updateRowField).toHaveBeenCalledWith(
      2,
      snapshot.columns,
      'error',
      expect.stringContaining('manual reconciliation required'),
    );
  });
});
