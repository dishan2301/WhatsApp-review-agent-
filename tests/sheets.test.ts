import { describe, expect, it, vi } from 'vitest';

import { GoogleSheetsService, type SheetsValuesApi } from '../src/google/sheets.js';

describe('GoogleSheetsService', () => {
  it('reads rows using a mocked Google Sheets API', async () => {
    const api: SheetsValuesApi = {
      get: vi.fn().mockResolvedValue({
        data: { values: [['Customer ID', 'Name', 'Mobile'], ['C-1', 'Asha', '9876543210']] },
      }),
      update: vi.fn(),
    };
    const snapshot = await new GoogleSheetsService('sheet-id', 'Customers', api).readSnapshot();
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({ customerId: 'C-1', name: 'Asha', mobile: '9876543210' });
    expect(api.get).toHaveBeenCalledWith(expect.objectContaining({ spreadsheetId: 'sheet-id' }));
  });

  it('updates only the requested status cell using RAW values', async () => {
    const api: SheetsValuesApi = { get: vi.fn(), update: vi.fn().mockResolvedValue({}) };
    const service = new GoogleSheetsService('sheet-id', 'Customers', api);
    await service.updateRowField(7, { status: 4 }, 'status', 'Pending');
    expect(api.update).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      range: "'Customers'!E7",
      valueInputOption: 'RAW',
      requestBody: { values: [['Pending']] },
    });
  });

  it('writes, verifies, and restores a dedicated test cell', async () => {
    let cell = 'original';
    const api: SheetsValuesApi = {
      get: vi.fn().mockImplementation(async () => ({ data: { values: [[cell]] } })),
      update: vi.fn().mockImplementation(async params => {
        cell = String(params.requestBody?.values?.[0]?.[0] ?? '');
        return {};
      }),
    };
    await new GoogleSheetsService('sheet-id', 'Customers', api).verifyWriteAndRestore('Phase2 Test!A1');
    expect(cell).toBe('original');
    expect(api.update).toHaveBeenCalledTimes(2);
    expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ range: "'Phase2 Test'!A1" }));
  });
});
