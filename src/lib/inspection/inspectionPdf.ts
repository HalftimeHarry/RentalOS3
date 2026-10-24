import type { jsPDF } from 'jspdf';

export interface InspectionPdfDetails {
  address: string;
  unit: string;
  tenants: string;
  moveInDate?: string;
  moveOutDate?: string;
  metadata?: Array<{ label: string; value: string }>;
}

export interface InspectionPdfChecklistSection {
  title: string;
  items: string[];
}

export function formatInspectionPdfDate(value?: string): string {
  if (!value) return 'Not provided';
  const calendar = value.match(/^\d{4}-\d{2}-\d{2}(?=$|[T ])/u)?.[0];
  if (!calendar) return value;
  const date = new Date(`${calendar}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== calendar) return value;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'
  }).format(date);
}

export function drawInspectionPdfHeader(doc: jsPDF, details: InspectionPdfDetails): number {
  const margin = 52;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const bottom = doc.internal.pageSize.getHeight() - margin;
  let cursor = margin;

  function ensureSpace(height: number) {
    if (cursor + height > bottom) {
      doc.addPage();
      cursor = margin;
    }
  }

  function field(label: string, value: string, x: number, y: number, fieldWidth: number): number {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(label, x, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const lines: string[] = doc.splitTextToSize(value.trim() || 'Not provided', fieldWidth);
    doc.text(lines, x, y + 17);
    return 17 + lines.length * 14;
  }

  doc.setTextColor(25);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('Inspection Contract', margin, cursor);
  cursor += 18;
  doc.setDrawColor(130);
  doc.setLineWidth(0.6);
  doc.line(margin, cursor, margin + width, cursor);
  cursor += 26;

  const addressHeight = field('Property address', details.address, margin, cursor, width - 108);
  const unitHeight = field('Unit', details.unit, margin + width - 80, cursor, 80);
  cursor += Math.max(addressHeight, unitHeight) + 20;
  cursor += field('Tenant(s)', details.tenants, margin, cursor, width) + 20;
  const columnWidth = (width - 28) / 2;
  const moveInHeight = field('Move-in date', formatInspectionPdfDate(details.moveInDate), margin, cursor, columnWidth);
  const moveOutHeight = field('Move-out date', formatInspectionPdfDate(details.moveOutDate), margin + columnWidth + 28, cursor, columnWidth);
  cursor += Math.max(moveInHeight, moveOutHeight) + 24;

  for (const entry of details.metadata ?? []) {
    doc.setFontSize(11);
    const lines: string[] = doc.splitTextToSize(entry.value.trim() || 'Not provided', width);
    ensureSpace(17 + lines.length * 14 + 16);
    cursor += field(entry.label, entry.value, margin, cursor, width) + 16;
  }

  for (const stage of ['Move-in', 'Move-out']) {
    ensureSpace(162);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(stage, margin, cursor);
    doc.setDrawColor(180);
    doc.line(margin, cursor + 10, margin + width, cursor + 10);
    cursor += 30;

    for (const role of ['Manager', 'Tenant']) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(role, margin, cursor);
      const lineY = cursor + 26;
      const dateX = margin + width - 108;
      doc.setDrawColor(90);
      doc.line(margin, lineY, dateX - 28, lineY);
      doc.line(dateX, lineY, margin + width, lineY);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('Signature', margin, lineY + 12);
      doc.text('Date', dateX, lineY + 12);
      cursor += 58;
    }
    cursor += 16;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(0);
  return cursor;
}

export function drawInspectionPdfChecklist(doc: jsPDF, sections: InspectionPdfChecklistSection[]): void {
  const margin = 52;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const bottom = doc.internal.pageSize.getHeight() - margin;
  let cursor = margin;
  let currentSection = '';

  const startPage = (continued: boolean) => {
    doc.addPage();
    cursor = margin;
    doc.setTextColor(25);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(continued ? 'Condition Checklist (continued)' : 'Condition Checklist', margin, cursor);
    cursor += 20;
    doc.setDrawColor(130);
    doc.setLineWidth(0.6);
    doc.line(margin, cursor, margin + width, cursor);
    cursor += 22;
    if (continued && currentSection) drawSectionTitle(`${currentSection} (continued)`);
  };

  function drawSectionTitle(title: string) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(25);
    doc.text(title, margin, cursor + 10);
    cursor += 22;
  }

  startPage(false);
  for (const section of sections) {
    currentSection = section.title;
    if (cursor + 56 > bottom) startPage(false);
    drawSectionTitle(section.title);

    for (const item of section.items) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const lines: string[] = doc.splitTextToSize(item.trim() || 'Condition notes', width);
      let lineOffset = 0;

      while (lineOffset < lines.length) {
        if (cursor + 34 > bottom) startPage(true);
        const availableLines = Math.max(1, Math.floor((bottom - cursor - 20) / 12));
        const textLines = lines.slice(lineOffset, lineOffset + availableLines);
        const rowHeight = Math.max(34, textLines.length * 12 + 20);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(25);
        doc.text(textLines, margin, cursor + 10);
        const lineY = cursor + rowHeight - 6;
        doc.setDrawColor(170);
        doc.setLineWidth(0.45);
        doc.line(margin, lineY, margin + width, lineY);
        cursor += rowHeight;
        lineOffset += textLines.length;
      }
    }
    cursor += 10;
  }

  doc.setTextColor(0);
}