import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const rentalId = url.searchParams.get('id');

  return {
    rental: null,
    currentBill: null,
    rentals: [],
    selectedRentalId: rentalId
  };
};
