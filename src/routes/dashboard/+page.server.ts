import type { PageServerLoad } from './$types';
import type { Actions } from './$types';
import { billingAction, billingFor, billingLoadError } from '$lib/modules/billing/infrastructure/billing.server';

export const load: PageServerLoad = async ({ locals, url }) => {
  try {
    const billing = billingFor(locals);
    const context = await billing.context(url.searchParams.get('id') || undefined);
    const bills = context.rental ? await billing.list(context.rental.id) : [];
    return {
      billing: { ...context, bills },
      rental: null,
      currentBill: null,
      rentals: [],
      selectedRentalId: context.rental?.id ?? null
    };
  } catch (cause) {
    billingLoadError(cause);
  }
};

export const actions: Actions = {
  createBill: (event) => billingAction(event, 'save')
};
