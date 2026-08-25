import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
import { BillRecord, normalizeRelationIds, type Bill } from '$lib/models';

const isAbortError = (error: unknown) => {
  return error instanceof Error && (error.name === 'AbortError' || error.message?.toLowerCase().includes('aborted'));
};

const getBillIdsFromRental = (rental: Record<string, any> | null | undefined) => {
  const direct = normalizeRelationIds((rental as Record<string, any> | undefined)?.bills ?? []);
  const expanded = Array.isArray((rental as Record<string, any> | undefined)?.expand?.bills)
    ? normalizeRelationIds((rental as Record<string, any> | undefined)?.expand?.bills)
    : [];

  return Array.from(new Set([...direct, ...expanded]));
};

export class BillService {
  prepareForSave(data: Partial<Bill>) {
    return BillRecord.prepareForSave(data);
  }

  hydrate(record: Partial<Bill>): Bill {
    return BillRecord.hydrate(record);
  }

  async listPage(page = 1, perPage = 50, options?: { sort?: string; filter?: string; rentalId?: string; status?: string }) {
    const rentalId = options?.rentalId;
    const bills = rentalId ? await this.list(rentalId) : await this.list();

    const normalized = bills.filter((bill) => {
      if (options?.status && BillRecord.normalizeStatus(bill) !== options.status) return false;
      if (!options?.filter) return true;

      const searchText = options.filter.trim();
      if (!searchText) return true;

      const haystack = [bill.id, bill.notes ?? '', bill.dueDate].join(' ').toLowerCase();
      return haystack.includes(searchText.toLowerCase());
    });

    const totalItems = normalized.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const startIndex = (safePage - 1) * perPage;
    const items = normalized.slice(startIndex, startIndex + perPage);

    return {
      page: safePage,
      perPage,
      totalPages,
      totalItems,
      items
    };
  }

  async search(filter: string, sort = '-dueDate', rentalId?: string): Promise<Bill[]> {
    const bills = rentalId ? await this.list(rentalId) : await this.list();
    const normalized = filter.trim();

    if (!normalized) return bills.sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));

    return bills.filter((bill) => {
      const haystack = [bill.id, bill.notes ?? '', bill.dueDate].join(' ').toLowerCase();
      return haystack.includes(normalized.toLowerCase());
    });
  }

  async list(rentalId?: string): Promise<Bill[]> {
    if (!rentalId) return [];

    try {
      const rental = await pocketbase.client.collection('rental').getOne(rentalId, { expand: 'bills' });
      const billIds = getBillIdsFromRental(rental as Record<string, any>);

      if (billIds.length) {
        const records = await Promise.all(
          billIds.map(async (id) => {
            try {
              return await pocketbase.client.collection('bill').getOne<Bill>(id);
            } catch {
              return null;
            }
          })
        );

        return records.filter(Boolean).map((bill) => this.hydrate(bill as Partial<Bill>)).sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
      }

      const fallback = await pocketbase.client.collection('bill').getFullList<Bill>({ sort: '-dueDate' });
      return fallback
        .filter((bill) => String((bill as Partial<Bill>).rental ?? '') === String(rentalId))
        .map((bill) => this.hydrate(bill))
        .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
    } catch (error) {
      if (isAbortError(error)) return [];

      console.warn('[BillService.list] rental bills lookup failed; retrying without relation filter.', error);

      try {
        const fallback = await pocketbase.client.collection('bill').getFullList<Bill>({ sort: '-dueDate' });
        return fallback
          .filter((bill) => String((bill as Partial<Bill>).rental ?? '') === String(rentalId))
          .map((bill) => this.hydrate(bill))
          .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
      } catch (fallbackError) {
        console.error('[BillService.list] failed to load bills:', fallbackError);
        return [];
      }
    }
  }

  async getById(id: string): Promise<Bill | null> {
    if (!id) return null;

    try {
      const record = await pocketbase.client.collection('bill').getOne<Bill>(id);
      return this.hydrate(record);
    } catch (error) {
      if (isAbortError(error)) return null;
      console.error('[BillService.getById] failed to load bill:', error);
      return null;
    }
  }

  async save(data: Partial<Bill>, id?: string, receiptFiles: File[] = []) {
    const payload = this.prepareForSave(data);
    const rentalId = typeof payload.rental === 'string' ? payload.rental : undefined;
    const { rental, receipts, recipts, ...billFields } = payload as Partial<Bill> & { rental?: string; receipts?: string[]; recipts?: string[] };
    const formData = new FormData();

    Object.entries(billFields).forEach(([key, value]) => {
      if (key === 'id' || value === undefined || value === null) return;
      if (Array.isArray(value)) {
        value.forEach((item) => formData.append(key, String(item)));
        return;
      }
      formData.append(key, String(value));
    });

    const savedReceipts = Array.isArray(recipts) && recipts.length ? recipts : Array.isArray(receipts) ? receipts : [];
    savedReceipts.forEach((item) => {
      formData.append('recipts', String(item));
    });

    receiptFiles.forEach((file) => {
      formData.append('recipts', file, file.name);
    });

    if (id) {
      return pocketbase.client.collection('bill').update(id, formData);
    }

    const created = await pocketbase.client.collection('bill').create(formData);

    if (rentalId) {
      try {
        const rentalRecord = await pocketbase.client.collection('rental').getOne(rentalId, { expand: 'bills' });
        const existingIds = getBillIdsFromRental(rentalRecord as Record<string, any>);
        const nextIds = Array.from(new Set([...existingIds, String(created.id)]));

        await pocketbase.client.collection('rental').update(rentalId, {
          bills: nextIds
        });
      } catch (relationError) {
        console.warn('[BillService.save] failed to attach bill to rental relation:', relationError);
      }
    }

    return created;
  }

  async uploadReceipts(id: string, files: File[]) {
    const validFiles = files.filter((file): file is File => file instanceof File && file.size > 0);
    if (!id || !validFiles.length) return null;

    const formData = new FormData();
    validFiles.forEach((file) => {
      formData.append('recipts', file, file.name);
    });

    return pocketbase.client.collection('bill').update(id, formData);
  }

  async delete(id: string) {
    return pocketbase.client.collection('bill').delete(id);
  }
}

export const billService = new BillService();
