// CSV exports of the month-end report (opens in Excel/Google Sheets; UTF-8 with BOM so Thai displays correctly).
const cell = v => {
  let s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection from user-typed text (order refs, names, notes).
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header, rows) => '﻿' + [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
const file = (name, report, body) => ({filename: `${name}_${report.from.slice(0, 7)}.csv`, type: 'text/csv;charset=utf-8', body});

export const productionCsv = report => file('production', report, toCsv(
  ['วันที่', 'เวลา', 'หมวดหมู่', 'รุ่นสินค้า', 'ออเดอร์', 'ผู้เบิก', 'จำนวน'],
  report.production.map(p => [p.date, p.time, p.category, p.model, p.order, p.worker, p.qty])));

export const materialsCsv = report => file('materials', report, toCsv(
  ['วันที่', 'ชื่อวัตถุดิบ', 'จำนวนที่ใช้', 'หน่วย', 'รุ่น', 'ออเดอร์', 'หมวด', 'ผู้เบิก'],
  report.materials.map(m => [m.date, m.material, m.qty, m.unit, m.model, m.order, m.category, m.worker])));

export const repairsCsv = report => file('repairs', report, toCsv(
  ['วันที่', 'เวลา', 'ประเภท', 'ออเดอร์', 'ผู้เบิก', 'เหตุผล'],
  report.repairs.map(r => [r.date, r.time, r.model, r.order, r.worker, r.reason])));
