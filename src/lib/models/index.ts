export type UserRole = 'admin' | 'rentor';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
}

export interface Rental {
  id: string;
  address: string;
  rent: number;
  photos: string[];
  renter?: User;
}

export interface Bill {
  id: string;
  rental: string;
  rent: number;
  sdge: number;
  att: number;
  total: number;
  dueDate: string;
  paid: boolean;
  paidDate?: string;
  notes?: string;
}

export const billTotal = (bill: Pick<Bill, 'rent' | 'sdge' | 'att'>) =>
  bill.rent + bill.sdge + bill.att;
