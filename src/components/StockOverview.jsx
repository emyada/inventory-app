import {useRefreshRead} from '../hooks/useRefreshRead.js';
import React,{useState} from 'react';
import {loadAllMovements,localDay} from '../lib/inventoryReports.js';
import {receivingRows,receivingType} from '../lib/receivingHistory.js';
import {CanonicalReports} from './CanonicalReports.jsx';
export function StockOverview({api,role,revision}) {
 const [data,setData]=useState(null),[error,setError]=useState(null),[reload,setReload]=useState(0);
 const [history,setHistory]=useState(false),[search,setSearch]=useState(''),[type,setType]=useState('All'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[page,setPage]=useState(0);
 const allowed=['admin','purchasing'].includes(role);
 useRefreshRead(()=>allowed?loadAllMovements(api):Promise.resolve(null),value=>{if(allowed){setData({api,revision,reload,value});setError(null);}},()=>setError({api,revision,reload}),[api,revision,reload,allowed]);
 if(!allowed)return null;
 const failed=error?.api===api&&error.revision===revision&&error.reload===reload;
 const ready=data?.api===api&&data.revision===revision&&data.reload===reload;
 let rows=[],invalid='';try{if(ready)rows=receivingRows(data.value.rows,history?{search,type,from,to}:{});}catch{invalid='กรุณาตรวจสอบช่วงวันที่ / ข้อมูลประวัติ';}
 const last=Math.max(0,Math.ceil(rows.length/20)-1),current=Math.min(page,last);
 const change=setter=>e=>{setter(e.target.value);setPage(0);};
 return <section aria-label="Stock Overview">
  <h2>ภาพรวมคลัง</h2>
  {!history&&<CanonicalReports api={api} role={role} revision={revision} compact/>}
  <div className="inv-toolbar"><h3>{history?'ประวัติรับเข้า':'รับเข้าล่าสุด 5 รายการ'}</h3><button onClick={()=>{setHistory(!history);setPage(0);}}>{history?'กลับภาพรวม':'ดูทั้งหมด — Receiving History'}</button></div>
  {history&&<div className="inv-filters"><label>ค้นหาประวัติ<input value={search} onChange={change(setSearch)} placeholder="วัตถุดิบ / อ้างอิง / ผู้บันทึกหรือ UUID"/></label><label>ประเภท<select aria-label="ประเภท" value={type} onChange={change(setType)}>{['All','Purchased','Returned to Stock'].map(t=><option key={t}>{t}</option>)}</select></label><label>จาก (Bangkok)<input type="date" value={from} onChange={change(setFrom)}/></label><label>ถึง (Bangkok)<input type="date" value={to} onChange={change(setTo)}/></label></div>}
  {failed?<p role="alert">โหลดประวัติไม่สำเร็จ <button onClick={()=>setReload(v=>v+1)}>ลองใหม่</button></p>:!ready?<p role="status">กำลังโหลดประวัติ…</p>:invalid?<p role="alert">{invalid}</p>:<>
   {!rows.length&&<p>ไม่มีประวัติรับเข้าตามตัวกรอง</p>}
   <div className="receiving-history">{rows.slice(history?current*20:0,history?current*20+20:5).map(r=><details className="inv-card" key={r.id}><summary>{r.material_name} · {r.delta} {r.unit} · {localDay(r.occurred_at)} · {receivingType(r)}</summary><dl>{[['อ้างอิง',r.reference],['ผู้บันทึก',r.actor_name||r.actor_id],['เวลา (Bangkok)',new Date(r.occurred_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})],['ผู้ขาย',r.receipt_document?.supplier_source],['PO',r.receipt_document?.po_number],['Invoice',r.receipt_document?.invoice_number],['หมายเหตุ',r.note],['Movement UUID',r.id]].map(([label,value])=><React.Fragment key={label}><dt>{label}</dt><dd>{value??'ไม่มีข้อมูลบันทึก'}</dd></React.Fragment>)}</dl></details>)}</div>
   {history&&<div className="inv-actions"><button disabled={!current} onClick={()=>setPage(current-1)}>ก่อนหน้า</button><span>{current+1} / {last+1} · {rows.length} รายการ</span><button disabled={current===last} onClick={()=>setPage(current+1)}>ถัดไป</button></div>}
  </>}
 </section>;
}
