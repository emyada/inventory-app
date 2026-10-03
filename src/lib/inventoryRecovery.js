import { assertInventoryMutation } from './inventoryEnvironment.js';
import { createInventoryApi, mutationParameters } from './inventoryApi.js';
import { rpcData, isDefinitiveFailure, retainFailure } from './inventoryFailure.js';
import { fingerprint } from './inventoryOperation.js';
const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const kinds = { set_material_active: 'archive_material', receive_purchase: 'purchase', receive_purchase_v21: 'purchase', close_not_completed: 'cancel_request', issue_finished: 'finished_out' };
export function createRecoveryInventory(client, { userId, currentUserId, storage, uuid, now = Date.now, mutationsEnabled = false, assertAccess = () => {} } = {}) {
  if (!isUuid(userId) || typeof currentUserId !== 'function') throw new Error('Recovery requires a user UUID');
  const prefix = `inventory.replay.v2:${userId}:`;
  const memory = new Map(); const flights = new Map();
  let backend; let warning = null;
  const fallback = () => { backend = null; warning = new Error('บันทึก replay ไม่ได้ ใช้ memory ชั่วคราว ห้าม reload ขณะยังไม่ทราบผล'); };
  try { backend = storage === undefined ? globalThis.localStorage : storage; } catch { fallback(); }
  if (!backend) fallback();
  async function guard() {
    assertAccess();
    if (await currentUserId() !== userId) throw new Error('ผู้ใช้เปลี่ยนแล้ว ห้ามตรวจหรือ retry รายการของบัญชีเดิม');
  }
  function noSecrets(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key,child] of Object.entries(value)) {
      if (/^(access_token|refresh_token|token|password|api_key|apikey|service_role|service_role_key|authorization|auth_session|session)$/i.test(key)) throw new Error('ห้ามเก็บข้อมูล auth/secret ใน replay');
      noSecrets(child);
    }
  }
  function validate(row) {
    noSecrets(row);
    if (Object.keys(row || {}).some(k => !['operation_id','rpc_name','arguments','intent_key','payload_fingerprint','created_at','status'].includes(k))) throw new Error('Unexpected replay metadata');
    const allowed = mutationParameters[row?.rpc_name];
    if (!isUuid(row?.operation_id) || !allowed || row.status !== 'pending'
      || typeof row.intent_key !== 'string' || row.intent_key.split(':')[0] !== row.rpc_name
      || !/^[a-f0-9]{64}$/.test(row.payload_fingerprint) || !Number.isFinite(row.created_at)
      || !row.arguments || Array.isArray(row.arguments) || typeof row.arguments !== 'object'
      || Object.keys(row.arguments).some(k => !allowed.split(' ').map(p => `p_${p}`).includes(k))) {
      throw new Error('Replay เสียหาย หยุดส่งรายการและเก็บหลักฐานไว้');
    }
    return row;
  }
  async function list() {
    await guard();
    if (backend) {
      try {
        const fresh = new Map();
        for (let i = 0; i < backend.length; i++) { const k = backend.key(i); if (k?.startsWith(prefix)) fresh.set(k, backend.getItem(k)); }
        memory.clear(); for (const [k,v] of fresh) memory.set(k,v);
      } catch { fallback(); }
    }
    const rows = [];
    for (const [key,raw] of memory) {
      let row;
      try { row = validate(JSON.parse(raw)); } catch { throw new Error('Replay เสียหาย ห้ามล้างหรือสร้าง UUID ใหม่'); }
      if (key !== prefix + row.operation_id || await fingerprint(row.arguments) !== row.payload_fingerprint) throw new Error('Replay fingerprint ไม่ตรง หยุดอย่างปลอดภัย');
      rows.push(row);
    }
    return rows;
  }
  function write(row) {
    const key = prefix + row.operation_id; const raw = JSON.stringify(row); memory.set(key,raw);
    if (backend) { try { backend.setItem(key,raw); } catch { fallback(); } }
  }
  async function remove(id) {
    await guard();
    if (backend) {
      try { backend.removeItem(prefix+id); }
      catch { warning = new Error('ลบ replay ไม่ได้ ให้ตรวจผลเดิมอีกครั้งก่อนส่ง intent ใหม่'); return false; }
    }
    memory.delete(prefix+id);return true;
  }
  const store = {
    async acquire(intentKey, args, newId) {
      const rows = await list(); const hash = await fingerprint(args);
      const old = rows.find(r => r.intent_key === intentKey && r.payload_fingerprint === hash);
      if (old) return { id: old.operation_id, createdAt: old.created_at };
      const row = validate({ operation_id: newId(), rpc_name: intentKey.split(':')[0], arguments: args,
        intent_key: intentKey, payload_fingerprint: hash, created_at: now(), status: 'pending' });
      if (rows.some(r => r.operation_id === row.operation_id)) throw new Error('Operation UUID collision; replay preserved');
      await guard(); write(row); return { id: row.operation_id, createdAt: row.created_at };
    },
    confirm() {}, // Removal requires authenticated lookup/mutation confirmation below.
    isStale: record => Boolean(record && now()-record.createdAt >= 7*86400000),
    getWarning: () => warning,
  };
  async function rawCall(name,args,mutation = false) {
    await guard(); if(mutation)assertInventoryMutation(mutationsEnabled); const response = await client.rpc(name,args); await guard();
    return rpcData(response,{mutation});
  }
  function single(id, run) {
    if (flights.has(id)) return flights.get(id);
    const p = Promise.resolve().then(run).finally(() => flights.delete(id)); flights.set(id,p); return p;
  }
  async function lookup(row) {
    const data = await rawCall('inventory_get_operation_result',{p_operation_id:row.operation_id});
    if (!data || typeof data.found !== 'boolean' || typeof data.completed !== 'boolean') throw new Error('ผลตรวจ operation ไม่สมบูรณ์');
    if (data.found && data.kind !== (kinds[row.rpc_name] || row.rpc_name)) throw new Error('ชนิด operation ไม่ตรง หยุด retry');
    if (data.found && data.completed) { await remove(row.operation_id); return { state:'completed', result:data.result }; }
    return { state: data.found ? 'waiting' : 'not_found' };
  }
  async function getRow(id) {
    const row = (await list()).find(r => r.operation_id===id);
    if (!row) throw new Error('ไม่พบ replay ของผู้ใช้ปัจจุบัน'); return row;
  }
  function check(id) { return single(id, async () => lookup(await getRow(id))); }
  function retry(id) {
    assertAccess();assertInventoryMutation(mutationsEnabled);
    return single(id, async () => {
    const row = await getRow(id); const found = await lookup(row);
    if (found.state !== 'not_found') return found;
    // Even a stale replay uses the same UUID. Only the mutation's DB response
    // can establish rollback; a failed lookup or local version read cannot.
    try {
      const result = await rawCall('inventory_'+row.rpc_name,{...row.arguments,p_operation_id:id},true);
      await remove(id); return {state:'completed',result};
    } catch(error) {
      if(isDefinitiveFailure(error)) {
        try {if(await remove(id)===false)retainFailure(error);}catch{retainFailure(error);}
      }
      throw error;
    }
  }); }
  const wrapped = { rpc: async (name,args) => {
    if (Object.keys(mutationParameters).some(n => name===`inventory_${n}`)) {
      const recovered = await retry(args.p_operation_id);
      if (recovered.state !== 'completed') throw new Error('รายการยังไม่เสร็จ ให้รอแล้วตรวจอีกครั้งด้วย UUID เดิม');
      return {data:recovered.result,error:null};
    }
    return {data:await rawCall(name,args),error:null};
  } };
  const api = createInventoryApi(wrapped,{uuid,operationStore:store,mutationsEnabled,assertAccess});
  return { api, list, check, retry, getWarning: () => warning };
}
