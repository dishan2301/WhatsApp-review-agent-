import { google, type sheets_v4 } from 'googleapis';

import type { GoogleConfig } from '../config/env.js';
import { detectColumns, type ColumnMap, type LogicalColumn } from './headers.js';
import { parseCustomerRows, type SheetCustomerRow } from './rows.js';

export interface SheetsValuesApi {
  get(params: sheets_v4.Params$Resource$Spreadsheets$Values$Get): Promise<{ data: sheets_v4.Schema$ValueRange }>;
  update(params: sheets_v4.Params$Resource$Spreadsheets$Values$Update): Promise<unknown>;
}

export interface SheetSnapshot {
  columns: ColumnMap;
  headers: string[];
  rows: SheetCustomerRow[];
}

function quoteSheetName(name: string): string {
  return `'${name.replaceAll("'", "''")}'`;
}

function qualifyRange(defaultSheetName: string, a1Range: string): string {
  const separator = a1Range.lastIndexOf('!');
  if (separator < 0) return `${quoteSheetName(defaultSheetName)}!${a1Range}`;
  const suppliedSheetName = a1Range.slice(0, separator).trim();
  const cellOrRange = a1Range.slice(separator + 1).trim();
  const unquotedSheetName =
    suppliedSheetName.startsWith("'") && suppliedSheetName.endsWith("'")
      ? suppliedSheetName.slice(1, -1).replaceAll("''", "'")
      : suppliedSheetName;
  return `${quoteSheetName(unquotedSheetName)}!${cellOrRange}`;
}

function columnLetter(index: number): string {
  let number = index + 1;
  let result = '';
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

export class GoogleSheetsService {
  constructor(
    private readonly spreadsheetId: string,
    private readonly sheetName: string,
    private readonly valuesApi: SheetsValuesApi,
  ) {}

  static create(config: GoogleConfig): GoogleSheetsService {
    const auth = new google.auth.GoogleAuth({
      credentials: config.credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    return new GoogleSheetsService(config.spreadsheetId, config.sheetName, sheets.spreadsheets.values);
  }

  async readSnapshot(): Promise<SheetSnapshot> {
    const response = await this.valuesApi.get({
      spreadsheetId: this.spreadsheetId,
      range: `${quoteSheetName(this.sheetName)}!A:ZZ`,
      majorDimension: 'ROWS',
    });
    const values = response.data.values ?? [];
    if (values.length === 0) throw new Error(`Sheet "${this.sheetName}" is empty or unavailable.`);
    const headers = (values[0] ?? []).map(value => String(value ?? '').trim());
    const columns = detectColumns(headers);
    return { headers, columns, rows: parseCustomerRows(values, columns) };
  }

  async updateRowField(rowNumber: number, columns: ColumnMap, field: LogicalColumn, value: string): Promise<void> {
    if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new Error('Sheet row number must be an integer >= 2.');
    const columnIndex = columns[field];
    if (columnIndex === undefined) throw new Error(`Required Sheet column is missing: ${field}`);
    await this.updateCell(`${columnLetter(columnIndex)}${rowNumber}`, value);
  }

  async updateCell(a1Cell: string, value: string): Promise<void> {
    const range = qualifyRange(this.sheetName, a1Cell);
    await this.valuesApi.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [[value]] },
    });
  }

  async readCell(a1Cell: string): Promise<string> {
    const range = qualifyRange(this.sheetName, a1Cell);
    const response = await this.valuesApi.get({ spreadsheetId: this.spreadsheetId, range });
    return String(response.data.values?.[0]?.[0] ?? '');
  }

  async verifyWriteAndRestore(a1Cell: string): Promise<void> {
    const original = await this.readCell(a1Cell);
    const marker = `OPENWA_PHASE2_TEST_${new Date().toISOString()}`;
    try {
      await this.updateCell(a1Cell, marker);
      const observed = await this.readCell(a1Cell);
      if (observed !== marker) throw new Error('Google Sheets write verification did not read back the test marker.');
    } finally {
      await this.updateCell(a1Cell, original);
    }
  }
}
