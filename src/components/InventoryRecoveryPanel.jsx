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
  return <aside className="inv-recovery" aria-label="ตรวจสอบรายการค้าง" aria-busy={busy}>
    {busy && <p role="status">กำลังตรวจสอบผลการบันทึก…</p>}
    {error && <><p role="alert">{error}</p><button disabled={busy} onClick={()=>setScanVersion(v=>v+1)}>ตรวจสอบอีกครั้ง</button></>}
    {recovery.getWarning() && <p role="alert">การเก็บสถานะในเครื่องมีปัญหา กรุณาตรวจผลก่อนส่งซ้ำ</p>}
    {rows.map(row=><div key={row.operation_id}><p>มีรายการที่ยังยืนยันผลไม่ได้ · {new Date(row.created_at).toLocaleString('th-TH')}</p>
      <p>{states[row.operation_id]==='not_found'?'ยังไม่พบผลบันทึก สามารถส่งรายการเดิมอีกครั้งโดยไม่สร้างรายการซ้ำ':'กำลังรอผล กรุณาตรวจสอบอีกครั้ง'}</p>
      <button disabled={busy} onClick={()=>run(row,false)}>ตรวจสอบผล</button>
      {mutationsEnabled && states[row.operation_id]==='not_found' && <button disabled={busy} onClick={()=>run(row,true)}>ส่งรายการเดิมอีกครั้ง</button>}
      <details><summary>ข้อมูลสำหรับแจ้งปัญหา</summary><code>{row.operation_id}</code></details>
    </div>)}
    {results.length>0&&<p role="status">ตรวจสอบแล้ว พบรายการบันทึกสำเร็จ {results.length} รายการ</p>}
  </aside>;
}
