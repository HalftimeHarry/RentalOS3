import { Bill, BillingError, centsToDollars, dateOnly, dollarsToCents, isPaymentState } from '../domain/Bill';

export type LegacyRecord = Record<string, unknown>;

export function relationIds(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(relationIds);
  if (value && typeof value === 'object' && 'id' in value) return relationIds(value.id);
  return [];
}

export function receiptField(record: LegacyRecord): 'receipts' | 'recipts' {
  return 'recipts' in record || !('receipts' in record) ? 'recipts' : 'receipts';
}

export function receiptRefs(record: LegacyRecord): string[] {
  const refs = [record.recipts, record.receipts].flatMap((value) => Array.isArray(value) ? value : []);
  return [...new Set(refs.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim()))];
}

export function billFromLegacy(record: LegacyRecord, rentalId: string, today: string): Bill {
  const status = isPaymentState(record.status) ? record.status : record.status ? 'open' : record.paid === true ? 'paid' : 'open';
  if (record.notes !== undefined && typeof record.notes !== 'string') throw new BillingError('Stored bill notes are invalid.', 502);
  return new Bill({
    id: String(record.id ?? ''), rentalId,
    rentCents: dollarsToCents(record.rent ?? 0, true),
    sdgeCents: dollarsToCents(record.sdge ?? 0, true),
    attCents: dollarsToCents(record.att ?? 0, true),
    dueDate: record.dueDate ? dateOnly(record.dueDate, true) : today,
    status,
    paidDate: status === 'paid' && record.paidDate ? dateOnly(record.paidDate, true) : '',
    notes: record.notes ?? ''
  });
}

export function billToLegacy(bill: Bill): LegacyRecord {
  const { data } = bill;
  return {
    rent: centsToDollars(data.rentCents), sdge: centsToDollars(data.sdgeCents), att: centsToDollars(data.attCents),
    total: centsToDollars(bill.totalCents), dueDate: data.dueDate,
    status: data.status, paid: data.status === 'paid', paidDate: data.paidDate, notes: data.notes
  };
}