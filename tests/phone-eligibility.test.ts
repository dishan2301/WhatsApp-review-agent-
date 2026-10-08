import { describe, expect, it } from 'vitest';

import type { SheetCustomerRow } from '../src/google/rows.js';
import { checkEligibility } from '../src/services/eligibility.js';
import { buildBilingualReviewMessages, buildReviewMessage } from '../src/services/message.js';
import { normalizeIndianPhone } from '../src/utils/phone.js';

const row: SheetCustomerRow = {
  rowNumber: 2,
  customerId: 'TEST-1',
  name: 'Asha',
  mobile: '98765 43210',
  product: 'phone repair',
  serviceType: 'Repair',
  consent: 'Yes',
  reviewSent: 'No',
  status: '',
  sentAt: '',
  error: '',
  completed: 'Completed',
};

describe('Phase 3 validation', () => {
  it('normalizes valid Indian phone numbers', () => {
    expect(normalizeIndianPhone('+91 98765-43210')).toBe('919876543210');
    expect(normalizeIndianPhone('9876543210')).toBe('919876543210');
  });

  it('rejects invalid phone numbers', () => {
    expect(normalizeIndianPhone('12345')).toBeNull();
    expect(normalizeIndianPhone('1111111111')).toBeNull();
  });

  it('requires consent, completion, an id, and an unsent state', () => {
    expect(checkEligibility(row)).toMatchObject({ eligible: true, phone: '919876543210' });
    expect(checkEligibility({ ...row, consent: 'No' })).toMatchObject({ eligible: false, reason: 'no_consent' });
    expect(checkEligibility({ ...row, completed: 'Pending' })).toMatchObject({ eligible: false, reason: 'not_completed' });
    expect(checkEligibility({ ...row, reviewSent: 'Yes' })).toMatchObject({ eligible: false, reason: 'already_sent' });
    expect(checkEligibility({ ...row, status: 'Pending' })).toMatchObject({ eligible: false, reason: 'unsafe_existing_status' });
    expect(checkEligibility({ ...row, status: 'English Sent' })).toMatchObject({ eligible: false, reason: 'unsafe_existing_status' });
    expect(checkEligibility({ ...row, status: 'Failed' })).toMatchObject({ eligible: false, reason: 'unsafe_existing_status' });
  });

  it('builds the approved message without misleading review text', () => {
    const message = buildReviewMessage(row, 'https://example.com/review');
    expect(message).toContain('Hi Asha');
    expect(message).toContain('phone repair');
    expect(message).toContain('https://example.com/review');
    expect(message.toLowerCase()).not.toContain('positive review');
  });

  it('builds separate English and Gujarati messages with the same review link', () => {
    const messages = buildBilingualReviewMessages(row, 'https://example.com/review');
    expect(messages.english).toContain('Thank you for choosing');
    expect(messages.gujarati).toContain('પસંદ કરવા બદલ આભાર');
    expect(messages.english).toContain('https://example.com/review');
    expect(messages.gujarati).toContain('https://example.com/review');
  });
});
