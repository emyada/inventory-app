import { isDefinitiveFailure } from '../lib/inventoryFailure.js';
import React, { useEffect, useRef, useState } from 'react';
import { useInventoryOperation } from '../hooks/useInventoryOperation.js';
import { canManage, createManagementSubmission, isStaleStock, managementError } from '../lib/inventoryManagement.js';
import { managementCatalog } from '../lib/inventoryModelCatalog.js';

export const managementLabels = {create_material:'เพิ่มวัตถุดิบ',update_material:'แก้ไขวัตถุดิบ',
  set_material_active:'เปิด/ปิดวัตถุดิบ',receive_purchase:'รับของเข้า',receive_purchase_v21:'รับของเข้า',stocktake:'ตรวจนับ',
  save_model:'บันทึกรุ่นและ BOM',set_model_active:'เปิด/ปิดรุ่น'};
export function ReceiptFields({values,change}) { return <>
        <label>จำนวนรับเข้า *<input required inputMode="decimal" value={values.quantity} onChange={e=>change('quantity',e.target.value)}/></label>
        <label>ผู้ขาย / แหล่งที่ซื้อ<input maxLength={500} value={values.supplier_source} onChange={e=>change('supplier_source',e.target.value)}/></label>
        <label>ประเภทเอกสาร<select value={values.document_type} onChange={e=>change('document_type',e.target.value)}><option value="none">ไม่มีเอกสาร</option><option value="po">PO</option><option value="invoice">Invoice</option><option value="both">PO + Invoice</option></select></label>
        {['po','both'].includes(values.document_type)&&<label>เลข PO<input required maxLength={200} value={values.po_number} onChange={e=>change('po_number',e.target.value)}/></label>}
        {['invoice','both'].includes(values.document_type)&&<label>เลข Invoice<input required maxLength={200} value={values.invoice_number} onChange={e=>change('invoice_number',e.target.value)}/></label>}
        <label>หมายเหตุ<textarea value={values.note} onChange={e=>change('note',e.target.value)}/></label>
        <p>เลขรับเข้า: ระบบจะออกเลขเมื่อบันทึก</p>
      </>; }
