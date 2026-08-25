<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { ArrowUpRight, CalendarDays, CheckCircle2, CircleDollarSign, House, Users } from '@lucide/svelte';
  import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
  import { billService } from '$lib/services/BillService';
  import { rentalService } from '$lib/services/RentalService';
  import { renterService } from '$lib/services/RenterService';
  import { formatDateForInput, normalizeDateOnly, parseDateOnly, renderDateLabel } from '$lib/models';
  import type { Bill, BillStatus, Rental } from '$lib/models';

  let { data } = $props();

  let rental = $state<Rental | null>(null);
  let rentals = $state<Rental[]>([]);
  let tenants = $state<Array<{
    id: string;
    tenant_name?: string;
    tenant_email?: string;
    status?: string;
    user?: string;
    creditData?: string[];
    appData?: string[];
    damageData?: string[];
  }>>([]);
  let renterProfile = $state<{ id: string; user: string; creditData?: string[]; appData?: string[]; damageData?: string[] } | null>(null);
  let creditFiles = $state<File[]>([]);
  let creditUploadError = $state('');
  let creditUploading = $state(false);
  let allRentalBills = $state<Bill[]>([]);
  let rentalBills = $derived.by(() => {
    if (!allRentalBills.length) return [];
    return selectedStatus === 'all' ? allRentalBills : allRentalBills.filter((bill) => normalizeBillStatus(bill) === selectedStatus);
  });
  let currentBill = $derived.by(() => {
    if (selectedStatus === 'all') return null;
    return rentalBills[0] ?? null;
  });
  let activeBillRequestId = 0;
  let activeRentalRequestId = 0;
  let selectedStatus = $state<'all' | BillStatus>('open');
  let statusTabs = $derived(['open', 'paid', 'overdue', 'void', 'all'] as const);
  const emptyBillState = $derived.by(() => {
    switch (selectedStatus) {
      case 'overdue':
        return { title: 'There are no Overdue Bills', description: 'This rental is up to date.' };
      case 'paid':
        return { title: 'There are no Paid Bills', description: 'No paid bills are recorded for this property yet.' };
      case 'void':
        return { title: 'There are no Void Bills', description: 'No voided bills are recorded for this property yet.' };
      case 'open':
        return { title: 'There are no Open Bills', description: 'This rental has no open bills at the moment.' };
      default:
        return { title: 'No bills yet', description: 'Create the first monthly bill for this property.' };
    }
  });
  let userRole = $derived((pocketbase.client.authStore.model?.role as string | undefined) ?? 'renter');
  let roleLabel = $derived(userRole === 'admin' ? 'Admin' : 'Renter');
  let showTenantRecords = $state(false);
  let tenantStatusModal = $state<{
    tenantId: string;
    userName: string;
    email: string;
    status: 'applying' | 'active' | 'in-active';
  } | null>(null);
  let showBillModal = $state(false);
  let selectedRentalForBill = $state<Rental | null>(null);
  let billError = $state('');
  let billForm = $state({
    rent: 0,
    sdge: 0,
    att: 0,
    dueDate: '',
    notes: ''
  });
  let dayLabel = $state('Today');
  let greeting = $state('Hello');

  const tenantStatusPriority = (status?: string) => {
    switch (status) {
      case 'active':
        return 0;
      case 'applying':
        return 1;
      case 'in-active':
        return 2;
      default:
        return 3;
    }
  };

  const normalizeTenantStatus = (status?: string | null): 'applying' | 'active' | 'in-active' => {
    const value = status?.toLowerCase?.() ?? 'applying';
    if (value === 'active' || value === 'applying' || value === 'in-active') return value;
    return 'applying';
  };

  const money = (value = 0) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  const normalizeBillStatus = (bill?: Partial<Bill> | null): BillStatus => {
    if (!bill) return 'open';
    const status = bill.status ?? (bill.paid ? 'paid' : 'open');
    return status === 'paid' || status === 'open' || status === 'overdue' || status === 'void' ? status : 'open';
  };
  const statusLabel = (value?: BillStatus | null) => {
    const status = normalizeBillStatus({ status: value ?? undefined });
    switch (status) {
      case 'paid':
        return 'Paid';
      case 'overdue':
        return 'Overdue';
      case 'void':
        return 'Void';
      default:
        return 'Open';
    }
  };
  const plainText = (value?: string | null) =>
    (value ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  const getGreeting = () => {
    const now = new Date();
    const hour = now.getHours();
    const day = now.toLocaleDateString('en-US', { weekday: 'long' });
    dayLabel = `${day}, your rental at a glance`;

    if (hour < 12) greeting = 'Good morning.';
    else if (hour < 18) greeting = 'Good afternoon.';
    else greeting = 'Good evening.';
  };

  getGreeting();

  $effect(() => {
    if (data.rental) rental = data.rental as Rental | null;
    if ((data.rentals as Rental[] | undefined)?.length) rentals = data.rentals as Rental[];
  });

  $effect(() => {
    const selectedRentalId = rental?.id;
    if (!selectedRentalId) {
      allRentalBills = [];
      return;
    }

    const requestId = ++activeBillRequestId;

    Promise.resolve()
      .then(async () => {
        const bills = await billService.list(selectedRentalId);
        return bills.sort((a, b) => parseDateOnly(b.dueDate).getTime() - parseDateOnly(a.dueDate).getTime());
      })
      .then((bills) => {
        if (requestId !== activeBillRequestId) return;
        allRentalBills = bills;
      })
      .catch((error) => {
        if (requestId !== activeBillRequestId) return;
        console.error('[dashboard page] rental bills fetch error:', error);
        allRentalBills = [];
      });
  });

  onMount(async () => {
    try {
      if (!pocketbase.client.authStore.isValid) {
        console.log('[dashboard page] user not authenticated yet; waiting for auth state');
        return;
      }

      const requestId = ++activeRentalRequestId;
      const list = await rentalService.list();
      if (requestId !== activeRentalRequestId) return;
      console.log('[dashboard page] rental list loaded:', list);

      if (list.length) {
        rentals = list;

        const selectedId = new URLSearchParams(window.location.search).get('id');
        if (selectedId) {
          const selected = list.find((item) => item.id === selectedId) ?? null;
          if (selected) {
            rental = selected;
          }
        }

        if (!rental) {
          rental = list[0];
        }
      }

      if (rental?.id) {
        const current = await rentalService.getById(rental.id);
        if (requestId !== activeRentalRequestId) return;
        console.log('[dashboard page] selected rental:', current);
        if (current) rental = current;
      }

      if (userRole === 'admin') {
        const tenantResult = await renterService.list({ page: 1, perPage: 50, sort: '-created' });
        tenants = [...tenantResult.items]
          .sort((a, b) => {
            return tenantStatusPriority(a.status ?? 'applying') - tenantStatusPriority(b.status ?? 'applying')
              || (a.tenant_name ?? a.expand?.user?.name ?? '').localeCompare(b.tenant_name ?? b.expand?.user?.name ?? '')
              || (a.tenant_email ?? a.expand?.user?.email ?? '').localeCompare(b.tenant_email ?? b.expand?.user?.email ?? '');
          })
          .map((tenant) => ({
            id: tenant.id,
            tenant_name: tenant.tenant_name ?? tenant.expand?.user?.name ?? 'Unnamed tenant',
            tenant_email: tenant.tenant_email ?? tenant.expand?.user?.email ?? 'No email on file',
            status: tenant.status ?? 'applying',
            user: tenant.user ?? '',
            creditData: tenant.creditData ?? [],
            appData: tenant.appData ?? [],
            damageData: tenant.damageData ?? []
          }));
      } else {
        renterProfile = await renterService.getCurrent();
      }
    } catch (error) {
      const isAutoCancel = error instanceof Error && error.name === 'AbortError';
      if (!isAutoCancel) console.error('[dashboard page] rental list fetch error:', error);
    }
  });

  function handleCreditSelection(event: Event) {
    const input = event.currentTarget as HTMLInputElement | null;
    const files = Array.from(input?.files ?? []);

    if (!files.length) {
      creditFiles = [];
      creditUploadError = 'Please choose at least one file.';
      return;
    }

    creditFiles = files;
    creditUploadError = '';
  }

  async function uploadCreditFiles() {
    if (!creditFiles.length) {
      creditUploadError = 'Please choose a credit document to upload.';
      return;
    }

    creditUploading = true;
    creditUploadError = '';

    try {
      await renterService.saveFiles({ creditData: creditFiles });
      renterProfile = await renterService.getCurrent();
      creditFiles = [];
      const input = document.getElementById('credit-data-upload') as HTMLInputElement | null;
      if (input) input.value = '';
    } catch (error) {
      console.error('[dashboard page] renter credit upload failed:', error);
      creditUploadError = 'We could not upload your credit documents. Please try again.';
    } finally {
      creditUploading = false;
    }
  }

  function openTenantStatusModal(tenant: { id: string; tenant_name?: string; tenant_email?: string; status?: string }) {
    tenantStatusModal = {
      tenantId: tenant.id,
      userName: tenant.tenant_name || 'Unnamed tenant',
      email: tenant.tenant_email || 'No email on file',
      status: normalizeTenantStatus(tenant.status)
    };
  }

  async function saveTenantStatus() {
    if (!tenantStatusModal) return;

    try {
      await pocketbase.client.collection('tenants').update(tenantStatusModal.tenantId, {
        status: tenantStatusModal.status
      });

      tenants = tenants.map((tenant) =>
        tenant.id === tenantStatusModal?.tenantId
          ? { ...tenant, status: tenantStatusModal.status }
          : tenant
      );

      tenantStatusModal = null;
    } catch (error) {
      console.error('[dashboard page] failed to update tenant status:', error);
    }
  }

  function openBillModal(item: Rental) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    billError = '';
    selectedRentalForBill = item;
    billForm = {
      rent: item.rent ?? 0,
      sdge: 0,
      att: 0,
      dueDate: formatDateForInput(dueDate),
      notes: `Charge for ${plainText(item.address) || 'this property'}`
    };
    showBillModal = true;
  }

  async function saveBillDraft() {
    if (!selectedRentalForBill) return;

    try {
      billError = '';
      console.debug('[dashboard page] saving bill draft', {
        rentalId: selectedRentalForBill.id,
        rent: billForm.rent,
        sdge: billForm.sdge,
        att: billForm.att,
        dueDate: billForm.dueDate,
        notes: billForm.notes
      });

      const createdBill = await billService.save({
        rental: selectedRentalForBill.id,
        ...billForm,
        status: 'open',
        paid: false
      });

      const createdBillId = typeof createdBill === 'object' && createdBill && 'id' in createdBill ? String(createdBill.id) : '';
      console.debug('[dashboard page] bill created', { createdBillId, rentalId: selectedRentalForBill.id });

      showBillModal = false;
      selectedRentalForBill = null;
      await goto('/bills');
    } catch (error) {
      console.error('[dashboard page] failed to create bill for rental:', error);
      billError = 'Unable to create this bill. Check that your PocketBase session is valid and the bill collection is available.';
    }
  }
