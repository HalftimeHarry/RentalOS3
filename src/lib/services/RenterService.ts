import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';

export interface RenterProfile {
  id: string;
  user: string;
  tenant_email?: string;
  tenant_name?: string;
  status?: 'applying' | 'active' | 'in-active';
  creditData?: string[];
  appData?: string[];
  damageData?: string[];
  created?: string;
  updated?: string;
  expand?: {
    user?: {
      id?: string;
      name?: string;
      email?: string;
      role?: string;
    };
  };
}

export interface RenterListParams {
  page?: number;
  perPage?: number;
  sort?: string;
  filter?: string;
  expand?: string;
  fields?: string;
}

const getCurrentUserId = () => pocketbase.client.authStore.model?.id ?? null;

export class RenterService {
  async list(params: RenterListParams = {}) {
    const page = Math.max(1, Number(params.page ?? 1) || 1);
    const perPage = Math.min(100, Math.max(1, Number(params.perPage ?? 30) || 30));
    const sort = params.sort ?? '-created';
    const filter = params.filter ?? '';
    const expand = params.expand ?? 'user';
    const fields = params.fields ?? '*';

    const query: Record<string, string> = { sort, expand, fields };
    if (filter) query.filter = filter;

    return pocketbase.client.collection('tenants').getList<RenterProfile>(page, perPage, query);
  }

  async getCurrent(): Promise<RenterProfile | null> {
    const userId = getCurrentUserId();
    if (!userId) return null;

    try {
      const records = await pocketbase.client.collection('tenants').getFullList<RenterProfile>({
        sort: '-created',
        filter: `user = "${userId}"`
      });

      return records[0] ?? null;
    } catch (error) {
      console.error('[RenterService.getCurrent] failed to load renter profile:', error);
      return null;
    }
  }

  async saveFiles(files: Partial<Record<'creditData' | 'appData' | 'damageData', File[]>>) {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('No authenticated user found.');

    const existing = await this.getCurrent();
    const formData = new FormData();

    formData.append('user', userId);

    const creditFiles = files.creditData ?? [];
    creditFiles.forEach((file) => {
      formData.append('creditData', file, file.name);
    });

    if (existing?.id) {
      return pocketbase.client.collection('tenants').update(existing.id, formData);
    }

    return pocketbase.client.collection('tenants').create(formData);
  }
}

export const renterService = new RenterService();
