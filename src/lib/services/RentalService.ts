import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
import type { Rental } from '$lib/models';

const isAbortError = (error: unknown) => {
  return error instanceof Error && (error.name === 'AbortError' || error.message?.toLowerCase().includes('aborted'));
};

const getCurrentUserId = () => pocketbase.client.authStore.model?.id ?? null;

const normalizeRenterId = (rental: Partial<Rental> | null | undefined) => {
  if (!rental) return null;

  const tenantField = (rental as Partial<Rental>).tenant;
  const renterField = (rental as Partial<Rental>).renter;

  const candidate = typeof tenantField === 'string' ? tenantField :
    typeof renterField === 'string' ? renterField :
    (tenantField && typeof tenantField === 'object' && 'id' in tenantField ? String(tenantField.id) : null) ??
    (renterField && typeof renterField === 'object' && 'id' in renterField ? String(renterField.id) : null);

  if (candidate) return candidate;

  const expandedTenant = (rental as Partial<Rental>).expand?.tenant;
  const expandedRenter = (rental as Partial<Rental>).expand?.renter;

  if (expandedTenant && typeof expandedTenant === 'object' && 'id' in expandedTenant) return String(expandedTenant.id);
  if (expandedRenter && typeof expandedRenter === 'object' && 'id' in expandedRenter) return String(expandedRenter.id);

  return null;
};

const getScopedRecords = (records: Rental[]) => {
  const userId = getCurrentUserId();
  const userRole = pocketbase.client.authStore.model?.role;

  if (!userId || userRole === 'admin') return records;

  return records.filter((record) => normalizeRenterId(record) === userId);
};

export class RentalService {
  async list(): Promise<Rental[]> {
    try {
      const records = await pocketbase.client.collection('rental').getFullList({ sort: '-created', expand: 'tenant.user' });
      return getScopedRecords(records as unknown as Rental[]);
    } catch (error) {
      if (isAbortError(error)) return [];
      console.error('[RentalService.list] failed to load rentals:', error);
      return [];
    }
  }

  async getById(id: string): Promise<Rental | null> {
    if (!id) return null;

    try {
      const record = await pocketbase.client.collection('rental').getOne(id, { expand: 'tenant.user' });
      const rental = record as unknown as Rental;
      const userId = getCurrentUserId();
      const userRole = pocketbase.client.authStore.model?.role;

      if (userId && userRole !== 'admin') {
        const renterId = normalizeRenterId(rental);
        if (renterId !== userId) return null;
      }

      return rental;
    } catch (error) {
      if (isAbortError(error)) return null;
      console.error('[RentalService.getById] failed to load rental:', error);
      return null;
    }
  }

  async getCurrent(): Promise<Rental | null> {
    try {
      const records = await pocketbase.client.collection('rental').getFullList({
        sort: '-created',
        expand: 'tenant.user'
      });
      const scoped = getScopedRecords(records as unknown as Rental[]);
      return (scoped[0] as Rental | undefined) ?? null;
    } catch (error) {
      if (isAbortError(error)) return null;
      console.error('[RentalService.getCurrent] failed to load current rental:', error);
      return null;
    }
  }

  async update(id: string, data: Partial<Rental>) {
    return pocketbase.client.collection('rental').update(id, data);
  }

  async uploadPhotos(id: string, files: File[]) {
    const validFiles = files.filter((file): file is File => file instanceof File && file.size > 0).slice(0, 10);

    if (!id || !validFiles.length) return null;

    const formData = new FormData();
    validFiles.forEach((file) => {
      formData.append('photos', file, file.name);
    });

    return pocketbase.client.collection('rental').update(id, formData);
  }
}

export const rentalService = new RentalService();
