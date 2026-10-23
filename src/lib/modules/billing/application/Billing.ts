import { Bill, BillingError, centsToDollars, dateOnly, dollarsToCents, isPaymentState, type PaymentState } from '../domain/Bill';
import type { BillRepository, BillingRental, StoredBill } from './BillRepository';

export interface BillingUser {
  id: string;
  role: 'admin' | 'renter';
}

export interface BillDTO {
  id: string;
  rental: string;
  rent: number;
  sdge: number;
  att: number;
  total: number;
  dueDate: string;
  status: PaymentState;
  paid: boolean;
  paidDate: string;
  notes: string;
  receipts: string[];
}

export interface RentalDTO {
  id: string;
  address: string;
  rent: number;
}

export function todayInLosAngeles(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function toBillDTO(record: StoredBill): BillDTO {
  const { data } = record.bill;
  return {
    id: data.id, rental: data.rentalId,
    rent: centsToDollars(data.rentCents), sdge: centsToDollars(data.sdgeCents), att: centsToDollars(data.attCents),
    total: centsToDollars(record.bill.totalCents), dueDate: data.dueDate,
    status: data.status, paid: data.status === 'paid', paidDate: data.paidDate,
    notes: data.notes, receipts: [...record.receipts]
  };
}

function text(value: unknown, field: string, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new BillingError(`${field} must be text.`);
  return value.trim();
}

export class Billing {
  constructor(
    private readonly repository: BillRepository,
    private readonly user: BillingUser,
    private readonly today: () => string = todayInLosAngeles
  ) {
    if (!user.id || (user.role !== 'admin' && user.role !== 'renter')) {
      throw new BillingError('Sign in to access billing.', 401);
    }
  }

  private requireAdmin(): void {
    if (this.user.role !== 'admin') throw new BillingError('Only admins can change bills.', 403);
  }

  async context(rentalId?: string) {
    const rentals = (await this.repository.listRentals(this.user.id))
      .filter((rental) => this.user.role === 'admin' || rental.ownerUserIds.includes(this.user.id));
    const rental = rentalId ? rentals.find((entry) => entry.id === rentalId) : rentals[0];
    if (rentalId && !rental) throw new BillingError('Rental not found or access denied.', 403);
    const toRentalDTO = (entry: BillingRental): RentalDTO => ({ id: entry.id, address: entry.address, rent: entry.rent });
    return {
      rentals: rentals.map(toRentalDTO), rental: rental ? toRentalDTO(rental) : null,
      isAdmin: this.user.role === 'admin',
      renterStatus: this.user.role === 'admin' ? '' : await this.repository.renterStatus(this.user.id)
    };
  }

  async list(rentalId: string): Promise<BillDTO[]> {
    await this.context(rentalId);
    return (await this.repository.list(rentalId))
      .map(toBillDTO).sort((first, second) => second.dueDate.localeCompare(first.dueDate));
  }

  async page(rentalId: string, query = '', status = 'all', page = 1, perPage = 10) {
    if (status !== 'all' && !isPaymentState(status)) throw new BillingError('Invalid status filter.');
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100) {
      throw new BillingError('Invalid pagination.');
    }
    const search = query.trim().toLowerCase();
    const bills = (await this.list(rentalId)).filter((bill) =>
      (status === 'all' || bill.status === status) &&
      (!search || [bill.id, bill.notes, bill.dueDate].join(' ').toLowerCase().includes(search))
    );
    const totalPages = Math.max(1, Math.ceil(bills.length / perPage));
    const safePage = Math.min(page, totalPages);
    return { items: bills.slice((safePage - 1) * perPage, safePage * perPage), page: safePage, perPage, totalPages, totalItems: bills.length };
  }

  async save(input: unknown, files: File[] = []): Promise<BillDTO> {
    this.requireAdmin();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BillingError('Invalid bill input.');
    const raw = input as Record<string, unknown>;
    const rentalId = text(raw.rental, 'Rental');
    if (!rentalId) throw new BillingError('A rental is required.');
    await this.context(rentalId);
    const id = text(raw.id, 'ID');
    const existing = id ? await this.find(rentalId, id) : null;
    const createId = text(raw.createId, 'New ID');
    if (createId && !/^[a-z0-9]{15}$/.test(createId)) throw new BillingError('A custom ID must be 15 lowercase letters or digits.');
    if (!isPaymentState(raw.status)) throw new BillingError('Invalid payment state.');
    const bill = new Bill({
      id: existing?.bill.data.id ?? createId, rentalId,
      rentCents: dollarsToCents(raw.rent), sdgeCents: dollarsToCents(raw.sdge), attCents: dollarsToCents(raw.att),
      dueDate: dateOnly(text(raw.dueDate, 'Due date') || this.today()),
      status: raw.status,
      paidDate: raw.status === 'paid' ? dateOnly(text(raw.paidDate, 'Paid date') || this.today()) : '',
      notes: text(raw.notes, 'Notes')
    });
    const validFiles = files.filter((file) => file.size > 0);
    return toBillDTO(await this.repository.save(bill, validFiles, existing ? 'update' : 'create'));
  }

  private async find(rentalId: string, id: string): Promise<StoredBill> {
    await this.context(rentalId);
    const record = (await this.repository.list(rentalId)).find((entry) => entry.bill.data.id === id);
    if (!record) throw new BillingError('Bill not found for this rental.', 404);
    return record;
  }

  async markPaid(rentalId: string, id: string): Promise<BillDTO> {
    this.requireAdmin();
    const record = await this.find(rentalId, id);
    return toBillDTO(await this.repository.save(record.bill.transition('paid', this.today()), [], 'update'));
  }

  async delete(rentalId: string, id: string): Promise<void> {
    this.requireAdmin();
    await this.find(rentalId, id);
    await this.repository.delete(rentalId, id);
  }
}