function OperationStatus({operation}) {
  const state=useInventoryOperation(operation);
  return <div aria-live="polite">
    {state.loading && <p>กำลังส่งรายการ…</p>}
    {state.status==='succeeded' && <><p>บันทึกสำเร็จแล้ว</p>
      {state.data?.reference && <p role="status">เลขรับเข้า: <strong>{state.data.reference}</strong> {state.data.material_name} · {state.data.quantity} {state.data.unit}</p>}
      {state.data?.pending_request_count!==undefined && <p role="status">คำเตือน: รุ่นนี้มีงานค้าง {state.data.pending_request_count} งาน งานเดิมดำเนินต่อ/ยกเลิกได้ตามสิทธิ์เดิม</p>}
      {state.data?.qty_before!==undefined && <p>ผลจากระบบ: ก่อน {state.data.qty_before} → หลัง {state.data.qty_after} · ส่วนต่าง {state.data.delta ?? state.data.quantity}</p>}</>}
    {state.error && <><p role="alert">{managementError(state.error)}</p><details><summary>รายละเอียดสำหรับตรวจสอบ</summary><pre>{JSON.stringify({code:state.error.code,message:state.error.message,details:state.error.details,hint:state.error.hint},null,2)}</pre></details></>}
    {state.storageError && <p role="alert">{state.storageError.message}</p>}
  </div>;
}
export function InventoryManagementForm({task,api,role,onClose,onSuccess,catalog=managementCatalog,confirm: externalConfirm}) {
  const kind=task.kind; const [row,setRow]=useState(task.row);
  const [values,setValues]=useState({name:task.row?.name||'',unit:task.row?.unit||'',initial_qty:'0',
    low_stock_threshold:String(task.row?.low_stock_threshold??0),requires_picking:task.row?.requires_picking??true,
    is_active:!task.row?.is_active,reason:'',quantity:'',reference:'',note:'',counted_qty:'',supplier_source:'',document_type:'none',po_number:'',invoice_number:'',
    category:task.row?.category||task.category||'CIEM',bom:[]});
  const [materials,setMaterials]=useState([]);const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState(null);const [reload,setReload]=useState(0);
  const [error,setError]=useState(null);const [busy,setBusy]=useState(false);const [done,setDone]=useState(false);
  const [operation,setOperation]=useState(null);const submission=useRef(null);const gate=useRef(false);
  const [confirmation,setConfirmation]=useState(null);const confirmResolve=useRef(null);
  const confirm=message=>externalConfirm?externalConfirm(message):new Promise(resolve=>{confirmResolve.current=resolve;setConfirmation(message);});
  function answer(value){const resolve=confirmResolve.current;confirmResolve.current=null;setConfirmation(null);resolve?.(value);}
  useEffect(()=>()=>{confirmResolve.current?.(false);confirmResolve.current=null;},[]);
  async function loadMaterial(id) {
    const found=(await api.list_materials({include_inactive:true})).find(m=>m.id===id);
    if(!found)throw new Error('Material missing');return found;
  }
  useEffect(()=>{
    let active=true;setLoading(true);setLoadError(null);
    async function load() {
      if(!canManage(role,kind))throw new Error('ไม่มีสิทธิ์ทำรายการนี้');
      if(kind==='save_model'){
        const [m,b]=await Promise.all([api.list_materials({include_inactive:true}),task.row?.id?catalog.loadBom(task.row.id):Promise.resolve([])]);
        if(active){setMaterials(m);setValues(v=>({...v,bom:b.map(line=>({material_id:line.material_id,qty:String(line.qty)}))}));}
      }else if(task.row && kind!=='set_model_active'){
        const found=(await api.list_materials({include_inactive:true})).find(m=>m.id===task.row.id);
        if(!found)throw new Error('Material missing');
        if(active){setRow(found);setValues(v=>({...v,name:found.name,unit:found.unit,low_stock_threshold:String(found.low_stock_threshold),requires_picking:found.requires_picking,is_active:!found.is_active}));}
      }
    }
    load().catch(e=>{if(active)setLoadError(e);}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[api,kind,role,task.row,catalog,reload]);
  const change=(key,value)=>setValues(v=>({...v,[key]:value}));
  async function submit(event) {
    event.preventDefault();if(gate.current || operation)return;
    gate.current=true;setBusy(true);setError(null);
    try{
      const command=createManagementSubmission({api,kind,input:values,row,role,loadMaterial,
        onLatest:setRow,onPrepared:setOperation,confirm:({payload,row:latest})=>confirm(
          kind==='stocktake'?'ยืนยันตรวจนับ '+latest.name+' จำนวนที่นับได้ '+payload.counted_qty+' '+latest.unit+'? ระบบจะคำนวณส่วนต่างและบันทึกประวัติ'
          :kind==='save_model'?'ยืนยันแก้ BOM ของ '+payload.name+'? มีผลต่อคำขอใหม่ ประวัติเดิมไม่เปลี่ยน'
          :'ยืนยัน'+(payload.is_active?'เปิด':'ปิด')+'ใช้งาน '+(latest?.name||'รายการนี้')+'? เหตุผล: '+payload.reason)});
      submission.current=command;
      const result=await command.execute();
      if(!result?.cancelled){setDone(true);onSuccess();}
    }catch(e){setError(e);if(isDefinitiveFailure(e)){setOperation(null);submission.current=null;}}
    finally{gate.current=false;setBusy(false);}
  }
  const locked=loading||busy||Boolean(operation)||Boolean(loadError)||!canManage(role,kind);
  return <section aria-label={managementLabels[kind]} style={{border:'2px solid #888',padding:16,marginTop:12}}>
    <h2>{managementLabels[kind]} {row?.name}</h2>
    {kind==='save_model'&&values.category==='Universal'&&<p className="inv-notice">เตรียมรุ่นและ BOM เท่านั้น งานแพ็ก/ยอดสินค้าสำเร็จรูปยังไม่เปิดใช้ จนกว่าจะมีบัญชีเข้าออกที่ตรวจสอบได้</p>}
    {confirmation&&<div className="inv-confirm" role="alertdialog" aria-label="ยืนยันการบันทึก"><p>{confirmation}</p><button type="button" onClick={()=>answer(false)}>กลับไปแก้ไข</button><button type="button" className="inv-primary" onClick={()=>answer(true)}>ยืนยันบันทึก</button></div>}
    {loading && <p role="status">กำลังโหลดข้อมูลล่าสุด…</p>}
    {loadError && <><p role="alert">{managementError(loadError)}</p><button disabled={loading} onClick={()=>setReload(n=>n+1)}>โหลดใหม่</button></>}
    <form className="inv-form" onSubmit={submit}><fieldset disabled={locked}>
      {['create_material','update_material','save_model'].includes(kind) && <label>ชื่อ<input required value={values.name} onChange={e=>change('name',e.target.value)}/></label>}
      {kind==='create_material' && <><label>หน่วย<input required value={values.unit} onChange={e=>change('unit',e.target.value)}/></label>
        <label>จำนวนตั้งต้น<input required inputMode="decimal" value={values.initial_qty} onChange={e=>change('initial_qty',e.target.value)}/></label></>}
      {kind==='update_material' && <p>หน่วยเดิม: {row?.unit} (เปลี่ยนไม่ได้) · ยอดคงเหลือ {row?.qty}</p>}
      {['create_material','update_material'].includes(kind) && <><label>จุดเตือน<input required inputMode="decimal" value={values.low_stock_threshold} onChange={e=>change('low_stock_threshold',e.target.value)}/></label>
        <label>วิธีเบิกใช้<select value={String(values.requires_picking)} onChange={e=>change('requires_picking',e.target.value==='true')}><option value="true">ต้องหยิบ/ยืนยันโดยหัวหน้า</option><option value="false">ตัดใช้ตาม BOM อัตโนมัติ</option></select></label><p>ใช้กับคำขอใหม่เท่านั้น ไม่แก้ BOM Snapshot ของคำขอเดิม รายการอัตโนมัติตัดเมื่อหยิบด้วยมือครบ หากทั้งงานเป็นอัตโนมัติจะตัดตอนสร้างคำขอ</p></>}
      {kind==='receive_purchase_v21' && <ReceiptFields values={values} change={change}/>}
      {kind==='receive_purchase' && <><label>จำนวนรับเข้า<input required inputMode="decimal" value={values.quantity} onChange={e=>change('quantity',e.target.value)}/></label>
        <label>เอกสารอ้างอิง<input value={values.reference} onChange={e=>change('reference',e.target.value)}/></label>
        <label>หมายเหตุ<textarea value={values.note} onChange={e=>change('note',e.target.value)}/></label></>}
      {kind==='stocktake' && <><p>ยอดล่าสุด {row?.qty} {row?.unit}</p>
        <label>จำนวนที่นับได้จริง<input required inputMode="decimal" value={values.counted_qty} onChange={e=>change('counted_qty',e.target.value)}/></label>
        <p>หากยอดเปลี่ยนระหว่างนับ ระบบจะให้ตรวจยอดล่าสุดก่อนยืนยันใหม่</p></>}
      {['set_material_active','set_model_active'].includes(kind) && <p>ต้องการ{values.is_active?'เปิด':'ปิด'}ใช้งาน · ประวัติเดิมยังอ่านได้</p>}
      {['create_material','stocktake','set_material_active','set_model_active'].includes(kind) && <label>เหตุผล<textarea value={values.reason} onChange={e=>change('reason',e.target.value)}/></label>}
      {kind==='save_model' && <><label>หมวด<select value={values.category} onChange={e=>change('category',e.target.value)}>
        {[...new Set(['CIEM','Lifestyle','Sleepplug','Tactical','Universal',values.category])].filter(Boolean).map(c=><option key={c}>{c}</option>)}</select></label>
        <p>แก้ BOM สำหรับคำขอใหม่เท่านั้น สถานะเปิด/ปิดรุ่นไม่เปลี่ยน</p>
        {values.bom.map((b,i)=><div key={i}><label>วัตถุดิบ<select required value={b.material_id} onChange={e=>change('bom',values.bom.map((x,j)=>i===j?{...x,material_id:e.target.value}:x))}>
          <option value="">เลือกวัตถุดิบ</option>{materials.filter(m=>m.is_active||m.id===b.material_id).map(m=><option key={m.id} value={m.id} disabled={!m.is_active}>{m.name} ({m.unit}){!m.is_active?' — ปิดใช้งาน':''}</option>)}</select></label>
          <label>จำนวน<input required inputMode="decimal" value={b.qty} onChange={e=>change('bom',values.bom.map((x,j)=>i===j?{...x,qty:e.target.value}:x))}/></label>
          <button type="button" onClick={()=>change('bom',values.bom.filter((_,j)=>i!==j))}>เอาบรรทัดนี้ออกจาก BOM ที่กำลังแก้</button></div>)}
        <button type="button" onClick={()=>change('bom',[...values.bom,{material_id:'',qty:'1'}])}>เพิ่มบรรทัด BOM</button></>}
      <button type="submit">ตรวจและบันทึก</button>
    </fieldset></form>
    {busy && <p role="status">กำลังตรวจ/ส่งรายการ…</p>}
    {error && <p role="alert">{managementError(error)}{error.reloadError && ' · โหลดข้อมูลล่าสุดไม่สำเร็จ'}</p>}
    {isStaleStock(error) && <p>โหลดข้อมูลล่าสุด: {row?.qty} {row?.unit} กรุณาทบทวนการนับก่อนทำรายการต่อ</p>}
    {operation && <OperationStatus operation={operation}/>}
    {operation && !done && !busy && <p>ยังยืนยันผลไม่ได้ กรุณากลับไปตรวจสอบรายการค้างก่อนส่งซ้ำ</p>}
    <button disabled={busy} onClick={onClose}>{operation&&!done?'เปิดกู้รายการค้าง':done?'ปิดรายการที่สำเร็จแล้ว':'ปิดแบบฟอร์ม'}</button>
  </section>;
}
