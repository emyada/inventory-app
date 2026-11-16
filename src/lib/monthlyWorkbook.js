// Month-end Excel workbook (same shape as the team's own file). Totals are real SUMIF/SUMIFS
// formulas over whole columns, so editing a row recalculates the totals and added rows never
// fall outside a hand-typed range. Cached values are written too, so viewers that do not
// recalculate still show correct numbers.
import {reportFilesZIP} from './reportArchive.js';
import {REPAIR_CATEGORY} from './monthlyReport.js';

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PROD = 'ดิบ-การผลิต', MAT = 'ดิบ-วัตถุดิบ';
const round = v => Math.round(v * 1e6) / 1e6;

function xml(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\r', '&#13;');
}
function letter(n) { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }
const serial = day => Date.parse(`${day}T00:00:00Z`) / 86400000 + 25569;
const q = name => `'${name.replaceAll("'", "''")}'`;
// Cell helpers. Styles: 0 text, 1 bold header, 2 number, 3 date, 4 bold text, 5 bold number.
const T = (v, s = 0) => ({t: v, s});
const H = v => ({t: v, s: 1});
const N = (v, s = 2) => ({n: v, s});
const D = day => ({d: day, s: 3});
const F = (f, v, s = 2) => ({f, v, s});

function cell(c, ref) {
  if (c == null || c === '') return `<c r="${ref}"/>`;
  if (c.d) return `<c r="${ref}" s="3"><v>${serial(c.d)}</v></c>`;
  if (c.f !== undefined) {
    return typeof c.v === 'number'
      ? `<c r="${ref}" s="${c.s}"><f>${xml(c.f)}</f><v>${c.v}</v></c>`
      : `<c r="${ref}" s="${c.s}" t="str"><f>${xml(c.f)}</f><v>${xml(c.v)}</v></c>`;
  }
  if (c.n !== undefined) return `<c r="${ref}" s="${c.s}"><v>${c.n}</v></c>`;
  return `<c r="${ref}" t="inlineStr" s="${c.s}"><is><t xml:space="preserve">${xml(c.t)}</t></is></c>`;
}
function sheetXml(sheet) {
  const cols = sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const rows = sheet.rows.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => cell(c, letter(j) + (i + 1))).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`;
}
const STYLES = '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F3F1"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

export function workbookFiles(sheets) {
  const names = sheets.map(s => s.name);
  if (new Set(names).size !== names.length || names.some(n => !n || n.length > 31 || /[\[\]:*?/\\]/.test(n))) throw new Error('ชื่อชีตไม่ถูกต้อง');
  const files = [
    {name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'},
    {name: '_rels/.rels', content: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {name: 'xl/workbook.xml', content: '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets><calcPr fullCalcOnLoad="1"/></workbook>'},
    {name: 'xl/_rels/workbook.xml.rels', content: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + '<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
    {name: 'xl/styles.xml', content: STYLES},
  ];
  sheets.forEach((s, i) => files.push({name: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml(s)}));
  return files;
}

// ---- sheet builders -------------------------------------------------------
const sumBy = (rows, pick, qty = r => r.qty) => rows.reduce((a, r) => a + (pick(r) ? qty(r) : 0), 0);

function rawProduction(report) {
  const rows = [...report.production, ...report.repairs.map(r => ({...r, qty: 1}))].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return {
    rows,
    sheet: {name: PROD, widths: [12, 8, 16, 26, 16, 16, 9], rows: [
      ['วันที่', 'เวลา', 'หมวดหมู่', 'รุ่นสินค้า', 'ออเดอร์', 'ผู้เบิก', 'จำนวน'].map(H),
      ...rows.map(r => [D(r.date), T(r.time), T(r.category), T(r.model), T(r.order), T(r.worker), N(r.qty)]),
    ]},
  };
}
function summarySheet(report, prodRows) {
  const sumF = (cat, model) => model === undefined
    ? `SUMIFS(${q(PROD)}!$G:$G,${q(PROD)}!$C:$C,A{r})`
    : `SUMIFS(${q(PROD)}!$G:$G,${q(PROD)}!$C:$C,A{r},${q(PROD)}!$D:$D,B{r})`;
  const rows = [['หมวด', 'รุ่น', 'จำนวน (คู่)'].map(H)];
  const cats = [...new Set([...report.categories.map(c => c.name), ...(report.repairs.length ? [REPAIR_CATEGORY] : [])])];
  let total = 0;
  for (const cat of cats) {
    const inCat = prodRows.filter(r => r.category === cat);
    const catTotal = sumBy(inCat, () => true);
    if (cat !== REPAIR_CATEGORY) total += catTotal;
    rows.push([T(cat, 4), T('(รวมหมวด)', 4), F(sumF(cat).replace('{r}', rows.length + 1), catTotal, 5)]);
    const models = new Map();
    for (const r of inCat) models.set(r.model, (models.get(r.model) || 0) + r.qty);
    for (const [model, n] of [...models.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      rows.push([T(cat), T(model), F(sumF(cat, model).replaceAll('{r}', rows.length + 1), n)]);
    }
  }
  rows.push([T('ผลิตทั้งหมด (ไม่รวมซ่อมและอื่นๆ)', 4), null, F('SUMIFS(C:C,B:B,"(รวมหมวด)",A:A,"<>' + REPAIR_CATEGORY + '")', total, 5)]);
  return {name: 'สรุปการผลิต', widths: [30, 30, 14], rows};
}
function rawMaterials(report) {
  const rows = report.materials;
  return {name: MAT, widths: [12, 42, 12, 8, 26, 16, 16, 16], rows: [
    ['วันที่', 'ชื่อวัตถุดิบ', 'จำนวนที่ใช้', 'หน่วย', 'รุ่นสินค้า', 'ออเดอร์', 'หมวดหมู่', 'ผู้เบิก'].map(H),
    ...rows.map(r => [D(r.date), T(r.material), N(r.qty), T(r.unit), T(r.model), T(r.order), T(r.category), T(r.worker)]),
  ]};
}
function totalsBlock(startCol, materialRows, logCols) {
  // Right-hand block: one row per material with a SUMIF over the sheet's own log columns.
  const names = new Map();
  for (const m of materialRows) { const k = `${m.material}\u0000${m.unit}`; names.set(k, {material: m.material, unit: m.unit, qty: round((names.get(k)?.qty || 0) + m.qty)}); }
  const list = [...names.values()].sort((a, b) => b.qty - a.qty || a.material.localeCompare(b.material));
  return list.map((m, i) => [
    T(m.material), T(m.unit),
    F(`SUMIF($${logCols.name}:$${logCols.name},${letter(startCol)}${i + 2},$${logCols.qty}:$${logCols.qty})`, m.qty),
  ]);
}
function logSheet(name, materialRows, {byModel = false, pairsRows = null, withReason = false} = {}) {
  const rows = [...materialRows];
  if (byModel) rows.sort((a, b) => a.model.localeCompare(b.model) || (a.date + a.time).localeCompare(b.date + b.time) || a.order.localeCompare(b.order));
  const head = ['วันที่', 'เวลา', 'ผู้เบิก', 'รุ่นสินค้า', withReason ? 'เหตุผล / อ้างอิง' : 'ออเดอร์', 'วัตถุดิบ', 'จำนวนที่ใช้', 'หน่วย'].map(H);
  const body = [];
  let lastModel = null;
  for (const r of rows) {
    if (byModel && r.model !== lastModel) { body.push([null, null, null, T(r.model, 4)]); lastModel = r.model; }
    body.push([D(r.date), T(r.time), T(r.worker), T(r.model), T(withReason ? (r.reason || r.order) : r.order), T(r.material), N(r.qty), T(r.unit)]);
  }
  const totals = totalsBlock(9, rows, {name: 'F', qty: 'G'});
  // Pairs per model (right of the totals), from the raw production sheet.
  const pairs = pairsRows ? [...new Map(pairsRows.map(p => [p.model, 0])).keys()].map(m => [m, sumBy(pairsRows, p => p.model === m)]).sort((a, b) => b[1] - a[1]) : [];
  const total = Math.max(body.length, totals.length, pairs.length);
  const out = [[...head, null, H('วัตถุดิบ'), H('หน่วย'), H('ยอดรวม'), null, ...(pairsRows ? [H('รุ่น'), H('จำนวน (คู่)')] : [])]];
  for (let i = 0; i < total; i++) {
    const left = body[i] || Array(8).fill(null);
    const mid = totals[i] ? [null, ...totals[i]] : [null, null, null, null];
    const right = pairsRows && pairs[i]
      ? [null, T(pairs[i][0]), F(`SUMIFS(${q(PROD)}!$G:$G,${q(PROD)}!$C:$C,"${name.replaceAll('"', '""')}",${q(PROD)}!$D:$D,N${i + 2})`, pairs[i][1])]
      : [];
    out.push([...left, ...mid, ...right]);
  }
  return {name, widths: [12, 8, 16, 24, 18, 40, 12, 8, 3, 40, 8, 12, 3, 26, 14], rows: out};
}
function unfinishedSheet(report) {
  const rows = [['วันที่ยื่น', 'วันที่ปิด', 'หมวดหมู่', 'รุ่นสินค้า', 'ออเดอร์', 'ผู้เบิก', 'วัตถุดิบ', 'ตาม BOM', 'คืนเข้าสต็อก', 'ใช้ไป/ไม่คืน', 'หน่วย', 'ทำต่อแล้ว'].map(H)];
  const loss = [];
  for (const j of report.unfinished) {
    const cont = j.continued ? `${j.continued.date} (${j.continued.order})` : 'ยัง';
    const lines = j.lines.length ? j.lines : [{material: '-', unit: '', planned: 0, returned: 0, consumed: 0}];
    for (const l of lines) rows.push([D(j.date), j.closed ? D(j.closed) : null, T(j.category), T(j.model), T(j.order), T(j.worker), T(l.material), N(l.planned), N(l.returned), N(l.consumed), T(l.unit), T(cont)]);
  }
  const mats = report.unfinishedLoss;
  const out = rows.map((r, i) => [...r, null, ...(i === 0 ? [H('สูญเสียจากงานไม่เสร็จ'), H('หน่วย'), H('ใช้ไป/ไม่คืนรวม')] : mats[i - 1] ? [T(mats[i - 1].material), T(mats[i - 1].unit), F(`SUMIF($G:$G,N${i + 1},$J:$J)`, mats[i - 1].qty)] : [])]);
  for (let i = rows.length; i <= mats.length; i++) out.push([...Array(12).fill(null), null, T(mats[i - 1].material), T(mats[i - 1].unit), F(`SUMIF($G:$G,N${i + 1},$J:$J)`, mats[i - 1].qty)]);
  return {name: 'ไม่เสร็จ-ยกไปเดือนหน้า', widths: [12, 12, 14, 22, 14, 14, 36, 10, 14, 14, 8, 20, 3, 36, 8, 16], rows: out};
}
function stockSheet(stock, report) {
  const used = new Map();
  for (const m of report.materials) used.set(m.material, round((used.get(m.material) || 0) + m.qty));
  const rows = [['วัตถุดิบ', 'หน่วย', 'ยอดในระบบ', 'ยอดนับจริง', 'ส่วนต่าง', 'ใช้ตาม BOM เดือนนี้'].map(H)];
  stock.forEach((m, i) => rows.push([
    T(m.name), T(m.unit), N(Number(m.qty)), null,
    F(`IF(D${i + 2}="","",D${i + 2}-C${i + 2})`, ''),
    F(`SUMIF(${q(MAT)}!$B:$B,A${i + 2},${q(MAT)}!$C:$C)`, used.get(m.name) || 0),
  ]));
  return {name: 'ลำดับนับสต็อก', widths: [44, 8, 14, 14, 12, 20], rows};
}
function storeSheet(items) {
  const rows = [['รายการ', 'ประเภท', 'หน่วย', 'ต้นงวด', 'รับจากคลังหลัก', 'ขาย', 'ยกเลิกขาย', 'ปรับเพิ่ม', 'ปรับลด', 'คงเหลือ'].map(H)];
  items.forEach((r, i) => {
    const n = k => Number(r[k] ?? 0), row = i + 2;
    rows.push([T(r.name), T(r.item_kind === 'model' ? 'ชุดสำเร็จรูป' : 'อะไหล่'), T(r.unit), N(n('opening')), N(n('transfer_in')), N(n('sold')), N(n('sale_cancelled')), N(n('adjust_in')), N(n('adjust_out')),
      F(`D${row}+E${row}-F${row}+G${row}+H${row}-I${row}`, round(n('opening') + n('transfer_in') - n('sold') + n('sale_cancelled') + n('adjust_in') - n('adjust_out')))]);
  });
  return {name: 'หน้าร้าน', widths: [36, 14, 8, 10, 16, 10, 12, 10, 10, 12], rows};
}
function mainSalesSheet(items) {
  const rows = [['วัตถุดิบ', 'หน่วย', 'ขายจากคลังหน้าร้าน (อื่นๆ)'].map(H)];
  items.forEach(r => rows.push([T(r.name), T(r.unit), N(Number(r.qty))]));
  return {name: 'ขายจากคลังหลัก', widths: [44, 8, 26], rows};
}
const sheetNameFor = cat => cat.replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31);

