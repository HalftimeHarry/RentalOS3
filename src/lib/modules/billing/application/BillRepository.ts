import type { Bill } from '../domain/Bill';

export interface BillingRental {
  id: string;
  address: string;
  rent: number;
  ownerUserIds: string[];
}

export interface StoredBill {
  bill: Bill;
  receipts: string[];
}

export interface BillRepository {
  listRentals(userId: string): Promise<BillingRental[]>;
  renterStatus(userId: string): Promise<string>;
  list(rentalId: string): Promise<StoredBill[]>;
  save(bill: Bill, files: File[], mode: 'create' | 'update'): Promise<StoredBill>;
  delete(rentalId: string, billId: string): Promise<void>;
}