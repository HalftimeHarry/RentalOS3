import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
import type { Rental } from '$lib/models';

export class RentalService {
  async list(): Promise<Rental[]> {
    try {
      const records = await pocketbase.client.collection('rental').getFullList({ sort: '-created', expand: 'renter' });
      return records as unknown as Rental[];
    } catch {
      return [];
    }
  }

  async getById(id: string): Promise<Rental | null> {
    if (!id) return null;

    try {
      const record = await pocketbase.client.collection('rental').getOne(id, { expand: 'renter' });
      return record as unknown as Rental;
    } catch {
      return null;
    }
  }

  async getCurrent(): Promise<Rental | null> {
    try {
      const record = await pocketbase.client.collection('rental').getFirstListItem('');
      return record as unknown as Rental;
    } catch {
      return null;
    }
  }

  async update(id: string, data: Partial<Rental>) {
    return pocketbase.client.collection('rental').update(id, data);
  }
}

export const rentalService = new RentalService();
