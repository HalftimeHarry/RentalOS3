import PocketBase from 'pocketbase';
import { env } from '$env/dynamic/public';

export class PocketBaseProvider {
  readonly client: PocketBase;

  constructor(url = env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090') {
    this.client = new PocketBase(url);

    const adminEmail = env.PUBLIC_POCKETBASE_LOGIN;
    const adminPassword = env.PUBLIC_POCKETBASE_PASS;

    if (adminEmail && adminPassword) {
      void this.client.collection('users').authWithPassword(adminEmail, adminPassword)
        .then((auth) => {
          console.log('[pocketbase] env admin login ok:', auth.record?.email, auth.record?.role);
        })
        .catch((error) => {
          console.error('[pocketbase] env admin login failed:', error);
        });
    }
  }
}

export const pocketbase = new PocketBaseProvider();
