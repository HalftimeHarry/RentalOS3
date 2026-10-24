export const paymentStates = ['open', 'paid', 'overdue', 'void'] as const;
export type PaymentState = (typeof paymentStates)[number];

export class BillingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'BillingError';
  }
}

export function isPaymentState(value: unknown): value is PaymentState {
  return typeof value === 'string' && paymentStates.some((state) => state === value);
}

export function dollarsToCents(value: unknown, legacy = false): number {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new BillingError('Amount must be a number.');
  }
  const text = String(value).trim();
  if (!text || !/^-?\d+(?:\.\d+)?$/.test(text)) throw new BillingError('Invalid amount.');
  if (!legacy && !/^-?\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new BillingError('Amounts must use at most two decimal places.');
  }
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const rounded = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2)) + (legacy && Number(fraction[2] ?? 0) >= 5 ? 1n : 0n);
  const cents = Number(negative ? -rounded : rounded);
  if (!Number.isSafeInteger(cents)) throw new BillingError('Amount is outside the supported range.');
  return cents === 0 ? 0 : cents;
}

export function centsToDollars(cents: number): number {
  if (!Number.isSafeInteger(cents)) throw new BillingError('Amount must be integer cents.');
  return cents / 100;
}

export function dateOnly(value: unknown, legacy = false): string {
  if (typeof value !== 'string') throw new BillingError('Date must be YYYY-MM-DD.');
  const text = value.trim();
  const normalized = legacy && /^\d{4}-\d{2}-\d{2}[T ]/.test(text) ? text.slice(0, 10) : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new BillingError('Date must be YYYY-MM-DD.');
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new BillingError('Invalid calendar date.');
  }
  return normalized;
}

export interface BillSnapshot {
  id: string;
  rentalId: string;
  rentCents: number;
  sdgeCents: number;
  attCents: number;
  dueDate: string;
  status: PaymentState;
  paidDate: string;
  notes: string;
}

export class Bill {
  readonly data: Readonly<BillSnapshot>;

  constructor(data: BillSnapshot) {
    for (const amount of [data.rentCents, data.sdgeCents, data.attCents]) {
      if (!Number.isSafeInteger(amount)) throw new BillingError('Charges must be integer cents.');
    }
    if (!Number.isSafeInteger(data.rentCents + data.sdgeCents + data.attCents)) {
      throw new BillingError('Total is outside the supported range.');
    }
    if (!data.rentalId) throw new BillingError('A rental is required.');
    if (!isPaymentState(data.status)) throw new BillingError('Invalid payment state.');
    this.data = Object.freeze({
      ...data,
      dueDate: dateOnly(data.dueDate),
      paidDate: data.status === 'paid' && data.paidDate ? dateOnly(data.paidDate) : ''
    });
  }

  get totalCents(): number {
    return this.data.rentCents + this.data.sdgeCents + this.data.attCents;
  }

  transition(status: PaymentState, today: string, paidDate = ''): Bill {
    return new Bill({
      ...this.data,
      status,
      paidDate: status === 'paid' ? dateOnly(paidDate || today) : ''
    });
  }
}