import type { Handle } from '@sveltejs/kit';
import PocketBase from 'pocketbase';
import { env } from '$env/dynamic/public';

const getAuthFailureReason = (error: unknown) => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (error && typeof error === 'object') {
    const status = 'status' in error ? `status=${String(error.status)}` : null;
    const message = 'message' in error ? String(error.message) : JSON.stringify(error);
    return [status, message].filter(Boolean).join(' | ');
  }

  return String(error);
};

export const handle: Handle = async ({ event, resolve }) => {
  const baseUrl = env.PUBLIC_POCKETBASE_URL ?? 'http://127.0.0.1:8090';
  const pb = new PocketBase(baseUrl);
  const cookieHeader = event.request.headers.get('cookie') || '';
  const hasCookie = Boolean(cookieHeader);

  if (hasCookie) {
    pb.authStore.loadFromCookie(cookieHeader);
  }

  try {
    if (pb.authStore.isValid) {
      await pb.collection('users').authRefresh();
    } else if (hasCookie) {
      pb.authStore.clear();
    }
  } catch (error) {
    const reason = getAuthFailureReason(error);
    console.warn('[hooks.server] auth refresh failed; clearing stale session. reason:', reason);
    pb.authStore.clear();
  }

  event.locals.pb = pb;

  const response = await resolve(event);

  if (pb.authStore.isValid) {
    response.headers.append('set-cookie', pb.authStore.exportToCookie());
  } else if (hasCookie) {
    response.headers.append('set-cookie', 'pb_auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  }

  return response;
};
