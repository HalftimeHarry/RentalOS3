<script lang="ts">
  import { onMount } from 'svelte';
  import { jsPDF } from 'jspdf';
  import { buildInspectionRecordDetailEntries, isAutoCancelError } from '$lib/inspection/inspectionWorkflow';
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
    checkout_notes?: string;
    created_by?: string;
    created_by_name?: string;
    expand?: {
      created_by?: {
        id?: string;
        name?: string;
        email?: string;
      };
    };
  };

  const checklistTemplateSections = [
    { title: '1. GENERAL CONDITION', items: ['Paint', 'Cleaning / Professional Clean', 'Flooring / Baseboards', 'Walls / Ceilings', 'Doors / Locks / Hardware', 'Windows / Screens / Blinds', 'Lighting', 'Other'] },
    { title: '2. LIVING ROOM', items: ['Doors / Knobs / Locks / Hinges', 'Flooring / Baseboards', 'Walls / Ceilings / Paint', 'Windows / Screens / Blinds', 'Light Fixtures / Fans', 'Switches / Outlets', 'Other'] },
    { title: '3. DINING AREA', items: ['Flooring / Baseboards', 'Walls / Ceilings / Paint', 'Windows / Screens / Blinds', 'Light Fixtures / Fans', 'Switches / Outlets', 'Other'] },
    { title: '4. KITCHEN', items: ['Flooring / Baseboards', 'Walls / Ceiling / Paint', 'Windows / Screens / Blinds', 'Light Fixtures', 'Switches / Outlets', 'Range / Fan / Hood / Knobs', 'Oven / Knobs', 'Microwave', 'Refrigerator', 'Dishwasher', 'Sink / Disposal', 'Faucets / Plumbing', 'Cabinets / Counters / Hardware', 'Other'] },
    { title: '5. BEDROOM', items: ['Doors / Knobs / Locks / Hinges', 'Flooring / Baseboards', 'Walls / Ceilings / Paint', 'Windows / Screens / Blinds', 'Light Fixtures / Fans', 'Switches / Outlets', 'Closet / Closet Doors / Tracks', 'Smoke / CO detector', 'Other'] },
    { title: '6. BATHROOM', items: ['Doors / Knobs / Locks / Hinges', 'Flooring / Baseboards', 'Walls / Ceilings / Paint', 'Lights / Switches / Outlets', 'Toilet / Tub / Shower', 'Shower Door / Rail / Curtain', 'Sink / Faucet / Drains', 'Exhaust Fan / Cover', 'Towel / TP Rack(s)', 'Cabinets / Counters', 'Mirror / Medicine Cabinet', 'Other'] },
    { title: '7. SMALL HALLWAY', items: ['Flooring / Baseboards', 'Walls / Ceilings / Paint', 'Light Fixtures', 'Switches / Outlets', 'Closet / Storage', 'Other'] },
    { title: '8. SYSTEMS / SAFETY / SECURITY', items: ['Thermostat / HVAC', 'Water Heater', 'Smoke / CO Detectors', 'Doorbell / Security Device', 'Electrical / Outlets / Switches', 'Locks / Access', 'Other'] },
    { title: '9. INCLUDED ITEMS / FINAL NOTES', items: ['Included items / missing items', 'Damage to report', 'Additional notes', 'Tenant acknowledgement'] }
  ];

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
      case 'repair-needed':
        return 'Fix required';
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

  const getCreatedByName = (record: InspectionRecord) => {
    return record.created_by_name || getExpandedName(record.expand?.created_by?.name) || record.created_by || '—';
  };

  const formatPdfDate = (value?: string) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  };

  const openPdfPreview = (doc: jsPDF, fileName: string) => {
    const pdfBlob = doc.output('blob');
    const url = URL.createObjectURL(pdfBlob);
    const previewWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (previewWindow) {
      previewWindow.focus();
    }

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  const canEditInspection = (record?: InspectionRecord | null) => {
    const status = record?.workflow_status;
    return status === 'draft' || status === 'admin-complete' || status === 'tenant-reviewed';
  };

  const openInspection = (record: InspectionRecord) => {
    selectedInspection = record;
  };

  const closeInspection = () => {
    selectedInspection = null;
  };

  const printInspection = (event?: MouseEvent) => {
    event?.stopPropagation();
    if (!selectedInspection) return;

    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 52;
    let y = 52;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('Inspection Contract', margin, y);
    y += 24;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    const details = [
      `Address: ${selectedInspection.property_address || 'Not provided'}`,
      `Unit: ${selectedInspection.unit_no || 'Not provided'}`,
      `Tenant(s): ${selectedInspection.tenants || 'Not provided'}`,
      `Type: ${selectedInspection.type === 'move-out' ? 'Move-out' : 'Move-in'}`,
      `Move-in date: ${formatPdfDate(selectedInspection.move_in_date)}`,
      `Move-out date: ${formatPdfDate(selectedInspection.move_out_date)}`,
      `Workflow stage: ${workflowLabel(selectedInspection.workflow_status)}`,
      `Created by: ${getCreatedByName(selectedInspection)}`
    ];

    for (const line of details) {
      doc.text(line, margin, y);
      y += 16;
    }

    y += 8;
    doc.setFont('helvetica', 'bold');
    doc.text('Checklist review', margin, y);
    y += 18;
    doc.setFont('helvetica', 'normal');

    const checklistData = parseChecklist(selectedInspection.checklist);

    for (const section of checklistTemplateSections) {
      if (y > 700) {
        doc.addPage();
        y = 56;
      }

      doc.setFont('helvetica', 'bold');
      doc.text(section.title, margin, y);
      y += 14;
      doc.setFont('helvetica', 'normal');

      for (const item of section.items) {
        const itemState = checklistData[section.title]?.[item] ?? {} as { na?: boolean; o?: boolean; desc?: string };
        const flags: string[] = [];
        if (itemState.na) flags.push('N/A');
        if (itemState.o) flags.push('O');
        if (itemState.desc?.trim()) flags.push(itemState.desc.trim());
        const itemText = `${item}${flags.length ? ` ${flags.join(' — ')}` : ''}`;
        const wrapped = doc.splitTextToSize(`• ${itemText}`, pageWidth - margin * 2 - 120);

        for (const chunk of wrapped) {
          if (y > 760) {
            doc.addPage();
            y = 56;
          }
          doc.text(chunk, margin, y);
          y += 12;
        }
      }

      y += 8;
    }

    const notesText = [selectedInspection.notes, selectedInspection.checkout_notes].filter(Boolean).join('\n\n');

    if (y > 680) {
      doc.addPage();
      y = 56;
    }

    doc.setFont('helvetica', 'bold');
    doc.text('9. INCLUDED ITEMS / FINAL NOTES', margin, y);
    y += 20;

    if (notesText) {
      doc.setFont('helvetica', 'normal');
      const notesLines = doc.splitTextToSize(notesText, pageWidth - margin * 2);
      for (const line of notesLines) {
        if (y > 760) {
          doc.addPage();
          y = 56;
        }
        doc.text(line, margin, y);
        y += 12;
      }
    }

    if (y > 610) {
      doc.addPage();
      y = 56;
    }

    doc.setDrawColor(190, 200, 190);
    doc.setLineWidth(0.7);
    const footerY = Math.max(y + 18, 640);
    const fieldWidth = (pageWidth - margin * 2 - 24) / 2;

    const drawMoveSignatureBlock = (title: string, x: number, yPos: number, width: number) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(title, x, yPos);

      const boxY = yPos + 10;

      doc.setFont('helvetica', 'bold');
      doc.text('Manager', x + 12, boxY + 16);
      doc.setFont('helvetica', 'normal');
      doc.text('Signature', x + 92, boxY + 16);
      doc.line(x + 160, boxY + 12, x + width - 110, boxY + 12);
      doc.text('Date', x + width - 105, boxY + 16);
      doc.line(x + width - 70, boxY + 12, x + width - 12, boxY + 12);

      const tenantRowY = boxY + 44;

      doc.setFont('helvetica', 'bold');
      doc.text('Tenant', x + 12, tenantRowY + 16);
      doc.setFont('helvetica', 'normal');
      doc.text('Signature', x + 92, tenantRowY + 16);
      doc.line(x + 160, tenantRowY + 12, x + width - 110, tenantRowY + 12);
      doc.text('Date', x + width - 105, tenantRowY + 16);
      doc.line(x + width - 70, tenantRowY + 12, x + width - 12, tenantRowY + 12);
    };

    const moveInFooterY = footerY + 18;
    const moveOutFooterY = footerY + 110;

    drawMoveSignatureBlock('Move-in', margin, moveInFooterY, pageWidth - margin * 2);
    drawMoveSignatureBlock('Move-out', margin, moveOutFooterY, pageWidth - margin * 2);

    const fileName = `${(selectedInspection.tenants || 'inspection').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-inspection-contract.pdf`;
    openPdfPreview(doc, fileName);
  };

  onMount(async () => {
    try {
      const records = await pocketbase.client.collection('inspections').getFullList({
        expand: 'created_by',
        fields: 'id,type,property_address,unit_no,tenant,tenants,move_in_date,move_out_date,notes,checkout_notes,workflow_status,checklist,created,created_by'
      });

      const userIds = [...new Set(records.map((record) => record.created_by).filter((value): value is string => Boolean(value)))];
      const userNameLookup = new Map<string, string>();

      for (const userId of userIds) {
        try {
          const user = await pocketbase.client.collection('users').getOne(userId, { fields: 'id,name' });
          if (user?.name) {
            userNameLookup.set(userId, user.name);
          }
        } catch {
          // Ignore lookup failures and keep the raw id as a fallback.
        }
      }

      inspections = records.map((record) => ({
        ...record,
        created_by_name: record.expand?.created_by?.name || userNameLookup.get(record.created_by ?? '') || record.created_by || '—'
      })) as InspectionRecord[];
    } catch (loadError) {
      if (isAutoCancelError(loadError)) return;
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
        <div class="modal-header-actions">
          <button class="print-button" type="button" aria-label="Print inspection record" onclick={(event) => printInspection(event)}>Print</button>
          <button class="close-button" type="button" aria-label="Close inspection" onclick={closeInspection}>×</button>
        </div>
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

      <div class="detail-block">
        <h3>Record details</h3>
        <ul>
          {#each buildInspectionRecordDetailEntries(selectedInspection) as detail}
            <li><strong>{detail.label}:</strong> {detail.value}</li>
          {/each}
        </ul>
      </div>

      {#if selectedInspection.notes || selectedInspection.checkout_notes}
        <div class="notes-block">
          <h3>Notes</h3>
          <p>{selectedInspection.notes || selectedInspection.checkout_notes || '—'}</p>
        </div>
      {/if}

      <div class="action-bar">
        {#if canEditInspection(selectedInspection)}
          <a class="button" href={`/inspections?edit=${selectedInspection.id}`}>Edit inspection</a>
        {:else}
          <button class="button secondary-button" type="button" disabled>Editing locked</button>
        {/if}
        <span class="status-note">
          {canEditInspection(selectedInspection)
            ? 'This record can still be updated while it is in an active workflow stage.'
            : 'Editing is locked once the inspection reaches final approval.'}
        </span>
      </div>

      {#if selectedInspection.checkout_notes && selectedInspection.notes !== selectedInspection.checkout_notes}
        <div class="notes-block">
          <h3>Manager notes</h3>
          <p>{selectedInspection.checkout_notes}</p>
        </div>
      {/if}

      {#if selectedInspection.notes}
        <div class="notes-block">
          <h3>Inspection notes</h3>
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

  .modal-header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .print-button,
  .close-button {
    border: 1px solid #dfe8df;
    border-radius: 999px;
    background: #f7faf7;
    color: #183b35;
    cursor: pointer;
  }

  .print-button {
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 700;
  }

  .close-button {
    width: 34px;
    height: 34px;
    font-size: 26px;
    line-height: 1;
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

  .action-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 18px;
    padding-top: 12px;
    border-top: 1px solid #dfe8df;
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
    cursor: pointer;
  }

  .button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .secondary-button {
    background: white;
    color: #183b35;
  }

  .status-note {
    color: #536864;
    font-size: 13px;
  }

  .signature-footer {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    margin-top: 22px;
    padding-top: 14px;
    border-top: 1px solid #dfe8df;
  }

  .sig-box {
    display: grid;
    gap: 10px;
    padding: 12px;
    border: 1px solid #dfe8df;
    border-radius: 10px;
    background: white;
    color: #405b57;
    font-size: 13px;
    font-weight: 600;
  }

  .sig-line {
    border-bottom: 1px solid #aabcb4;
    min-height: 28px;
    width: 100%;
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

  @media print {
    body {
      background: white;
    }

    aside.sidebar,
    .page-header,
    section.panel,
    .back-to-top,
    .modal-header-actions,
    .action-bar,
    .close-button,
    .button {
      display: none !important;
    }

    .modal-backdrop {
      position: static;
      display: block;
      background: white;
      padding: 0;
      width: 100%;
    }

    .inspection-modal {
      width: 100%;
      max-height: none;
      overflow: visible;
      border: none;
      box-shadow: none;
      padding: 0;
    }

    .checklist-block {
      display: none !important;
    }

    .signature-footer {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin-top: 24px;
    }
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
