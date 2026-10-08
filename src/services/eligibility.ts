import type { SheetCustomerRow } from '../google/rows.js';
import { normalizeIndianPhone } from '../utils/phone.js';

const YES = new Set(['yes', 'y', 'true', '1']);
const COMPLETED = new Set(['yes', 'y', 'true', '1', 'complete', 'completed', 'done', 'delivered', 'closed']);

export interface EligibilityResult {
  eligible: boolean;
  phone: string | null;
  reason?: string;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('en-IN');
}

export function checkEligibility(row: SheetCustomerRow): EligibilityResult {
  const phone = normalizeIndianPhone(row.mobile);
  if (!phone) return { eligible: false, phone: null, reason: 'invalid_phone' };
  if (!row.customerId) return { eligible: false, phone, reason: 'missing_customer_id' };
  if (!YES.has(normalized(row.consent))) return { eligible: false, phone, reason: 'no_consent' };
  if (YES.has(normalized(row.reviewSent))) return { eligible: false, phone, reason: 'already_sent' };
  if (!COMPLETED.has(normalized(row.completed))) return { eligible: false, phone, reason: 'not_completed' };
  if (['pending', 'queued', 'english sent', 'sent', 'delivered', 'failed', 'ambiguous'].includes(normalized(row.status))) {
    return { eligible: false, phone, reason: 'unsafe_existing_status' };
  }
  return { eligible: true, phone };
}
