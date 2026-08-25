import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

type UserRecord = {
  id: string;
  email?: string;
  name?: string;
  avatar?: string;
  role?: string;
  created?: string;
  updated?: string;
  verified?: boolean;
};

type RenterRecord = {
  id: string;
  user: string;
  status?: string;
  tenant_email?: string;
  tenant_name?: string;
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
};

type TenantRow = UserRecord & {
  renter?: RenterRecord | null;
  fileCount: number;
};

export const load: PageServerLoad = async ({ locals, url }) => {
  const pb = locals.pb;

  console.log('[tenants route] session valid:', pb.authStore.isValid, 'role:', pb.authStore.model?.role ?? 'unknown');

  if (!pb.authStore.isValid) {
    console.warn('[tenants route] unauthenticated user; redirecting to /login');
    throw redirect(302, '/login');
  }

  if (pb.authStore.model?.role !== 'admin') {
    console.warn('[tenants route] non-admin user attempted access.', { role: pb.authStore.model?.role ?? 'unknown' });
    throw redirect(302, '/dashboard');
  }

  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('perPage') ?? '12') || 12));
  const sort = url.searchParams.get('sort') ?? '-created';
  const search = url.searchParams.get('search')?.trim() ?? '';
  const filter = search ? `(id ~ "${search}") || (user ~ "${search}")` : '';

  try {
    const renterResult = await pb.collection('tenants').getList<RenterRecord>(page, perPage, {
      sort,
      expand: 'user',
      ...(filter ? { filter } : {})
    });

    console.log('[tenants route] loaded renter records:', renterResult.items.length, 'page:', renterResult.page, 'total:', renterResult.totalItems);

    const rows: TenantRow[] = await Promise.all(renterResult.items.map(async (renter) => {
      let expandedUser = renter.expand?.user as UserRecord | undefined;
      if ((!renter.tenant_name || !renter.tenant_email) && renter.user) {
        try {
          const userRecord = await pb.collection('users').getOne(renter.user);
          expandedUser = {
            ...(expandedUser ?? {}),
            id: userRecord.id,
            name: userRecord.name ?? expandedUser?.name ?? renter.tenant_name ?? '',
            email: userRecord.email ?? expandedUser?.email ?? renter.tenant_email ?? '',
            role: userRecord.role ?? expandedUser?.role ?? 'renter',
            created: userRecord.created ?? expandedUser?.created,
            updated: userRecord.updated ?? expandedUser?.updated,
            verified: userRecord.verified ?? expandedUser?.verified ?? false
          };
        } catch (error) {
          console.warn('[tenants route] failed to resolve user for tenant row:', renter.id, error);
        }
      }

      const fallbackName = expandedUser?.name ?? renter.tenant_name ?? 'Unnamed user';
      const fallbackEmail = renter.tenant_email ?? expandedUser?.email ?? undefined;
      const normalizedRenter = {
        ...renter,
        tenant_name: fallbackName,
        tenant_email: fallbackEmail ?? renter.tenant_email ?? ''
      };

      const user: UserRecord = {
        id: expandedUser?.id ?? renter.user ?? renter.id,
        name: fallbackName,
        email: fallbackEmail,
        avatar: expandedUser?.avatar ?? undefined,
        role: expandedUser?.role ?? 'renter',
        created: expandedUser?.created ?? renter.created,
        updated: expandedUser?.updated ?? renter.updated,
        verified: expandedUser?.verified ?? false
      };

      const fileCount = (renter?.creditData?.length ?? 0) + (renter?.appData?.length ?? 0) + (renter?.damageData?.length ?? 0);

      return {
        ...user,
        renter: normalizedRenter,
        fileCount
      };
    }));

    const statusPriority = (status?: string) => {
      switch (status) {
        case 'active':
          return 0;
        case 'applying':
          return 1;
        case 'in-active':
          return 2;
        default:
          return 3;
      }
    };

    rows.sort((a, b) => {
      const aStatus = a.renter?.status ?? 'applying';
      const bStatus = b.renter?.status ?? 'applying';
      return statusPriority(aStatus) - statusPriority(bStatus)
        || (a.name ?? '').localeCompare(b.name ?? '')
        || (a.email ?? '').localeCompare(b.email ?? '');
    });

    return {
      rows,
      page: renterResult.page,
      perPage: renterResult.perPage,
      totalItems: renterResult.totalItems,
      totalPages: renterResult.totalPages,
      sort,
      search,
      error: null
    };
  } catch (error) {
    console.error('[tenants page server load] failed to fetch tenant records:', error);
    return {
      rows: [],
      page: 1,
      perPage,
      totalItems: 0,
      totalPages: 0,
      sort,
      search,
      error: error instanceof Error ? error.message : 'Unable to load tenant records from PocketBase.'
    };
  }
};
