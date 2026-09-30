import React,{useRef,useState,useEffect} from 'react';
import {useInventoryOperation} from '../hooks/useInventoryOperation.js';
import {physicalReturnDefaults,prepareExtension} from '../lib/inventoryExtensions.js';
import {workflowError} from '../lib/inventoryWorkflow.js';
function Result({operation,onSuccess,onFailure}) {
 const state=useInventoryOperation(operation);const notified=useRef(false);
 useEffect(()=>{if(notified.current)return;if(state.status==='succeeded'){notified.current=true;onSuccess();}else if(state.status==='failed'){notified.current=true;onFailure(state.error);}},[state.status,state.error,onSuccess,onFailure]);
 return <div aria-live="polite">{state.loading&&<p>กำลังบันทึก…</p>}{state.status==='succeeded'&&<p>บันทึกสำเร็จแล้ว</p>}{state.error&&<p role="alert">{workflowError(state.error)}</p>}{state.status==='unknown'&&<p>ยังยืนยันผลไม่ได้ ตรวจสอบรายการค้างก่อนส่งอีกครั้ง</p>}{state.storageError&&<p role="alert">บันทึกสถานะในเครื่องไม่ได้ อย่าส่งซ้ำ กรุณาตรวจสอบผลก่อน</p>}</div>;
}
export function InventoryExtensionForm({task,api,role,onClose,onSuccess}) {
 const closing=task.kind==='close_not_completed';
 const [initial]=useState(()=>{try{return {rows:closing?physicalReturnDefaults(task.row):[],error:null};}catch(e){return {rows:[],error:e.message};}});
 const [returns,setReturns]=useState(initial.rows);const [reason,setReason]=useState('');const [reference,setReference]=useState('');const [confirmed,setConfirmed]=useState(false);
 const [operation,setOperation]=useState(null);const flight=useRef(null);const [sending,setSending]=useState(false);const [error,setError]=useState(null);const [done,setDone]=useState(false);
 function submit(e){e.preventDefault();if(flight.current)return;try{
  if(!confirmed)throw new Error('กรุณายืนยันข้อมูลก่อนบันทึก');
  const op=prepareExtension(api,task.kind,{reason,returns,reference,note:reason},{role,row:task.row});
  flight.current=op;setOperation(op);setError(null);setSending(true);op.execute().catch(()=>{}).finally(()=>setSending(false));
 }catch(e){setError(e.message);}}
 return <section className="inv-form"><h2>{closing?'ผลิตไม่สำเร็จ / คืนตามจริง':'นำสินค้าสำเร็จรูปออก'}</h2><p>{task.row.model_name} {task.row.order_ref}</p>
 {initial.error&&<p role="alert">{initial.error}</p>}
 <form onSubmit={submit}><fieldset disabled={Boolean(operation)||Boolean(initial.error)||role!=='admin'}>
 {closing?<><p>ตรวจจำนวนที่คืนจริง ส่วนที่ไม่คืนยังนับเป็นใช้ไปแล้ว เมื่อยืนยันจะปิดงานและไม่รวมเป็นผลิตสำเร็จ</p>{returns.map(r=><label key={r.line_id}>{r.name} (คืนได้ {r.max} {r.unit})<input required type="number" min="0" max={r.max} step="any" value={r.quantity} onChange={e=>setReturns(rows=>rows.map(x=>x.line_id===r.line_id?{...x,quantity:e.target.value}:x))}/></label>)}</>:<><p>นำออก 1 ชิ้นจากงานแพ็กที่เลือก ไม่ใช่รายการขาย</p><label>อ้างอิง<input required value={reference} onChange={e=>setReference(e.target.value)}/></label></>}
 <label>{closing?'เหตุผล':'หมายเหตุ'}<textarea required value={reason} onChange={e=>setReason(e.target.value)}/></label>
 <label><input required type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{closing?'ตรวจยอดคืนจริงและยืนยันปิดงาน':'ยืนยันนำสินค้าสำเร็จรูปออก 1 ชิ้น'}</label><button className="inv-primary" type="submit">ยืนยัน</button>
 </fieldset></form>{error&&<p role="alert">{error}</p>}
 {operation&&<Result operation={operation} onFailure={e=>{flight.current=null;setOperation(null);setError(workflowError(e));}} onSuccess={()=>{setDone(true);onSuccess();}}/>}
 <button disabled={sending} onClick={onClose}>{done?'กลับรายการ':operation?'กลับไปตรวจสอบรายการ':'ปิด'}</button></section>;
}
