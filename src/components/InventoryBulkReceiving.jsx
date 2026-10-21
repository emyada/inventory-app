import React,{useEffect,useRef,useState} from 'react';
import {ModalHeader} from './InventoryUI.jsx';
import {bulkPayload} from '../lib/inventoryBulkReceiving.js';
import {isDefinitiveFailure} from '../lib/inventoryFailure.js';
import './InventoryBulkReceiving.css';

export function InventoryBulkReceiving({api,role,onClose,onSuccess}) {
 const [catalog,setCatalog]=useState(null),[reload,setReload]=useState(0);
 const current=catalog?.api===api&&catalog?.role===role&&catalog?.reload===reload;
 const materials=current?catalog.rows:[],loading=role==='admin'&&!current,loadError=current?catalog.error:'';
 const [search,setSearch]=useState(''),[lines,setLines]=useState([]),[fields,setFields]=useState({supplier_source:'',document_type:'none',po_number:'',invoice_number:'',document_date:'',note:''});
 const [review,setReview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null),[pending,setPending]=useState(false);
 const operation=useRef(null),gate=useRef(false);
 useEffect(()=>{let alive=true;if(role!=='admin')return;Promise.resolve().then(()=>api.list_materials({include_inactive:false})).then(rows=>{if(alive)setCatalog({api,role,reload,rows:rows.filter(m=>m.is_active),error:''});}).catch(()=>{if(alive)setCatalog({api,role,reload,rows:[],error:'โหลดวัตถุดิบไม่สำเร็จ'});});return()=>{alive=false;};},[api,role,reload]);
 const change=(k,v)=>setFields(f=>({...f,[k]:v}));
 const editLine=(id,k,v)=>setLines(rows=>rows.map(l=>l.material_id===id?{...l,[k]:v}:l));
 const label=id=>materials.find(m=>m.id===id);
 function prepare(e){e.preventDefault();setError('');try{setReview(bulkPayload(role,lines,fields,materials));}catch(e){setError(e.message);}}
 async function submit(){
  if(gate.current||operation.current||!review||role!=='admin')return;
  gate.current=true;setBusy(true);setError('');
  try{operation.current=api.receive_purchase_batch(review,{intentKey:'bulk-receiving'});setPending(true);
   const saved=await operation.current.execute();setResult(saved);setPending(false);onSuccess();
  }catch(e){setError(isDefinitiveFailure(e)?'ระบบปฏิเสธรายการ ไม่ได้บันทึก กรุณาทบทวนข้อมูล':'ยังยืนยันผลไม่ได้ ห้ามส่งรายการใหม่ ให้ตรวจสอบรายการค้างด้วยรายการเดิม');
   if(isDefinitiveFailure(e)){operation.current=null;setPending(false);setReview(null);}
  }finally{gate.current=false;setBusy(false);}
 }
 if(role!=='admin')return <section><p role="alert">เฉพาะ Admin เท่านั้น</p><button onClick={onClose}>ปิด</button></section>;
 return <section className="inv-bulk"><ModalHeader title="Bulk Receiving — รับเข้าหลายรายการ" busy={busy} onClose={onClose}/>
  {loading&&<p role="status">กำลังโหลดวัตถุดิบ…</p>}
  {loadError&&<p role="alert">{loadError} <button onClick={()=>setReload(n=>n+1)}>โหลดใหม่</button></p>}
  {!review&&!result&&<form className="inv-form" onSubmit={prepare}><fieldset disabled={loading||busy||pending||Boolean(loadError)}>
   <label>ค้นหาวัตถุดิบ<input value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <label>เพิ่มวัตถุดิบ<select value="" onChange={e=>{const id=e.target.value;if(id)setLines(ls=>ls.some(l=>l.material_id===id)?ls:[...ls,{material_id:id,quantity:'',unit_purchase_price:''}]);}} disabled={lines.length>=100}>
    <option value="">เลือกวัตถุดิบ</option>{materials.filter(m=>m.name.toLowerCase().includes(search.toLowerCase())&&!lines.some(l=>l.material_id===m.id)).map(m=><option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
   </select></label>
   {lines.map(l=><div className="inv-bulk-line" key={l.material_id}><strong>{label(l.material_id)?.name} · {label(l.material_id)?.unit}</strong>
    <label>จำนวนรับเข้า *<input required inputMode="decimal" value={l.quantity} onChange={e=>editLine(l.material_id,'quantity',e.target.value)}/></label>
    <label>ราคาซื้อต่อหน่วย (ไม่บังคับ)<input inputMode="decimal" value={l.unit_purchase_price} onChange={e=>editLine(l.material_id,'unit_purchase_price',e.target.value)}/></label>
    <button type="button" onClick={()=>setLines(ls=>ls.filter(x=>x.material_id!==l.material_id))}>นำออก</button></div>)}
   <label>ผู้ขาย / แหล่งซื้อ<input maxLength={500} value={fields.supplier_source} onChange={e=>change('supplier_source',e.target.value)}/></label>
   <label>ประเภทเอกสาร<select value={fields.document_type} onChange={e=>change('document_type',e.target.value)}>{['none','po','invoice','both'].map((x,i)=><option key={x} value={x}>{['ไม่มีเอกสาร','PO','Invoice','PO + Invoice'][i]}</option>)}</select></label>
   {['po','both'].includes(fields.document_type)&&<label>เลข PO (ไม่บังคับ)<input maxLength={200} value={fields.po_number} onChange={e=>change('po_number',e.target.value)}/></label>}
   {['invoice','both'].includes(fields.document_type)&&<label>เลข Invoice (ไม่บังคับ)<input maxLength={200} value={fields.invoice_number} onChange={e=>change('invoice_number',e.target.value)}/></label>}
   <label>วันที่เอกสาร (ไม่บังคับ)<input type="date" value={fields.document_date} onChange={e=>change('document_date',e.target.value)}/></label>
   <label>หมายเหตุ<textarea maxLength={4000} value={fields.note} onChange={e=>change('note',e.target.value)}/></label>
   <p>ระบบออกเลข RCV เดียวเมื่อบันทึกสำเร็จ วันที่รับเข้าคือวันที่รับจริง ไม่ใช่วันที่เอกสาร</p>
   <button type="submit" disabled={!lines.length}>ตรวจสอบก่อนบันทึก</button>
  </fieldset></form>}
  {review&&!result&&<div><h3>ตรวจสอบ {review.lines.length} รายการ</h3><p>ผู้ขาย: {review.supplier_source||'—'} · เอกสาร: {review.document_type} · PO: {review.po_number||'—'} · Invoice: {review.invoice_number||'—'} · วันที่เอกสาร: {review.document_date||'—'}</p><p>{review.note}</p>
   <ul>{review.lines.map(l=><li key={l.material_id}>{label(l.material_id)?.name}: {l.quantity} {label(l.material_id)?.unit} · ราคาต่อหน่วย {l.unit_purchase_price??'ไม่ระบุ'}</li>)}</ul>
   <button disabled={busy||pending} onClick={()=>setReview(null)}>กลับไปแก้ไข</button> <button className="inv-primary" disabled={busy||pending} onClick={submit}>ยืนยันรับเข้าทั้งหมด</button>
  </div>}
  {busy&&<p role="status">กำลังบันทึก กรุณารอ…</p>}{error&&<p role="alert">{error}</p>}
  {pending&&!busy&&<button onClick={onClose}>ตรวจสอบ / ลองรายการเดิมผ่านรายการค้าง</button>}
  {result&&<div role="status"><h3>บันทึกสำเร็จ · {result.reference}</h3><p>วันที่รับเข้า {result.business_date}</p><ul>{result.lines?.map(l=><li key={l.material_id}>{l.material_name}: +{l.quantity} {l.unit} · {l.qty_before} → {l.qty_after}</li>)}</ul><p>ยอดหลังรายการเป็นยอด ณ เวลารับเข้า</p><button onClick={onClose}>เสร็จสิ้น</button></div>}
 </section>;
}
