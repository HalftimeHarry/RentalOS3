import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { ClientResponseError } from 'pocketbase';
import { Billing } from '../application/Billing';
import { BillingError } from '../domain/Bill';
import { PocketBaseBillRepository } from './PocketBaseBillRepository.server';

export function billingFor(locals: App.Locals): Billing {
  const record = locals.pb.authStore.record;
  if (!locals.pb.authStore.isValid || !record?.id) throw new BillingError('Sign in to access billing.', 401);
  if (record.role !== 'admin' && record.role !== 'renter') throw new BillingError('Billing access denied.', 403);
  return new Billing(new PocketBaseBillRepository(locals.pb), { id: record.id, role: record.role });
}

export function billingFailure(cause: unknown): { status: number; message: string } {
  if (cause instanceof BillingError) return { status: cause.status, message: cause.message };
  if (cause instanceof ClientResponseError) {
    if (cause.status === 403) return { status: 403, message: 'PocketBase denied billing access. Your session or collection rules may not permit this action.' };
    if (cause.status === 404) return { status: 404, message: 'A bill or rental is missing or inaccessible. Check the rental links and PocketBase permissions.' };
    if (cause.status === 400) return { status: 400, message: 'PocketBase rejected the bill. Check field values, receipt restrictions, and collection permissions.' };
  }
  return { status: 502, message: 'Billing could not reach PocketBase. Please retry when the service is available.' };
}

export function billingLoadError(cause: unknown): never {
  const failure = billingFailure(cause);
  if (failure.status === 401) redirect(303, '/login');
  error(failure.status, failure.message);
}

export async function billingAction(event: RequestEvent, action: 'save' | 'markPaid' | 'delete') {
  try {
    const billing = billingFor(event.locals);
    const form = await event.request.formData();
    const field = (name: string): string => {
      const value = form.get(name);
      if (value !== null && typeof value !== 'string') throw new BillingError(`${name} must be text.`);
      return value ?? '';
    };
    if (action === 'save') {
      const input = Object.fromEntries(['id', 'createId', 'rental', 'rent', 'sdge', 'att', 'dueDate', 'status', 'paidDate', 'notes'].map((name) => [name, field(name)]));
      const files = form.getAll('receipts').map((entry) => {
        if (typeof entry === 'string') throw new BillingError('Invalid receipt upload.');
        return entry;
      });
      await billing.save(input, files);
    } else if (action === 'markPaid') {
      await billing.markPaid(field('rental'), field('id'));
    } else {
      await billing.delete(field('rental'), field('id'));
    }
    return { success: true };
  } catch (cause) {
    const failure = billingFailure(cause);
    return fail(failure.status, { message: failure.message });
  }
}