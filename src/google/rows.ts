import type { ColumnMap } from './headers.js';

export interface SheetCustomerRow {
  rowNumber: number;
  customerId: string;
  name: string;
  mobile: string;
  product: string;
  serviceType: string;
  consent: string;
  reviewSent: string;
  status: string;
  sentAt: string;
  error: string;
  completed: string;
  reviewCompleted?: string;
  followupStatus?: string;
  followupSentAt?: string;
}

function cell(row: readonly unknown[], index: number | undefined): string {
  return index === undefined ? '' : String(row[index] ?? '').trim();
}

export function parseCustomerRows(values: readonly (readonly unknown[])[], columns: ColumnMap): SheetCustomerRow[] {
  return values.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    customerId: cell(row, columns.customerId),
    name: cell(row, columns.name),
    mobile: cell(row, columns.mobile),
    product: cell(row, columns.product),
    serviceType: cell(row, columns.serviceType),
    consent: cell(row, columns.consent),
    reviewSent: cell(row, columns.reviewSent),
    status: cell(row, columns.status),
    sentAt: cell(row, columns.sentAt),
    error: cell(row, columns.error),
    completed: cell(row, columns.completed),
    reviewCompleted: cell(row, columns.reviewCompleted),
    followupStatus: cell(row, columns.followupStatus),
    followupSentAt: cell(row, columns.followupSentAt),
  }));
}
