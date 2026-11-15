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
  assert.deepEqual(out.sheetNames, ['สรุปการผลิต', 'วัตถุดิบรวม', 'CIEM', 'Tactical', 'Lifestyle', 'Sleepplug', 'ซ่อมและอื่นๆ', 'ดิบ-การผลิต', 'ดิบ-วัตถุดิบ', 'ลำดับนับสต็อก', 'หน้าร้าน']);
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

import {materialsCsv, productionCsv} from './monthlyCsv.js';
test('csv export: BOM, quoting and formula-injection guard', () => {
  const report = {from: '2026-11-01', to: '2026-11-30',
    production: [{date: '2026-11-02', time: '09:00', category: 'CIEM', model: 'A,B', order: '=1+1', worker: 'Te "x"', qty: 1}],
    materials: [{date: '2026-11-02', material: 'Resin', qty: 2.5, unit: 'g', model: 'A', order: 'Z1', category: 'CIEM', worker: 'Te'}], repairs: []};
  const p = productionCsv(report);
  assert.equal(p.filename, 'production_2026-11.csv');
  assert.ok(p.body.startsWith('﻿วันที่'));
  assert.ok(p.body.includes('"A,B"') && p.body.includes("'=1+1") && p.body.includes('"Te ""x"""'));
  assert.ok(materialsCsv(report).body.includes('Resin,2.5,g'));
});
