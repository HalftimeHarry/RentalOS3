<script lang="ts">
  import { onMount } from 'svelte';
  import { Check, FileImage, FileText, Pencil, Plus, Trash2, X } from '@lucide/svelte';
  import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
  import { billService } from '$lib/services/BillService';
  import { rentalService } from '$lib/services/RentalService';
  import { formatDateForInput, renderDateLabel, normalizeDateOnly, parseDateOnly } from '$lib/models';
  import type { Bill, BillStatus, Rental } from '$lib/models';

  let bills = $state<Bill[]>([]); let rental = $state<Rental | null>(null); let showForm = $state(false); let editingId = $state<string | undefined>(); let error = $state('');
  let form = $state({ id: '', rent: 0, sdge: 0, att: 0, total: 0, dueDate: '', status: 'open' as BillStatus, paid: false, paidDate: '', notes: '' });
  let receiptFiles = $state<File[]>([]);
  let existingReceipts = $state<string[]>([]);
  let billQuery = $state('');
  let billPage = $state({ page: 1, perPage: 10, totalPages: 1, totalItems: 0 });
  let selectedReceiptUrl = $state<string | null>(null);
  let selectedReceiptName = $state('');
  let isAdmin = $derived(pocketbase.client.authStore.model?.role === 'admin');
  const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  const month = (date: string) => renderDateLabel(date, { month: 'long', year: 'numeric' });
  const getBillStatus = (bill?: Partial<Bill> | null): BillStatus => {
    const status = bill?.status ?? (bill?.paid ? 'paid' : 'open');
    return status === 'paid' || status === 'open' || status === 'overdue' || status === 'void' ? status : 'open';
  };
  const currentBill = $derived(bills[0] ?? null);
  const currentBillStatus = $derived(currentBill ? getBillStatus(currentBill) : 'open');
  const isImageReceipt = (value: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(value);
  const statusTabs = $derived(['all', 'open', 'paid', 'overdue', 'void'] as const);
  let selectedStatus = $state<'all' | BillStatus>('all');
  const visibleBills = $derived(selectedStatus === 'all' ? bills : bills.filter((bill) => getBillStatus(bill) === selectedStatus));
  const shouldShowCurrentBill = $derived(selectedStatus === 'all' || selectedStatus === 'open');
  const emptyStateCopy = $derived.by(() => {
    switch (selectedStatus) {
      case 'overdue':
        return {
          title: 'There are no Overdue Bills',
          description: 'All current bills are on schedule.'
        };
      case 'paid':
        return {
          title: 'There are no Paid Bills',
          description: 'Try another status filter to view more records.'
        };
      case 'void':
        return {
          title: 'There are no Void Bills',
          description: 'Try another status filter to view more records.'
        };
      case 'open':
        return {
          title: 'There are no Open Bills',
          description: 'Try another status filter to view more records.'
        };
      default:
        return {
          title: 'No matching bills',
          description: 'Try another status filter to view more records.'
        };
    }
  });
  const escapeFilterValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  async function loadBillsPage(resetPage = false) {
    if (!rental?.id) return;

    const nextPage = resetPage ? 1 : billPage.page;
    const rentalFilter = `rental = "${rental.id}"`;
    const searchValue = billQuery.trim();
    const searchFilter = searchValue
      ? `notes ~ "${escapeFilterValue(searchValue)}" || id ~ "${escapeFilterValue(searchValue)}" || dueDate ~ "${escapeFilterValue(searchValue)}"`
      : '';

    const pageResult = await billService.listPage(nextPage, billPage.perPage, {
      sort: '-dueDate',
      rentalId: rental.id,
      filter: [rentalFilter, searchFilter].filter(Boolean).join(' && ')
    });

    bills = pageResult.items;
    billPage = {
      page: pageResult.page,
      perPage: pageResult.perPage,
      totalPages: pageResult.totalPages,
      totalItems: pageResult.totalItems
    };
  }

  onMount(async () => {
    try {
      rental = await rentalService.getCurrent();
      console.debug('[bills page] loading bills', { rentalId: rental?.id, hasRental: !!rental });
      await loadBillsPage(true);
    } catch (loadError) {
      console.error('[bills page] failed to load bills', loadError);
      error = 'Connect PocketBase to load bills.';
    }
  });
  function openForm(bill?: Bill) {
    editingId = bill?.id;
    const status = getBillStatus(bill);
    existingReceipts = bill?.receipts ?? [];
    receiptFiles = [];
    form = bill
      ? { id: bill.id, rent: bill.rent, sdge: bill.sdge, att: bill.att, total: bill.total ?? (bill.rent + bill.sdge + bill.att), dueDate: bill.dueDate, status, paid: status === 'paid', paidDate: bill.paidDate ?? '', notes: bill.notes ?? '' }
      : { id: '', rent: rental?.rent ?? 0, sdge: 0, att: 0, total: (rental?.rent ?? 0), dueDate: '', status: 'open', paid: false, paidDate: '', notes: '' };
    showForm = true;
  }
  async function save() { if (!rental) return; try { const status: BillStatus = form.status ?? (form.paid ? 'paid' : 'open'); const paidDate = status === 'paid' ? (form.paidDate || formatDateForInput()) : ''; const savedBill = await billService.save({ ...form, id: editingId ?? form.id, rental: rental.id, status, paid: status === 'paid', paidDate, receipts: existingReceipts }, editingId, receiptFiles); await loadBillsPage(true); existingReceipts = Array.isArray((savedBill as Partial<Bill>)?.receipts) ? (savedBill as Partial<Bill>).receipts as string[] : existingReceipts; receiptFiles = []; showForm = false; } catch { error = 'Could not save this bill.'; } }
  async function markPaid(bill: Bill) { const status: BillStatus = 'paid'; const paidDate = formatDateForInput(); await billService.save({ ...bill, status, paid: true, paidDate }, bill.id); await loadBillsPage(true); }
  async function remove(bill: Bill) { if (!confirm(`Delete the ${month(bill.dueDate)} bill?`)) return; await billService.delete(bill.id); await loadBillsPage(true); }
  function openReceiptModal(receipt: string) {
    selectedReceiptUrl = receipt;
    selectedReceiptName = receipt.split('/').pop() ?? 'Receipt';
  }
  function closeReceiptModal() {
    selectedReceiptUrl = null;
    selectedReceiptName = '';
  }
</script>
<svelte:head><title>Bills · RentalOS3</title></svelte:head>
<div class="page-header"><div><p class="page-kicker">Monthly costs</p><h1>Bills</h1><p class="muted">A clear record of rent and utilities.</p></div>{#if isAdmin}<button class="button" onclick={() => openForm()}><Plus size={16} /> New bill</button>{/if}</div>
{#if error}<p class="form-error">{error}</p>{/if}
{#if showForm}<section class="panel bill-form"><div class="panel-title"><h2>{editingId ? 'Edit bill' : 'New bill'}</h2><button class="icon-button" onclick={() => showForm = false} aria-label="Close"><X size={17} /></button></div><div class="form-grid"><label>ID<input bind:value={form.id} type="text" readonly={!!editingId} /></label><label>Rent<input bind:value={form.rent} type="number" /></label><label>SDG&E<input bind:value={form.sdge} type="number" /></label><label>AT&T<input bind:value={form.att} type="number" /></label><label>Total<input value={money(form.rent + form.sdge + form.att)} type="text" readonly /></label><label>Due date<input bind:value={form.dueDate} type="date" /></label><label>Status<select bind:value={form.status}><option value="open">open</option><option value="paid">paid</option><option value="overdue">overdue</option><option value="void">void</option></select></label></div><label class="notes">Notes<textarea bind:value={form.notes} rows="2"></textarea></label><label class="receipt-upload"><span>Receipts</span><input type="file" accept="image/*,application/pdf" multiple onchange={(event) => { receiptFiles = Array.from(event.currentTarget.files ?? []); error = ''; }} /><div class="chip-list">{#if receiptFiles.length}{#each receiptFiles as file}<span class="chip"><span class="chip-icon">{#if /(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(file.name)}<FileImage size={12} />{:else}<FileText size={12} />{/if}</span>{file.name}</span>{/each}{:else if existingReceipts.length}{#each existingReceipts as receipt}<a class="chip file-link" href={receipt} target="_blank" rel="noreferrer noopener"><span class="chip-icon">{#if isImageReceipt(receipt)}<FileImage size={12} />{:else}<FileText size={12} />{/if}</span>{receipt.split('/').pop() ?? receipt}</a>{/each}{:else}<span class="muted">No receipts attached</span>{/if}</div></label><p class="form-total">Calculated total <strong>{money(form.rent + form.sdge + form.att)}</strong></p><button class="button" onclick={save}>Save bill</button></section>{/if}
{#if currentBill || bills.length}
  {#if shouldShowCurrentBill && currentBill}
    <section class="panel bill-highlight">
      <div>
        <p class="page-kicker">Current bill</p>
        <h2>{currentBillStatus === 'paid' ? 'Paid in full' : 'Monthly payment'}</h2>
        <div class="bill-meta">
          <span>Rent {money(currentBill.rent)}</span>
          <span>Utilities {money(currentBill.sdge + currentBill.att)}</span>
        </div>
      </div>
      <div>
        <div class="bill-total">{money(currentBill.total)}</div>
        <span class="pill {currentBillStatus === 'paid' ? 'paid' : 'unpaid'}">{currentBillStatus === 'paid' ? 'Paid' : 'Open'}</span>
      </div>
      {#if currentBill.receipts?.length}
        <div class="receipt-summary">
          <p class="receipt-label">Attached receipts</p>
          <div class="chip-list">
            {#each currentBill.receipts as receipt}
              <button type="button" class="chip file-link" onclick={() => openReceiptModal(receipt)}>
                <span class="chip-icon">{#if isImageReceipt(receipt)}<FileImage size={12} />{:else}<FileText size={12} />{/if}</span>
                {receipt.split('/').pop() ?? receipt}
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </section>
  {/if}
  {#if selectedReceiptUrl}
    <div class="receipt-modal-backdrop" onclick={closeReceiptModal} role="presentation">
      <div class="receipt-modal" onclick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={selectedReceiptName}>
        <div class="receipt-modal-header">
          <h3>{selectedReceiptName}</h3>
          <button class="icon-button" type="button" aria-label="Close receipt" onclick={closeReceiptModal}><X size={16} /></button>
        </div>
        {#if isImageReceipt(selectedReceiptUrl)}
          <img class="receipt-preview" src={selectedReceiptUrl} alt={selectedReceiptName} />
        {:else}
          <div class="receipt-preview-placeholder">
            <FileText size={36} />
            <p>{selectedReceiptName}</p>
            <a class="button" href={selectedReceiptUrl} target="_blank" rel="noreferrer noopener">Open file</a>
          </div>
        {/if}
      </div>
    </div>
  {/if}
  <div class="toolbar">
    <div class="status-tabs" aria-label="Bill status filters">
      {#each statusTabs as tab}
        <button type="button" class:active={selectedStatus === tab} class="status-tab" onclick={() => selectedStatus = tab}>
          {tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1)}
        </button>
      {/each}
    </div>
    <label class="search-box">
      <span class="sr-only">Search bills</span>
      <input bind:value={billQuery} oninput={() => { billPage.page = 1; void loadBillsPage(true); }} placeholder="Search bills" />
    </label>
  </div>
  {#if visibleBills.length}
    <div class="table-wrap"><table><thead><tr><th>Month</th><th>Rent</th><th>SDG&E</th><th>AT&T</th><th>Total</th><th>Due date</th><th>Paid date</th><th>Status</th><th>Receipts</th>{#if isAdmin}<th></th>{/if}</tr></thead><tbody>{#each visibleBills as bill}<tr><td><strong>{month(bill.dueDate)}</strong></td><td>{money(bill.rent)}</td><td>{money(bill.sdge)}</td><td>{money(bill.att)}</td><td><strong>{money(bill.total)}</strong></td><td>{renderDateLabel(bill.dueDate, { month: 'numeric', day: 'numeric', year: 'numeric' })}</td><td>{bill.paidDate ? renderDateLabel(bill.paidDate, { month: 'numeric', day: 'numeric', year: 'numeric' }) : '—'}</td><td><span class="pill {getBillStatus(bill) === 'paid' ? 'paid' : 'unpaid'}">{getBillStatus(bill) === 'paid' ? 'Paid' : 'Open'}</span></td><td>{#if bill.receipts?.length}<div class="receipt-cell">{#each bill.receipts as receipt}<a class="chip file-link" href={receipt} target="_blank" rel="noreferrer noopener" title={receipt.split('/').pop() ?? receipt}><span class="chip-icon">{#if isImageReceipt(receipt)}<FileImage size={12} />{:else}<FileText size={12} />{/if}</span>{(receipt.split('/').pop() ?? receipt).slice(0, 12)}{(((receipt.split('/').pop() ?? receipt).length > 12) ? '…' : '')}</a>{/each}</div>{:else}<span class="muted">—</span>{/if}</td>{#if isAdmin}<td><div class="actions">{#if getBillStatus(bill) !== 'paid'}<button class="icon-button" onclick={() => markPaid(bill)} aria-label="Mark paid"><Check size={16} /></button>{/if}<button class="icon-button" onclick={() => openForm(bill)} aria-label="Edit bill"><Pencil size={16} /></button><button class="icon-button" onclick={() => remove(bill)} aria-label="Delete bill"><Trash2 size={16} /></button></div></td>{/if}</tr>{/each}</tbody></table></div>
  {:else}
    <section class="panel empty"><h2>{emptyStateCopy.title}</h2><p>{emptyStateCopy.description}</p></section>
  {/if}
  {#if billPage.totalPages > 1}
    <div class="pagination">
      <button class="button secondary" type="button" disabled={billPage.page <= 1} onclick={() => { billPage.page = Math.max(1, billPage.page - 1); void loadBillsPage(); }}>Previous</button>
      <span class="page-indicator">Page {billPage.page} of {billPage.totalPages}</span>
      <button class="button secondary" type="button" disabled={billPage.page >= billPage.totalPages} onclick={() => { billPage.page = Math.min(billPage.totalPages, billPage.page + 1); void loadBillsPage(); }}>Next</button>
    </div>
  {/if}
{:else}
  <section class="panel empty"><h2>No bills yet</h2><p>Create the first monthly bill to start tracking costs.</p></section>
{/if}
<style>.form-error { color: #a14c3b; margin: 0 0 18px; }.bill-form { margin-bottom: 22px; }.bill-form h2 { margin: 0; }.form-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }.form-grid label, .notes { display: grid; gap: 7px; color: #71837c; font-size: 13px; }.form-grid input, textarea { width: 100%; box-sizing: border-box; border: 1px solid #d8e3d8; border-radius: 7px; padding: 10px; }.notes { margin: 15px 0; }.form-total { color: #71837c; }.form-total strong { margin-left: 8px; color: #183b35; font: 600 20px 'Space Grotesk'; }.receipt-upload { display: grid; gap: 8px; margin: 18px 0 0; color: #71837c; font-size: 13px; } .receipt-upload input { width: 100%; box-sizing: border-box; border: 1px solid #d8e3d8; border-radius: 7px; padding: 10px; } .chip-list { display: flex; flex-wrap: wrap; gap: 8px; } .chip { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; background: #eef5f1; color: #183b35; padding: 6px 10px; font-size: 11px; font-weight: 700; } .file-link { text-decoration: none; transition: opacity .15s ease; } .file-link:hover { opacity: .82; } .chip-icon { display: inline-flex; align-items: center; justify-content: center; } .receipt-summary { display: grid; gap: 8px; margin-top: 12px; } .receipt-label { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #71837c; } .receipt-cell { display: flex; flex-wrap: wrap; gap: 6px; max-width: 220px; } .muted { color: #71837c; } .bill-highlight { display: flex; justify-content: space-between; align-items: center; gap: 18px; padding: 20px 22px; }.bill-meta { display: flex; flex-wrap: wrap; gap: 10px 18px; margin-top: 8px; color: #536864; font-size: 14px; }.bill-total { font-size: clamp(2rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -.04em; color: #183b35; } .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 6px 10px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; } .pill.paid { background: #e9f8e5; color: #1c6c42; } .pill.unpaid { background: #fff2d9; color: #8d5a00; } .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 14px; } .status-tabs { display: flex; flex-wrap: wrap; gap: 8px; } .status-tab { border: 1px solid #dfe8df; background: #f7faf6; color: #183b35; border-radius: 999px; padding: 8px 12px; font-weight: 700; cursor: pointer; transition: all .18s ease; } .status-tab.active { background: #183b35; border-color: #183b35; color: white; } .search-box { display: flex; align-items: center; } .search-box input { min-width: min(260px, 100%); border: 1px solid #dce8de; border-radius: 999px; padding: 9px 12px; background: white; color: #183b35; } .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; } .pagination { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 16px; } .button.secondary { background: white; border: 1px solid #dce8de; color: #183b35; } .button.secondary:disabled { opacity: .5; cursor: not-allowed; } .page-indicator { color: #536864; font-size: 13px; } @media (max-width: 720px) { .form-grid { grid-template-columns: 1fr 1fr; } .bill-highlight { flex-direction: column; align-items: flex-start; } .toolbar { align-items: stretch; } .search-box { width: 100%; } .search-box input { width: 100%; } }</style>
