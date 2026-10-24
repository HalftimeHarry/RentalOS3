import type { Actions, PageServerLoad } from './$types';
import { billingAction, billingFor, billingLoadError } from '$lib/modules/billing/infrastructure/billing.server';
import { BillingError, isPaymentState } from '$lib/modules/billing/domain/Bill';

export const load: PageServerLoad = async ({ locals, url }) => {
  try {
    const billing = billingFor(locals);
    const context = await billing.context(url.searchParams.get('id') || undefined);
    const status = url.searchParams.get('status') || (!context.isAdmin && context.renterStatus === 'active' ? 'open' : 'all');
    if (status !== 'all' && !isPaymentState(status)) throw new BillingError('Invalid status filter.');
    const query = url.searchParams.get('q') ?? '';
    const page = Number(url.searchParams.get('page') || 1);
    if (!Number.isSafeInteger(page) || page < 1) throw new BillingError('Invalid pagination.');
    const billPage = context.rental
      ? await billing.page(context.rental.id, query, status, page)
      : { items: [], page: 1, perPage: 10, totalItems: 0, totalPages: 1 };
    return { ...context, billPage, query, status };
  } catch (cause) {
    billingLoadError(cause);
  }
};

export const actions: Actions = {
  save: (event) => billingAction(event, 'save'),
  markPaid: (event) => billingAction(event, 'markPaid'),
  delete: (event) => billingAction(event, 'delete')
};