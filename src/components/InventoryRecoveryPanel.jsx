import { isDefinitiveFailure } from '../lib/inventoryFailure.js';
import { managementError } from '../lib/inventoryManagement.js';
import React, { useEffect, useState } from 'react';
export function InventoryRecoveryPanel({ recovery, onCompleted, onBlocked, mutationsEnabled = false }) {
  const [scanVersion,setScanVersion] = useState(0);
  const [rows,setRows] = useState([]); const [states,setStates] = useState({});
  const [busy,setBusy] = useState(true); const [error,setError] = useState(null);
  const [results,setResults] = useState([]);
  useEffect(() => {
    let active = true;
    async function scan() {
      setBusy(true); setError(null);
      try {
        const pending = await recovery.list(); const next = {}; const done = [];
        for (const row of pending) {
          const found = await recovery.check(row.operation_id); next[row.operation_id]=found.state;
          if (found.state==='completed') done.push({id:row.operation_id,result:found.result});
        }
        const remaining = await recovery.list();
        if (active) { setRows(remaining); setStates(next); setResults(done); onBlocked(remaining.length>0); if(done.length) onCompleted(); }
      } catch(e) { if(active) {setError(managementError(e));onBlocked(true);} }
      finally { if(active)setBusy(false); }
    }
    scan(); return () => {active=false;};
  }, [recovery, onCompleted, onBlocked, scanVersion]);
  async function run(row,replay) {
    if(replay && !mutationsEnabled)return;
    setBusy(true);setError(null);
    try {
      const value = await (replay ? recovery.retry(row.operation_id) : recovery.check(row.operation_id));
      setStates(s=>({...s,[row.operation_id]:value.state}));
      if(value.state==='completed') {setResults(r=>[...r,{id:row.operation_id,result:value.result}]);onCompleted();}
      const remaining=await recovery.list();setRows(remaining);onBlocked(remaining.length>0);
    } catch(e) {
      setError(managementError(e));
      if(isDefinitiveFailure(e)){
        try {const remaining=await recovery.list();setRows(remaining);onBlocked(remaining.length>0);onCompleted();}
        catch{onBlocked(true);}
      }else onBlocked(true);
    } finally {setBusy(false);}
  }
  return <aside aria-label="กู้รายการค้าง" aria-busy={busy}>
    {busy && <p role="status">กำลังตรวจผลรายการเดิม…</p>}
    {error && <><p role="alert">{error}</p><button disabled={busy} onClick={()=>setScanVersion(v=>v+1)}>ตรวจรายการค้างอีกครั้ง</button></>}
    {recovery.getWarning() && <p role="alert">{recovery.getWarning().message}</p>}
    {rows.map(row=><div key={row.operation_id}><p>{row.rpc_name} · {row.operation_id} · {new Date(row.created_at).toLocaleString()}</p>
      <p>{states[row.operation_id]==='not_found' ? 'ยังไม่พบผล ไม่ได้สร้าง UUID ใหม่' : 'ต้องตรวจสอบ/รอผลเดิม'}</p>
      <button disabled={busy} onClick={()=>run(row,false)}>ตรวจผลเดิมอีกครั้ง</button>
      {mutationsEnabled && states[row.operation_id]==='not_found' && <button disabled={busy} onClick={()=>run(row,true)}>ลอง payload เดิมด้วย UUID เดิม</button>}
    </div>)}
    {results.map(r=><div key={r.id}><p role="status">ยืนยันผลเดิมแล้ว: {r.id}</p><pre>{JSON.stringify(r.result,null,2)}</pre>{r.result?.pending_request_count!==undefined && <p role="status">คำเตือน: รุ่นนี้มีงานค้าง {r.result.pending_request_count} งาน งานเดิมดำเนินต่อได้ตามสิทธิ์</p>}</div>)}
  </aside>;
}
