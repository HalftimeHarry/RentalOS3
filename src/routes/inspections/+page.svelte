<script lang="ts">
  import { onMount } from 'svelte';
  import { Printer, RotateCcw, Save } from '@lucide/svelte';
  import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
  import { renterService } from '$lib/services/RenterService';
  import { canEditInspectionStatus, type InspectionWorkflowStatus } from '$lib/inspection/inspectionWorkflow';

  type InspectionType = 'move-in' | 'move-out';
  type WorkflowStatus = InspectionWorkflowStatus;
  type ItemState = { na: boolean; o: boolean; desc: string };

  type Section = {
    title: string;
    items: string[];
  };

  const sections: Section[] = [
    {
      title: '1. GENERAL CONDITION',
      items: ['Paint', 'Cleaning / Professional Clean', 'Flooring / Baseboards', 'Walls / Ceilings', 'Doors / Locks / Hardware', 'Windows / Screens / Blinds', 'Lighting', 'Other']
    },
    {
      title: '2. LIVING ROOM',
      items: ['Doors / Knobs / Locks / Hinges', 'Flooring / Baseboards', 'Walls / Ceilings / Paint', 'Windows / Screens / Blinds', 'Light Fixtures / Fans', 'Switches / Outlets', 'Other']
    },
    {
      title: '3. DINING AREA',
      items: ['Flooring / Baseboards', 'Walls / Ceilings / Paint', 'Windows / Screens / Blinds', 'Light Fixtures / Fans', 'Switches / Outlets', 'Other']
    },
    {
      title: '4. KITCHEN',
      items: ['Flooring / Baseboards', 'Walls / Ceiling / Paint', 'Windows / Screens / Blinds', 'Light Fixtures', 'Switches / Outlets', 'Range / Fan / Hood / Knobs', 'Oven / Knobs', 'Microwave', 'Refrigerator', 'Dishwasher', 'Sink / Disposal', 'Faucets / Plumbing', 'Cabinets / Counters / Hardware', 'Other']
    },
    {
      title: '5. BEDROOM',
      items: ['Doors / Knobs / Locks / Hinges', 'Flooring / Baseboards', 'Walls / Ceilings / Paint', 'Windows / Screens / Blinds', 'Light Fixtures / Fans', 'Switches / Outlets', 'Closet / Closet Doors / Tracks', 'Smoke / CO detector', 'Other']
    },
    {
      title: '6. BATHROOM',
      items: ['Doors / Knobs / Locks / Hinges', 'Flooring / Baseboards', 'Walls / Ceilings / Paint', 'Lights / Switches / Outlets', 'Toilet / Tub / Shower', 'Shower Door / Rail / Curtain', 'Sink / Faucet / Drains', 'Exhaust Fan / Cover', 'Towel / TP Rack(s)', 'Cabinets / Counters', 'Mirror / Medicine Cabinet', 'Other']
    },
    {
      title: '7. SMALL HALLWAY',
      items: ['Flooring / Baseboards', 'Walls / Ceilings / Paint', 'Light Fixtures', 'Switches / Outlets', 'Closet / Storage', 'Other']
    },
    {
      title: '8. SYSTEMS / SAFETY / SECURITY',
      items: ['Thermostat / HVAC', 'Water Heater', 'Smoke / CO Detectors', 'Doorbell / Security Device', 'Electrical / Outlets / Switches', 'Locks / Access', 'Other']
    },
    {
      title: '9. INCLUDED ITEMS / FINAL NOTES',
      items: ['Included items / missing items', 'Damage to report', 'Additional notes', 'Tenant acknowledgement']
    }
  ];

  const createItemState = (): ItemState => ({ na: false, o: false, desc: '' });
  const createSectionState = () => Object.fromEntries(
    sections.map((section) => [section.title, Object.fromEntries(section.items.map((item) => [item, createItemState()]))])
  );
  const initialSectionState = createSectionState();

  function getItemState(sectionTitle: string, item: string): ItemState {
    return sectionStates[sectionTitle]?.[item] ?? createItemState();
  }

  function updateItemState(sectionTitle: string, item: string, patch: Partial<ItemState>) {
    const currentSection = sectionStates[sectionTitle] ?? {};
    const currentItem = currentSection[item] ?? createItemState();

    sectionStates = {
      ...sectionStates,
      [sectionTitle]: {
        ...currentSection,
        [item]: {
          ...currentItem,
          ...patch
        }
      }
    };
  }

  const providerAdminId = '0vkp0699sqhkv90';
  const providerAdminRecord = {
    id: providerAdminId,
    name: 'Dustin Dinsmore',
    role: 'admin'
  };

  let inspectionType = $state<InspectionType>('move-in');
  let workflowStatus = $state<WorkflowStatus>('draft');
  let currentTenantId = $state<string | null>(null);
  let editInspectionId = $state<string | null>(null);
  let tenantOptions = $state<Array<{ id: string; name: string; email?: string }>>([]);
  let selectedTenantId = $state<string>('');
  let form = $state({
    propertyAddress: '2728 B Street, San Diego CA 92102',
    unitNo: '102',
    tenants: '',
    moveInDate: '',
    moveOutDate: '',
    otherConditionSummary: false,
    notes: '',
    tenantName1: '',
    tenantName2: '',
    providerName: '',
    providerDate: '',
    tenantDate1: '',
    tenantDate2: '',
    adminSignature: '',
    adminSignatureDate: '',
    tenantSignature: '',
    tenantSignDate: '',
    adminApprovalName: '',
    adminApprovalDate: '',
    checkoutApprovalName: '',
    checkoutApprovalDate: '',
    checkoutNotes: ''
  });
  let sectionStates = $state<Record<string, Record<string, ItemState>>>(initialSectionState);
  let saveError = $state('');
  let saveMessage = $state('');
  let savingInspection = $state(false);
  let tenantOptionsRequestId = 0;

  const isInspectionLocked = () => {
    if (!editInspectionId) return false;
    return !canEditInspectionStatus(workflowStatus);
  };

  function applyInspectionRecord(record: Record<string, any>) {
    const nextType = record.type === 'move-out' ? 'move-out' : 'move-in';
    inspectionType = nextType;
    workflowStatus = (record.workflow_status ?? 'draft') as WorkflowStatus;
    form = {
      propertyAddress: record.property_address ?? '2728 B Street, San Diego CA 92102',
      unitNo: record.unit_no ?? '102',
      tenants: record.tenants ?? '',
      moveInDate: record.move_in_date ?? '',
      moveOutDate: record.move_out_date ?? '',
      otherConditionSummary: Boolean(record.other_condition_summary),
      notes: record.notes ?? '',
      tenantName1: record.tenant_name_1 ?? '',
      tenantName2: record.tenant_name_2 ?? '',
      providerName: record.provider_name ?? '',
      providerDate: record.provider_date ?? '',
      tenantDate1: record.tenant_date_1 ?? '',
      tenantDate2: record.tenant_date_2 ?? '',
      adminSignature: record.admin_signature ?? '',
      adminSignatureDate: record.admin_signature_date ?? '',
      tenantSignature: record.tenant_signature ?? '',
      tenantSignDate: record.tenant_sign_date ?? '',
      adminApprovalName: record.admin_approval_name ?? '',
      adminApprovalDate: record.admin_approval_date ?? '',
      checkoutApprovalName: record.checkout_approval_name ?? '',
      checkoutApprovalDate: record.checkout_approval_date ?? '',
      checkoutNotes: record.checkout_notes ?? ''
    };

    if (record.checklist) {
      try {
        const parsed = typeof record.checklist === 'string' ? JSON.parse(record.checklist) : record.checklist;
        if (parsed && typeof parsed === 'object') {
          sectionStates = Object.fromEntries(
            sections.map((section) => {
              const sectionData = parsed[section.title] ?? {};
              return [
                section.title,
                Object.fromEntries(section.items.map((item) => [item, { na: Boolean(sectionData[item]?.na), o: Boolean(sectionData[item]?.o), desc: String(sectionData[item]?.desc ?? '') }]))
              ];
            })
          );
        }
      } catch {
        sectionStates = Object.fromEntries(
          sections.map((section) => [section.title, Object.fromEntries(section.items.map((item) => [item, createItemState()]))])
        );
      }
    }

    if (record.tenant) {
      selectedTenantId = record.tenant;
      const tenantName = record.tenants || record.tenant_name_1 || record.tenant_name_2 || '';
      form.tenants = tenantName;
    }
  }

  async function loadTenantOptionsForAdmin() {
    if (!pocketbase.client.authStore.isValid) return;

    const requestId = ++tenantOptionsRequestId;
    const authRole = pocketbase.client.authStore.model?.role as string | undefined;
    const isAdmin = authRole === 'admin';
    const profile = await renterService.getCurrent();
    currentTenantId = profile?.id ?? null;

    if (!isAdmin) {
      if (profile) {
        selectedTenantId = profile.id;
        form.tenants = profile.tenant_name ?? '';
      }
      return;
    }

    try {
      const tenantRecords = await pocketbase.client.collection('tenants').getFullList({
        sort: '-created',
        expand: 'user'
      });

      if (requestId !== tenantOptionsRequestId) return;

      tenantOptions = tenantRecords.map((tenant) => {
        const expandedUser = tenant.expand?.user as Record<string, any> | undefined;
        return {
          id: tenant.id,
          name: tenant.tenant_name ?? expandedUser?.name ?? 'Unnamed tenant',
          email: tenant.tenant_email ?? expandedUser?.email ?? 'No email on file'
        };
      });

      const activeTenants = tenantRecords
        .filter((tenant) => (tenant.status ?? 'applying') === 'active')
        .map((tenant) => ({
          id: tenant.id,
          name: tenant.tenant_name ?? tenant.expand?.user?.name ?? 'Unnamed tenant',
          email: tenant.tenant_email ?? tenant.expand?.user?.email ?? 'No email on file',
          status: tenant.status ?? 'applying'
        }));

      const activeTenant = activeTenants[0] ?? tenantOptions[0];
      if (activeTenant) {
        selectedTenantId = activeTenant.id;
        form.tenants = activeTenant.name;
      }
    } catch (error) {
      if (requestId !== tenantOptionsRequestId) return;
      const isAutoCancel = error instanceof Error && (error.name === 'AbortError' || error.message?.toLowerCase().includes('aborted') || error.message?.toLowerCase().includes('autocancelled'));
      if (isAutoCancel) return;
      console.error('[inspections] failed to load tenant options for admin:', error);
      tenantOptions = [];
    }
  }

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    const editId = params.get('edit');

    if (editId) {
      editInspectionId = editId;
      try {
        const record = await pocketbase.client.collection('inspections').getOne(editId);
        applyInspectionRecord(record);
      } catch (error) {
        console.error('[inspections] failed to load inspection for edit:', error);
        saveError = 'This inspection could not be loaded for editing.';
      }
    }

    await loadTenantOptionsForAdmin();

    const unsubscribe = pocketbase.client.authStore.onChange(() => {
      void loadTenantOptionsForAdmin();
    });

    return unsubscribe;
  });

  function resetForm() {
    editInspectionId = null;
    if (typeof window !== 'undefined') {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete('edit');
      window.history.replaceState({}, '', `${nextUrl.pathname}${nextUrl.search}`);
    }
    workflowStatus = 'draft';
    form = {
      propertyAddress: '2728 B Street, San Diego CA 92102',
      unitNo: '102',
      tenants: '',
      moveInDate: '',
      moveOutDate: '',
      otherConditionSummary: false,
      notes: '',
      tenantName1: '',
      tenantName2: '',
      providerName: '',
      providerDate: '',
      tenantDate1: '',
      tenantDate2: '',
      adminSignature: '',
      adminSignatureDate: '',
      tenantSignature: '',
      tenantSignDate: '',
      adminApprovalName: '',
      adminApprovalDate: '',
      checkoutApprovalName: '',
      checkoutApprovalDate: '',
      checkoutNotes: ''
    };
    sectionStates = createSectionState();
  }

  function printForm() {
    window.print();
  }

  function handleTenantSelection(event: Event) {
    const nextValue = (event.currentTarget as HTMLSelectElement | null)?.value ?? '';
    selectedTenantId = nextValue;
    const selectedTenant = tenantOptions.find((tenant) => tenant.id === nextValue);
    if (selectedTenant) {
      form.tenants = selectedTenant.name;
    }
  }

  async function saveInspection() {
    const effectiveEditId = editInspectionId ?? (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('edit') : null);
    if (effectiveEditId) {
      editInspectionId = effectiveEditId;
    }

    if (isInspectionLocked()) {
      saveError = 'This inspection is locked from editing because it has reached a final approval status.';
      saveMessage = '';
      return;
    }

    saveError = '';
    saveMessage = 'Trying to save inspection…';

    if (!pocketbase.client.authStore.isValid) {
      saveError = 'You must be signed in before saving an inspection record.';
      saveMessage = '';
      return;
    }

    const selectedTenant = tenantOptions.find((tenant) => tenant.id === selectedTenantId) ?? null;
    const resolvedTenantId = selectedTenantId || currentTenantId || null;

    if (!form.tenants.trim() && !resolvedTenantId) {
      saveError = 'Please choose a tenant or enter a tenant name before saving.';
      saveMessage = '';
      console.warn('[inspections] early save block: no tenant selected or entered');
      return;
    }

    savingInspection = true;
    saveError = '';
    saveMessage = '';

    try {
      const payload = {
        type: inspectionType,
        property_address: form.propertyAddress.trim(),
        unit_no: form.unitNo.trim(),
        tenant: resolvedTenantId,
        tenants: form.tenants.trim() || (selectedTenant?.name ?? ''),
        move_in_date: form.moveInDate || null,
        move_out_date: form.moveOutDate || null,
        other_condition_summary: form.otherConditionSummary,
        notes: form.notes.trim(),
        tenant_name_1: form.tenantName1.trim(),
        tenant_name_2: form.tenantName2.trim(),
        provider: providerAdminRecord.id,
        provider_name: providerAdminRecord.name,
        provider_date: form.providerDate || null,
        tenant_date_1: form.tenantDate1 || null,
        tenant_date_2: form.tenantDate2 || null,
        admin_signature: form.adminSignature.trim(),
        admin_signature_date: form.adminSignatureDate || null,
        tenant_signature: form.tenantSignature.trim(),
        tenant_sign_date: form.tenantSignDate || null,
        admin_approval_name: form.adminApprovalName.trim(),
        admin_approval_date: form.adminApprovalDate || null,
        checkout_approval_name: form.checkoutApprovalName.trim(),
        checkout_approval_date: form.checkoutApprovalDate || null,
        checkout_notes: form.checkoutNotes.trim(),
        workflow_status: workflowStatus,
        checklist: JSON.stringify(sectionStates),
        created_by: pocketbase.client.authStore.model?.id ?? null
      };

      const record = effectiveEditId
        ? await pocketbase.client.collection('inspections').update(effectiveEditId, payload)
        : await pocketbase.client.collection('inspections').create(payload);

      if (effectiveEditId) {
        saveMessage = `Inspection updated${record?.id ? ` for ${form.tenants.trim()}` : ''}.`;
        console.log('[inspections page] updated record:', record);
        editInspectionId = null;
        if (typeof window !== 'undefined') {
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.delete('edit');
          window.history.replaceState({}, '', `${nextUrl.pathname}${nextUrl.search}`);
        }
      } else {
        saveMessage = `Inspection saved${record?.id ? ` for ${form.tenants.trim()}` : ''}.`;
        console.log('[inspections page] saved record:', record);
      }
    } catch (error) {
      console.error('[inspections page] save failed:', error);
      saveError = 'We could not save this inspection. Make sure the PocketBase inspections collection exists and the current user has permission.';
    } finally {
      savingInspection = false;
    }
  }
