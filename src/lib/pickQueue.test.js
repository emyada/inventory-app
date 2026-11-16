import test from 'node:test';
import assert from 'node:assert/strict';
import {groupByRequester, groupRequirements, modelCounts} from './pickQueue.js';

const row = (id, who, category, model, lines = [], extra = {}) => ({id, order_ref: 'Z' + id, staff_name: who, category, model_name: model, workflow_state: 'pending',
  confirmation_contract: 'admin-whole-order-v1', bom_snapshot: lines, ...extra});
const line = (line_id, material_id, qty, unit = 'pcs', picked = false) => ({line_id, material_id, material_name: 'M' + material_id, qty: String(qty), unit, picked});

test('groups by requester (case-insensitive) with per-model counts, repairs labelled, closed/non-pickable skipped', () => {
  const rows = [row('1', 'Golf', 'CIEM', 'OCL-Driver'), row('2', 'golf ', 'CIEM', 'OCL-Driver'), row('3', 'Golf', 'CIEM', 'MRA-Driver'),
    row('4', 'Golf', 'Sleepplug', 'Sleepplug Pro'), row('5', 'Te', 'ซ่อมและอื่นๆ', 'CIEM'),
    row('6', 'Te', 'CIEM', 'X', [], {workflow_state: 'completed'}), row('7', 'Te', 'CIEM', 'X', [], {can_pick: false}), row('1', 'Golf', 'CIEM', 'OCL-Driver')];
  const groups = groupByRequester(rows);
  assert.deepEqual(groups.map(g => [g.name, g.rows.length]), [['Golf', 4], ['Te', 1]]);
  assert.deepEqual(groups[0].models.map(m => [m.label, m.count]), [['OCL-Driver', 2], ['MRA-Driver', 1], ['Sleepplug Pro', 1]]);
  assert.equal(groups[1].models[0].label, 'ซ่อม/อื่นๆ · CIEM');
  assert.deepEqual(modelCounts([]), []);
});

test('group requirements sum across orders and flag shortage against combined stock', () => {
  const rows = [row('1', 'Golf', 'CIEM', 'A', [line('l1', 'm1', 2), line('l2', 'm2', 1, 'pcs', true)]), row('2', 'Golf', 'CIEM', 'A', [line('l3', 'm1', 3)])];
  const ok = groupRequirements(rows, [{id: 'm1', qty: 5, unit: 'pcs', is_active: true}]);
  assert.deepEqual(ok.map(r => [r.id, r.required, r.insufficient]), [['m1', '5', false]]);
  const short = groupRequirements(rows, [{id: 'm1', qty: 4, unit: 'pcs', is_active: true}]);
  assert.equal(short[0].insufficient, true);
  assert.equal(groupRequirements(rows, [])[0].insufficient, true);
  assert.throws(() => groupRequirements([row('9', 'x', 'CIEM', 'A', [line('a', 'm1', 1)], {confirmation_contract: undefined})], []));
});

import {splitByStock} from './pickQueue.js';
test('splitByStock keeps oldest orders that fit and lists the short ones', () => {
  const mats = [{id: 'm1', name: 'Tip', unit: 'ชิ้น', qty: '2', is_active: true}];
  const mk = (id, at) => ({id, order_ref: id, created_at: at, confirmation_contract: 'admin-whole-order-v1', bom_snapshot: [{line_id: id, material_id: 'm1', material_name: 'Tip', unit: 'ชิ้น', qty: '1', picked: false}]});
  const r = splitByStock([mk('c', '2026-01-03'), mk('a', '2026-01-01'), mk('b', '2026-01-02')], mats);
  assert.deepEqual(r.fit.map(x => x.id), ['a', 'b']);
  assert.deepEqual(r.short.map(x => x.row.id), ['c']);
  assert.deepEqual(r.short[0].lacking, ['Tip']);
});
