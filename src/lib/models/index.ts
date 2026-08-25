export type UserRole = 'admin' | 'renter';

export const LA_TIMEZONE = 'America/Los_Angeles';

export const formatDateForInput = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: LA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const normalizeDateOnly = (value?: string | null) => {
  if (!value) return '';

  const trimmed = String(value).trim();
  if (!trimmed) return '';

  const dateOnlyMatch = trimmed.match(/^\d{4}-\d{2}-\d{2}/);
  if (dateOnlyMatch) {
    return dateOnlyMatch[0];
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }

  return formatDateForInput(parsed);
};

export const parseDateOnly = (value?: string | null) => {
  const normalized = normalizeDateOnly(value);
  if (!normalized) return new Date();

  const [year, month, day] = normalized.split('-').map(Number);
  if (!year || !month || !day) return new Date();

  return new Date(Date.UTC(year, month - 1, day));
};

export const renderDateLabel = (value?: string | null, options: Intl.DateTimeFormatOptions = { month: 'numeric', day: 'numeric', year: 'numeric' }) => {
  const normalized = normalizeDateOnly(value);
  if (!normalized) return '—';

  const [year, month, day] = normalized.split('-').map(Number);
  if (!year || !month || !day) return '—';

  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(date);
};

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
}

export interface Rental {
  id: string;
  collectionId?: string;
  collectionName?: string;
  address: string;
  rent: number;
  photos?: string[];
  bills?: string[];
  renter?: User | string;
  tenant?: User | string;
  created?: string;
  updated?: string;
  expand?: {
    renter?: Partial<User> & { tenant_name?: string; tenant_email?: string; user?: string | Partial<User> | null; expand?: { user?: Partial<User> | null } };
    tenant?: Partial<User> & { tenant_name?: string; tenant_email?: string; user?: string | Partial<User> | null; expand?: { user?: Partial<User> | null } };
  };
}

export interface RenterRecordData {
  id: string;
  user?: string | Partial<User> | null;
  tenant_email?: string;
  tenant_name?: string;
  status?: 'applying' | 'active' | 'in-active';
  creditData?: string[];
  appData?: string[];
  damageData?: string[];
  created?: string;
  updated?: string;
  expand?: {
    user?: Partial<User> | null;
  };
}

export class Renter {
  static syncTenantDetails(record: Partial<RenterRecordData>): Partial<RenterRecordData> {
    const userRef = typeof record.user === 'object' ? record.user : null;
    const expandedUser = record.expand?.user ?? userRef;
    const userId = typeof record.user === 'string' ? record.user : (userRef?.id ?? '');

    const tenant_email = record.tenant_email ?? expandedUser?.email ?? '';
    const tenant_name = record.tenant_name ?? expandedUser?.name ?? '';

    return {
      ...record,
      user: userId,
      tenant_email,
      tenant_name,
      status: record.status ?? 'applying'
    };
  }
}

export type BillStatus = 'open' | 'paid' | 'overdue' | 'void';

export interface Bill {
  id: string;
  rental: string;
  rent: number;
  sdge: number;
  att: number;
  total: number;
  dueDate: string;
  paid?: boolean;
  status?: BillStatus;
  paidDate?: string;
  notes?: string;
  receipts?: string[];
}

export class BillRecord {
  static normalizeStatus(value?: Partial<Bill> | BillStatus | null): BillStatus {
    const status = typeof value === 'string' ? value : value?.status ?? (value?.paid ? 'paid' : 'open');
    return status === 'paid' || status === 'open' || status === 'overdue' || status === 'void' ? status : 'open';
  }

  static hydrate(record: Partial<Bill>): Bill {
    const status = BillRecord.normalizeStatus(record);
    const dueDate = normalizeDateOnly(record.dueDate) || formatDateForInput();
    const paidDate = normalizeDateOnly(record.paidDate);

    const rent = Number(record.rent ?? 0);
    const sdge = Number(record.sdge ?? 0);
    const att = Number(record.att ?? 0);
    const computedTotal = billTotal({ rent, sdge, att });

    return {
      id: record.id ?? '',
      rental: record.rental ?? '',
      rent,
      sdge,
      att,
      total: computedTotal,
      dueDate,
      paid: record.paid ?? status === 'paid',
      status,
      paidDate,
      notes: record.notes ?? '',
      receipts: Array.isArray(record.receipts) ? record.receipts : []
    };
  }

  static prepareForSave(record: Partial<Bill>): Partial<Bill> {
    const status = BillRecord.normalizeStatus(record);
    const rent = Number(record.rent ?? 0);
    const sdge = Number(record.sdge ?? 0);
    const att = Number(record.att ?? 0);
    const dueDate = normalizeDateOnly(record.dueDate) || formatDateForInput();
    const paidDate = status === 'paid' ? (normalizeDateOnly(record.paidDate) || formatDateForInput()) : normalizeDateOnly(record.paidDate);
    const computedTotal = billTotal({ rent, sdge, att });

    return {
      ...record,
      dueDate,
      rent,
      sdge,
      att,
      status,
      paid: status === 'paid',
      paidDate,
      total: computedTotal,
      receipts: Array.isArray(record.receipts) ? record.receipts : []
    };
  }
}

export const billTotal = (bill: Pick<Bill, 'rent' | 'sdge' | 'att'>) =>
  bill.rent + bill.sdge + bill.att;
