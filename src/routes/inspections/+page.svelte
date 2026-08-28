<script lang="ts">
  import { onMount } from 'svelte';
  import { Copy, Printer, RotateCcw, Save } from '@lucide/svelte';
  import { jsPDF } from 'jspdf';
  import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
  import { renterService } from '$lib/services/RenterService';
  import {
    buildMoveOutPrefillFromMoveIn,
    canEditInspectionStatus,
    canReopenInspectionForRepair,
    deriveNextWorkflowStatus,
    getInspectionStageMeta,
    isAutoCancelError,
    isMissingResourceError,
    repairRequiredAdminNote,
    reopenInspectionForRepairStatus,
    resolveInspectionOwnerFields,
    type InspectionWorkflowStatus
  } from '$lib/inspection/inspectionWorkflow';

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

  function getInspectionOwnerFields() {
    const authUser = pocketbase.client.authStore.model as { id?: string; name?: string; role?: string } | null;
    const authUserId = authUser?.id ?? null;

    return resolveInspectionOwnerFields({
      authUserId,
      authUserName: authUser?.name ?? null,
      fallbackProviderName: null,
      adminProviderId: null,
      isAdmin: authUser?.role === 'admin'
    });
  }

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
    otherConditionSummary: true,
    notes: '',
    checkoutNotes: ''
  });
  let sectionStates = $state<Record<string, Record<string, ItemState>>>(initialSectionState);
  let originalSectionStates = $state<Record<string, Record<string, ItemState>>>(initialSectionState);
  let saveError = $state('');
  let saveMessage = $state('');
  let savingInspection = $state(false);
  let tenantOptionsRequestId = 0;

  const canReopenForRepair = $derived(canReopenInspectionForRepair(workflowStatus));
  const getTodayDateValue = () => new Date().toISOString().slice(0, 10);

  function isInspectionLocked() {
    if (!editInspectionId) return false;
    return !canEditInspectionStatus(workflowStatus);
  }

  const canSaveInspection = $derived(!isInspectionLocked());

  function applyRepairRequiredGuidance(nextStatus: WorkflowStatus) {
    if (nextStatus === 'repair-needed' && !form.checkoutNotes.trim()) {
      form.checkoutNotes = repairRequiredAdminNote;
    }
  }

  function cloneSectionState(state: Record<string, Record<string, ItemState>>) {
    return JSON.parse(JSON.stringify(state)) as Record<string, Record<string, ItemState>>;
  }

  function hasChecklistChanges() {
    return JSON.stringify(sectionStates) !== JSON.stringify(originalSectionStates);
  }

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
          originalSectionStates = cloneSectionState(sectionStates);
        }
      } catch {
        sectionStates = Object.fromEntries(
          sections.map((section) => [section.title, Object.fromEntries(section.items.map((item) => [item, createItemState()]))])
        );
        originalSectionStates = cloneSectionState(sectionStates);
      }
    }

    if (record.tenant) {
      selectedTenantId = record.tenant;
      const tenantName = record.tenants || '';
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
      if (isAutoCancelError(error)) return;
      console.error('[inspections] failed to load tenant options for admin:', error);
      tenantOptions = [];
    }
  }

  onMount(() => {
    const loadInspectionData = async () => {
      const params = new URLSearchParams(window.location.search);
      const editId = params.get('edit');

      if (editId) {
        editInspectionId = editId;
        try {
          const record = await pocketbase.client.collection('inspections').getOne(editId);
          applyInspectionRecord(record);
        } catch (error) {
          if (isAutoCancelError(error)) return;
          console.error('[inspections] failed to load inspection for edit:', error);
          clearEditInspectionState();
          saveError = 'This inspection no longer exists or was deleted. A new inspection draft is ready.';
        }
      }

      await loadTenantOptionsForAdmin();
    };

    void loadInspectionData();

    const unsubscribe = pocketbase.client.authStore.onChange(() => {
      void loadTenantOptionsForAdmin();
    });

    return unsubscribe;
  });

  function clearEditInspectionState() {
    editInspectionId = null;
    saveError = '';
    saveMessage = '';
    if (typeof window !== 'undefined') {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete('edit');
      window.history.replaceState({}, '', `${nextUrl.pathname}${nextUrl.search}`);
    }
  }

  function getCurrentEditIdFromUrl() {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('edit');
  }

  function resetForm() {
    clearEditInspectionState();
    workflowStatus = 'draft';
    form = {
      propertyAddress: '2728 B Street, San Diego CA 92102',
      unitNo: '102',
      tenants: '',
      moveInDate: '',
      moveOutDate: '',
      otherConditionSummary: true,
      notes: '',
      checkoutNotes: ''
    };
    sectionStates = createSectionState();
    originalSectionStates = cloneSectionState(sectionStates);
  }

  async function createMoveOutFromLastMoveIn() {
    if (!pocketbase.client.authStore.isValid) {
      saveError = 'You must be signed in before creating a move-out shortcut.';
      saveMessage = '';
      return;
    }

    try {
      const moveInRecords = await pocketbase.client.collection('inspections').getFullList({
        filter: 'type = "move-in"',
        sort: '-created',
        fields: 'id,tenant,tenants,property_address,unit_no'
      });

      const latestMoveIn = moveInRecords[0];
      if (!latestMoveIn) {
        saveError = 'No move-in inspection has been saved yet, so there is no record to copy from.';
        saveMessage = '';
        return;
      }

      const prefill = buildMoveOutPrefillFromMoveIn(latestMoveIn as Record<string, any>);
      form.tenants = prefill.tenantName;
      selectedTenantId = prefill.tenantId;
      form.propertyAddress = prefill.propertyAddress;
      form.unitNo = prefill.unitNo;
      inspectionType = 'move-out';
      workflowStatus = 'draft';
      saveError = '';
      saveMessage = 'Move-out form loaded from the latest move-in record.';
    } catch (error) {
      if (isAutoCancelError(error)) return;
      console.error('[inspections] failed to create move-out from last move-in:', error);
      saveError = 'Unable to find the last move-in record to copy from.';
      saveMessage = '';
    }
  }

  function formatPdfDate(value?: string) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  function previewPdfDocument(doc: jsPDF, fileName: string) {
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
  }

  function printForm() {
    document.body.classList.add('print-contract');
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('print-contract');
    }, { once: true });
    window.print();
  }

  function downloadInspectionPdf() {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 52;
    let y = 52;
    const title = 'Inspection Contract';

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(title, margin, y);
    y += 24;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    const lines = [
      `Address: ${form.propertyAddress || 'Not provided'}`,
      `Unit: ${form.unitNo || 'Not provided'}`,
      `Tenant(s): ${form.tenants || 'Not provided'}`,
      `Move-in date: ${formatPdfDate(form.moveInDate)}`,
      `Move-out date: ${formatPdfDate(form.moveOutDate)}`
    ];

    for (const line of lines) {
      doc.text(line, margin, y);
      y += 16;
    }

    const signatureY = y + 20;
    const drawMoveSignatureBlock = (title: string, x: number, yPos: number, width: number) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(title, x, yPos);

      const labelX = x + 12;
      const sigLabelX = x + 94;
      const sigLineStartX = x + 166;
      const sigLineEndX = x + width - 155;
      const dateLabelX = x + width - 190;
      const dateLineStartX = x + width - 150;

      const drawSignatureRow = (role: string, rowY: number) => {
        doc.setFont('helvetica', 'bold');
        doc.text(role, labelX, rowY + 10);
        doc.setFont('helvetica', 'normal');
        doc.text('Signature', sigLabelX, rowY + 10);
        doc.line(sigLineStartX, rowY + 7, sigLineEndX, rowY + 7);
        doc.text('Date', dateLabelX, rowY + 10);
        doc.line(dateLineStartX, rowY + 7, x + width - 12, rowY + 7);
      };

      drawSignatureRow('Manager', yPos + 18);
      drawSignatureRow('Tenant', yPos + 48);
    };

    drawMoveSignatureBlock('Move-in', margin, signatureY, pageWidth - margin * 2);
    drawMoveSignatureBlock('Move-out', margin, signatureY + 90, pageWidth - margin * 2);
    y = signatureY + 180;

    doc.setFont('helvetica', 'bold');
    doc.text('Checklist review', margin, y);
    y += 18;
    doc.setFont('helvetica', 'normal');

    for (const section of sections) {
      if (y > 700) {
        doc.addPage();
        y = 56;
      }

      doc.setFont('helvetica', 'bold');
      doc.text(section.title, margin, y);
      y += 14;
      doc.setFont('helvetica', 'normal');

      for (const item of section.items) {
        const itemState = getItemState(section.title, item);
        const flags: string[] = [];
        if (itemState.na) flags.push('N/A');
        if (itemState.o) flags.push('O');
        if (itemState.desc.trim()) flags.push(itemState.desc.trim());
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

    const fileName = `${(form.tenants || 'inspection').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-inspection-contract.pdf`;
    previewPdfDocument(doc, fileName);
  }

  function reopenInspectionForRepair() {
    const nextStatus = reopenInspectionForRepairStatus(workflowStatus);
    if (!canReopenForRepair) return;

    workflowStatus = nextStatus;
    const fixNote = 'Fix expense reopened this inspection for repair review until the issue is resolved.';
    form.checkoutNotes = form.checkoutNotes.trim()
      ? `${form.checkoutNotes.trim()}\n${fixNote}`
      : fixNote;

    saveInspection();
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
    const debugSnapshotAtStart = {
      editInspectionId,
      workflowStatus,
      tenantName: form.tenants,
      selectedTenantId,
      currentTenantId,
      hasChecklistChanges: hasChecklistChanges(),
      notes: form.notes,
      form: JSON.parse(JSON.stringify(form)),
      sectionStates: JSON.parse(JSON.stringify(sectionStates))
    };

    console.debug('[inspections submit] start', debugSnapshotAtStart);

    const urlEditId = getCurrentEditIdFromUrl();
    const effectiveEditId = urlEditId ?? editInspectionId;

    if (urlEditId) {
      editInspectionId = urlEditId;
    } else if (!urlEditId && editInspectionId) {
      editInspectionId = null;
    }

    const currentHasChecklistChanges = hasChecklistChanges();
    const nextWorkflowStatus = deriveNextWorkflowStatus({
      currentStatus: workflowStatus,
      tenantApproved: true,
      hasTenantChanges: currentHasChecklistChanges || Boolean(form.notes.trim())
    });

    if (workflowStatus !== nextWorkflowStatus) {
      workflowStatus = nextWorkflowStatus;
    }

    if (isInspectionLocked()) {
      console.warn('[inspections submit] blocked: record is locked', { workflowStatus, nextWorkflowStatus });
      saveError = 'This inspection is locked from editing because it has reached a final approval status.';
      saveMessage = '';
      return;
    }

    saveError = '';
    saveMessage = 'Trying to save inspection…';

    if (!pocketbase.client.authStore.isValid) {
      console.warn('[inspections submit] blocked: not authenticated', { authValid: pocketbase.client.authStore.isValid });
      saveError = 'You must be signed in before saving an inspection record.';
      saveMessage = '';
      return;
    }

    const selectedTenant = tenantOptions.find((tenant) => tenant.id === selectedTenantId) ?? null;
    const resolvedTenantId = selectedTenantId || currentTenantId || null;

    if (!form.tenants.trim() && !resolvedTenantId) {
      console.warn('[inspections submit] blocked: no tenant selected or entered', {
        tenantText: form.tenants,
        selectedTenantId,
        currentTenantId
      });
      saveError = 'Please choose a tenant or enter a tenant name before saving.';
      saveMessage = '';
      return;
    }

    savingInspection = true;
    saveError = '';
    saveMessage = '';

    const ownerFields = getInspectionOwnerFields();
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
      checkout_notes: form.checkoutNotes.trim(),
      workflow_status: nextWorkflowStatus,
      checklist: JSON.stringify(sectionStates),
      created_by: ownerFields.createdById
    };

    const fullDebugPayload = {
      editId: effectiveEditId ?? null,
      currentWorkflowStatus: workflowStatus,
      derivedWorkflowStatus: nextWorkflowStatus,
      inspectionType,
      propertyAddress: form.propertyAddress,
      unitNo: form.unitNo,
      selectedTenantId,
      resolvedTenantId,
      tenants: form.tenants,
      moveInDate: form.moveInDate,
      moveOutDate: form.moveOutDate,
      otherConditionSummary: form.otherConditionSummary,
      notes: form.notes,
      checkoutNotes: form.checkoutNotes,
      checklist: JSON.parse(JSON.stringify(sectionStates)),
      rawPayload: payload
    };

    try {
      console.debug('[inspections submit] full payload dump', fullDebugPayload);
      console.debug('[inspections submit] update target', {
        editId: effectiveEditId ?? null,
        payload
      });

      const record = effectiveEditId
        ? await pocketbase.client.collection('inspections').update(effectiveEditId, payload)
        : await pocketbase.client.collection('inspections').create(payload);

      console.debug('[inspections submit] response', {
        id: record?.id ?? null,
        workflow_status: record?.workflow_status ?? null
      });

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
      if (isMissingResourceError(error)) {
        console.warn('[inspections page] stale inspection record detected; clearing edit state', {
          editId: effectiveEditId ?? null,
          payload: payload ?? null,
          error
        });
        clearEditInspectionState();
        resetForm();
        saveError = 'This inspection record no longer exists. The stale edit link was cleared and you can start a new inspection.';
      } else {
        console.error('[inspections page] save failed:', {
          editId: effectiveEditId ?? null,
          payload: payload ?? null,
          error
        });
        saveError = 'We could not save this inspection. Make sure the PocketBase inspections collection exists and the current user has permission.';
      }
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
    <p class="page-kicker">Manager record</p>
    <h1>Inspection record</h1>
    <p class="muted">Single property record with move-in and move-out reference dates.</p>
  </div>
  <div class="header-actions">
    <a class="button secondary-button" href="/inspections/history">History</a>
    <button class="button secondary-button" type="button" onclick={resetForm}><RotateCcw size={15} /> Reset</button>
    <button class="button" type="button" onclick={saveInspection} disabled={savingInspection}><Save size={15} /> {savingInspection ? 'Saving...' : 'Save'}</button>
    <button class="button secondary-button" type="button" onclick={downloadInspectionPdf}><Printer size={15} /> Download PDF</button>
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
      <span>Move-in Date</span>
      <input bind:value={form.moveInDate} type="date" />
    </label>
    <label class="field short-field">
      <span>Move-out Date</span>
      <input bind:value={form.moveOutDate} type="date" />
    </label>
  </div>

  <div class="note-block">
    <p><strong>N/A</strong> - Not applicable &nbsp;&nbsp; <strong>O</strong> - Other condition requiring explanation</p>
  </div>

  <label class="checkbox-row">
    <input bind:checked={form.otherConditionSummary} type="checkbox" />
    <span>Prepare a summary of all other-condition items checked below.</span>
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
      <span>Inspection notes</span>
      <textarea bind:value={form.notes} rows="4" placeholder="Add condition notes, exceptions, or follow-up items."></textarea>
    </label>
  </div>

  <div class="notes-card">
    <label class="field">
      <span>Manager notes</span>
      <textarea bind:value={form.checkoutNotes} rows="4" placeholder="Record any final condition differences or approved exceptions."></textarea>
    </label>
  </div>

  <div class="form-footer fix-row">
    <button class="button secondary-button" type="button" onclick={downloadInspectionPdf}><Printer size={15} /> Download PDF contract</button>
    <button class="button secondary-button" type="button" onclick={printForm}><Printer size={15} /> Print approved sheet</button>
    {#if canReopenForRepair}
      <button class="button warning-button" type="button" onclick={reopenInspectionForRepair}>Add fix expense</button>
    {/if}
    <button class="button" type="button" onclick={saveInspection} disabled={savingInspection || !canSaveInspection}><Save size={15} /> {savingInspection ? 'Saving...' : !canSaveInspection ? 'Requirements missing' : 'Save inspection'}</button>
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

  .required-field {
    border-color: #c77d41 !important;
    background: #fffaf2 !important;
    box-shadow: inset 0 0 0 1px rgba(199, 125, 65, 0.15);
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

  .workflow-status-banner {
    border: 1px solid #dfe8df;
    border-radius: 12px;
    background: linear-gradient(135deg, #f7faf7, #eef6f3);
    padding: 14px 16px;
    display: grid;
    gap: 8px;
  }

  .mini-label {
    display: inline-block;
    color: #688078;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .workflow-status-banner h3 {
    margin: 4px 0 0;
    color: #183b35;
    font-size: 1rem;
  }

  .workflow-status-banner p,
  .workflow-status-banner small {
    margin: 0;
    color: #405b57;
    line-height: 1.5;
  }

  .workflow-card {
    border: 1px solid #dfe8df;
    border-radius: 12px;
    background: white;
    padding: 14px;
    display: grid;
    gap: 6px;
    transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
  }

  .workflow-card.active {
    border-color: #183b35;
    box-shadow: 0 8px 24px rgba(24, 59, 53, 0.08);
    transform: translateY(-1px);
  }

  .workflow-card.done {
    border-color: #7ea79d;
    background: #f3faf6;
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
    gap: 10px;
    flex-wrap: wrap;
    padding-top: 4px;
  }

  .fix-row {
    justify-content: space-between;
  }

  .warning-button {
    border-color: #c77d41;
    background: #c77d41;
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
    :global(body),
    :global(html) {
      background: white !important;
      margin: 0;
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
      width: 100% !important;
      max-width: none !important;
      margin: 0 !important;
    }
  }
</style>
