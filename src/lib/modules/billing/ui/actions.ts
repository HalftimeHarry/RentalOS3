import { deserialize } from '$app/forms';
import { invalidateAll } from '$app/navigation';

export async function submitBillingAction(path: string, action: string, fields: Record<string, string>, files: File[] = []): Promise<void> {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  for (const file of files) body.append('receipts', file, file.name);
  const response = await fetch(`${path}?/${action}`, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
  const result = deserialize(await response.text());
  if (result.type === 'failure') {
    const data = result.data as { message?: unknown } | undefined;
    throw new Error(typeof data?.message === 'string' ? data.message : 'The billing action failed.');
  }
  if (result.type !== 'success') throw new Error('The billing action could not be completed. Refresh and sign in again.');
  await invalidateAll();
}