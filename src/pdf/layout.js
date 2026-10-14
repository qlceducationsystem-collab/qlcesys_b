import PDFDocument from 'pdfkit';

export const C = { navy: '#0B1426', blue: '#2F6FED', gold: '#C9A54C', silver: '#8A94A6', text: '#1D2433', light: '#EEF1F6', green: '#1E8E5A', red: '#C0392B' };

export const money = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n));
export const pct = (n) => (n === null || n === undefined ? 'N/D' : `${Number(n).toFixed(2)}%`);
export const date = (d) => new Date(d).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

export function createDoc(res, filename, title, subtitle) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 48, bufferPages: true, info: { Title: title, Author: 'QLC Financial Education' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  doc.rect(0, 0, doc.page.width, 90).fill(C.navy);
  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(10).text('QLC FINANCIAL EDUCATION', 48, 28, { characterSpacing: 2 });
  doc.fillColor('#FFFFFF').fontSize(18).text(title, 48, 44);
  doc.fillColor(C.silver).font('Helvetica').fontSize(9).text(subtitle, 48, 68);
  doc.y = 110;
  doc.fillColor(C.text);
  return doc;
}

export function section(doc, title) {
  ensureSpace(doc, 60);
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.navy).text(title, 48);
  const y = doc.y + 2;
  doc.moveTo(48, y).lineTo(doc.page.width - 48, y).lineWidth(1).strokeColor(C.gold).stroke();
  doc.moveDown(0.5).font('Helvetica').fontSize(9).fillColor(C.text);
}

export function ensureSpace(doc, h) {
  if (doc.y + h > doc.page.height - 60) doc.addPage();
}

export function kpis(doc, items, cols = 3) {
  const w = (doc.page.width - 96) / cols;
  const h = 44;
  for (let i = 0; i < items.length; i += cols) {
    ensureSpace(doc, h + 6);
    const y = doc.y;
    items.slice(i, i + cols).forEach(([label, value], j) => {
      const x = 48 + j * w;
      doc.rect(x + 2, y, w - 4, h).fill(C.light);
      doc.fillColor(C.silver).font('Helvetica').fontSize(7.5).text(label.toUpperCase(), x + 10, y + 8, { width: w - 20 });
      doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(11).text(value, x + 10, y + 22, { width: w - 20 });
    });
    doc.y = y + h + 6;
  }
  doc.fillColor(C.text).font('Helvetica').fontSize(9);
}

export function table(doc, columns, rows) {
  const totalW = doc.page.width - 96;
  const widths = columns.map((c) => (c.width || 1 / columns.length) * totalW);
  const drawRow = (cells, header = false) => {
    ensureSpace(doc, 20);
    const y = doc.y;
    if (header) doc.rect(48, y - 2, totalW, 16).fill(C.navy);
    let x = 48;
    cells.forEach((cell, i) => {
      doc.fillColor(header ? '#FFFFFF' : C.text).font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
        .text(String(cell ?? ''), x + 4, y + 2, { width: widths[i] - 8, align: columns[i].align || 'left', lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.y = y + 16;
    if (!header) doc.moveTo(48, doc.y - 1).lineTo(48 + totalW, doc.y - 1).lineWidth(0.4).strokeColor('#D5DAE3').stroke();
  };
  drawRow(columns.map((c) => c.label), true);
  if (!rows.length) drawRow(['Sin registros']);
  rows.forEach((r) => drawRow(r));
  doc.moveDown(0.4);
}

export function statusBanner(doc, ok, okText, badText, detail) {
  ensureSpace(doc, 34);
  const y = doc.y;
  doc.rect(48, y, doc.page.width - 96, 26).fill(ok ? C.green : C.red);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10).text(ok ? okText : badText, 58, y + 8, { continued: !!detail });
  if (detail) doc.font('Helvetica').text(`   ${detail}`);
  doc.y = y + 34;
  doc.fillColor(C.text).font('Helvetica').fontSize(9);
}

export function finish(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(C.silver).fontSize(7).text(
      `Documento informativo y educativo generado con los datos registrados por el usuario. No constituye asesoría financiera ni garantiza rendimientos.   Página ${i + 1} de ${range.count}`,
      48, doc.page.height - 40, { width: doc.page.width - 96, align: 'center' },
    );
    doc.page.margins.bottom = bottom;
  }
  doc.end();
}
