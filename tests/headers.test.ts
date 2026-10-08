import { describe, expect, it } from 'vitest';

import { detectColumns } from '../src/google/headers.js';
import { parseCustomerRows } from '../src/google/rows.js';

describe('Sheet parsing', () => {
  it('detects normalized columns without depending on order', () => {
    expect(detectColumns(['Product', ' WhatsApp Consent ', 'Customer_ID', 'Mobile Number', 'Review Message Sent'])).toEqual({
      customerId: 2,
      mobile: 3,
      product: 0,
      consent: 1,
      reviewSent: 4,
    });
  });

  it('normalizes row values and preserves the actual Sheet row number', () => {
    const values = [
      ['Mobile', 'Name', 'Message Status'],
      [' 9876543210 ', ' Asha ', ' Pending '],
    ];
    const rows = parseCustomerRows(values, detectColumns(values[0] ?? []));
    expect(rows[0]).toMatchObject({ rowNumber: 2, mobile: '9876543210', name: 'Asha', status: 'Pending' });
  });
});
