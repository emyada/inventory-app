import React, {useCallback, useEffect, useState} from 'react';
import {Search, Plus, PackagePlus, Pencil, AlertTriangle} from 'lucide-react';
import {managementCatalog} from '../lib/inventoryModelCatalog.js';
import {loadAllRequests, PRODUCT_CATEGORIES, WORKFLOW_LABELS, sumAmounts} from '../lib/inventoryReports.js';
import {manualPendingLines} from '../lib/inventoryV2Reads.js';
import {canCloseNotCompleted} from '../lib/inventoryExtensions.js';
import {cancelEligibility} from '../lib/inventoryWorkflow.js';
function useRead(load,revision) {
  const [state,setState]=useState({busy:true,error:null,rows:[]});
  useEffect(()=>{let alive=true;setState({busy:true,error:null,rows:[]});load().then(rows=>{if(alive)setState({busy:false,error:null,rows});}).catch(e=>{if(alive)setState({busy:false,error:e.message,rows:[]});});return()=>{alive=false;};},[load,revision]);
  return state;
}
function ReadState({state}) {return <>{state.busy&&<p role="status">กำลังโหลด…</p>}{state.error&&<p role="alert">{state.error} กรุณาโหลดใหม่</p>}{!state.busy&&!state.error&&!state.rows.length&&<p className="inv-empty">ไม่มีรายการ</p>}</>;}
export function ModelsFloor({role,revision,onAction,actionBusy}) {
  const state=useRead(managementCatalog.listModels,revision);const [category,setCategory]=useState('CIEM');const [search,setSearch]=useState('');const [inactive,setInactive]=useState(false);
  const rows=state.rows.filter(m=>m.category===category&&(m.is_active||inactive)&&m.name.toLowerCase().includes(search.toLowerCase()));
  return <section><div className="inv-toolbar"><h2>เลือกรุ่นเพื่อขอเบิก</h2>{role==='admin'&&<button disabled={actionBusy} onClick={()=>onAction({kind:'save_model',category})}><Plus size={16}/> เพิ่มรุ่น</button>}</div>
    <nav className="inv-subnav">{[...new Set([...PRODUCT_CATEGORIES,...state.rows.map(m=>m.category)])].map(c=><button key={c} aria-pressed={category===c} onClick={()=>setCategory(c)}>{c}</button>)}<button disabled={actionBusy} onClick={()=>onAction({kind:'create',repair:true})}>ซ่อมและอื่นๆ</button></nav>
    <label className="inv-search"><Search size={16}/><input aria-label="ค้นหารุ่น" placeholder="ค้นหารุ่น…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    {role==='admin'&&<label><input type="checkbox" checked={inactive} onChange={e=>setInactive(e.target.checked)}/> แสดงรุ่นที่ปิดใช้งาน</label>}
    {category==='Universal'&&<aside className="inv-notice">Universal: เลือกรุ่นเพื่อเปิดงานแพ็ก 1 ชิ้นตาม BOM ของรุ่น ยอดสำเร็จรูปเพิ่มเมื่อเบิกวัตถุดิบครบ ไม่ต้องระบุชื่อลูกค้า</aside>}
    <ReadState state={state}/><div className="grid-list">{rows.map(m=><article className="inv-card" key={m.id}><h3>{m.name}</h3><p>{m.category} · {m.is_active?'ใช้งาน':'ปิดใช้งาน'}</p>
      <button className="inv-primary" disabled={actionBusy||!m.is_active} onClick={()=>onAction({kind:'create',model:m})}>{m.category==='Universal'?'เปิดงานแพ็ก':'ยื่นคำขอเบิก'}</button>
      {role==='admin'&&<div className="inv-actions"><button disabled={actionBusy} onClick={()=>onAction({kind:'save_model',row:m})}><Pencil size={14}/> แก้ไขรุ่น / BOM</button><button disabled={actionBusy} onClick={()=>onAction({kind:'set_model_active',row:m})}>{m.is_active?'ปิด':'เปิด'}ใช้งาน</button></div>}</article>)}</div>
    {!state.busy&&!state.error&&!rows.length&&<p>ไม่มีรุ่นในหมวด/คำค้นนี้</p>}
  </section>;
}
export function MaterialsPanel({api,role,revision,onAction,actionBusy}) {
  const state=useRead(useCallback(()=>api.list_materials({include_inactive:true}),[api]),revision);const [search,setSearch]=useState('');const [low,setLow]=useState(false);const [inactive,setInactive]=useState(false);
  const rows=state.rows.filter(m=>(m.is_active||inactive)&&m.name.toLowerCase().includes(search.toLowerCase())&&(!low||Number(m.qty)<=Number(m.low_stock_threshold)));
  return <section><div className="inv-toolbar"><h2>คลังวัตถุดิบ</h2>{role==='admin'&&<button disabled={actionBusy} onClick={()=>onAction({kind:'create_material'})}><Plus size={16}/> เพิ่มวัตถุดิบ</button>}</div>
    <div className="inv-filters"><label>ค้นหาวัตถุดิบ<input value={search} onChange={e=>setSearch(e.target.value)}/></label><label><input type="checkbox" checked={low} onChange={e=>setLow(e.target.checked)}/> เฉพาะใกล้หมด</label><label><input type="checkbox" checked={inactive} onChange={e=>setInactive(e.target.checked)}/> รวมที่ปิดใช้งาน</label></div>
    <ReadState state={state}/><div className="grid-list">{rows.map(m=><article className="inv-card" key={m.id}><h3>{m.name}</h3><strong className="inv-balance">{m.qty} {m.unit}</strong><p>ระดับแจ้งเตือน {m.low_stock_threshold} {m.unit} · {m.requires_picking?'ต้องหยิบ':'ใช้โดยอัตโนมัติเมื่องานเบิกครบ'}</p>{Number(m.qty)<=Number(m.low_stock_threshold)&&<p className="inv-warning"><AlertTriangle size={14}/> ใกล้หมด</p>}
      {!m.is_active&&<p>ปิดใช้งาน</p>}<div className="inv-actions">
      {['admin','purchasing'].includes(role)&&<button className="inv-primary" disabled={actionBusy||!m.is_active} onClick={()=>onAction({kind:'receive_purchase',row:m})}><PackagePlus size={16}/> รับเข้า</button>}
      {role==='admin'&&<><button disabled={actionBusy} onClick={()=>onAction({kind:'update_material',row:m})}>แก้ไขข้อมูล</button><button disabled={actionBusy} onClick={()=>onAction({kind:'stocktake',row:m})}>ตรวจนับ</button><button disabled={actionBusy} onClick={()=>onAction({kind:'set_material_active',row:m})}>{m.is_active?'ปิด':'เปิด'}ใช้งาน</button></>}</div></article>)}</div>
  </section>;
}
async function queueRows(api) {
  const rows=[];const seen=new Set();let cursor={};for(let page=0;page<1000;page++){
    const batch=await api.list_pick_queue({...cursor,limit:500});if(!Array.isArray(batch))throw new Error('ข้อมูลคิวไม่สมบูรณ์');
    for(const r of batch){if(seen.has(r.id))throw new Error('คิวเปลี่ยนระหว่างอ่าน กรุณาโหลดใหม่');seen.add(r.id);rows.push(r);}if(batch.length<500)return rows;
    const last=batch.at(-1);cursor={after_at:last.created_at,after_id:last.id};
  }throw new Error('คิวมีข้อมูลเกินขอบเขต');
}
export function RequestsPanel({api,role,userId,queue=false,revision,onAction,actionBusy}) {
  const state=useRead(useCallback(()=>queue?queueRows(api):loadAllRequests(api),[api,queue]),revision);const [search,setSearch]=useState('');const [status,setStatus]=useState('');const [page,setPage]=useState(0);
  const rows=state.rows.filter(r=>(!status||r.workflow_state===status)&&`${r.order_ref} ${r.model_name} ${r.staff_name}`.toLowerCase().includes(search.toLowerCase()));
  const last=Math.max(0,Math.ceil(rows.length/25)-1);const current=Math.min(page,last);
  const totals=new Map();if(queue)for(const r of rows)for(const line of manualPendingLines(r)){const prior=totals.get(line.material_id)||{name:line.material_name,unit:line.unit,qty:'0'};prior.qty=sumAmounts([prior.qty,line.qty]);totals.set(line.material_id,prior);}
  return <section><div className="inv-toolbar"><h2>{queue?'คิวหยิบของ':role==='admin'?'คำขอทั้งหมด':'คำขอของฉัน'}</h2>{!queue&&['staff','admin'].includes(role)&&<button disabled={actionBusy} onClick={()=>onAction({kind:'create'})}>ยื่นคำขอเบิก</button>}</div>
    <div className="inv-filters"><label>ค้นหาออเดอร์ / รุ่น / ผู้ขอ<input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label>{!queue&&<label>สถานะ<select value={status} onChange={e=>{setStatus(e.target.value);setPage(0);}}><option value="">ทั้งหมด</option>{Object.entries(WORKFLOW_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}</div>
    <ReadState state={state}/>
    {queue&&rows.length>0&&<details><summary>ยอดที่ต้องหยิบตามวัตถุดิบ ({rows.length} คำขอในตัวกรอง)</summary>{[...totals].map(([id,t])=><p key={id}>{t.name} · {t.qty} {t.unit}</p>)}<button disabled={actionBusy} onClick={()=>onAction({kind:'pick',rows})}>เลือกบรรทัดจากคิวนี้เพื่อหยิบพร้อมกัน</button><p>ไม่มีการเลือกให้อัตโนมัติ ต้องเลือกบรรทัดจริงก่อนยืนยัน</p></details>}
    <div className="grid-list">{rows.slice(current*25,(current+1)*25).map(r=><article className="inv-card" key={r.id}><h3>{r.order_ref}</h3><p>{r.model_name} · {r.category}</p><p>{r.staff_name} · {new Date(r.created_at).toLocaleString('th-TH')}</p><span className={'inv-status '+r.workflow_state}>{WORKFLOW_LABELS[r.workflow_state]||r.workflow_state}</span><p>ทั้งหมด {r.total_lines} · หยิบแล้ว {r.picked_lines} · ค้าง {r.actionable_pending_lines ?? r.pending_lines}</p>{r.note&&<p>{r.note}</p>}
      {r.accounting_evidence==='unverified'&&<p>Completed/shipped by business attestation; historical stock deduction unverified. Original snapshot flags retained.</p>}<details><summary>รายละเอียดวัตถุดิบที่บันทึกไว้</summary>{(queue?manualPendingLines(r):r.bom_snapshot||[]).map((b,i)=><p key={b.line_id||i}>{b.material_name} · {b.qty} {b.unit} · {r.workflow_state==='legacy_completed_shipped'?'Historical snapshot; issue unverified':b.picked?'เบิกแล้ว':b.requires_picking===false?'อัตโนมัติเมื่อเบิกครบ':'รอหยิบ'}</p>)}</details>
      {queue&&role==='admin'&&<button className="inv-primary" disabled={actionBusy} onClick={()=>onAction({kind:'pick',row:r})}>เลือกและยืนยันหยิบ</button>}
      {!queue&&(cancelEligibility(r,role,userId)?<p className="inv-muted">{cancelEligibility(r,role,userId)}</p>:<button disabled={actionBusy} onClick={()=>onAction({kind:'cancel',row:r})}>{Number(r.picked_lines)>0?'ยกเลิกและคืนเต็มจำนวน':'ยกเลิกคำขอ'}</button>)}
      {!queue&&canCloseNotCompleted(r,role)&&<button disabled={actionBusy} onClick={()=>onAction({kind:'close_not_completed',row:r})}>ผลิตไม่สำเร็จ / คืนตามจริง</button>}
      {r.closure_kind==='production_not_completed'&&<div><p>ปิดงานแล้ว — ไม่รวมเป็นผลิตสำเร็จ</p>{(r.return_summary||[]).map(line=>{const b=r.bom_snapshot?.find(x=>x.line_id===line.line_id);return <p key={line.line_id}>{b?.material_name} · คืนจริง {line.returned_qty} · ใช้ไป/ไม่คืน {line.consumed_qty} {b?.unit}</p>;})}</div>}
    </article>)}</div>
    {!state.busy&&!state.error&&!rows.length&&<p>ไม่มีคำขอในตัวกรองนี้</p>}
    {last>0&&<div className="inv-toolbar"><button disabled={!current} onClick={()=>setPage(current-1)}>ก่อนหน้า</button><span>หน้า {current+1}/{last+1}</span><button disabled={current===last} onClick={()=>setPage(current+1)}>ถัดไป</button></div>}
  </section>;
}
