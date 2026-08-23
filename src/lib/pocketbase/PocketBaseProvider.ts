import PocketBase from 'pocketbase';
import { env } from '$env/dynamic/public';

export class PocketBaseProvider {
  readonly client: PocketBase;

  constructor(url = env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090') {
    this.client = new PocketBase(url);
  }
}

export const pocketbase = new PocketBaseProvider();
