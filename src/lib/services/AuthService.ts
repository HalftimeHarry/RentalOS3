import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
import { Renter, type User } from '$lib/models';

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const syncAuthCookie = () => {
  if (typeof document === 'undefined') return;

  const cookie = pocketbase.client.authStore.exportToCookie({ httpOnly: false });
  if (cookie) {
    document.cookie = cookie;
  }
};

export class AuthService {
  async login(email: string, password: string): Promise<User> {
    const normalizedEmail = normalizeEmail(email);
    const cleanPassword = password.trim();

    const record = await pocketbase.client.collection('users').authWithPassword(normalizedEmail, cleanPassword);
    syncAuthCookie();

    return {
      id: record.record.id,
      name: record.record.name,
      email: record.record.email,
      role: record.record.role,
      avatar: record.record.avatar
    };
  }

  async register(name: string, email: string, password: string): Promise<User> {
    const cleanName = name.trim();
    const normalizedEmail = normalizeEmail(email);
    const cleanPassword = password.trim();

    const userRecord = await pocketbase.client.collection('users').create({
      name: cleanName,
      email: normalizedEmail,
      password: cleanPassword,
      passwordConfirm: cleanPassword,
      role: 'renter'
    });

    try {
      const loggedInUser = await this.login(normalizedEmail, cleanPassword);
      const tenantPayload = Renter.syncTenantDetails({
        user: pocketbase.client.authStore.model?.id ?? loggedInUser.id ?? userRecord.id,
        tenant_name: userRecord.name ?? cleanName,
        tenant_email: userRecord.email ?? normalizedEmail,
        status: 'applying'
      });

      await pocketbase.client.collection('tenants').create(tenantPayload);
      return loggedInUser;
    } catch (error) {
      console.error('[AuthService.register] failed to create tenant row for new user:', error);
      throw error;
    }
  }
}

export const authService = new AuthService();
