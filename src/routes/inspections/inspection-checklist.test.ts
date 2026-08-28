import { describe, expect, it } from 'vitest';
import { buildInspectionRecordDetailEntries, buildMoveOutPrefillFromMoveIn, canEditInspectionStatus, canReopenInspectionForRepair, deriveNextWorkflowStatus, getInspectionStageMeta, isAutoCancelError, isInspectionRecordStale, isMissingResourceError, reopenInspectionForRepairStatus, resolveInspectionOwnerFields, validateInspectionSignatureRequirements } from '$lib/inspection/inspectionWorkflow';

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

  it('prefills a move-out inspection from the latest move-in record without extra tenant signature fields', () => {
    expect(buildMoveOutPrefillFromMoveIn({
      tenant: 'tenant-42',
      tenants: 'Alice & Bob Smith',
      property_address: '123 Main St',
      unit_no: 'A1'
    })).toEqual({
      tenantId: 'tenant-42',
      tenantName: 'Alice & Bob Smith',
      propertyAddress: '123 Main St',
      unitNo: 'A1'
    });
  });

  it('keeps only the admin-created record detail and fallback values that remain relevant', () => {
    expect(buildInspectionRecordDetailEntries({
      created_by: 'Dustin Dinsmore'
    })).toEqual([
      { label: 'Created by', value: 'Dustin Dinsmore' }
    ]);

    expect(buildInspectionRecordDetailEntries({})).toEqual([
      { label: 'Created by', value: '—' }
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

  it('keeps the admin provider relation but uses the active tenant as the creator when a renter signs the inspection', () => {
    expect(resolveInspectionOwnerFields({
      authUserId: 'user-123',
      authUserName: 'Alice Smith',
      fallbackProviderName: 'Dustin Dinsmore',
      adminProviderId: '0vkp0699sqhkv90',
      isAdmin: false
    })).toEqual({
      providerId: '0vkp0699sqhkv90',
      providerName: 'Alice Smith',
      createdById: 'user-123'
    });

    expect(resolveInspectionOwnerFields({
      authUserId: '',
      authUserName: 'Dustin Dinsmore',
      fallbackProviderName: 'Dustin Dinsmore',
      adminProviderId: '0vkp0699sqhkv90',
      isAdmin: true
    })).toEqual({
      providerId: '0vkp0699sqhkv90',
      providerName: 'Dustin Dinsmore',
      createdById: null
    });
  });

  it('marks an inspection stale only after the 30-day grace period and never by created date alone', () => {
    const now = Date.now();
    const recentDate = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
    const staleDate = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString();

    expect(isInspectionRecordStale({ updated: recentDate })).toBe(false);
    expect(isInspectionRecordStale({ created: staleDate })).toBe(true);
    expect(isInspectionRecordStale({ updated: staleDate })).toBe(true);
    expect(isInspectionRecordStale({ updated: 'not-a-date' })).toBe(false);
  });

  it('allows inspection records to save without any digital signature requirements', () => {
    expect(validateInspectionSignatureRequirements({
      currentStatus: 'draft',
      adminSignature: '',
      adminSignatureDate: '',
      tenantApproved: false,
      tenantSignature: '',
      tenantSignDate: ''
    }).isValid).toBe(true);

    expect(validateInspectionSignatureRequirements({
      currentStatus: 'draft',
      adminSignature: '',
      adminSignatureDate: '',
      tenantApproved: true,
      tenantSignature: '',
      tenantSignDate: ''
    }).isValid).toBe(true);
  });
});