export function buildMonthlyWorkbook(report, {stock = [], storeItems = null, mainSales = null} = {}) {
  const prod = rawProduction(report);
  const sheets = [summarySheet(report, prod.rows)];
  const allMaterials = new Map();
  for (const m of report.materials) { const k = `${m.material}\u0000${m.unit}`; allMaterials.set(k, {material: m.material, unit: m.unit, qty: round((allMaterials.get(k)?.qty || 0) + m.qty)}); }
  sheets.push({name: 'วัตถุดิบรวม', widths: [44, 8, 14], rows: [
    ['วัตถุดิบ', 'หน่วย', 'ยอดใช้ตาม BOM'].map(H),
    ...[...allMaterials.values()].sort((a, b) => a.material.localeCompare(b.material)).map((m, i) => [T(m.material), T(m.unit),
      F(`SUMIF(${q(MAT)}!$B:$B,A${i + 2},${q(MAT)}!$C:$C)`, m.qty)]),
  ]});
  for (const cat of report.categories) {
    sheets.push(logSheet(sheetNameFor(cat.name), report.materials.filter(m => m.category === cat.name), {byModel: cat.name === 'Sleepplug', pairsRows: prod.rows.filter(p => p.category === cat.name)}));
  }
  if (report.repairs.length || report.materials.some(m => m.category === REPAIR_CATEGORY)) {
    sheets.push(logSheet('ซ่อมและอื่นๆ', report.materials.filter(m => m.category === REPAIR_CATEGORY), {withReason: true}));
  }
  if (report.unfinished.length) sheets.push(unfinishedSheet(report));
  sheets.push(prod.sheet, rawMaterials(report));
  if (stock.length) sheets.push(stockSheet(stock, report));
  if (storeItems?.length) sheets.push(storeSheet(storeItems));
  if (mainSales?.length) sheets.push(mainSalesSheet(mainSales));
  return {
    filename: `stock_report_${report.from.slice(0, 7)}.xlsx`, type: XLSX_TYPE,
    sheetNames: sheets.map(s => s.name), body: reportFilesZIP(workbookFiles(sheets)),
  };
}
