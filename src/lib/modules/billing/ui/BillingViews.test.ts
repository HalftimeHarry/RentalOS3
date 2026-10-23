import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BillsPage from '../../../../routes/bills/+page.svelte';
import DashboardPage from '../../../../routes/dashboard/+page.svelte';
import { goto } from '$app/navigation';
import { submitBillingAction } from './actions';
import type { BillDTO } from '../application/Billing';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/bills?id=rental1') } }));
vi.mock('./actions', () => ({ submitBillingAction: vi.fn() }));
vi.mock('$lib/pocketbase/PocketBaseProvider', () => ({
  pocketbase: { client: { authStore: { isValid: false, onChange: () => () => {} } } }
}));

const bill: BillDTO = {
  id: 'bill1', rental: 'rental1', rent: 1800, sdge: 10.1, att: 20.2, total: 1830.3,
  dueDate: '2026-10-23', status: 'open', paid: false, paidDate: '', notes: 'October',
  receipts: ['http://development.invalid/old.png']
};
function data(isAdmin: boolean) {
  return {
    isAdmin, rental: { id: 'rental1', address: 'One bedroom', rent: 1800 },
    rentals: [{ id: 'rental1', address: 'One bedroom', rent: 1800 }], renterStatus: 'active', status: 'open' as const, query: '',
    billPage: { items: [bill], page: 1, perPage: 10, totalItems: 1, totalPages: 1 }
  };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('billing presentation', () => {
  it('keeps renter receipts and printing available without mutation controls', async () => {
    render(BillsPage, { props: { data: data(false) } });
    expect(screen.queryByRole('button', { name: 'New bill' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit bill' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete bill' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark paid' })).not.toBeInTheDocument();
    expect(screen.getAllByText('$1,830.30')).toHaveLength(2);
    await fireEvent.click(screen.getByRole('button', { name: 'old.png' }));
    expect(screen.getByRole('dialog', { name: 'old.png' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'old.png' })).toHaveAttribute('src', bill.receipts[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Close receipt' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await fireEvent.click(screen.getByRole('button', { name: 'Print October 2026 bill' }));
    expect(print).toHaveBeenCalledOnce();
    print.mockRestore();
  });

  it('sends admin edits, payments, and deletion through server actions', async () => {
    render(BillsPage, { props: { data: data(true) } });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit bill' }));
    await fireEvent.input(screen.getByLabelText('Rent'), { target: { value: '1700.25' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save bill' }));
    expect(submitBillingAction).toHaveBeenCalledWith('/bills', 'save', expect.objectContaining({
      id: 'bill1', rental: 'rental1', rent: '1700.25', status: 'open'
    }), []);
    await fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    expect(submitBillingAction).toHaveBeenCalledWith('/bills', 'markPaid', { id: 'bill1', rental: 'rental1' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Delete bill' }));
    expect(submitBillingAction).toHaveBeenCalledWith('/bills', 'delete', { id: 'bill1', rental: 'rental1' });
    confirm.mockRestore();
  });

  it('keeps filters available on empty pages and sends selection to the server', async () => {
    const props = data(false);
    props.billPage.items = [];
    render(BillsPage, { props: { data: props } });
    await fireEvent.click(screen.getByRole('button', { name: 'Paid' }));
    expect(goto).toHaveBeenCalledWith(expect.any(URL), expect.anything());
    const url = vi.mocked(goto).mock.calls[0][0] as URL;
    expect(url.searchParams.get('status')).toBe('paid');
    expect(url.searchParams.get('id')).toBe('rental1');
    expect(url.searchParams.get('page')).toBe('1');
  });

  it('preserves form input and shows a failed save instead of claiming success', async () => {
    vi.mocked(submitBillingAction).mockRejectedValueOnce(new Error('PocketBase denied billing access.'));
    render(BillsPage, { props: { data: data(true) } });
    await fireEvent.click(screen.getByRole('button', { name: 'New bill' }));
    await fireEvent.input(screen.getByLabelText('Notes'), { target: { value: 'Keep this draft' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save bill' }));
    expect(screen.getByText('PocketBase denied billing access.')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toHaveValue('Keep this draft');
  });

  it('creates dashboard bills through its server action and keeps the selected rental', async () => {
    const billing = { ...data(true), bills: [bill] };
    render(DashboardPage, { props: { data: {
      billing, rental: null, currentBill: null, rentals: [], selectedRentalId: 'rental1'
    } } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add bill' }));
    expect(screen.getByLabelText('Rent')).toHaveValue(1800);
    expect((screen.getByLabelText('Due date') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await fireEvent.click(screen.getByRole('button', { name: 'Create bill' }));
    expect(submitBillingAction).toHaveBeenCalledWith('/dashboard', 'createBill', expect.objectContaining({
      rental: 'rental1', rent: '1800', status: 'open'
    }));
    expect(goto).toHaveBeenCalledWith('/bills?id=rental1');
  });
});