import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMonthlyReport, monthRange, shiftMonth, monthLabel, lowMaterials} from './monthlyReport.js';
import {buildMonthlyWorkbook, workbookFiles} from './monthlyWorkbook.js';

const line = (material_name, qty, unit = 'pcs') => ({material_name, qty: String(qty), unit, line_id: material_name});
const req = (id, category, model_name, order_ref, staff_name, created_at, lines, extra = {}) =>
  ({id, category, model_name, order_ref, staff_name, created_at, workflow_state: 'completed', bom_snapshot: lines, note: '', ...extra});
const rows = [
  req('1', 'CIEM', 'OCL-Driver', 'N868', 'Te', '2026-09-07T01:00:00Z', [line('G217_1000 g', 20, 'g')]),
  req('2', 'CIEM', 'OCL-Driver', 'N869', 'Te', '2026-09-30T16:59:00Z', [line('G217_1000 g', 20, 'g')]),   // 23:59 Bangkok on the 30th: inside
  req('3', 'CIEM', 'OCL-Driver', 'N870', 'Te', '2026-09-30T17:01:00Z', [line('G217_1000 g', 20, 'g')]),   // 00:01 Oct 1 Bangkok: outside
  req('4', 'Sleepplug', 'Sleepplug', 'Z1', 'Mo', '2026-09-09T05:00:00Z', [line('Pink Silicone', 4, 'ml')], {workflow_state: 'cancelled'}),
  req('5', 'Sleepplug', 'Sleepplug', 'Z2', 'Mo', '2026-09-09T05:00:00Z', [line('Pink Silicone', 4, 'ml')], {workflow_state: 'production_not_completed'}),
  req('6', 'Sleepplug', 'Sleepplug', 'Z3', 'Mo', '2026-09-10T05:00:00Z', [line('Pink Silicone', 4, 'ml')], {workflow_state: 'pending'}),
  req('7', 'ซ่อมและอื่นๆ', 'อื่นๆ', '', 'mie', '2026-09-11T03:00:00Z', [line('IEM Cleaning Tool_pcs', 1)], {note: 'ลูกค้า walk in'}),
];

test('month helpers', () => {
  assert.deepEqual(monthRange(2026, 2), {from: '2026-02-01', to: '2026-02-28'});
  assert.deepEqual(shiftMonth({year: 2026, month: 1}, -1), {year: 2025, month: 12});
  assert.deepEqual(shiftMonth({year: 2026, month: 12}, 1), {year: 2027, month: 1});
  assert.equal(monthLabel({year: 2026, month: 9}), 'กันยายน 2026');
});

test('counts one pair per request; Bangkok month edges; cancelled and not-completed excluded; repairs separate', () => {
  const r = buildMonthlyReport(rows, '2026-09-01', '2026-09-30');
  assert.equal(r.totalPairs, 3);           // requests 1, 2, 6
  assert.equal(r.repairCount, 1);
  const ciem = r.categories.find(c => c.name === 'CIEM');
  assert.equal(ciem.pairs, 2);
  assert.deepEqual(ciem.materials, [{material: 'G217_1000 g', unit: 'g', qty: 40}]);
  assert.equal(r.categories.find(c => c.name === 'Sleepplug').pairs, 1);
  assert.equal(r.production[0].worker, 'Te');
  assert.equal(r.repairs[0].reason, 'ลูกค้า walk in');
});

test('workbook has every sheet, whole-column SUMIF formulas and cached values', () => {
  const r = buildMonthlyReport(rows, '2026-09-01', '2026-09-30');
  const out = buildMonthlyWorkbook(r, {stock: [{name: 'G217_1000 g', unit: 'g', qty: '500'}], storeItems: [{name: 'Music', item_kind: 'model', unit: 'ชุด', opening: '0', transfer_in: '20', sold: '3'}]});
  assert.deepEqual(out.sheetNames, ['สรุปการผลิต', 'วัตถุดิบรวม', 'CIEM', 'Tactical', 'Lifestyle', 'Sleepplug', 'ซ่อมและอื่นๆ', 'ไม่เสร็จ-ยกไปเดือนหน้า', 'ดิบ-การผลิต', 'ดิบ-วัตถุดิบ', 'ลำดับนับสต็อก', 'หน้าร้าน']);
  assert.equal(out.filename, 'stock_report_2026-09.xlsx');
  const sheets = workbookFiles([{name: 'A', widths: [8], rows: [[{f: "SUMIF($B:$B,A2,$C:$C)", v: 5, s: 2}, {t: '=1+1', s: 0}]]}]);
  const xml = sheets.find(f => f.name === 'xl/worksheets/sheet1.xml').content;
  assert.match(xml, /<f>SUMIF\(\$B:\$B,A2,\$C:\$C\)<\/f><v>5<\/v>/);
  assert.match(xml, /t="inlineStr"[^>]*><is><t[^>]*>=1\+1</);   // text that looks like a formula stays text
  assert.throws(() => workbookFiles([{name: 'bad:name', widths: [], rows: []}]), /ชื่อชีต/);
});

