import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
import { normalizeRelationIds, type Rental } from '$lib/models';

const isAbortError = (error: unknown) => {
  return error instanceof Error && (error.name === 'AbortError' || error.message?.toLowerCase().includes('aborted'));
};

const getCurrentUserId = () => pocketbase.client.authStore.model?.id ?? null;

const normalizeRenterId = (rental: Partial<Rental> | null | undefined) => {
  if (!rental) return null;

  const tenantField = (rental as Partial<Rental>).tenant;
  const renterField = (rental as Partial<Rental>).renter;
  const expandedTenant = (rental as Partial<Rental>).expand?.tenant;
  const expandedRenter = (rental as Partial<Rental>).expand?.renter;

  const getRelationUserId = (relation: unknown): string | null => {
    if (!relation || typeof relation === 'string') return null;

    if (typeof relation === 'object') {
      const userId = normalizeRelationIds((relation as { user?: unknown }).user).at(0)
        ?? normalizeRelationIds((relation as { expand?: { user?: unknown } }).expand?.user).at(0)
        ?? null;
      if (userId) return userId;

      const directId = 'id' in relation ? String((relation as { id?: string | null }).id ?? '') : '';
      return directId || null;
    }

    return null;
  };

  const directTenantUserId = getRelationUserId(tenantField);
  const directRenterUserId = getRelationUserId(renterField);
  const expandedTenantUserId = getRelationUserId(expandedTenant);
  const expandedRenterUserId = getRelationUserId(expandedRenter);

  const userId = directTenantUserId ?? directRenterUserId ?? expandedTenantUserId ?? expandedRenterUserId;
  if (userId) return userId;

  const fallbackId =
    (typeof tenantField === 'string' ? tenantField : null) ??
    (typeof renterField === 'string' ? renterField : null) ??
    (expandedTenant && typeof expandedTenant === 'object' && 'id' in expandedTenant ? String(expandedTenant.id) : null) ??
    (expandedRenter && typeof expandedRenter === 'object' && 'id' in expandedRenter ? String(expandedRenter.id) : null);

  return fallbackId ?? null;
};

const normalizeRentalRecord = (record: Partial<Rental>): Rental => {
  const normalizedTenant = normalizeRelationIds((record as { tenant?: unknown }).tenant).at(0) ?? undefined;
  const normalizedRenter = normalizeRelationIds((record as { renter?: unknown }).renter).at(0) ?? undefined;
  const normalizedBills = normalizeRelationIds((record as { bills?: unknown }).bills);

  return {
    ...(record as Rental),
    tenant: normalizedTenant,
    renter: normalizedRenter,
    bills: normalizedBills,
    photos: Array.isArray(record.photos) ? record.photos.filter((photo): photo is string => typeof photo === 'string') : []
  };
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
      const records = await pocketbase.client.collection('rental').getFullList({ sort: '-created', expand: 'tenant.user,bills' });
      return getScopedRecords((records as Rental[]).map((record) => normalizeRentalRecord(record)));
    } catch (error) {
      if (isAbortError(error)) return [];
      console.error('[RentalService.list] failed to load rentals:', error);
      return [];
    }
  }

  async getById(id: string, options?: { bypassUserScope?: boolean }): Promise<Rental | null> {
    if (!id) return null;

    try {
      const record = await pocketbase.client.collection('rental').getOne(id, { expand: 'tenant.user,bills' });
      const rental = normalizeRentalRecord(record as Partial<Rental>);
      const userId = getCurrentUserId();
      const userRole = pocketbase.client.authStore.model?.role;

      if (options?.bypassUserScope) {
        return rental;
      }

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
        expand: 'tenant.user,bills'
      });
      const scoped = getScopedRecords((records as Rental[]).map((record) => normalizeRentalRecord(record)));
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
