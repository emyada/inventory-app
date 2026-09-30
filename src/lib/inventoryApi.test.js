import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryApi as apiFactory, mutationParameters, readParameters } from './inventoryApi.js';
import { createInventoryOperation } from './inventoryOperation.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('duplicate clicks share a promise and one UUID, including clicks after success', async () => {
  const gate = deferred(); let calls = 0; let ids = 0;
  const op = createInventoryOperation(() => { calls++; return gate.promise; }, {}, () => `id-${++ids}`);
  const states = []; op.subscribe(() => states.push(op.getSnapshot().status));
  const first = op.execute(); const second = op.execute();
  assert.equal(first, second); assert.equal(op.getSnapshot().loading, true);
  gate.resolve({ ok: true }); await first; await op.execute();
  assert.equal(calls, 1); assert.equal(ids, 1);
  assert.deepEqual(states, ['submitting', 'submitting', 'succeeded']);
});
test('lost response retries same UUID and original nested payload', async () => {
  const calls = []; let attempt = 0; const input = { items: [{ line_id: 'line', transaction_id: 'tx' }] };
  const api = createInventoryApi({ rpc: async (name, args) => {
    calls.push(structuredClone({ name, args }));
    if (++attempt === 1) throw new TypeError('Network response lost');
    return { data: { committed: true }, error: null, status: 200 };
  } }, { uuid: () => 'stable-id' });
  const op = api.confirm_pick(input); input.items[0].line_id = 'changed';
  await assert.rejects(op.execute(), /Network response lost/);
  assert.equal(op.getSnapshot().status, 'unknown'); assert.equal(op.getSnapshot().loading, false);
  await op.retry(); assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[1].args.p_operation_id, 'stable-id');
  assert.equal(calls[1].args.p_items[0].line_id, 'line');
});
test('definitive RPC failure is terminal; retry does not resend or allocate UUID', async () => {
  let ids = 0; let calls = 0;
  const api = createInventoryApi({ rpc: async () => { calls++; return {
    data: null, status: 400, error: { code: 'P0001', message: 'Inventory cutover not active' },
  }; } }, { uuid: () => `id-${++ids}` });
  const op = api.set_model_active({ model_id: 'model', is_active: false, reason: 'test' });
  await assert.rejects(op.execute(), /cutover not active/);
  assert.equal(op.getSnapshot().status, 'failed'); assert.equal(op.getSnapshot().error.code, 'P0001');
  await assert.rejects(op.retry()); assert.equal(ids, 1); assert.equal(calls, 1);
});
test('all 20 RPCs use named parameters and only mutations have operation IDs', async () => {
  const calls = [];
  const api = createInventoryApi({ rpc: async (name, args) => { calls.push({ name, args }); return { data: [], error: null }; } }, { uuid: () => 'op' });
  for (const [name, params] of Object.entries(mutationParameters)) {
    const input = Object.fromEntries(params.split(' ').map(p => [p, null]));
    const op = api[name](input); await op.execute();
    assert.deepEqual(calls.at(-1), { name: `inventory_${name}`, args: { ...Object.fromEntries(params.split(' ').map(p => [`p_${p}`, null])), p_operation_id: 'op' } });
  }
  for (const name of Object.keys(readParameters)) await api[name]();
  assert.equal(calls.length, 20); assert.ok(calls.slice(12).every(c => !('p_operation_id' in c.args)));
});
test('rejects client quantity/status/operation overrides before network access', () => {
  const api = createInventoryApi({ rpc: () => assert.fail('unexpected network') });
  assert.throws(() => api.update_material({ qty: 99 }), /Unsupported/);
  assert.throws(() => api.create_request({ operation_id: 'override' }), /Unsupported/);
  assert.throws(() => api.create_request({ picked: true }), /Unsupported/);
});
test('different completed intents allocate distinct UUIDs when executed', async () => {
  let n = 0; const api = createInventoryApi({ rpc: async () => ({ data: true, error: null }) }, { uuid: () => `op-${++n}` });
  const a = api.create_request({}); await a.execute();
  const b = api.create_request({}); await b.execute(); assert.notEqual(a.id, b.id);
});

