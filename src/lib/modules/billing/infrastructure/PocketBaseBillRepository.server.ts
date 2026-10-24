import PocketBase, { type RecordModel } from 'pocketbase';
import type { BillRepository, BillingRental, StoredBill } from '../application/BillRepository';
import { todayInLosAngeles } from '../application/Billing';
import { Bill, BillingError } from '../domain/Bill';
import { billFromLegacy, billToLegacy, receiptField, receiptRefs, relationIds, type LegacyRecord } from './BillMapper';

export class PocketBaseBillRepository implements BillRepository {
  private profiles = new Map<string, Promise<RecordModel[]>>();

  constructor(private readonly pb: PocketBase) {}

  private tenantProfiles(userId: string): Promise<RecordModel[]> {
    let result = this.profiles.get(userId);
    if (!result) {
      result = this.pb.collection('tenants').getFullList({
        filter: this.pb.filter('user = {:userId}', { userId }), sort: '-created', requestKey: null
      });
      this.profiles.set(userId, result);
    }
    return result;
  }

  async renterStatus(userId: string): Promise<string> {
    return String((await this.tenantProfiles(userId))[0]?.status ?? 'applying');
  }

  async listRentals(userId: string): Promise<BillingRental[]> {
    const isAdmin = this.pb.authStore.record?.role === 'admin';
    const profiles = isAdmin ? [] : await this.tenantProfiles(userId);
    const ownedRelations = new Set([userId, ...profiles.map((profile) => profile.id)]);
    const records = await this.pb.collection('rental').getFullList({ sort: '-created', requestKey: null });
    return records.map((record) => ({
      id: record.id,
      address: typeof record.address === 'string' ? record.address : '',
      rent: typeof record.rent === 'number' ? record.rent : 0,
      ownerUserIds: [...relationIds(record.tenant), ...relationIds(record.renter)]
        .some((id) => ownedRelations.has(id)) ? [userId] : []
    }));
  }

  private toStored(record: RecordModel, rentalId: string): StoredBill {
    const canonicalRentals = relationIds(record.rental);
    if (canonicalRentals.length && (canonicalRentals.length !== 1 || canonicalRentals[0] !== rentalId)) {
      throw new BillingError('A bill has conflicting rental links. Ask an admin to reconcile the record.', 502);
    }
    const receipts = receiptRefs(record).map((ref) => {
      if (/^https?:\/\//i.test(ref) || ref.startsWith('blob:') || ref.startsWith('data:')) return ref;
      if (ref.startsWith('/api/files/')) return `${this.pb.baseURL}${ref}`;
      if (ref.startsWith('/') && !ref.startsWith('//')) return ref;
      return this.pb.files.getURL(record, ref.split('/').pop() ?? ref);
    });
    return { bill: billFromLegacy(record, rentalId, todayInLosAngeles()), receipts };
  }

  async list(rentalId: string): Promise<StoredBill[]> {
    const rental = await this.pb.collection('rental').getOne(rentalId, { requestKey: null });
    const ids = [...new Set(relationIds(rental.bills))];
    if (ids.length) {
      const records = await Promise.all(ids.map((id) => this.pb.collection('bill').getOne(id, { requestKey: null })));
      return records.map((record) => this.toStored(record, rentalId));
    }
    const records = await this.pb.collection('bill').getFullList({ sort: '-dueDate', requestKey: null });
    return records.filter((record) => relationIds(record.rental).includes(rentalId))
      .map((record) => this.toStored(record, rentalId));
  }

  private payload(bill: Bill): LegacyRecord {
    return { ...billToLegacy(bill), rental: bill.data.rentalId };
  }

  private async attachFiles(record: RecordModel, files: File[]): Promise<RecordModel> {
    if (!files.length) return record;
    const form = new FormData();
    for (const file of files) form.append(`${receiptField(record)}+`, file, file.name);
    return this.pb.collection('bill').update(record.id, form, { requestKey: null });
  }

  async save(bill: Bill, files: File[], mode: 'create' | 'update'): Promise<StoredBill> {
    if (mode === 'update') {
      const saved = await this.pb.collection('bill').update(bill.data.id, this.payload(bill), { requestKey: null });
      try {
        return this.toStored(await this.attachFiles(saved, files), bill.data.rentalId);
      } catch (cause) {
        if (!files.length) throw cause;
        throw new BillingError('Bill details were saved, but receipts could not be uploaded. Refresh before retrying.', 502);
      }
    }
    const rental = await this.pb.collection('rental').getOne(bill.data.rentalId, { requestKey: null });
    const created = await this.pb.collection('bill').create({
      ...this.payload(bill), ...(bill.data.id ? { id: bill.data.id } : {})
    }, { requestKey: null });
    try {
      const saved = await this.attachFiles(created, files);
      if ('bills' in rental) {
        await this.pb.collection('rental').update(bill.data.rentalId, { 'bills+': [created.id] }, { requestKey: null });
      }
      return this.toStored(saved, bill.data.rentalId);
    } catch (cause) {
      try {
        await this.pb.collection('bill').delete(created.id, { requestKey: null });
      } catch {
        throw new BillingError(`Bill ${created.id} was created but could not be fully attached or rolled back. Ask an admin to reconcile it before retrying.`, 502);
      }
      throw cause;
    }
  }

  async delete(rentalId: string, billId: string): Promise<void> {
    const rental = await this.pb.collection('rental').getOne(rentalId, { requestKey: null });
    await this.pb.collection('bill').delete(billId, { requestKey: null });
    if (!('bills' in rental)) return;
    try {
      await this.pb.collection('rental').update(rentalId, { 'bills-': [billId] }, { requestKey: null });
    } catch {
      throw new BillingError('Bill was deleted, but its rental link could not be cleaned up. Refresh and ask an admin to reconcile the link.', 502);
    }
  }
}