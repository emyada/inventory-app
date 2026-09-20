import React, { useEffect, useState } from 'react';
import { managementCatalog } from '../lib/inventoryModelCatalog.js';
export function InventoryModelsPanel({role,revision,onAction,actionBusy,catalog=managementCatalog}) {
  const [rows,setRows]=useState([]);const [loading,setLoading]=useState(true);const [error,setError]=useState(null);
  const [reload,setReload]=useState(0);const [page,setPage]=useState(0);
  useEffect(()=>{
    if(role!=='admin')return;
    let active=true;setLoading(true);setError(null);setPage(0);
    catalog.listModels().then(data=>{if(active)setRows(data);}).catch(e=>{if(active)setError(e);}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[role,revision,reload,catalog]);
  if(role!=='admin')return null;
  return <section aria-label="รุ่นและ BOM"><h2>รุ่นและ BOM</h2>
    <button disabled={loading} onClick={()=>setReload(n=>n+1)}>โหลดรุ่นใหม่</button>
    <button disabled={actionBusy} onClick={()=>onAction({kind:'save_model'})}>เพิ่มรุ่น</button>
    {loading && <p role="status">กำลังโหลด…</p>}
    {error && <p role="alert">{error.message} {error.code && '['+error.code+']'}</p>}
    {!loading&&!error&&!rows.length && <p>ยังไม่มีรุ่น</p>}
    {rows.slice(page*25,(page+1)*25).map(row=><article key={row.id}><h3>{row.name} — {row.category}</h3>
      <p>{row.is_active?'เปิดใช้งาน':'ปิดใช้งาน — สร้างคำขอใหม่ไม่ได้'} · ประวัติเดิมดูได้ในคำขอของฉัน/รายงาน</p>
      <button disabled={actionBusy||loading||Boolean(error)} onClick={()=>onAction({kind:'save_model',row})}>แก้ไขรุ่นและ BOM</button>
      <button disabled={actionBusy||loading||Boolean(error)} onClick={()=>onAction({kind:'set_model_active',row})}>{row.is_active?'ปิด':'เปิด'}ใช้งานรุ่น</button>
    </article>)}
    {rows.length>25 && <nav><button disabled={!page||loading} onClick={()=>setPage(p=>p-1)}>ก่อนหน้า</button><span>หน้า {page+1}</span>
      <button disabled={(page+1)*25>=rows.length||loading} onClick={()=>setPage(p=>p+1)}>ถัดไป</button></nav>}
  </section>;
}