</script>

<svelte:head>
  <title>Inspections · RentalOS3</title>
</svelte:head>

<div class="page-header">
  <div>
    <p class="page-kicker">Tenant documentation</p>
    <h1>Move-in / Move-out inspection</h1>
    <p class="muted">Capture unit condition for each tenancy and keep a clean record for both parties.</p>
  </div>
  <div class="header-actions">
    <a class="button secondary-button" href="/inspections/history">History</a>
    <button class="button secondary-button" type="button" onclick={resetForm}><RotateCcw size={15} /> Reset</button>
    <button class="button" type="button" onclick={saveInspection} disabled={savingInspection}><Save size={15} /> {savingInspection ? 'Saving...' : 'Save'}</button>
    <button class="button" type="button" onclick={printForm}><Printer size={15} /> Print</button>
  </div>
</div>

{#if saveError}
  <div class="inline-alert error-alert" role="alert">{saveError}</div>
{/if}

{#if saveMessage}
  <div class="inline-alert success-alert" role="status">{saveMessage}</div>
{/if}

<section class="panel form-shell">
  <div class="inspection-tabs" aria-label="Inspection type selector">
    <button class:active={inspectionType === 'move-in'} type="button" class="tab-button" onclick={() => (inspectionType = 'move-in')}>Move-in</button>
    <button class:active={inspectionType === 'move-out'} type="button" class="tab-button" onclick={() => (inspectionType = 'move-out')}>Move-out</button>
  </div>

  <div class="top-grid">
    <label class="field">
      <span>Property Address</span>
      <input bind:value={form.propertyAddress} type="text" placeholder="123 Main Street" />
    </label>
    <label class="field short-field">
      <span>Unit No.</span>
      <input bind:value={form.unitNo} type="text" placeholder="Apt 102" />
    </label>
    {#if pocketbase.client.authStore.model?.role === 'admin'}
      {#if tenantOptions.length}
        <label class="field">
          <span>Tenant</span>
          <select value={selectedTenantId} onchange={handleTenantSelection}>
            <option value="">Select tenant</option>
            {#each tenantOptions as tenant}
              <option value={tenant.id}>{tenant.name}</option>
            {/each}
          </select>
        </label>
      {:else}
        <label class="field">
          <span>Tenant(s)</span>
          <input bind:value={form.tenants} type="text" placeholder="Tenant name" />
          <small class="helper-text">No tenant records were loaded. Enter the tenant name manually or add a tenant record first.</small>
        </label>
      {/if}
    {:else}
      <label class="field">
        <span>Tenant(s)</span>
        <input bind:value={form.tenants} type="text" placeholder="Tenant names" />
      </label>
    {/if}
    <label class="field short-field">
      <span>{inspectionType === 'move-in' ? 'Move-In Date' : 'Move-Out Date'}</span>
      <input
        type="date"
        value={inspectionType === 'move-in' ? form.moveInDate : form.moveOutDate}
        onchange={(event) => {
          const nextValue = (event.currentTarget as HTMLInputElement).value;
          if (inspectionType === 'move-in') {
            form.moveInDate = nextValue;
          } else {
            form.moveOutDate = nextValue;
          }
        }}
      />
    </label>
  </div>

  <div class="workflow-panel">
    <div class="workflow-header">
      <h2>Shared inspection workflow</h2>
      <label class="field compact-field">
        <span>Current stage</span>
        <select bind:value={workflowStatus} disabled={isInspectionLocked()}>
          <option value="draft">Draft</option>
          <option value="admin-complete">Admin completed initial review</option>
          <option value="tenant-reviewed">Tenant notes and signature added</option>
          <option value="admin-approved">Admin approved</option>
          <option value="checkout-approved">Checkout comparison approved</option>
        </select>
      </label>
    </div>

    {#if editInspectionId && isInspectionLocked()}
      <div class="inline-alert warning-alert" role="status">This record is locked for editing because it has reached final approval.</div>
    {/if}

    <div class="workflow-grid">
      <div class="workflow-card">
        <h3>1. Admin initial review</h3>
        <p>Property manager completes the condition checklist and signs below.</p>
      </div>
      <div class="workflow-card">
        <h3>2. Tenant notes</h3>
        <p>Tenant adds remarks and signs after reviewing the report.</p>
      </div>
      <div class="workflow-card">
        <h3>3. Final admin approval</h3>
        <p>Admin reviews both sets of notes and approves before or at checkout.</p>
      </div>
    </div>
  </div>

  <div class="note-block">
    <p><strong>IMPORTANT:</strong> This inspection record documents the condition of the interior unit at the beginning or end of the tenancy. Exterior and common-area items are managed by the HOA and are not included in this report. Please review each room carefully and note any items that are missing, damaged, or require attention.</p>
    <p><strong>N/A</strong> - Not applicable to this unit &nbsp;&nbsp; <strong>O</strong> - Other condition requiring explanation</p>
  </div>

  <label class="checkbox-row">
    <input bind:checked={form.otherConditionSummary} type="checkbox" />
    <span>Checking this box will prepare a summary of all Other Condition items (O) checked below.</span>
  </label>

  {#each sections as section}
    <div class="inspection-section">
      <h2>{section.title}</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>N/A</th>
              <th>O</th>
              <th>Description / Comment</th>
            </tr>
          </thead>
          <tbody>
            {#each section.items as item}
              {@const itemState = getItemState(section.title, item)}
              <tr>
                <td class="item-name">{item}</td>
                <td>
                  <input
                    checked={itemState.na}
                    type="checkbox"
                    onchange={(event) => updateItemState(section.title, item, { na: (event.currentTarget as HTMLInputElement).checked })}
                  />
                </td>
                <td>
                  <input
                    checked={itemState.o}
                    type="checkbox"
                    onchange={(event) => updateItemState(section.title, item, { o: (event.currentTarget as HTMLInputElement).checked })}
                  />
                </td>
                <td>
                  <input
                    value={itemState.desc}
                    type="text"
                    placeholder="Comment"
                    onchange={(event) => updateItemState(section.title, item, { desc: (event.currentTarget as HTMLInputElement).value })}
                  />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/each}

  <div class="notes-card">
    <label class="field">
      <span>Tenant Remarks for all categories above</span>
      <textarea bind:value={form.notes} rows="4" placeholder="Add any additional tenant remarks or notes."></textarea>
    </label>
  </div>

  <div class="signature-grid">
    <label class="field">
      <span>Provider (linked admin)</span>
      <input value={providerAdminRecord.name} readonly aria-readonly="true" />
      <small class="helper-text">Linked admin provider — this is not free text.</small>
    </label>
    <label class="field short-field">
      <span>Date</span>
      <input bind:value={form.providerDate} type="date" />
    </label>
    <label class="field">
      <span>Admin signature</span>
      <input bind:value={form.adminSignature} type="text" placeholder="Dustin Dinsmore" />
    </label>
    <label class="field short-field">
      <span>Signature date</span>
      <input bind:value={form.adminSignatureDate} type="date" />
    </label>
    <label class="field">
      <span>Tenant</span>
      <input bind:value={form.tenantName1} type="text" placeholder="Tenant name" />
    </label>
    <label class="field short-field">
      <span>Date</span>
      <input bind:value={form.tenantDate1} type="date" />
    </label>
    <label class="field">
      <span>Tenant signature</span>
      <input bind:value={form.tenantSignature} type="text" placeholder="Tenant signature" />
    </label>
    <label class="field short-field">
      <span>Tenant sign date</span>
      <input bind:value={form.tenantSignDate} type="date" />
    </label>
    <label class="field">
      <span>Admin approval</span>
      <input bind:value={form.adminApprovalName} type="text" placeholder="Approved by" />
    </label>
    <label class="field short-field">
      <span>Approval date</span>
      <input bind:value={form.adminApprovalDate} type="date" />
    </label>
    <label class="field">
      <span>Checkout approval</span>
      <input bind:value={form.checkoutApprovalName} type="text" placeholder="Checkout approved by" />
    </label>
    <label class="field short-field">
      <span>Checkout date</span>
      <input bind:value={form.checkoutApprovalDate} type="date" />
    </label>
  </div>

  <div class="notes-card">
    <label class="field">
      <span>Checkout comparison notes</span>
      <textarea bind:value={form.checkoutNotes} rows="4" placeholder="Record any final condition differences or approved exceptions noted at checkout."></textarea>
    </label>
  </div>

  <div class="form-footer">
    <button class="button" type="button" onclick={saveInspection} disabled={savingInspection || isInspectionLocked()}><Save size={15} /> {savingInspection ? 'Saving...' : isInspectionLocked() ? 'Locked' : 'Save inspection'}</button>
  </div>
</section>

<style>
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 18px;
    margin-bottom: 22px;
  }

  .page-kicker {
    margin: 0 0 8px;
    color: #688078;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  .muted {
    color: #71837c;
    margin: 0;
  }

  .header-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .panel {
    background: #fff;
    border: 1px solid #dfe8df;
    border-radius: 16px;
    padding: 22px;
    box-shadow: 0 10px 30px rgba(24, 59, 53, 0.05);
  }

  .form-shell {
    display: grid;
    gap: 18px;
  }

  .inspection-tabs {
    display: inline-flex;
    background: #f4f7f4;
    border: 1px solid #dfe8df;
    border-radius: 999px;
    padding: 4px;
    width: fit-content;
  }

  .tab-button {
    border: 0;
    border-radius: 999px;
    background: transparent;
    padding: 8px 18px;
    font: inherit;
    font-weight: 700;
    color: #536864;
    cursor: pointer;
  }

  .tab-button.active {
    background: #183b35;
    color: white;
  }

  .top-grid,
  .signature-grid {
    display: grid;
    grid-template-columns: minmax(220px, 2fr) minmax(140px, 0.8fr) minmax(200px, 1.5fr) minmax(140px, 0.8fr);
    gap: 14px;
  }

  .field {
    display: grid;
    gap: 8px;
    color: #294744;
    font-size: 13px;
    font-weight: 600;
  }

  .field input,
  .field textarea,
  .field select {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #dfe8df;
    border-radius: 10px;
    background: #fbfdfb;
    color: #183b35;
    padding: 11px 12px;
    font: inherit;
  }

  .field textarea {
    min-height: 120px;
    resize: vertical;
  }

  .helper-text {
    margin: 0;
    color: #688078;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.4;
  }

  .short-field,
  .compact-field {
    max-width: 200px;
  }

  .workflow-panel {
    border: 1px solid #dfe8df;
    border-radius: 14px;
    background: #f7faf7;
    padding: 16px;
    display: grid;
    gap: 14px;
  }

  .workflow-header {
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: 12px;
  }

  .workflow-header h2 {
    margin: 0;
    font-size: 1rem;
    color: #183b35;
  }

  .workflow-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .workflow-card {
    border: 1px solid #dfe8df;
    border-radius: 12px;
    background: white;
    padding: 14px;
    display: grid;
    gap: 6px;
  }

  .workflow-card h3 {
    margin: 0;
    color: #183b35;
    font-size: 0.95rem;
  }

  .workflow-card p {
    margin: 0;
    color: #536864;
    font-size: 12px;
    line-height: 1.6;
  }

  .note-block {
    border: 1px solid #dfe8df;
    border-radius: 12px;
    background: #f7faf7;
    padding: 14px 16px;
    line-height: 1.6;
    color: #405b57;
    font-size: 13px;
  }

  .checkbox-row {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: #294744;
    font-size: 13px;
    font-weight: 600;
  }

  .inspection-section {
    display: grid;
    gap: 12px;
  }

  .inspection-section h2 {
    margin: 0;
    font-size: 1.02rem;
    color: #183b35;
  }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid #dfe8df;
    border-radius: 12px;
    background: #fff;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 720px;
  }

  th,
  td {
    border-bottom: 1px solid #edf1ee;
    padding: 10px 12px;
    vertical-align: middle;
    text-align: left;
  }

  th {
    background: #f7faf7;
    color: #536864;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .05em;
    text-transform: uppercase;
  }

  .item-name {
    min-width: 260px;
    color: #183b35;
    font-weight: 600;
  }

  input[type='checkbox'] {
    width: 16px;
    height: 16px;
    accent-color: #183b35;
  }

  td input[type='text'] {
    width: 100%;
    box-sizing: border-box;
    min-width: 160px;
    border: 1px solid #dfe8df;
    border-radius: 8px;
    background: #fbfdfb;
    padding: 8px 10px;
    font: inherit;
  }

  .inline-alert {
    border-radius: 12px;
    padding: 12px 14px;
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 14px;
  }

  .success-alert {
    background: #edfbe9;
    border: 1px solid #bfe4b9;
    color: #20532b;
  }

  .error-alert {
    background: #fff0f0;
    border: 1px solid #f2c7c7;
    color: #7d2525;
  }

  .form-footer {
    display: flex;
    justify-content: flex-end;
    padding-top: 4px;
  }

  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 999px;
    padding: 10px 16px;
    border: 1px solid #183b35;
    background: #183b35;
    color: white;
    font-weight: 700;
    cursor: pointer;
  }

  .button:disabled {
    opacity: 0.7;
    cursor: wait;
  }

  .secondary-button {
    background: white;
    color: #183b35;
    border-color: #cfe0bd;
  }

  @media (max-width: 900px) {
    .top-grid,
    .signature-grid {
      grid-template-columns: 1fr;
    }

    .short-field {
      max-width: none;
    }

    .page-header {
      flex-direction: column;
      align-items: stretch;
    }
  }

  @media print {
    body {
      background: white;
    }

    .page-header,
    .inspection-tabs,
    .header-actions {
      display: none !important;
    }

    .panel {
      box-shadow: none;
      border: none;
      padding: 0;
    }
  }
</style>
