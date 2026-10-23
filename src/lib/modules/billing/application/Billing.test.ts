import { describe, expect, it, vi } from 'vitest';
import { Billing, todayInLosAngeles } from './Billing';
import type { BillRepository } from './BillRepository';
import { billFromLegacy, billToLegacy, receiptField, receiptRefs, relationIds } from '../infrastructure/BillMapper';

const legacy = { id: 'bill1', rent: 1000.01, sdge: 0.1, att: 0.2, dueDate: '2026-10-23 00:00:00.000Z', paid: true, total: 5 };
const bill = billFromLegacy(legacy, 'rental1', '2026-10-23');
function repository(): BillRepository {
  return {
    listRentals: vi.fn(async () => [{ id: 'rental1', address: 'Home', rent: 1000, ownerUserIds: ['renter1'] }]),
    renterStatus: vi.fn(async () => 'active'),
    list: vi.fn(async () => [{ bill, receipts: [] }]),
    save: vi.fn(async (saved) => ({ bill: saved, receipts: [] })), delete: vi.fn(async () => {})
  };
}

describe('billing mapping', () => {
  it('converts legacy dollars, recomputes totals, and normalizes dates', () => {
    expect(bill.totalCents).toBe(100031);
    expect(bill.data.dueDate).toBe('2026-10-23');
    expect(bill.data.status).toBe('paid');
    expect(billToLegacy(bill)).toMatchObject({ total: 1000.31, status: 'paid', paid: true });
  });
  it('makes status authoritative and removes stale paid dates', () => {
    const open = billFromLegacy({ ...legacy, status: 'open', paidDate: '2026-10-22' }, 'rental1', '2026-10-23');
    expect(billToLegacy(open)).toMatchObject({ status: 'open', paid: false, paidDate: '' });
    expect(billFromLegacy({ ...legacy, status: 'unknown' }, 'rental1', '2026-10-23').data.status).toBe('open');
  });
  it('supports both receipt spellings and relation representations', () => {
    expect(receiptRefs({ recipts: ['a.pdf'], receipts: ['b.jpg', 'a.pdf'] })).toEqual(['a.pdf', 'b.jpg']);
    expect(receiptField({ receipts: [] })).toBe('receipts');
    expect(receiptField({})).toBe('recipts');
    expect(relationIds(['one', { id: 'two' }])).toEqual(['one', 'two']);
  });
  it('uses the Los Angeles calendar date near UTC midnight', () => {
    expect(todayInLosAngeles(new Date('2026-10-23T01:00:00Z'))).toBe('2026-10-22');
  });
});

describe('billing authorization and actions', () => {
  it('denies anonymous access', () => {
    expect(() => new Billing(repository(), { id: '', role: 'renter' })).toThrow('Sign in');
  });
  it('lets renters read only their verified rental', async () => {
    const repo = repository();
    expect(await new Billing(repo, { id: 'renter1', role: 'renter' }).list('rental1')).toHaveLength(1);
    repo.list = vi.fn();
    await expect(new Billing(repo, { id: 'other', role: 'renter' }).list('rental1')).rejects.toThrow('access denied');
    expect(repo.list).not.toHaveBeenCalled();
  });
  it('rejects renter mutations before repository writes', async () => {
    const repo = repository();
    const billing = new Billing(repo, { id: 'renter1', role: 'renter' });
    await expect(billing.save({})).rejects.toThrow('Only admins');
    await expect(billing.markPaid('rental1', 'bill1')).rejects.toThrow('Only admins');
    await expect(billing.delete('rental1', 'bill1')).rejects.toThrow('Only admins');
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });
  it('marks paid server-side and refuses cross-rental bill IDs', async () => {
    const repo = repository();
    const billing = new Billing(repo, { id: 'admin1', role: 'admin' }, () => '2026-10-24');
    expect(await billing.markPaid('rental1', 'bill1')).toMatchObject({ status: 'paid', paid: true, paidDate: '2026-10-24' });
    await expect(billing.delete('rental1', 'anotherbill')).rejects.toThrow('Bill not found');
    expect(repo.delete).not.toHaveBeenCalled();
  });
  it('validates external input instead of trusting supplied total or paid', async () => {
    const billing = new Billing(repository(), { id: 'admin1', role: 'admin' }, () => '2026-10-23');
    const input = { rental: 'rental1', rent: '1.10', sdge: '0.20', att: '0.30', status: 'open', total: 999, paid: true };
    expect(await billing.save(input)).toMatchObject({ total: 1.6, paid: false, dueDate: '2026-10-23' });
    await expect(billing.save({ ...input, rent: '1.001' })).rejects.toThrow('two decimal');
    await expect(billing.save({ ...input, dueDate: '2026-02-30' })).rejects.toThrow('calendar');
    await expect(billing.save({ ...input, status: 'invalid' })).rejects.toThrow('payment state');
  });
  it('filters before pagination and clamps pages after searching', async () => {
    const repo = repository();
    repo.list = vi.fn(async () => Array.from({ length: 15 }, (_, index) => ({
      bill: billFromLegacy({ ...legacy, id: `bill${index}`, status: index < 11 ? 'open' : 'paid', notes: index === 14 ? 'Special' : '' }, 'rental1', '2026-10-23'), receipts: []
    })));
    const billing = new Billing(repo, { id: 'renter1', role: 'renter' });
    expect(await billing.page('rental1', '', 'paid', 2)).toMatchObject({ page: 1, totalItems: 4 });
    expect((await billing.page('rental1', 'special')).items[0].id).toBe('bill14');
    await expect(billing.page('rental1', '', 'all', NaN)).rejects.toThrow('pagination');
  });
  it('does not convert repository failures into empty lists', async () => {
    const repo = repository();
    repo.list = vi.fn(async () => { throw new Error('Backend unavailable'); });
    await expect(new Billing(repo, { id: 'admin1', role: 'admin' }).list('rental1')).rejects.toThrow('Backend unavailable');
  });
});