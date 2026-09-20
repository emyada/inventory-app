import { isDefinitiveFailure, retainFailure } from './inventoryFailure.js';
const PREFIX = 'inventory.pending.v1:';
export const DEFAULT_OPERATION_TTL = 7 * 24 * 60 * 60 * 1000;

function canonical(value) {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Invalid operation payload');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
export async function fingerprint(payload) {
  const bytes = new TextEncoder().encode(canonical(payload));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

export function createOperationStore({ storage, now = Date.now, ttl = DEFAULT_OPERATION_TTL } = {}) {
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('Invalid operation TTL');
  const memory = new Map();
  let backend;
  let warning = null;
  try { backend = storage === undefined ? globalThis.localStorage : storage; }
  catch { backend = null; }
  const fallback = () => {
    backend = null;
    warning = new Error('ไม่สามารถบันทึกรายการในเครื่องได้ ใช้หน่วยความจำชั่วคราว กรุณาอย่า reload ขณะยังไม่ทราบผล');
  };
  if (!backend) fallback();
  function read(key) {
    if (backend) {
      try { const raw = backend.getItem(key); if (raw !== null) memory.set(key, raw); else memory.delete(key); }
      catch { fallback(); }
    }
    return memory.get(key) ?? null;
  }
  function write(key, value) {
    if (value === null) memory.delete(key); else memory.set(key, value);
    if (backend) {
      try { if (value === null) backend.removeItem(key); else backend.setItem(key, value); }
      catch { fallback(); }
    }
  }
  function valid(raw) {
    try {
      const row = JSON.parse(raw);
      return row && typeof row.operation_id === 'string' && typeof row.intent_key === 'string'
        && /^[a-f0-9]{64}$/.test(row.payload_fingerprint) && Number.isFinite(row.created_at)
        && row.status === 'pending' ? row : null;
    } catch { return null; }
  }
  function cleanup() {
    const keys = new Set(memory.keys());
    if (backend) {
      try { for (let i = 0; i < backend.length; i++) { const key = backend.key(i); if (key?.startsWith(PREFIX)) keys.add(key); } }
      catch { fallback(); }
    }
    // Unresolved (including corrupt) evidence is never erased on a timer.
    for (const key of keys) {
      if (key.startsWith(PREFIX) && !valid(read(key))) {
        warning = new Error('ข้อมูล pending ไม่สมบูรณ์ ต้องตรวจสอบก่อนส่งรายการเดิม ห้ามล้างเพื่อสร้าง UUID ใหม่');
      }
    }
  }
  return {
    getPendingSummary() {
      cleanup();
      let pending = 0; let stale = 0; let corrupt = 0;
      for (const raw of memory.values()) {
        const row = valid(raw);
        if (!row) { corrupt++; continue; }
        pending++; if (now() - row.created_at >= ttl) stale++;
      }
      return { pending, stale, corrupt, error: warning };
    },
    async acquire(intentKey, payload, uuid) {
      const hash = await fingerprint(payload);
      cleanup();
      const key = PREFIX + encodeURIComponent(intentKey) + ':' + hash;
      const raw = read(key);
      const row = valid(raw);
      if (row && row.intent_key === intentKey && row.payload_fingerprint === hash) return { key, id: row.operation_id, createdAt: row.created_at };
      if (raw !== null) throw new Error('ต้องตรวจสอบ pending เดิม ไม่สามารถสร้าง UUID ใหม่แทนข้อมูลที่เสียหายได้');
      const id = uuid();
      write(key, JSON.stringify({ operation_id: id, intent_key: intentKey,
        payload_fingerprint: hash, created_at: now(), status: 'pending' }));
      return { key, id, createdAt: now() };
    },
    confirm(record) {
      // Confirmed success or a trusted mutation rollback may retire matching evidence.
      const row = valid(read(record.key));
      if (row?.operation_id !== record.id) return true;
      if (backend) {
        try { backend.removeItem(record.key); }
        catch { warning = new Error('ลบ pending ไม่ได้ เก็บ UUID เดิมไว้ก่อน ห้ามส่ง intent ใหม่'); return false; }
      }
      memory.delete(record.key);return true;
    },
    isStale: record => Boolean(record && now() - record.createdAt >= ttl),
    cleanup,
    getWarning: () => warning,
  };
}
let defaultStore;
export function getDefaultOperationStore() { return defaultStore ??= createOperationStore(); }
export function createInventoryOperation(run, payload, uuid = () => crypto.randomUUID(), options = {}) {
  const store = options.store ?? getDefaultOperationStore();
  const intentKey = options.intentKey ?? 'inventory';
  if (typeof intentKey !== 'string' || !intentKey.trim()) throw new Error('Intent key required');
  const frozenPayload = structuredClone(payload);
  let record = null;
  let snapshot = { status: 'idle', loading: false, error: null, storageError: null, needsReview: false, data: null };
  let pending = null;
  const listeners = new Set();
  const publish = next => {
    snapshot = { ...next, needsReview: next.status !== 'succeeded' && store.isStale(record), storageError: store.getWarning() };
    listeners.forEach(listener => listener());
  };
  const execute = () => {
    if (pending) return pending;
    if (snapshot.status === 'succeeded') return Promise.resolve(snapshot.data);
    if (snapshot.status === 'failed') return Promise.reject(snapshot.error); // Terminal rollback; a new intent needs a new controller.
    pending = Promise.resolve().then(async () => {
      record ??= await store.acquire(intentKey, frozenPayload, uuid);
      publish({ status: 'submitting', loading: true, error: null, data: null });
      return run(record.id, structuredClone(frozenPayload));
    }).then(data => {
      store.confirm(record);
      publish({ status: 'succeeded', loading: false, error: null, data });
      return data;
    }, async error => {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (record && isDefinitiveFailure(failure)) {
        try { if (await store.confirm(record) === false) retainFailure(failure); }
        catch { retainFailure(failure); }
      }
      publish({ status: isDefinitiveFailure(failure) ? 'failed' : 'unknown', loading: false, error: failure, data: null });
      throw failure;
    }).finally(() => { pending = null; });
    publish({ status: 'submitting', loading: true, error: null, data: null });
    return pending;
  };
  return Object.freeze({ get id() { return record?.id ?? null; }, execute, retry: execute,
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  });
}