</script>
<svelte:head><title>Overview · RentalOS3</title></svelte:head>
<div class="page-header"><div><p class="page-kicker">{dayLabel}</p><h1>{greeting}</h1><p class="muted">Here is what needs your attention.</p><span class="role-badge">{roleLabel} role</span></div>{#if userRole === 'admin' || !!rental}<div class="header-actions">{#if userRole === 'admin'}<a class="button" href="/tenants">Manage Tenants <Users size={16} /></a>{/if}<a class="button" href="/bills">View all bills <ArrowUpRight size={16} /></a></div>{/if}</div>
{#if userRole !== 'admin' && !rental}
  <section class="panel empty-state">
    <p class="page-kicker">Property status</p>
    <h2>No property assigned yet</h2>
    <p class="muted">Your account is active, but there is no property record linked to your renter profile yet. Please upload your credit documentation below.</p>

    <div class="document-box credit-box">
      <div class="document-header">
        <strong>Credit data</strong>
        <span>{renterProfile?.creditData?.length ? `${renterProfile.creditData.length} file(s)` : 'No files uploaded'}</span>
      </div>

      <label class="upload-field" for="credit-data-upload">Upload credit documents</label>
      <input id="credit-data-upload" type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onchange={handleCreditSelection} />

      {#if creditFiles.length}
        <div class="selected-files">
          {#each creditFiles as file}
            <span class="selected-file">{file.name}</span>
          {/each}
        </div>
      {/if}

      {#if creditUploadError}
        <p class="form-error">{creditUploadError}</p>
      {/if}

      <button class="button small-upload" type="button" onclick={uploadCreditFiles} disabled={creditUploading}>
        {creditUploading ? 'Uploading...' : 'Upload credit data'}
      </button>
    </div>
  </section>
{:else}
<div class="stat-grid"><div class="stat"><span class="stat-label"><House size={15} /> Property</span><span class="stat-value">{plainText(rental?.address) || 'No rental set up'}</span></div><div class="stat"><span class="stat-label"><CircleDollarSign size={15} /> Monthly rent</span><span class="stat-value">{money(rental?.rent)}</span></div><div class="stat"><span class="stat-label"><CalendarDays size={15} /> Next due</span><span class="stat-value">{currentBill?.dueDate ? renderDateLabel(currentBill.dueDate, { month: 'short', day: 'numeric' }) : '—'}</span></div></div>
<div class="status-tabs" aria-label="Bill status filters">
  {#each statusTabs as tab}
    <button type="button" class:active={selectedStatus === tab} class="status-tab" onclick={() => selectedStatus = tab}>
      {tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1)}
    </button>
  {/each}
</div>
{#if selectedStatus === 'all'}
  {#if allRentalBills.length}
    <section class="panel" style="margin-top: 18px;">
      <p class="page-kicker">Bill history</p>
      <h2>All bills</h2>
      <ul class="rental-list">
        {#each allRentalBills as bill}
          <li class="rental-row bill-history-row">
            <div class="bill-history-main">
              <div class="bill-history-date">{renderDateLabel(bill.dueDate, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
              <div class="bill-history-meta">
                <span>Rent {money(bill.rent)}</span>
                <span>SDG&E {money(bill.sdge)}</span>
                <span>AT&T {money(bill.att)}</span>
                <span>Total {money(bill.total)}</span>
                <span>Status {statusLabel(normalizeBillStatus(bill))}</span>
                <span>Paid {bill.paid ? 'Yes' : 'No'}</span>
                {#if bill.paidDate}
                  <span>Paid date {renderDateLabel(bill.paidDate, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                {/if}
                {#if bill.notes}
                  <span>Notes {bill.notes}</span>
                {/if}
              </div>
            </div>
            <span class="status-tag">{statusLabel(normalizeBillStatus(bill))}</span>
          </li>
        {/each}
      </ul>
    </section>
  {:else}
    <section class="panel empty-state" style="margin-top: 24px;">
      <p class="page-kicker">Bills</p>
      <h2>{emptyBillState.title}</h2>
      <p class="muted">{emptyBillState.description}</p>
    </section>
  {/if}
{:else if currentBill}
  <section class="panel bill-highlight">
    <div class="bill-highlight-row">
      <div class="bill-highlight-main">
        <div class="bill-check-rail {normalizeBillStatus(currentBill) === 'paid' ? 'paid-rail' : 'open-rail'}">
          <CheckCircle2 size={26} class="bill-check {normalizeBillStatus(currentBill) === 'paid' ? 'paid-icon' : 'open-icon'}" />
        </div>
        <div class="bill-highlight-copy">
          <p class="page-kicker">Current bill</p>
          <h2>Monthly payment</h2>
          <div class="bill-meta">
            <span>Rent {money(currentBill?.rent ?? rental?.rent)}</span>
            <span>Utilities {money((currentBill?.sdge ?? 0) + (currentBill?.att ?? 0))}</span>
          </div>
        </div>
      </div>
      <div class="bill-highlight-side">
        <div class="bill-total">{money(currentBill?.total ?? rental?.rent)}</div>
        <span class="pill {normalizeBillStatus(currentBill) === 'paid' ? 'paid' : 'unpaid'}">{statusLabel(normalizeBillStatus(currentBill))}</span>
      </div>
    </div>
  </section>
{:else}
  <section class="panel empty-state" style="margin-top: 24px;">
    <p class="page-kicker">Bills</p>
    <h2>{emptyBillState.title}</h2>
    <p class="muted">{emptyBillState.description}</p>
  </section>
{/if}

{#if userRole === 'admin' && tenants.length}
  <section class="panel" style="margin-top: 24px;">
    <button class="tenant-collapse-toggle" type="button" onclick={() => (showTenantRecords = !showTenantRecords)} aria-expanded={showTenantRecords}>
      <span>Tenant records</span>
      <span class="tenant-collapse-indicator">{showTenantRecords ? '−' : '+'}</span>
    </button>

    {#if showTenantRecords}
      <div class="tenant-collapse-body">
        <h2>All tenants</h2>
        <ul class="rental-list">
          {#each tenants as tenant}
            <li class="rental-row">
              <div class="rental-row-copy">
                <strong>{tenant.tenant_name || 'Unnamed tenant'}</strong>
                <span>{tenant.tenant_email || 'No email on file'}</span>
                <span>Status: {tenant.status || 'applying'}</span>
              </div>
              <div class="rental-row-actions">
                <span class="status-tag">{tenant.status || 'applying'}</span>
                <button class="small-button" type="button" onclick={() => openTenantStatusModal(tenant)}>Edit</button>
              </div>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>
{/if}
<section class="panel" style="margin-top: 24px;">
  <p class="page-kicker">Rental records</p>
  <h2>All rentals</h2>
  {#if rentals.length}
    <ul class="rental-list">
      {#each rentals as item}
        <li class="rental-row">
          <div class="rental-row-copy">
            <span>{plainText(item.address) || 'No address set'}</span>
          </div>
          {#if userRole === 'admin'}
            <button class="small-button" type="button" onclick={() => openBillModal(item)}>
              Add bill
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">No rental records found.</p>
  {/if}
</section>

{/if}

{#if tenantStatusModal}
  <div
    class="modal-backdrop"
    onclick={() => (tenantStatusModal = null)}
    onkeydown={(event) => {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        tenantStatusModal = null;
      }
    }}
    tabindex="0"
    role="button"
    aria-label="Close tenant status dialog"
  >
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onkeydown={(event) => {
        if (event.key === 'Escape') tenantStatusModal = null;
      }}
      onclick={(event) => event.stopPropagation()}
    >
      <div class="modal-header">
        <div>
          <p class="page-kicker">Tenant details</p>
          <h2>Edit status</h2>
        </div>
        <button class="icon-button" onclick={() => (tenantStatusModal = null)} type="button" aria-label="Close">×</button>
      </div>

      <div class="status-modal-content">
        <p class="status-modal-name">{tenantStatusModal.userName}</p>
        <p class="status-modal-email">{tenantStatusModal.email}</p>

        <label class="status-modal-label">
          Status
          <select bind:value={tenantStatusModal.status} class="select-input compact">
            <option value="applying">applying</option>
            <option value="active">active</option>
            <option value="in-active">in-active</option>
          </select>
        </label>
      </div>

      <div class="modal-footer">
        <button class="button-secondary" type="button" onclick={() => (tenantStatusModal = null)}>Cancel</button>
        <button class="button" type="button" onclick={saveTenantStatus}>Save</button>
      </div>
    </div>
  </div>
{/if}

{#if showBillModal && selectedRentalForBill}
  <div
    class="modal-backdrop"
    onclick={() => showBillModal = false}
    onkeydown={(event) => {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showBillModal = false;
      }
    }}
    tabindex="0"
    role="button"
    aria-label="Close add bill dialog"
  >
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onkeydown={(event) => {
        if (event.key === 'Escape') showBillModal = false;
      }}
      onclick={(event) => event.stopPropagation()}
    >
      <div class="modal-header">
        <div>
          <p class="page-kicker">Add bill</p>
          <h2>{plainText(selectedRentalForBill.address) || 'Property'} </h2>
        </div>
        <button class="icon-button" onclick={() => showBillModal = false} type="button" aria-label="Close">×</button>
      </div>

      <div class="form-grid">
        <label>Rent<input bind:value={billForm.rent} type="number" min="0" /></label>
        <label>SDG&E<input bind:value={billForm.sdge} type="number" min="0" /></label>
        <label>AT&T<input bind:value={billForm.att} type="number" min="0" /></label>
        <label>Due date<input bind:value={billForm.dueDate} type="date" /></label>
      </div>

      <label class="notes">
        Notes
        <textarea bind:value={billForm.notes} rows="3" placeholder="Optional notes"></textarea>
      </label>

      {#if billError}
        <p class="form-error">{billError}</p>
      {/if}

      <div class="modal-footer">
        <button class="button-secondary" type="button" onclick={() => showBillModal = false}>Cancel</button>
        <button class="button" type="button" onclick={saveBillDraft}>Create bill</button>
      </div>
    </div>
  </div>
{/if}

<style>.page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin-bottom: 22px; } .header-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; } .button { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 10px 16px; font-weight: 700; text-decoration: none; transition: all .18s ease; } .button[href="/tenants"] { background: #edf5d9; color: #183b35; border: 1px solid #cfe0bd; } .button[href="/bills"] { background: #183b35; color: white; border: 1px solid #183b35; } .button:hover { filter: brightness(0.98); } .rental-list { list-style: none; padding: 0; margin: 16px 0 0; display: grid; gap: 10px; } .rental-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border: 1px solid #dfe8df; border-radius: 10px; background: #f7faf6; } .rental-row-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; } .rental-row-actions { display: flex; align-items: center; gap: 8px; } .rental-row a { color: #1f5a8a; font-weight: 700; text-decoration: none; } .rental-row a:hover { text-decoration: underline; } .rental-row span { color: #536864; font-size: 13px; } .bill-history-row { align-items: flex-start; } .bill-history-main { display: flex; flex-direction: column; gap: 8px; min-width: 0; flex: 1; } .bill-history-date { font-weight: 700; color: #183b35; } .bill-history-meta { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; } .small-button { border: none; border-radius: 999px; background: #183b35; color: white; padding: 9px 12px; font-weight: 700; font-size: 12px; cursor: pointer; } .small-button:disabled { opacity: 0.7; cursor: wait; } .small-link { color: #1f5a8a; font-size: 13px; font-weight: 700; text-decoration: none; } .small-link:hover { text-decoration: underline; } .status-tabs { display: flex; flex-direction: row; align-items: center; justify-content: flex-start; flex-wrap: wrap; gap: 12px; margin: 0 0 18px; width: 100%; } .status-tab { border: none; background: transparent; color: #536864; border-bottom: 2px solid transparent; border-radius: 0; padding: 0 0 8px; font-weight: 700; cursor: pointer; transition: all .18s ease; width: max-content; line-height: 1.2; } .status-tab.active { background: transparent; color: #183b35; border-bottom-color: #183b35; } .tenant-collapse-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; border: 1px solid #dfe8df; background: #f8faf7; color: #183b35; border-radius: 12px; padding: 12px 14px; font: inherit; font-weight: 700; cursor: pointer; } .tenant-collapse-indicator { font-size: 1.4rem; line-height: 1; } .tenant-collapse-body { display: grid; gap: 12px; margin-top: 14px; } .bill-highlight { display: grid; gap: 18px; padding: 20px 22px; } .bill-highlight-row { display: flex; justify-content: space-between; align-items: center; gap: 18px; } .bill-highlight-main { display: flex; align-items: stretch; gap: 16px; min-width: 0; } .bill-check-rail { display: flex; align-items: center; justify-content: center; min-width: 46px; border-radius: 12px; padding: 8px 0; } .bill-check-rail.open-rail { background: linear-gradient(180deg, rgba(255,192,0,0.25), rgba(255,192,0,0.38)); } .bill-check-rail.paid-rail { background: linear-gradient(180deg, rgba(28,108,66,0.12), rgba(28,108,66,0.2)); } .bill-check { flex-shrink: 0; } .bill-check.open-icon { color: #b7791f; } .bill-check.paid-icon { color: #1c6c42; } .bill-highlight-copy { display: flex; flex-direction: column; justify-content: center; } .bill-meta { display: flex; flex-wrap: wrap; gap: 10px 18px; margin-top: 8px; color: #536864; font-size: 14px; } .bill-highlight-side { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; } .bill-total { font-size: clamp(2rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -.04em; color: #183b35; } .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 6px 10px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; } .pill.paid { background: #e9f8e5; color: #1c6c42; } .pill.unpaid { background: #fff2d9; color: #8d5a00; } .modal-backdrop { position: fixed; inset: 0; background: rgba(17, 28, 23, 0.46); display: grid; place-items: center; padding: 24px; z-index: 50; } .modal { width: min(560px, 100%); background: #fff; border: 1px solid #dfe8df; border-radius: 18px; padding: 24px; box-shadow: 0 22px 50px rgba(12, 24, 20, 0.18); } .modal-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; } .modal-header h2 { margin: 0; font-size: 1.5rem; } .icon-button { background: transparent; border: 1px solid #dfe8df; border-radius: 999px; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; color: #183b35; font-size: 20px; cursor: pointer; } .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; } .form-grid label, .notes { display: grid; gap: 7px; color: #71837c; font-size: 13px; } .form-grid input, .notes textarea { width: 100%; box-sizing: border-box; border: 1px solid #d8e3d8; border-radius: 7px; padding: 10px; } .notes { margin-top: 15px; } .modal-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; } .button-secondary { border: 1px solid #dfe8df; background: white; color: #183b35; border-radius: 999px; padding: 10px 16px; font-weight: 700; cursor: pointer; } .form-error { margin-top: 14px; color: #a14c3b; font-size: 13px; font-weight: 600; } @media (max-width: 640px) { .rental-row { align-items: flex-start; flex-direction: column; } .small-button { width: 100%; } .form-grid { grid-template-columns: 1fr; } } </style>
