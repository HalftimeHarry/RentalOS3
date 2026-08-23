import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
import { billTotal, type Bill } from '$lib/models';

export class BillService {
  async list(rentalId?: string): Promise<Bill[]> {
    const filter = rentalId ? `rental = "${rentalId}"` : '';
    const result = await pocketbase.client.collection('bill').getFullList<Bill>({ sort: '-dueDate', filter });
    return result.map((bill) => ({ ...bill, total: billTotal(bill) }));
  }

  async save(data: Omit<Bill, 'id' | 'total'>, id?: string) {
    const payload = { ...data, total: billTotal(data) };
    return id ? pocketbase.client.collection('bill').update(id, payload) : pocketbase.client.collection('bill').create(payload);
  }

  async delete(id: string) {
    return pocketbase.client.collection('bill').delete(id);
  }
}

export const billService = new BillService();
