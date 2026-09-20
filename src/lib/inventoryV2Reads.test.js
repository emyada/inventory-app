import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inventoryV2Enabled, v2Tabs, manualPendingLines, createInventoryReader } from './inventoryV2Reads.js';
import { createOperationStore } from './inventoryOperation.js';

test('flag defaults false; legacy Workspace code remains unchanged apart from line endings', () => {
  for (const value of [undefined, '', 'false', 'TRUE', '1', false]) assert.equal(inventoryV2Enabled(value), false);
  assert.equal(inventoryV2Enabled('true'), true);
  const baseline = JSON.parse(readFileSync('docs/inventory-migration-drafts/REACT_B1_BASELINE.json', 'utf8'))['src/App.jsx'];
  const current = readFileSync('src/App.jsx', 'utf8').replaceAll('\r\n', '\n');
  assert.equal(current.slice(current.indexOf('function Workspace(')), baseline.slice(baseline.indexOf('function Workspace(')));
  assert.ok(current.includes('return <Workspace profile={profile} role={role} signOut={signOut} userId={session.user.id} />;'));
  assert.ok(current.includes('if (inventoryV2Enabled(import.meta.env.VITE_INVENTORY_V2_ENABLED))'));
});
test('role routes and queue exclude automatic/picked lines; received irrelevant', () => {
  assert.deepEqual(v2Tabs('staff'), ['requests']);
  assert.deepEqual(v2Tabs('purchasing'), ['materials','report','movements']);
  assert.deepEqual(v2Tabs('unknown'), []);
  assert.equal(v2Tabs('admin').length, 5);
  const manual = { line_id: 'a', picked: false, received: true };
  assert.deepEqual(manualPendingLines({ lines: [manual, { requires_picking: false }, { picked: true }] }), [manual]);
});
test('request pagination preserves snapshot metadata/status and uses cursor UUID/date', async () => {
  const row = { id: '1', created_at: '2026-01-01', model_name: 'Old name', category: 'CIEM', order_ref: 'same', note: 'note', workflow_state: 'completed', received: false };
  const calls = []; const reader = createInventoryReader({ list_my_requests: async args => {
    calls.push(args); return calls.length === 1 ? [row] : [{ ...row, id: '2' }];
  } }, 'requests', {}, 1);
  const a = reader.load(); assert.equal(reader.getSnapshot().loading, true); assert.equal(reader.load(), a);
  await a; await reader.load(true);
  assert.deepEqual(calls[1], { after_at: row.created_at, after_id: '1', limit: 1 });
  assert.equal(reader.getSnapshot().rows[0].workflow_state, 'completed');
  assert.equal(reader.getSnapshot().rows.length, 2);
});
test('movement pagination retains first cutoff; empty and error states recover', async () => {
  const calls = []; let fail = true;
  const reader = createInventoryReader({ list_movements: async args => {
    calls.push(args); if (fail) throw new Error('RPC denied');
    return { cutoff_sequence: 9, rows: args.after_sequence ? [] : [{ id: 'm', sequence_no: 4 }] };
  } }, 'movements', {}, 1);
  await reader.load(); assert.match(reader.getSnapshot().error.message, /RPC denied/); assert.equal(reader.getSnapshot().loading, false);
  fail = false; await reader.load(); await reader.load(true);
  assert.deepEqual(calls.at(-1), { after_sequence: 4, cutoff_sequence: 9, limit: 1 });
  assert.equal(reader.getSnapshot().hasMore, false); assert.equal(reader.getSnapshot().error, null);
});
test('all five read RPCs wired without mutation access; report totals never recomputed', async () => {
  const report = { id: 'mat', opening: null, closing: null, coverage: 'before_coverage', issue: 13, production_issue: 10, repair_issue: 3 };
  const api = { list_materials: async () => [{ id: 'mat', qty: 0 }], list_my_requests: async () => [],
    list_pick_queue: async () => [], balance_report: async args => { assert.equal(args.timezone, 'Asia/Bangkok'); return { materials: [report] }; },
    list_movements: async () => ({ cutoff_sequence: 0, rows: [] }) };
  for (const tab of v2Tabs('admin')) {
    const reader = createInventoryReader(api, tab, { timezone: 'Asia/Bangkok' }); await reader.load();
    assert.equal(reader.getSnapshot().error, null);
    if (tab === 'report') assert.deepEqual(reader.getSnapshot().rows, [report]);
    if (tab === 'materials') assert.equal(reader.getSnapshot().rows[0].qty, 0);
    if (tab === 'queue') assert.deepEqual(reader.getSnapshot().rows, []);
  }
  const ui = readFileSync('src/views/InventoryV2.jsx','utf8');
  assert.ok(!ui.includes('received')); assert.ok(!/\.(execute|retry|from|insert|update|delete)\(/.test(ui));
});
test('pending banner summary reads persistent stale operations without clearing or minting IDs', async () => {
  const data = new Map(); const storage = { get length() { return data.size; }, key: i => [...data.keys()][i],
    getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: () => assert.fail('must not remove') };
  const store = createOperationStore({ storage, now: () => 0 });
  await store.acquire('old', { qty: 1 }, () => 'retained');
  const reload = createOperationStore({ storage, now: () => 9 * 24 * 60 * 60 * 1000 });
  assert.deepEqual(reload.getPendingSummary(), { pending: 1, stale: 1, corrupt: 0, error: null });
  assert.equal(data.size, 1);
});