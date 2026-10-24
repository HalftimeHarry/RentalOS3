import { describe, expect, it } from 'vitest';
import { Bill, centsToDollars, dateOnly, dollarsToCents, type BillSnapshot } from './Bill';

const snapshot: BillSnapshot = {
  id: 'bill1', rentalId: 'rental1', rentCents: 100001, sdgeCents: 10, attCents: 20,
  dueDate: '2026-10-23', status: 'open', paidDate: '', notes: ''
};

describe('billing domain', () => {
  it('totals integer cents and supports signed credits', () => {
    expect(new Bill(snapshot).totalCents).toBe(100031);
    expect(new Bill({ ...snapshot, attCents: -20 }).totalCents).toBe(99991);
  });

  it('converts dollars explicitly without floating point totals', () => {
    expect(dollarsToCents('0.10') + dollarsToCents('0.20')).toBe(30);
    expect(dollarsToCents('1.005', true)).toBe(101);
    expect(dollarsToCents('-1.005', true)).toBe(-101);
    expect(dollarsToCents('10.075', true)).toBe(1008);
    expect(dollarsToCents('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => dollarsToCents('90071992547409.92')).toThrow();
    expect(centsToDollars(12345)).toBe(123.45);
    for (const invalid of ['', 'NaN', 'Infinity', '1.005', null, {}, 1e20]) {
      expect(() => dollarsToCents(invalid)).toThrow();
    }
    expect(() => centsToDollars(1.5)).toThrow();
  });

  it('preserves date-only values across timestamp offsets and leap days', () => {
    expect(dateOnly('2024-02-29')).toBe('2024-02-29');
    expect(dateOnly('2026-10-23T00:00:00+14:00', true)).toBe('2026-10-23');
    expect(dateOnly('2026-10-23 00:00:00.000Z', true)).toBe('2026-10-23');
    for (const invalid of ['2026-02-29', '2026-04-31', '2026-13-01', '10/23/2026']) {
      expect(() => dateOnly(invalid)).toThrow();
    }
  });

  it('allows existing state transitions and clears non-paid payment dates', () => {
    const paid = new Bill(snapshot).transition('paid', '2026-10-23');
    expect(paid.data.paidDate).toBe('2026-10-23');
    expect(paid.transition('open', '2026-10-24').data.paidDate).toBe('');
    expect(paid.transition('void', '2026-10-24').transition('paid', '2026-10-25').data.paidDate).toBe('2026-10-25');
    expect(paid.transition('overdue', '2026-10-24').data.status).toBe('overdue');
  });

  it('rejects unsafe totals and fractional cent charges', () => {
    expect(() => new Bill({ ...snapshot, rentCents: 1.5 })).toThrow();
    expect(() => new Bill({ ...snapshot, rentCents: Number.MAX_SAFE_INTEGER })).toThrow();
  });
});