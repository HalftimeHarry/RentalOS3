import { jsPDF } from 'jspdf';
import { describe, expect, it, vi } from 'vitest';
import { drawInspectionPdfChecklist, drawInspectionPdfHeader, formatInspectionPdfDate } from './inspectionPdf';

const details = {
  address: '2728 B Street, San Diego CA 92102', unit: '102', tenants: 'None',
  moveInDate: '2026-10-31', moveOutDate: '2027-02-28'
};

describe('inspection PDF formatting', () => {
  it('prints calendar dates without timezone conversion', () => {
    expect(formatInspectionPdfDate('2026-10-31')).toBe('Oct 31, 2026');
    expect(formatInspectionPdfDate('2027-02-28T00:00:00+14:00')).toBe('Feb 28, 2027');
    expect(formatInspectionPdfDate('2026-02-30')).toBe('2026-02-30');
    expect(formatInspectionPdfDate()).toBe('Not provided');
  });

  it('separates property fields and reserves wide handwritten signature lines', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const text = vi.spyOn(doc, 'text');
    const line = vi.spyOn(doc, 'line');
    const nextY = drawInspectionPdfHeader(doc, details);
    const labels = text.mock.calls.map((call) => call[0]);
    expect(labels).toContain('Property address');
    expect(labels).toContain('Move-in');
    expect(labels).toContain('Move-out');
    expect(labels.filter((label) => label === 'Signature')).toHaveLength(4);
    expect(labels.filter((label) => label === 'Date')).toHaveLength(4);
    const signatureLines = line.mock.calls.filter(([startX, , endX]) => startX === 52 && endX === 424);
    expect(signatureLines).toHaveLength(4);
    expect(nextY).toBeLessThan(740);
    expect(doc.getNumberOfPages()).toBe(1);
    expect(doc.output()).toContain('%PDF');
  });

  it('wraps long fields and keeps history signature blocks within page margins', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const text = vi.spyOn(doc, 'text');
    const nextY = drawInspectionPdfHeader(doc, {
      ...details, address: 'Long property address '.repeat(8), tenants: 'Tenant name '.repeat(15),
      metadata: Array.from({ length: 4 }, () => ({ label: 'Created by', value: 'Manager name '.repeat(15) }))
    });
    expect(text.mock.calls.some(([value]) => Array.isArray(value) && value.length > 1)).toBe(true);
    expect(nextY).toBeLessThan(740);
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });

  it('starts checklist content after the signature page and reserves handwriting lines', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    drawInspectionPdfHeader(doc, details);
    expect(doc.getNumberOfPages()).toBe(1);
    const text = vi.spyOn(doc, 'text');
    const line = vi.spyOn(doc, 'line');
    const items = Array.from({ length: 42 }, (_, index) => `Inspection item ${index + 1}`);

    drawInspectionPdfChecklist(doc, [{ title: 'KITCHEN', items }]);

    const labels = text.mock.calls.map((call) => call[0]);
    expect(labels).toContain('Condition Checklist');
    expect(labels).toContain('KITCHEN (continued)');
    expect(line.mock.calls.filter(([startX, , endX]) => startX === 52 && endX === 560).length).toBeGreaterThanOrEqual(items.length);
    expect(doc.getNumberOfPages()).toBeGreaterThan(2);
  });

  it('wraps unusually long saved notes across pages without drawing below the margin', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const text = vi.spyOn(doc, 'text');
    drawInspectionPdfChecklist(doc, [{ title: 'NOTES', items: ['Existing note '.repeat(900)] }]);
    const yCoordinates = text.mock.calls.map((call) => call[2]).filter((value): value is number => typeof value === 'number');

    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(yCoordinates.every((value) => value >= 52 && value <= 740)).toBe(true);
  });
});