test('low materials use the combined (main + store) total', () => {
  assert.deepEqual(lowMaterials({materials: [{name: 'A', unit: 'g', total_qty: '5', low_stock_threshold: '10'}, {name: 'B', unit: 'g', total_qty: '50', low_stock_threshold: '10'}]}),
    [{name: 'A', unit: 'g', total: 5, threshold: 10}]);
});

import {unfinishedJobs, continuationOrder} from './unfinished.js';
test('unfinished jobs: derived continuation, loss, kept out of production and material usage', () => {
  const closed = {id: 'u1', category: 'CIEM', model_id: 'm1', model_name: 'OCL-Driver', order_ref: 'Z12261', staff_name: 'Golf', created_at: '2026-11-29T10:00:00Z',
    cancelled_at: '2026-11-30T09:00:00Z', closure_kind: 'production_not_completed', workflow_state: 'production_not_completed',
    bom_snapshot: [line('l1', 2), {material_name: 'G217', qty: '24', unit: 'g', line_id: 'l2'}],
    return_summary: [{line_id: 'l1', returned_qty: '2', consumed_qty: '0'}, {line_id: 'l2', returned_qty: '0', consumed_qty: '24'}]};
  const again = {id: 'n1', category: 'CIEM', model_id: 'm1', model_name: 'OCL-Driver', order_ref: 'ZG12261', staff_name: 'Golf', created_at: '2026-12-02T03:00:00Z', workflow_state: 'pending', bom_snapshot: [line('l1', 2)]};
  const waiting = {id: 'w1', category: 'CIEM', model_id: 'm1', model_name: 'OCL-Driver', order_ref: 'Z999', staff_name: 'Te', created_at: '2026-11-30T03:00:00Z', workflow_state: 'pending', bom_snapshot: []};
  const nov = buildMonthlyReport([closed, again, waiting], '2026-11-01', '2026-11-30');
  assert.equal(nov.totalPairs, 1); // only the waiting one; the unfinished job is not production
  assert.equal(nov.materials.length, 0);
  assert.equal(nov.unfinished.length, 1);
  assert.equal(nov.unfinished[0].continued.date, '2026-12-02');
  assert.deepEqual(nov.unfinishedLoss, [{material: 'G217', unit: 'g', qty: 24}]);
  assert.equal(nov.waitingPick, 1);
  assert.equal(unfinishedJobs([closed])[0].continued, null);
  assert.equal(continuationOrder('Z12261'), '12261'); assert.equal(continuationOrder('UV-abc'), 'UV-abc');
  const wb = buildMonthlyWorkbook(nov);
  assert.ok(wb.sheetNames.includes('ไม่เสร็จ-ยกไปเดือนหน้า'));
  const dec = buildMonthlyReport([closed, again, waiting], '2026-12-01', '2026-12-31');
  assert.equal(dec.unfinished.length, 0); assert.equal(dec.totalPairs, 1);
});

test('workbook adds a per-line store sales sheet (seller, time, source) when sales exist', () => {
  const r = buildMonthlyReport(rows, '2026-09-01', '2026-09-30');
  const sales = [{sale_id: 's1', created_at: '2026-09-10T03:00:00Z', seller_name: 'Mint', tag: 'SH1001', status: 'active', pending: false, lines: [{name: 'Music universal', item_kind: 'model', qty: 1, unit: 'ชุด', source: 'store'}, {name: 'Filter box', item_kind: 'material', qty: 2, unit: 'pcs', source: 'main'}]},
    {sale_id: 's2', created_at: '2026-09-11T03:00:00Z', seller_name: 'Mint', tag: null, status: 'cancelled', pending: true, lines: [{name: 'Filter box', item_kind: 'material', qty: 5, unit: 'pcs', source: 'main'}]}];
  assert.ok(buildMonthlyWorkbook(r, {storeSales: sales}).sheetNames.includes('รายการขายหน้าร้าน'));
  assert.ok(!buildMonthlyWorkbook(r, {storeSales: []}).sheetNames.includes('รายการขายหน้าร้าน'));
});
