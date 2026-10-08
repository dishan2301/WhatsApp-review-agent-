import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { hashPhone, MessageLedger } from '../src/queue/messageLedger.js';

describe('MessageLedger', () => {
  it('persists per-language progress without storing the raw phone', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'swastik-ledger-')), 'queue.sqlite');
    const ledger = new MessageLedger(path);
    ledger.reserve('T-1', 2, '919876543210', '2026-08-08T12:00:00.000Z');
    ledger.markEnglishSent('T-1', 'english-id', '2026-08-08T12:00:01.000Z');
    expect(ledger.get('T-1')).toMatchObject({
      state: 'english_sent',
      phoneHash: hashPhone('919876543210'),
      englishProviderId: 'english-id',
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    ledger.close();

    const reopened = new MessageLedger(path);
    expect(reopened.get('T-1')?.state).toBe('english_sent');
    reopened.markComplete('T-1', 'gujarati-id', '2026-08-08T12:00:02.000Z');
    expect(reopened.get('T-1')).toMatchObject({ state: 'complete', gujaratiProviderId: 'gujarati-id' });
    expect(reopened.getByPhone('919876543210')?.transactionId).toBe('T-1');
    expect(() => reopened.reserve('T-2', 3, '919876543210', '2026-08-08T12:00:03.000Z'))
      .toThrow('duplicate send blocked');
    reopened.close();
  });
});
