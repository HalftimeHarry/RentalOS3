import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
import type { User } from '$lib/models';

export class AuthService {
  async login(email: string, password: string): Promise<User> {
    const record = await pocketbase.client.collection('users').authWithPassword(email, password);
    return { id: record.record.id, name: record.record.name, email: record.record.email, role: record.record.role, avatar: record.record.avatar };
  }

  async register(name: string, email: string, password: string): Promise<User> {
    await pocketbase.client.collection('users').create({
      name,
      email,
      password,
      passwordConfirm: password,
      role: 'rentor'
    });
    return this.login(email, password);
  }
}

export const authService = new AuthService();
