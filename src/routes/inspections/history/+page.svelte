<script lang="ts">
  import { onMount } from 'svelte';
  import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';

  type InspectionRecord = {
    id: string;
    type?: string;
    property_address?: string;
    unit_no?: string;
    tenant?: string;
    tenants?: string;
    move_in_date?: string;
    move_out_date?: string;
    workflow_status?: string;
    created?: string;
    checklist?: string | Record<string, unknown>;
    notes?: string;
    provider?: string;
    provider_name?: string;
    provider_date?: string;
    tenant_name_1?: string;
    tenant_name_2?: string;
    tenant_date_1?: string;
    tenant_date_2?: string;
    admin_approval_name?: string;
    admin_approval_date?: string;
    checkout_approval_name?: string;
    checkout_approval_date?: string;
    checkout_notes?: string;
    created_by?: string;
    expand?: {
      provider?: {
        id?: string;
        name?: string;
        email?: string;
      };
      created_by?: {
        id?: string;
        name?: string;
        email?: string;
      };
    };
  };

  let inspections = $state<InspectionRecord[]>([]);
  let loading = $state(true);
  let error = $state('');
  let selectedInspection = $state<InspectionRecord | null>(null);

  const workflowLabel = (status?: string) => {
    switch (status) {
      case 'admin-complete':
        return 'Admin completed';
      case 'tenant-reviewed':
        return 'Tenant reviewed';
      case 'admin-approved':
        return 'Admin approved';
      case 'checkout-approved':
        return 'Checkout approved';
      default:
        return 'Draft';
    }
  };

  const prettyDate = (value?: string) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  };

  const parseChecklist = (value?: string | Record<string, unknown>) => {
    if (!value) return {} as Record<string, Record<string, { na?: boolean; o?: boolean; desc?: string }>>;
    if (typeof value === 'object') return value as Record<string, Record<string, { na?: boolean; o?: boolean; desc?: string }>>;

    try {
      const parsed = JSON.parse(value) as Record<string, Record<string, { na?: boolean; o?: boolean; desc?: string }>>;
      return parsed ?? {};
    } catch {
      return {} as Record<string, Record<string, { na?: boolean; o?: boolean; desc?: string }>>;
    }
  };

  const getExpandedName = (value?: string | { name?: string } | null) => {
    if (!value) return '—';
    if (typeof value === 'string') return value || '—';
    return value.name || '—';
  };

  const getProviderName = (record: InspectionRecord) => {
    return record.provider_name || getExpandedName(record.expand?.provider?.name) || record.provider || '—';
  };

  const getCreatedByName = (record: InspectionRecord) => {
    return getExpandedName(record.expand?.created_by?.name) || record.created_by || '—';
  };

  const openInspection = (record: InspectionRecord) => {
    selectedInspection = record;
  };

  const closeInspection = () => {
    selectedInspection = null;
  };

  onMount(async () => {
    try {
      const records = await pocketbase.client.collection('inspections').getFullList({
        fields: 'id,type,property_address,unit_no,tenant,tenants,move_in_date,move_out_date,notes,provider,provider_name,provider_date,tenant_name_1,tenant_name_2,tenant_date_1,tenant_date_2,admin_approval_name,admin_approval_date,checkout_approval_name,checkout_approval_date,checkout_notes,workflow_status,checklist,created,created_by'
      });
      inspections = records as InspectionRecord[];
    } catch (loadError) {
      console.error('[inspection history] load failed:', loadError);
      error = 'Unable to load inspection history. Please check the inspections collection and permissions.';
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>Inspection history · RentalOS3</title>
</svelte:head>

<div class="page-header">
  <div>
    <p class="page-kicker">Records</p>
    <h1>Inspection history</h1>
    <p class="muted">Review prior inspections by tenant and workflow stage.</p>
  </div>
  <a class="button" href="/inspections">New inspection</a>
</div>

{#if error}
  <div class="inline-alert error-alert" role="alert">{error}</div>
{/if}

<section class="panel">
  {#if loading}
    <p class="muted">Loading inspection records...</p>
  {:else if !inspections.length}
    <p class="muted">No inspection records have been saved yet.</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Tenant(s)</th>
            <th>Property</th>
            <th>Type</th>
            <th>Date</th>
            <th>Provider</th>
            <th>Created by</th>
            <th>Stage</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {#each inspections as record}
            <tr
              class="clickable-row"
              tabindex="0"
              role="button"
              onclick={() => openInspection(record)}
              onkeydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openInspection(record);
                }
              }}
            >
              <td>{record.tenants || '—'}</td>
              <td>{record.property_address || '—'}{record.unit_no ? `, ${record.unit_no}` : ''}</td>
              <td>{record.type === 'move-out' ? 'Move-out' : 'Move-in'}</td>
              <td>
                {record.type === 'move-out' ? prettyDate(record.move_out_date) : prettyDate(record.move_in_date)}
              </td>
              <td>{getProviderName(record)}</td>
              <td>{getCreatedByName(record)}</td>
              <td>
                <span class="stage-tag">{workflowLabel(record.workflow_status)}</span>
              </td>
              <td>{record.notes ? record.notes.slice(0, 100) + (record.notes.length > 100 ? '…' : '') : '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

{#if selectedInspection}
  <div class="modal-backdrop" role="presentation" onclick={closeInspection}>
    <div class="inspection-modal" role="dialog" aria-modal="true" aria-label="Inspection record details" onclick={(event) => event.stopPropagation()}>
      <div class="modal-header">
        <div>
          <p class="page-kicker">Inspection record</p>
          <h2>{selectedInspection.tenants || 'Tenant record'}</h2>
        </div>
        <button class="close-button" type="button" aria-label="Close inspection" onclick={closeInspection}>×</button>
      </div>

      <div class="detail-grid">
        <div>
          <span class="detail-label">Property</span>
          <strong>{selectedInspection.property_address || '—'}{selectedInspection.unit_no ? `, ${selectedInspection.unit_no}` : ''}</strong>
        </div>
        <div>
          <span class="detail-label">Type</span>
          <strong>{selectedInspection.type === 'move-out' ? 'Move-out' : 'Move-in'}</strong>
        </div>
        <div>
          <span class="detail-label">Date</span>
          <strong>{selectedInspection.type === 'move-out' ? prettyDate(selectedInspection.move_out_date) : prettyDate(selectedInspection.move_in_date)}</strong>
        </div>
        <div>
          <span class="detail-label">Workflow stage</span>
          <strong>{workflowLabel(selectedInspection.workflow_status)}</strong>
        </div>
      </div>

      <div class="signature-block">
        <h3>Record details</h3>
        <ul>
          {#if selectedInspection.provider_name || selectedInspection.provider || selectedInspection.expand?.provider?.name}
            <li><strong>Provider:</strong> {getProviderName(selectedInspection)}</li>
          {/if}
          {#if selectedInspection.created_by || selectedInspection.expand?.created_by?.name}
            <li><strong>Created by:</strong> {getCreatedByName(selectedInspection)}</li>
          {/if}
          {#if selectedInspection.tenant_name_1}
            <li><strong>Tenant 1:</strong> {selectedInspection.tenant_name_1}</li>
          {/if}
          {#if selectedInspection.tenant_name_2}
            <li><strong>Tenant 2:</strong> {selectedInspection.tenant_name_2}</li>
          {/if}
          {#if selectedInspection.provider_date}
            <li><strong>Provider date:</strong> {prettyDate(selectedInspection.provider_date)}</li>
          {/if}
          {#if selectedInspection.tenant_date_1}
            <li><strong>Tenant date 1:</strong> {prettyDate(selectedInspection.tenant_date_1)}</li>
          {/if}
          {#if selectedInspection.tenant_date_2}
            <li><strong>Tenant date 2:</strong> {prettyDate(selectedInspection.tenant_date_2)}</li>
          {/if}
          {#if selectedInspection.admin_approval_name}
            <li><strong>Admin approval:</strong> {selectedInspection.admin_approval_name}</li>
          {/if}
          {#if selectedInspection.checkout_approval_name}
            <li><strong>Checkout approval:</strong> {selectedInspection.checkout_approval_name}</li>
          {/if}
        </ul>
      </div>

      {#if selectedInspection.notes || selectedInspection.checkout_notes}
        <div class="notes-block">
          <h3>Notes</h3>
          <p>{selectedInspection.notes || selectedInspection.checkout_notes || '—'}</p>
        </div>
      {/if}

      {#if selectedInspection.notes && selectedInspection.checkout_notes && selectedInspection.notes !== selectedInspection.checkout_notes}
        <div class="notes-block">
          <h3>Checkout notes</h3>
          <p>{selectedInspection.checkout_notes}</p>
        </div>
      {/if}

      {#if selectedInspection.notes}
        <div class="notes-block">
          <h3>Tenant notes</h3>
          <p>{selectedInspection.notes}</p>
        </div>
      {/if}

      {#if Object.keys(parseChecklist(selectedInspection.checklist)).length}
        <div class="checklist-block">
          <h3>Checklist review</h3>
          {#each Object.entries(parseChecklist(selectedInspection.checklist)) as [sectionTitle, items]}
            <div class="section-card">
              <h4>{sectionTitle}</h4>
              <ul>
                {#each Object.entries(items) as [itemName, itemState]}
                  <li>
                    <span class="item-name">{itemName}</span>
                    {#if itemState?.na}
                      <span class="chip">N/A</span>
                    {/if}
                    {#if itemState?.o}
                      <span class="chip alt">O</span>
                    {/if}
                    {#if itemState?.desc}
                      <span class="desc">— {itemState.desc}</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

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

  h1 {
    margin: 0;
    color: #183b35;
  }

  .muted {
    margin: 8px 0 0;
    color: #71837c;
  }

  .panel {
    background: #fff;
    border: 1px solid #dfe8df;
    border-radius: 16px;
    padding: 22px;
    box-shadow: 0 10px 30px rgba(24, 59, 53, 0.05);
  }

  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    padding: 10px 16px;
    border: 1px solid #183b35;
    background: #183b35;
    color: white;
    text-decoration: none;
    font-weight: 700;
  }

  .inline-alert {
    border-radius: 12px;
    padding: 12px 14px;
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 14px;
  }

  .error-alert {
    background: #fff0f0;
    border: 1px solid #f2c7c7;
    color: #7d2525;
  }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid #dfe8df;
    border-radius: 12px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 820px;
  }

  th,
  td {
    border-bottom: 1px solid #edf1ee;
    padding: 12px 14px;
    text-align: left;
    vertical-align: top;
  }

  th {
    background: #f7faf7;
    color: #536864;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .05em;
    text-transform: uppercase;
  }

  tbody tr:nth-child(odd) {
    background: #f9fbfa;
  }

  tbody tr:nth-child(even) {
    background: #eef5f1;
  }

  .clickable-row {
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .clickable-row:hover,
  .clickable-row:focus-visible {
    background: #edf5d9 !important;
    outline: none;
  }

  .stage-tag {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    background: #edf5d9;
    border: 1px solid #d9e8b9;
    color: #183b35;
    font-size: 11px;
    font-weight: 700;
    padding: 6px 10px;
    text-transform: none;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(18, 35, 32, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    z-index: 50;
  }

  .inspection-modal {
    width: min(920px, 100%);
    max-height: 90vh;
    overflow: auto;
    background: white;
    border: 1px solid #dfe8df;
    border-radius: 16px;
    padding: 22px;
    box-shadow: 0 14px 35px rgba(24, 59, 53, 0.16);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 18px;
  }

  .modal-header h2 {
    margin: 0;
    color: #183b35;
  }

  .close-button {
    border: 1px solid #dfe8df;
    border-radius: 999px;
    background: #f7faf7;
    color: #183b35;
    width: 34px;
    height: 34px;
    font-size: 26px;
    line-height: 1;
    cursor: pointer;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 18px;
  }

  .detail-grid > div {
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid #edf1ee;
    border-radius: 10px;
    background: #fafdfb;
  }

  .detail-label {
    display: block;
    color: #6a7b77;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .05em;
    text-transform: uppercase;
  }

  .signature-block,
  .notes-block,
  .checklist-block {
    border: 1px solid #dfe8df;
    border-radius: 12px;
    background: #f7faf7;
    padding: 14px 16px;
    margin-top: 16px;
  }

  .signature-block h3,
  .notes-block h3,
  .checklist-block h3 {
    margin: 0 0 8px;
    color: #183b35;
  }

  .signature-block ul {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 6px;
    color: #405b57;
  }

  .notes-block p {
    margin: 0;
    color: #405b57;
    line-height: 1.7;
  }

  .section-card {
    border: 1px solid #dfe8df;
    border-radius: 10px;
    background: white;
    padding: 12px;
    margin-top: 10px;
  }

  .section-card h4 {
    margin: 0 0 8px;
    color: #183b35;
  }

  .section-card ul {
    margin: 0;
    padding-left: 16px;
    display: grid;
    gap: 8px;
    color: #405b57;
  }

  .item-name {
    font-weight: 600;
    color: #183b35;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    background: #edf5d9;
    border: 1px solid #d9e8b9;
    color: #183b35;
    font-size: 10px;
    font-weight: 700;
    margin-left: 6px;
  }

  .chip.alt {
    background: #f5e9d8;
    border-color: #e8d0a5;
  }

  .desc {
    color: #536864;
  }

  @media (max-width: 720px) {
    .page-header {
      flex-direction: column;
      align-items: stretch;
    }

    .detail-grid {
      grid-template-columns: 1fr 1fr;
    }
  }

  @media (max-width: 520px) {
    .detail-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
