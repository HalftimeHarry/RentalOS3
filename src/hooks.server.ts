import type { Handle } from '@sveltejs/kit';
import PocketBase from 'pocketbase';
import { env } from '$env/dynamic/public';

export const handle: Handle = async ({ event, resolve }) => {
  const baseUrl = env.PUBLIC_POCKETBASE_URL ?? 'http://127.0.0.1:8090';
  const pb = new PocketBase(baseUrl);
  const cookieHeader = event.request.headers.get('cookie') || '';

  console.log('[hooks.server] restoring auth from cookie:', Boolean(cookieHeader), 'baseUrl:', baseUrl);
  pb.authStore.loadFromCookie(cookieHeader);

  try {
    if (pb.authStore.isValid) {
      await pb.collection('users').authRefresh();
    }
  } catch (error) {
    console.warn('[hooks.server] auth refresh failed; clearing session', error);
    pb.authStore.clear();
  }

  event.locals.pb = pb;

  const response = await resolve(event);

  if (pb.authStore.isValid) {
    response.headers.append('set-cookie', pb.authStore.exportToCookie());
  }

  return response;
};
