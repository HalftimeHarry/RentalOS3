import PocketBase from 'pocketbase';
import { describe, expect, it, vi } from 'vitest';
import { PocketBaseBillRepository } from './PocketBaseBillRepository.server';
import { billFromLegacy } from './BillMapper';

const record = { id: 'bill1', collectionId: 'bill', rent: 100, dueDate: '2026-10-23', recipts: ['old.pdf'] };
function setup() {
  const pb = new PocketBase('http://development.invalid');
  const bill = {
    getOne: vi.fn(async () => record), getFullList: vi.fn(async () => [record]),
    create: vi.fn(async () => record), update: vi.fn(async () => record), delete: vi.fn(async () => true)
  };
  const rental = {
    getOne: vi.fn(async (): Promise<{ id: string; bills?: string[] }> => ({ id: 'rental1', bills: ['bill1'] })),
    getFullList: vi.fn(async () => [{ id: 'rental1', tenant: 'tenant1' }, { id: 'rental2', renter: 'user1' }, { id: 'rental3', tenant: 'other' }]),
    update: vi.fn(async () => ({}))
  };
  const tenants = { getFullList: vi.fn(async () => [{ id: 'tenant1', user: 'user1', status: 'active' }]) };
  vi.spyOn(pb, 'collection').mockImplementation(((name: string) => ({ bill, rental, tenants })[name as 'bill' | 'rental' | 'tenants']) as unknown as typeof pb.collection);
  return { repo: new PocketBaseBillRepository(pb), bill, rental, tenants };
}

describe('PocketBase billing adapter (mocked, no network)', () => {
  it('resolves tenant profile and direct-user rental ownership', async () => {
    const { repo } = setup();
    const rentals = await repo.listRentals('user1');
    expect(rentals.map((rental) => rental.ownerUserIds)).toEqual([['user1'], ['user1'], []]);
  });
  it('reads rental-side relations and creates receipt URLs outside the domain', async () => {
    const { repo, bill } = setup();
    expect((await repo.list('rental1'))[0].receipts).toEqual(['http://development.invalid/api/files/bill/bill1/old.pdf']);
    expect(bill.getFullList).not.toHaveBeenCalled();
  });
  it('does not swallow failed queries', async () => {
    const { repo, rental } = setup();
    rental.getOne.mockRejectedValueOnce(new Error('Unavailable'));
    await expect(repo.list('rental1')).rejects.toThrow('Unavailable');
  });
  it('rejects a reverse link to another rental bill', async () => {
    const { repo, bill } = setup();
    bill.getOne.mockResolvedValueOnce({ ...record, rental: 'otherRental' } as typeof record);
    await expect(repo.list('rental1')).rejects.toThrow('conflicting rental links');
  });
  it('rolls back creation when the rental link cannot be attached', async () => {
    const { repo, rental, bill } = setup();
    rental.update.mockRejectedValueOnce(new Error('Rule denied'));
    await expect(repo.save(billFromLegacy(record, 'rental1', '2026-10-23'), [], 'create')).rejects.toThrow('Rule denied');
    expect(bill.delete).toHaveBeenCalledWith('bill1', { requestKey: null });
  });
  it('appends uploads to the actual legacy file field and preserves old receipts', async () => {
    const { repo, bill } = setup();
    await repo.save(billFromLegacy(record, 'rental1', '2026-10-23'), [new File(['image'], 'new.png')], 'update');
    const upload = bill.update.mock.calls[1] as unknown as [string, FormData];
    expect(upload[1].getAll('recipts+')).toHaveLength(1);
    expect(upload[1].has('recipts')).toBe(false);
  });
  it('creates bills without requiring a reverse rental relation', async () => {
    const { repo, rental, bill } = setup();
    rental.getOne.mockResolvedValueOnce({ id: 'rental1' });
    await repo.save(billFromLegacy(record, 'rental1', '2026-10-23'), [], 'create');
    expect(bill.create).toHaveBeenCalled();
    expect(rental.update).not.toHaveBeenCalled();
    expect(bill.delete).not.toHaveBeenCalled();
  });
  it('deletes bills without requiring a reverse rental relation', async () => {
    const { repo, rental, bill } = setup();
    rental.getOne.mockResolvedValueOnce({ id: 'rental1' });
    await repo.delete('rental1', 'bill1');
    expect(bill.delete).toHaveBeenCalledWith('bill1', { requestKey: null });
    expect(rental.update).not.toHaveBeenCalled();
  });
});