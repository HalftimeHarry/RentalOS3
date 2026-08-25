import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
import { BillRecord, type Bill } from '$lib/models';

const isAbortError = (error: unknown) => {
  return error instanceof Error && (error.name === 'AbortError' || error.message?.toLowerCase().includes('aborted'));
};

export class BillService {
  prepareForSave(data: Partial<Bill>) {
    return BillRecord.prepareForSave(data);
  }

  hydrate(record: Partial<Bill>): Bill {
    return BillRecord.hydrate(record);
  }

  async listPage(page = 1, perPage = 50, options?: { sort?: string; filter?: string; rentalId?: string; status?: string }) {
    const filterParts: string[] = [];

    if (options?.rentalId) {
      filterParts.push(`rental = "${options.rentalId}"`);
    }

    if (options?.status) {
      filterParts.push(`status = "${options.status}"`);
    }

    if (options?.filter) {
      filterParts.push(options.filter);
    }

    const result = await pocketbase.client.collection('bill').getList<Bill>(page, perPage, {
      sort: options?.sort ?? '-dueDate',
      filter: filterParts.length ? filterParts.join(' && ') : undefined
    });

    return {
      ...result,
      items: result.items.map((bill) => this.hydrate(bill))
    };
  }

  async search(filter: string, sort = '-dueDate', rentalId?: string): Promise<Bill[]> {
    const tickets = rentalId ? [`rental = "${rentalId}"`, filter] : [filter];
    const result = await pocketbase.client.collection('bill').getFullList<Bill>({
      sort,
      filter: tickets.join(' && ')
    });

    return result.map((bill) => this.hydrate(bill));
  }

  async list(rentalId?: string): Promise<Bill[]> {
    if (!rentalId) return [];

    try {
      const result = await pocketbase.client.collection('bill').getFullList<Bill>({
        sort: '-dueDate',
        filter: `rental = "${rentalId}"`
      });

      return result.map((bill) => this.hydrate(bill));
    } catch (error) {
      if (isAbortError(error)) return [];

      console.warn('[BillService.list] filtered query failed; retrying without rental filter.', error);

      try {
        const fallback = await pocketbase.client.collection('bill').getFullList<Bill>({
          sort: '-dueDate'
        });

        return fallback
          .filter((bill) => String((bill as Partial<Bill>).rental ?? '') === String(rentalId))
          .map((bill) => this.hydrate(bill));
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
    const formData = new FormData();

    Object.entries(payload).forEach(([key, value]) => {
      if (key === 'id' || key === 'receipts' || value === undefined || value === null) return;
      if (Array.isArray(value)) {
        value.forEach((item) => formData.append(key, String(item)));
        return;
      }
      formData.append(key, String(value));
    });

    receiptFiles.forEach((file) => {
      formData.append('recipts', file, file.name);
    });

    return id ? pocketbase.client.collection('bill').update(id, formData) : pocketbase.client.collection('bill').create(formData);
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
