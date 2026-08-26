import { describe, expect, it } from 'vitest';
import { canEditInspectionStatus } from '$lib/inspection/inspectionWorkflow';

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
});