import { createOperationStore } from './inventoryOperation.js';
function storageMock() {
  const data = new Map();
  return { get length() { return data.size; }, key: i => [...data.keys()][i],
    getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k), data };
}
test('reload after response loss reuses UUID; changed payload gets new UUID; success removes pending', async () => {
  const storage = storageMock(); let n = 0;
  const options = () => ({ store: createOperationStore({ storage }), intentKey: 'purchase:test-intent' });
  const uuid = () => `uuid-${++n}`;
  const a = createInventoryOperation(async () => { throw new Error('lost response'); }, { qty: 2 }, uuid, options());
  await assert.rejects(a.execute()); const firstId = a.id;
  const row = JSON.parse([...storage.data.values()][0]);
  assert.deepEqual(Object.keys(row).sort(), ['operation_id','intent_key','payload_fingerprint','created_at','status'].sort());
  assert.equal(row.status, 'pending');
  const b = createInventoryOperation(async id => id, { qty: 2 }, uuid, options());
  assert.equal(await b.execute(), firstId); assert.equal(n, 1); assert.equal(storage.length, 0);
  const c = createInventoryOperation(async () => { throw new Error('lost'); }, { qty: 2 }, uuid, options());
  await assert.rejects(c.execute());
  const d = createInventoryOperation(async id => id, { qty: 3 }, uuid, options());
  assert.notEqual(await d.execute(), c.id);
});
test('pending older than seven days survives cleanup and retries original committed result', async () => {
  const storage = storageMock(); let time = 0; let n = 0;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const committed = new Map();
  const options = () => ({ store: createOperationStore({ storage, now: () => time }), intentKey: 'stale' });
  const first = createInventoryOperation(async id => {
    committed.set(id, { result: 'original' }); throw new Error('response lost');
  }, { qty: 2 }, () => `stale-${++n}`, options());
  await assert.rejects(first.execute()); time = sevenDays + 1;
  const restored = options(); restored.store.cleanup(); assert.equal(storage.length, 1);
  const second = createInventoryOperation(async id => committed.get(id), { qty: 2 }, () => `stale-${++n}`, restored);
  const reviews = []; second.subscribe(() => reviews.push(second.getSnapshot().needsReview));
  assert.deepEqual(await second.retry(), { result: 'original' });
  assert.equal(second.id, first.id); assert.equal(n, 1); assert.ok(reviews.includes(true));
  assert.equal(storage.length, 0); assert.equal(second.getSnapshot().needsReview, false);
});
test('cleanup preserves unresolved pending despite repeated expiration and clock rollback', async () => {
  const storage = storageMock(); let time = 100;
  const store = createOperationStore({ storage, now: () => time, ttl: 10 });
  const record = await store.acquire('keep', { qty: 1 }, () => 'keep-id');
  for (time of [200, 500, 0]) { store.cleanup(); assert.equal(storage.length, 1); }
  assert.equal((await store.acquire('keep', { qty: 1 }, () => assert.fail('new UUID'))).id, record.id);
  assert.notEqual((await store.acquire('keep', { qty: 2 }, () => 'new-payload')).id, record.id);
});
test('corrupt unrelated storage is preserved with warning without crashing', async () => {
  const storage = storageMock(); storage.setItem('inventory.pending.v1:corrupt', '{invalid');
  const op = createInventoryOperation(async () => true, {}, () => 'ok', { store: createOperationStore({ storage }) });
  assert.equal(await op.execute(), true); assert.equal(storage.length, 1);
  assert.ok(op.getSnapshot().storageError);
});
test('unavailable storage falls back to memory with controlled warning and stable retry', async () => {
  const store = createOperationStore({ storage: { getItem() { throw new Error('blocked'); } } });
  let n = 0;
  const make = run => createInventoryOperation(run, {}, () => `memory-${++n}`, { store, intentKey: 'memory' });
  const a = make(async () => { throw new Error('lost'); }); await assert.rejects(a.execute());
  assert.match(a.getSnapshot().storageError.message, /reload/);
  const b = make(async id => id); assert.equal(await b.execute(), a.id); assert.equal(n, 1);
});
test('object key order does not change fingerprint and action keys isolate intents', async () => {
  const storage = storageMock(); const store = createOperationStore({ storage }); let n = 0;
  const a = createInventoryOperation(async () => { throw new Error('lost'); }, { a: 1, b: 2 }, () => `key-${++n}`, { store, intentKey: 'one' });
  await assert.rejects(a.execute());
  const b = createInventoryOperation(async id => id, { b: 2, a: 1 }, () => `key-${++n}`, { store, intentKey: 'one' });
  assert.equal(await b.execute(), a.id);
  const c = createInventoryOperation(async id => id, { a: 1, b: 2 }, () => `key-${++n}`, { store, intentKey: 'two' });
  assert.notEqual(await c.execute(), a.id);
});

test('corrupt matching pending blocks a fresh UUID instead of erasing evidence', async () => {
  const storage = storageMock(); const store = createOperationStore({ storage });
  const record = await store.acquire('corrupt-intent', { a: 1 }, () => 'old');
  storage.setItem(record.key, '{broken');
  const restored = createOperationStore({ storage }); restored.cleanup();
  await assert.rejects(restored.acquire('corrupt-intent', { a: 1 }, () => assert.fail('new UUID')), /pending/);
  assert.equal(storage.getItem(record.key), '{broken');
});

function createInventoryApi(client,options={}) {return apiFactory(client,{mutationsEnabled:true,...options});}
