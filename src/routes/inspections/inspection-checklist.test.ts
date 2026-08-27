import { describe, expect, it } from 'vitest';
import { buildInspectionRecordDetailEntries, buildMoveOutPrefillFromMoveIn, canEditInspectionStatus, canReopenInspectionForRepair, deriveNextWorkflowStatus, getInspectionStageMeta, isAutoCancelError, isMissingResourceError, reopenInspectionForRepairStatus, validateInspectionSignatureRequirements } from '$lib/inspection/inspectionWorkflow';

function createItemState() {
  return { na: false, o: false, desc: '' };
}

function createSectionState() {
  const sections = [
    {
      title: '3. DINING AREA',
      items: ['Flooring / Baseboards', 'Walls / Ceilings / Paint', 'Windows / Screens / Blinds', 'Light Fixtures / Fans', 'Switches / Outlets', 'Other']
    }
  ];

  return Object.fromEntries(
    sections.map((section) => [
      section.title,
      Object.fromEntries(section.items.map((item) => [item, createItemState()]))
    ])
  );
}

function updateItemState(sectionStates: Record<string, Record<string, { na: boolean; o: boolean; desc: string }>>, sectionTitle: string, item: string, patch: Partial<{ na: boolean; o: boolean; desc: string }>) {
  const currentSection = sectionStates[sectionTitle] ?? {};
  const currentItem = currentSection[item] ?? createItemState();

  return {
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

describe('inspection checklist state', () => {
  it('updates the windows item without losing the edited value', () => {
    let sectionStates = createSectionState();

    sectionStates = updateItemState(sectionStates, '3. DINING AREA', 'Windows / Screens / Blinds', {
      o: true,
      desc: 'The screen has a small tear'
    });

    expect(sectionStates['3. DINING AREA']['Windows / Screens / Blinds']).toEqual({
      na: false,
      o: true,
      desc: 'The screen has a small tear'
    });
  });

  it('preserves unrelated checklist items when editing one row', () => {
    let sectionStates = createSectionState();

    sectionStates = updateItemState(sectionStates, '3. DINING AREA', 'Flooring / Baseboards', { na: true });
    sectionStates = updateItemState(sectionStates, '3. DINING AREA', 'Windows / Screens / Blinds', {
      o: true,
      desc: 'Torn screen'
    });

    expect(sectionStates['3. DINING AREA']['Flooring / Baseboards']).toEqual({
      na: true,
      o: false,
      desc: ''
    });

    expect(sectionStates['3. DINING AREA']['Windows / Screens / Blinds']).toEqual({
      na: false,
      o: true,
      desc: 'Torn screen'
    });
  });
});

describe('inspection workflow rules', () => {
  it('allows editing while the workflow is a draft', () => {
    expect(canEditInspectionStatus('draft')).toBe(true);
  });

  it('locks editing once the workflow reaches final approval', () => {
    expect(canEditInspectionStatus('admin-complete')).toBe(true);
    expect(canEditInspectionStatus('tenant-reviewed')).toBe(true);
    expect(canEditInspectionStatus('repair-needed')).toBe(true);
    expect(canEditInspectionStatus('admin-approved')).toBe(false);
    expect(canEditInspectionStatus('checkout-approved')).toBe(false);
  });

  it('allows a final approved inspection to be reopened for a repair expense review', () => {
    expect(canReopenInspectionForRepair('admin-approved')).toBe(true);
    expect(canReopenInspectionForRepair('checkout-approved')).toBe(true);
    expect(canReopenInspectionForRepair('tenant-reviewed')).toBe(false);
    expect(reopenInspectionForRepairStatus('checkout-approved')).toBe('repair-needed');
  });

  it('marks a draft inspection as tenant-reviewed when the tenant approves it', () => {
    expect(deriveNextWorkflowStatus({
      currentStatus: 'draft',
      tenantApproved: true,
      hasTenantChanges: false
    })).toBe('tenant-reviewed');
  });

  it('provides a clear multi-step description for the repair-needed stage', () => {
    expect(getInspectionStageMeta('repair-needed')).toEqual({
      label: 'Fix required',
      description: 'Damage must be addressed before deposit release.',
      nextAction: 'Resolve the item(s), then re-submit the inspection for final review.'
    });
  });

  it('prefills a move-out inspection from the latest move-in record', () => {
    expect(buildMoveOutPrefillFromMoveIn({
      tenant: 'tenant-42',
      tenants: 'Alice & Bob Smith',
      property_address: '123 Main St',
      unit_no: 'A1',
      tenant_name_1: 'Alice Smith',
      tenant_name_2: 'Bob Smith'
    })).toEqual({
      tenantId: 'tenant-42',
      tenantName: 'Alice & Bob Smith',
      propertyAddress: '123 Main St',
      unitNo: 'A1',
      tenantName1: 'Alice Smith',
      tenantName2: 'Bob Smith'
    });
  });

  it('includes all core record detail fields with fallback placeholders', () => {
    expect(buildInspectionRecordDetailEntries({
      provider_name: 'Dustin Dinsmore',
      admin_approval_name: 'Dustin Dinsmore',
      checkout_approval_name: 'Dustin Dinsmore'
    })).toEqual([
      { label: 'Provider', value: 'Dustin Dinsmore' },
      { label: 'Created by', value: '—' },
      { label: 'Admin approval', value: 'Dustin Dinsmore' },
      { label: 'Checkout approval', value: 'Dustin Dinsmore' }
    ]);
  });

  it('treats auto-cancelled PocketBase requests as harmless', () => {
    expect(isAutoCancelError(new Error('The request was aborted'))).toBe(true);
    expect(isAutoCancelError(new Error('signal is aborted without reason'))).toBe(true);
    expect(isAutoCancelError(new Error('network error'))).toBe(false);
  });

  it('detects missing resource errors from PocketBase 404 responses', () => {
    const error = { name: 'ClientResponseError', status: 404, message: 'The requested resource wasn\'t found.' };
    const errorWithFormattedMessage = Object.assign(new Error('ClientResponseError 404: The requested resource wasn\'t found.'), { status: 404 });

    expect(isMissingResourceError(error)).toBe(true);
    expect(isMissingResourceError(errorWithFormattedMessage)).toBe(true);
    expect(isMissingResourceError(new Error('network error'))).toBe(false);
  });

  it('requires the admin signature and date before a draft can be saved, and the tenant signature/date when tenant approval is given', () => {
    expect(validateInspectionSignatureRequirements({
      currentStatus: 'draft',
      adminSignature: '',
      adminSignatureDate: '2026-08-27',
      tenantApproved: false,
      tenantSignature: '',
      tenantSignDate: ''
    }).isValid).toBe(false);

    expect(validateInspectionSignatureRequirements({
      currentStatus: 'draft',
      adminSignature: 'Dustin Dinsmore',
      adminSignatureDate: '2026-08-27',
      tenantApproved: true,
      tenantSignature: '',
      tenantSignDate: '2026-08-28'
    }).isValid).toBe(false);

    expect(validateInspectionSignatureRequirements({
      currentStatus: 'draft',
      adminSignature: 'Dustin Dinsmore',
      adminSignatureDate: '2026-08-27',
      tenantApproved: true,
      tenantSignature: 'Alice Smith',
      tenantSignDate: '2026-08-28'
    }).isValid).toBe(true);
  });
});
