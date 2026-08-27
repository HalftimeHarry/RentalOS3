import { describe, expect, it } from 'vitest';
import { canEditInspectionStatus, deriveNextWorkflowStatus, isAutoCancelError, isMissingResourceError } from '$lib/inspection/inspectionWorkflow';

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
    expect(canEditInspectionStatus('admin-approved')).toBe(false);
    expect(canEditInspectionStatus('checkout-approved')).toBe(false);
  });

  it('marks a draft inspection as tenant-reviewed when the tenant approves it', () => {
    expect(deriveNextWorkflowStatus({
      currentStatus: 'draft',
      tenantApproved: true,
      hasTenantChanges: false
    })).toBe('tenant-reviewed');
  });

  it('treats auto-cancelled PocketBase requests as harmless', () => {
    expect(isAutoCancelError(new Error('The request was aborted'))).toBe(true);
    expect(isAutoCancelError(new Error('signal is aborted without reason'))).toBe(true);
    expect(isAutoCancelError(new Error('network error'))).toBe(false);
  });

  it('detects missing resource errors from PocketBase 404 responses', () => {
    const error = { name: 'ClientResponseError', status: 404, message: 'The requested resource wasn\'t found.' };
    expect(isMissingResourceError(error)).toBe(true);
    expect(isMissingResourceError(new Error('network error'))).toBe(false);
  });
});
