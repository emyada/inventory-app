import {Overflow} from './InventoryUI.jsx';
import React, {useCallback, useEffect, useState} from 'react';
import {Search, Plus, PackagePlus, Pencil, AlertTriangle} from 'lucide-react';
import {managementCatalog} from '../lib/inventoryModelCatalog.js';
import {loadAllRequests, PRODUCT_CATEGORIES, WORKFLOW_LABELS} from '../lib/inventoryReports.js';
import {buildPickRound} from '../lib/inventoryPickRound.js';
import {manualPendingLines} from '../lib/inventoryV2Reads.js';
import {canCloseNotCompleted} from '../lib/inventoryExtensions.js';
import {filterRequests,employeeStatus} from '../lib/inventoryRequestUX.js';
import {cancelEligibility} from '../lib/inventoryWorkflow.js';
import {pendingWorkerGroups, UNASSIGNED_WORKER} from '../lib/inventoryRequestPresentation.js';
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
    {role==='admin'&&<details><summary>ตัวเลือกการแสดง</summary><label><input type="checkbox" checked={inactive} onChange={e=>setInactive(e.target.checked)}/> แสดงรุ่นที่ปิดใช้งาน</label></details>}
    <ReadState state={state}/><div className="grid-list">{rows.map(m=><article className="inv-card" key={m.id}><h3>{m.name}</h3><p className="inv-muted">{m.category}{!m.is_active?' · ปิดใช้งาน':''}</p>
      <button className="inv-primary" disabled={actionBusy||!m.is_active} onClick={()=>onAction({kind:'create',model:m})}>{'ยื่นคำขอเบิก'}</button>
      {role==='admin'&&<Overflow label={'จัดการรุ่น '+m.name}><button disabled={actionBusy} onClick={()=>onAction({kind:'save_model',row:m})}><Pencil size={14}/> แก้ไขรุ่น / BOM</button><button disabled={actionBusy} onClick={()=>onAction({kind:'set_model_active',row:m})}>{m.is_active?'ปิด':'เปิด'}ใช้งาน</button></Overflow>}</article>)}</div>
    {!state.busy&&!state.error&&!rows.length&&<p>ไม่มีรุ่นในหมวด/คำค้นนี้</p>}
  </section>;
}
export function MaterialsPanel({api,role,revision,onAction,actionBusy}) {
  const state=useRead(useCallback(()=>api.list_materials({include_inactive:true}),[api]),revision);const [search,setSearch]=useState('');const [low,setLow]=useState(false);const [inactive,setInactive]=useState(false);
  const lowRows=state.rows.filter(m=>m.is_active&&Number(m.qty)<=Number(m.low_stock_threshold));
  const rows=state.rows.filter(m=>(m.is_active||inactive)&&m.name.toLowerCase().includes(search.toLowerCase())&&(!low||Number(m.qty)<=Number(m.low_stock_threshold)));
  return <section><div className="inv-toolbar"><h2>คลังวัตถุดิบ</h2>{role==='admin'&&<button disabled={actionBusy} onClick={()=>onAction({kind:'create_material'})}><Plus size={16}/> เพิ่มวัตถุดิบ</button>}</div>
    {!state.busy&&!state.error&&<details className="inv-low-summary"><summary><AlertTriangle size={16}/> ใกล้หมด {lowRows.length} รายการ</summary><ul>{lowRows.map(m=><li key={m.id}><span>{m.name}</span><strong>{m.qty} {m.unit}</strong></li>)}</ul>{!lowRows.length&&<p>ไม่มีวัตถุดิบใกล้หมด</p>}</details>}
    <div className="inv-filters"><label>ค้นหาวัตถุดิบ<input value={search} onChange={e=>setSearch(e.target.value)}/></label><label><input type="checkbox" checked={low} onChange={e=>setLow(e.target.checked)}/> เฉพาะใกล้หมด</label><label><input type="checkbox" checked={inactive} onChange={e=>setInactive(e.target.checked)}/> รวมที่ปิดใช้งาน</label></div>
    <ReadState state={state}/><div className="grid-list">{rows.map(m=><article className="inv-card" key={m.id}><h3>{m.name}</h3><strong className="inv-balance">{m.qty} {m.unit}</strong>{Number(m.qty)<=Number(m.low_stock_threshold)&&<p className="inv-warning"><AlertTriangle size={14}/> ใกล้หมด</p>}
      {!m.is_active&&<p>ปิดใช้งาน</p>}<div className="inv-actions">
      {['admin','purchasing'].includes(role)&&<button className="inv-primary" disabled={actionBusy||!m.is_active} onClick={()=>onAction({kind:'receive_purchase_v21',row:m})}><PackagePlus size={16}/> รับเข้า</button>}
      {role==='admin'&&<Overflow label={'จัดการวัตถุดิบ '+m.name}><p className="inv-muted">จุดเตือน {m.low_stock_threshold} {m.unit} · {m.requires_picking?'ต้องหยิบ':'อัตโนมัติ'}</p><button disabled={actionBusy} onClick={()=>onAction({kind:'update_material',row:m})}>แก้ไขข้อมูล</button><button disabled={actionBusy} onClick={()=>onAction({kind:'stocktake',row:m})}>ตรวจนับ</button><button disabled={actionBusy} onClick={()=>onAction({kind:'set_material_active',row:m})}>{m.is_active?'ปิด':'เปิด'}ใช้งาน</button></Overflow>}</div></article>)}</div>
  </section>;
}
async function queueRows(api) {
  const rows=[];const seen=new Set();let cursor={};for(let page=0;page<1000;page++){
    const batch=await api.list_pick_queue({...cursor,limit:500});if(!Array.isArray(batch))throw new Error('ข้อมูลคิวไม่สมบูรณ์');
    for(const r of batch){if(seen.has(r.id))throw new Error('คิวเปลี่ยนระหว่างอ่าน กรุณาโหลดใหม่');seen.add(r.id);rows.push(r);}if(batch.length<500)return rows;
    const last=batch.at(-1);cursor={after_at:last.created_at,after_id:last.id};
  }throw new Error('คิวมีข้อมูลเกินขอบเขต');
}
export function SupervisorRequests(props) {
 const [view,setView]=useState('queue');
 return <section><h2>จัดการคำขอ</h2><nav className="inv-subnav" aria-label="มุมมองหัวหน้า">{[['queue','คิวหยิบ'],['all','คำขอทั้งหมด']].map(([key,label])=><button key={key} aria-pressed={view===key} onClick={()=>setView(key)}>{label}</button>)}</nav><RequestsPanel key={view} {...props} queue={view==='queue'}/></section>;
}
export function RequestsPanel({api,role,userId,queue=false,revision,onAction,actionBusy}) {
  const state=useRead(useCallback(()=>queue?queueRows(api):loadAllRequests(api),[api,queue]),revision);const [search,setSearch]=useState('');const [status,setStatus]=useState('');const [page,setPage]=useState(0);
  const [dateBasis,setDateBasis]=useState('created');const [view,setView]=useState('active');const [from,setFrom]=useState('');const [to,setTo]=useState('');
  const [worker,setWorker]=useState('');
  const employee=role==='staff'&&!queue;const showDates=!queue&&(!employee||view==='history');
  const invalidPeriod=showDates&&from&&to&&from>to;
  const rows=invalidPeriod?[]:filterRequests(state.rows,{view:employee?view:'all',search,status:employee?'':status,from:showDates?from:'',to:showDates?to:'',dateBasis});
  const workerGroups=queue?pendingWorkerGroups(state.rows):[];
  const pendingCount=workerGroups.reduce((total,group)=>total+group.rows.length,0);
  const displayRows=queue&&worker===UNASSIGNED_WORKER?pendingWorkerGroups(rows).flatMap(group=>group.rows):rows;
  const last=Math.max(0,Math.ceil(displayRows.length/25)-1);const current=Math.min(page,last);
  let round=[],roundError='';if(queue)try{round=buildPickRound(rows);}catch(e){roundError=e.message;}
  return <section><div className="inv-toolbar"><h2>{queue?'คิวหยิบของ':role==='admin'?'คำขอทั้งหมด':'คำขอของฉัน'}</h2>{!queue&&['staff','admin'].includes(role)&&<button disabled={actionBusy} onClick={()=>onAction({kind:'create'})}>ยื่นคำขอเบิก</button>}</div>
    {employee&&<nav className="inv-subnav" aria-label="คำขอของฉัน">{[['active','งานที่ยังไม่เสร็จ'],['history','ประวัติคำขอ']].map(([key,label])=><button key={key} aria-pressed={view===key} onClick={()=>{setView(key);setPage(0);}}>{label}</button>)}</nav>}
    {showDates&&<div className="inv-filters"><label>ค้นหาตาม<select value={dateBasis} onChange={e=>{setDateBasis(e.target.value);setPage(0);}}><option value="created">วันที่สร้างคำขอ</option><option value="issued">วันที่เบิกจริง</option></select></label><label>ตั้งแต่<input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(0);}}/></label><label>ถึง<input type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(0);}}/></label><button onClick={()=>{setFrom('');setTo('');setPage(0);}}>ล้างวันที่</button></div>}
    {invalidPeriod&&<p role="alert">วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด</p>}
    <div className="inv-filters"><label>ค้นหาออเดอร์ / รุ่น / ผู้ขอ<input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label>{!queue&&!employee&&<label>สถานะ<select value={status} onChange={e=>{setStatus(e.target.value);setPage(0);}}><option value="">ทั้งหมด</option>{Object.entries(WORKFLOW_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}</div>
    <ReadState state={state}/>
    {queue&&<nav className="inv-worker-filters" aria-label="กรองตามช่างผู้รับผิดชอบ"><button type="button" aria-pressed={!worker} onClick={()=>{setWorker('');setPage(0);}}>ทั้งหมด <span>{pendingCount}</span></button>{workerGroups.map(group=><button type="button" key={group.key} aria-pressed={worker===group.key} onClick={()=>{setWorker(group.key);setPage(0);}}>{group.name} <span>{group.rows.length}</span></button>)}</nav>}
    {queue&&<><p className="inv-muted">{rows.length} คำขอ · {round.length} วัตถุดิบ</p>{roundError&&<p role="alert">{roundError}</p>}
      <button className="inv-primary" disabled={role!=='admin'||actionBusy||state.busy||Boolean(state.error)||Boolean(roundError)||!round.length} onClick={()=>onAction({kind:'pick',rows})}>เลือกรอบหยิบ</button>
      <div className="inv-pick-summary">{round.map(g=><details key={g.material_id}><summary>{g.name} · {g.qty} {g.unit} · {g.order_count} คำขอ</summary>{g.lines.map(l=><p key={`${l.transaction_id}:${l.line_id}`}>{l.order_ref} · {l.qty} {g.unit}</p>)}</details>)}</div></>}
    {queue||role==='admin'?<CompactRequestList rows={displayRows.slice(current*25,(current+1)*25)} queue={queue} employee={employee} view={view} role={role} userId={userId} actionBusy={actionBusy} onAction={onAction}/>
      :<div className="grid-list">{displayRows.slice(current*25,(current+1)*25).map(r=><RequestCard key={r.id} r={r} queue={queue} employee={employee} view={view} role={role} userId={userId} actionBusy={actionBusy} onAction={onAction}/>)}</div>}
    {!state.busy&&!state.error&&!rows.length&&<p>ไม่มีคำขอในตัวกรองนี้</p>}
    {last>0&&<div className="inv-toolbar"><button disabled={!current} onClick={()=>setPage(current-1)}>ก่อนหน้า</button><span>หน้า {current+1}/{last+1}</span><button disabled={current===last} onClick={()=>setPage(current+1)}>ถัดไป</button></div>}
  </section>;
}

function RequestCard({r,queue,employee,view,role,userId,actionBusy,onAction,compact=false}) {
  return <article className={compact?'inv-request-detail':'inv-card'} id={compact?`request-detail-${r.id}`:undefined}><h3>{r.order_ref}</h3><p>{r.model_name} · {r.category}</p><span className={'inv-status '+r.workflow_state}>{employee?employeeStatus(r):WORKFLOW_LABELS[r.workflow_state]||r.workflow_state}</span>
      <details open={compact||undefined}><summary>รายละเอียดคำขอ</summary><p>{r.staff_name} · {new Date(r.created_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})}</p><p>ทั้งหมด {r.total_lines} · หยิบแล้ว {r.picked_lines} · ค้าง {r.actionable_pending_lines ?? r.pending_lines}</p>{r.note&&<p>{r.note}</p>}
      {!queue&&<><h4>วันที่เบิกจริง</h4>{(r.issue_times||[]).length?r.issue_times.map((at,i)=><p key={i}>{new Date(at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})}</p>):<p>ไม่มีหลักฐานวันเบิกในบัญชี V2</p>}</>}
      {r.accounting_evidence==='unverified'&&<p>ยืนยันว่าผลิตและส่งแล้ว แต่หลักฐานการตัดสต๊อกเดิมยังไม่ยืนยัน เก็บข้อมูลเดิมไว้</p>}
      <h4>วัตถุดิบที่บันทึกไว้</h4>{(queue?manualPendingLines(r):r.bom_snapshot||[]).map((b,i)=><p key={b.line_id||i}>{b.material_name} · {b.qty} {b.unit} · {r.workflow_state==='legacy_completed_shipped'?'Historical snapshot; issue unverified':b.picked?'เบิกแล้ว':b.requires_picking===false?'อัตโนมัติเมื่อเบิกครบ':'รอหยิบ'}</p>)}</details>
      {!queue&&(!employee||view==='active')&&(cancelEligibility(r,role,userId)?<p className="inv-muted">{cancelEligibility(r,role,userId)}</p>:<button disabled={actionBusy} onClick={()=>onAction({kind:'cancel',row:r})}>{Number(r.picked_lines)>0?'ยกเลิกและคืนเต็มจำนวน':'ยกเลิกคำขอ'}</button>)}
      {!queue&&canCloseNotCompleted(r,role)&&<button disabled={actionBusy} onClick={()=>onAction({kind:'close_not_completed',row:r})}>ผลิตไม่สำเร็จ / คืนตามจริง</button>}
      {r.closure_kind==='production_not_completed'&&<div><p>ปิดงานแล้ว — ไม่รวมเป็นผลิตสำเร็จ</p>{(r.return_summary||[]).map(line=>{const b=r.bom_snapshot?.find(x=>x.line_id===line.line_id);return <p key={line.line_id}>{b?.material_name} · คืนจริง {line.returned_qty} · ใช้ไป/ไม่คืน {line.consumed_qty} {b?.unit}</p>;})}</div>}
    </article>;
}
export function CompactRequestList({rows,queue=false,...detailProps}) {
  const [selectedId,setSelectedId]=useState(null);
  const groups=queue?pendingWorkerGroups(rows):[{key:'all',name:'ทุกหมวดสินค้า',rows}];
  return <div className="inv-compact-requests">{groups.map(group=>{
    const selected=group.rows.find(r=>r.id===selectedId);
    return <section className="inv-request-group" key={group.key} aria-label={group.name}>
      <div className="inv-request-group-heading"><h3>{group.name}</h3><span>แสดง {group.rows.length} คำขอ</span></div>
      <ul className="inv-order-references" aria-label="ออเดอร์">{group.rows.map((r,index)=><li key={r.id}>
        <button type="button" aria-expanded={selectedId===r.id} aria-controls={selectedId===r.id?`request-detail-${r.id}`:undefined}
          aria-label={`${r.order_ref} · ${r.model_name} · ${r.category}`} onClick={()=>setSelectedId(selectedId===r.id?null:r.id)}>{r.order_ref}</button>{index<group.rows.length-1&&<span aria-hidden="true">,</span>}
      </li>)}</ul>
      {selected&&<RequestCard r={selected} queue={queue} compact {...detailProps}/>}
    </section>;
  })}</div>;
}
