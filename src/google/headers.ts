export const COLUMN_KEYWORDS = {
  customerId: ['customer id', 'transaction id', 'invoice id'],
  name: ['name', 'customer name'],
  mobile: ['mobile', 'phone', 'contact', 'number'],
  product: ['product', 'item', 'device'],
  serviceType: ['service type', 'service'],
  consent: ['whatsapp consent', 'consent'],
  reviewSent: ['review message sent', 'review sent'],
  status: ['message status', 'status'],
  sentAt: ['sent at'],
  error: ['error'],
  completed: ['completed', 'transaction status', 'service status'],
  reviewCompleted: ['review completed', 'google review completed', 'review received'],
  followupStatus: ['follow up status', 'followup status'],
  followupSentAt: ['follow up sent at', 'followup sent at'],
} as const;

export type LogicalColumn = keyof typeof COLUMN_KEYWORDS;
export type ColumnMap = Partial<Record<LogicalColumn, number>>;

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('en-IN')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function detectColumns(headers: readonly unknown[]): ColumnMap {
  const normalized = headers.map(normalizeHeader);
  const columns: ColumnMap = {};

  for (const [field, keywords] of Object.entries(COLUMN_KEYWORDS) as [LogicalColumn, readonly string[]][]) {
    const exact = normalized.findIndex(header => keywords.includes(header));
    const partial = normalized.findIndex(header => keywords.some(keyword => header.includes(keyword)));
    const index = exact >= 0 ? exact : partial;
    if (index >= 0) columns[field] = index;
  }

  return columns;
}
