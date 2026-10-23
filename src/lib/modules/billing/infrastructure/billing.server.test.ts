import PocketBase, { ClientResponseError, type RecordModel } from 'pocketbase';
import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { load as billsLoad, actions as billsActions } from '../../../../routes/bills/+page.server';
import { load as dashboardLoad, actions as dashboardActions } from '../../../../routes/dashboard/+page.server';

function setup(role: 'admin' | 'renter' = 'admin', userId = 'user1') {
  const pb = new PocketBase('http://development.invalid');
  pb.authStore.save('', { id: userId, role, collectionId: 'users', collectionName: 'users' });
  vi.spyOn(pb.authStore, 'isValid', 'get').mockReturnValue(true);
  let records: RecordModel[] = [];
  const rentalRecord = { id: 'rental1', address: 'One bedroom', rent: 1800, renter: 'user1' };
  const bill = {
    getFullList: vi.fn(async () => records),
    create: vi.fn(async (input: Record<string, unknown>) => {
      const record = { ...input, id: 'bill00000000001', collectionId: 'bill', collectionName: 'bill' } as RecordModel;
      records = [...records, record];
      return record;
    }),
    update: vi.fn(async (id: string, input: Record<string, unknown>) => {
      const record = { ...records.find((entry) => entry.id === id), ...input } as RecordModel;
      records = records.map((entry) => entry.id === id ? record : entry);
      return record;
    }),
    delete: vi.fn(async (id: string) => {
      records = records.filter((entry) => entry.id !== id);
      return true;
    })
  };
  const rental = {
    getFullList: vi.fn(async () => [rentalRecord]),
    getOne: vi.fn(async () => rentalRecord)
  };
  const tenants = { getFullList: vi.fn(async () => [{ id: 'tenant1', user: userId, status: 'active' }]) };
  vi.spyOn(pb, 'collection').mockImplementation(((name: string) =>
    ({ bill, rental, tenants })[name as 'bill' | 'rental' | 'tenants']) as unknown as typeof pb.collection);
  function event<Route extends '/bills' | '/dashboard' = '/bills'>(
    fields: Record<string, string> = {}, search = '', route: Route = '/bills' as Route
  ): RequestEvent<Record<string, never>, Route> {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    return {
      locals: { pb }, url: new URL(`http://localhost${route}${search}`),
      request: { formData: async () => form }
    } as unknown as RequestEvent<Record<string, never>, Route>;
  }
  return { pb, bill, rental, event };
}

const input = {
  rental: 'rental1', rent: '1800.01', sdge: '0.10', att: '0.20',
  dueDate: '2026-10-23', status: 'open', notes: 'October'
};

describe('billing server loads and actions (mocked PocketBase, no network)', () => {
  it('preserves admin dashboard creation, editing, paid status, and deletion', async () => {
    const { event, bill } = setup();
    expect(await dashboardActions.createBill(event(input, '', '/dashboard'))).toEqual({ success: true });
    expect(bill.create).toHaveBeenCalledWith(expect.objectContaining({ total: 1800.31, rental: 'rental1' }), expect.anything());
    expect(await dashboardLoad(event() as Parameters<typeof dashboardLoad>[0])).toMatchObject({
      billing: { isAdmin: true, bills: [{ total: 1800.31, status: 'open', dueDate: '2026-10-23' }] }
    });
    expect(await billsActions.save(event({ ...input, id: 'bill00000000001', rent: '1700', notes: 'Credit applied' }))).toEqual({ success: true });
    expect(await billsActions.markPaid(event({ rental: 'rental1', id: 'bill00000000001' }))).toEqual({ success: true });
    expect(await billsLoad(event({}, '?status=paid&q=Credit&page=2') as Parameters<typeof billsLoad>[0])).toMatchObject({
      billPage: { page: 1, totalItems: 1, items: [{ total: 1700.3, status: 'paid', paid: true, notes: 'Credit applied' }] }
    });
    expect(await billsActions.delete(event({ rental: 'rental1', id: 'bill00000000001' }))).toEqual({ success: true });
    expect(await billsLoad(event() as Parameters<typeof billsLoad>[0])).toMatchObject({ billPage: { totalItems: 0 } });
  });

  it('lets renters view their bills and rejects every forged mutation', async () => {
    const { event, bill } = setup('renter');
    expect(await billsLoad(event() as Parameters<typeof billsLoad>[0])).toMatchObject({ isAdmin: false, status: 'open' });
    expect(await dashboardLoad(event() as Parameters<typeof dashboardLoad>[0])).toMatchObject({ billing: { isAdmin: false } });
    for (const action of [billsActions.save, billsActions.markPaid, billsActions.delete]) {
      expect(await action(event(input))).toMatchObject({ status: 403, data: { message: 'Only admins can change bills.' } });
    }
    expect(await dashboardActions.createBill(event(input, '', '/dashboard'))).toMatchObject({ status: 403 });
    expect(bill.create).not.toHaveBeenCalled();
    expect(bill.update).not.toHaveBeenCalled();
    expect(bill.delete).not.toHaveBeenCalled();
  });

  it('rejects other-renter rental selection before bill queries', async () => {
    const { event, bill } = setup('renter', 'otherUser');
    await expect(billsLoad(event({}, '?id=rental1') as Parameters<typeof billsLoad>[0])).rejects.toMatchObject({ status: 403 });
    expect(bill.getFullList).not.toHaveBeenCalled();
  });

  it('redirects anonymous loads and denies anonymous actions', async () => {
    const { event, pb, bill } = setup();
    vi.spyOn(pb.authStore, 'isValid', 'get').mockReturnValue(false);
    await expect(billsLoad(event() as Parameters<typeof billsLoad>[0])).rejects.toMatchObject({ status: 303, location: '/login' });
    expect(await billsActions.save(event(input))).toMatchObject({ status: 401 });
    expect(bill.create).not.toHaveBeenCalled();
  });

  it('validates malformed external input without writing', async () => {
    const { event, bill } = setup();
    for (const patch of [{ rent: 'NaN' }, { dueDate: '2026-02-30' }, { status: 'bogus' }]) {
      expect(await billsActions.save(event({ ...input, ...patch }))).toMatchObject({ status: 400 });
    }
    expect(bill.create).not.toHaveBeenCalled();
  });

  it('reports permission and backend failures rather than empty results', async () => {
    const { event, bill } = setup();
    bill.getFullList.mockRejectedValueOnce(new ClientResponseError({ status: 403 }));
    await expect(billsLoad(event() as Parameters<typeof billsLoad>[0])).rejects.toMatchObject({ status: 403 });
    bill.getFullList.mockRejectedValueOnce(new Error('Offline'));
    await expect(dashboardLoad(event() as Parameters<typeof dashboardLoad>[0])).rejects.toMatchObject({ status: 502 });
  });
});