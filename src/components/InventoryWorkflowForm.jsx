import React, {useEffect, useRef, useState} from 'react';
import {useInventoryOperation} from '../hooks/useInventoryOperation.js';
import {prepareWorkflow,workflowError} from '../lib/inventoryWorkflow.js';
import {buildPickRound,expandPickSelection} from '../lib/inventoryPickRound.js';
import {loadActiveModels,managementCatalog} from '../lib/inventoryModelCatalog.js';
import {loadAllMovements,returnableMaterials} from '../lib/inventoryReports.js';
function OperationResult({operation,onSuccess,onFailure}) {
  const state=useInventoryOperation(operation);const notified=useRef(false);
  useEffect(()=>{if(state.status==='succeeded'&&!notified.current){notified.current=true;onSuccess();}if(state.status==='failed'&&!notified.current){notified.current=true;onFailure(state.error);}},[state.status,state.error,onSuccess,onFailure]);
  return <div aria-live="polite">{state.loading&&<p>กำลังบันทึก กรุณารอ…</p>}{state.status==='succeeded'&&<p className="inv-success">บันทึกสำเร็จแล้ว{state.data?.completed?' — เบิกครบแล้ว':''}</p>}{state.error&&<p role="alert">{workflowError(state.error)}</p>}{state.storageError&&<p role="alert">ไม่สามารถเก็บสถานะการส่งในเครื่องได้ อย่าส่งรายการซ้ำ กรุณาตรวจสอบผลก่อน</p>}{state.status==='unknown'&&<p>ยังยืนยันผลไม่ได้ กลับไปตรวจสอบรายการค้างก่อนส่งอีกครั้ง</p>}</div>;
}
export function InventoryWorkflowForm({task,api,role,userId,profile,onClose,onSuccess}) {
  const [models,setModels]=useState([]);const [materials,setMaterials]=useState([]);const [preview,setPreview]=useState([]);const [returns,setReturns]=useState([]);
  const [catalogError,setCatalogError]=useState(null);const [catalogLoading,setCatalogLoading]=useState(true);const [previewLoading,setPreviewLoading]=useState(false);
  const [modelId,setModelId]=useState(task.model?.id||'');const [orderRef,setOrderRef]=useState('');const [repair,setRepair]=useState(Boolean(task.repair));const [note,setNote]=useState('');
  const [subtype,setSubtype]=useState('CIEM');const [bom,setBom]=useState([{material_id:'',qty:'1'}]);const [selected,setSelected]=useState([]);
  const [sending,setSending]=useState(false);const [operation,setOperation]=useState(null);const operationRef=useRef(null);const [error,setError]=useState(null);const [done,setDone]=useState(false);const [confirmedReturn,setConfirmedReturn]=useState(false);
  const issued=task.kind==='cancel'&&Number(task.row.picked_lines)>0;
  useEffect(()=>{let active=true;setCatalogLoading(true);async function load(){
    if(task.kind==='create'){const [m,s]=await Promise.all([loadActiveModels(),api.list_materials()]);if(active){setModels(m);setMaterials(s);}}
    if(issued&&role==='admin'){
      const history=await loadAllMovements(api);
      if(active)setReturns(returnableMaterials(history.rows,task.row.id));
    }
  }load().catch(e=>{if(active)setCatalogError(e.message);}).finally(()=>{if(active)setCatalogLoading(false);});return()=>{active=false;};},[task,api,issued,role]);
  useEffect(()=>{let active=true;setPreview([]);setPreviewLoading(false);if(!modelId||repair||task.kind!=='create')return;setPreviewLoading(true);managementCatalog.loadBom(modelId).then(rows=>{if(active)setPreview(rows);}).catch(e=>{if(active)setCatalogError(e.message);}).finally(()=>{if(active)setPreviewLoading(false);});return()=>{active=false;};},[modelId,repair,task.kind]);
  const [pickRound]=useState(()=>{try{return {groups:task.kind==='pick'?buildPickRound((task.rows||[task.row]).filter(Boolean)):[]};}catch(e){return {groups:[],error:e.message};}});
  function submit(e){e.preventDefault();if(operationRef.current)return;
    try{

      if(pickRound.error)throw new Error(pickRound.error);
      if(issued&&!confirmedReturn)throw new Error('กรุณายืนยันว่าได้รับวัตถุดิบคืนครบตามรายการจริง');
      const input=task.kind==='create'?{model_id:modelId,order_ref:orderRef,repair_spec:repair?{subtype,note,bom:bom.map(b=>({material_id:b.material_id,qty:b.qty}))}:null}
        :task.kind==='pick'?{items:expandPickSelection(pickRound.groups,selected)}:{reason:note,legacy_return_verified:false};
      const prepared=prepareWorkflow(api,task.kind,input,{role,userId,row:task.row,model:models.find(m=>m.id===modelId)});operationRef.current=prepared;setOperation(prepared);setError(null);setSending(true);prepared.execute().catch(()=>{}).finally(()=>setSending(false));
    }catch(e){setError(workflowError(e));}
  }
  const locked=Boolean(operation)||catalogLoading||previewLoading||Boolean(catalogError);
  return <section className="inv-form"><h2>{task.kind==='create'?'ยื่นคำขอเบิก':task.kind==='pick'?'เลือกบรรทัดที่หยิบจริง':issued?'ยกเลิกและคืนเต็มจำนวน':'ยกเลิกคำขอ'}</h2>
    <p className="inv-muted">ผู้รับผิดชอบ: {profile?.full_name||'บัญชีที่เข้าสู่ระบบ'}</p>
    {(catalogLoading||previewLoading)&&<p role="status">กำลังโหลดข้อมูล…</p>}{catalogError&&<p role="alert">{catalogError} กรุณาปิดแล้วเปิดใหม่</p>}
    <form onSubmit={submit}><fieldset disabled={locked}>
      {task.kind==='create'&&<><label><input type="checkbox" checked={repair} onChange={e=>setRepair(e.target.checked)}/> ซ่อมและอื่นๆ</label>
        <label>{!repair&&models.find(m=>m.id===modelId)?.category==='Universal'?'อ้างอิงงานแพ็ก (ไม่บังคับ)':'ออเดอร์ / เลขอ้างอิง'}<input required={repair||models.find(m=>m.id===modelId)?.category!=='Universal'} autoFocus value={orderRef} onChange={e=>setOrderRef(e.target.value)}/></label>
        {!repair?<><label>รุ่น<select required value={modelId} onChange={e=>setModelId(e.target.value)}><option value="">เลือกรุ่น</option>{models.map(m=><option key={m.id} value={m.id}>{m.name} · {m.category}</option>)}</select></label>
          <h3>วัตถุดิบตามรุ่น (ตัวอย่างก่อนส่ง)</h3>{preview.map(b=>{const m=materials.find(x=>x.id===b.material_id);return <p key={b.id}>{m?.name||'วัตถุดิบ'} · {b.qty} {m?.unit}</p>;})}<p className="inv-muted">ระบบจะบันทึก BOM ณ เวลาส่งคำขอ หากเป็นอัตโนมัติทั้งหมดจะเบิกทันที มิฉะนั้นรอหัวหน้าหยิบ</p></>
          :<><label>ประเภทงานซ่อม<select value={subtype} onChange={e=>setSubtype(e.target.value)}>{['CIEM','Tactical','Lifestyle','Sleepplug','อื่นๆ'].map(s=><option key={s}>{s}</option>)}</select></label><label>เหตุผล / หมายเหตุ<textarea required value={note} onChange={e=>setNote(e.target.value)}/></label>
            {bom.map((b,i)=><div className="inv-bom-line" key={i}><label>วัตถุดิบ<select required value={b.material_id} onChange={e=>setBom(rows=>rows.map((r,j)=>i===j?{...r,material_id:e.target.value}:r))}><option value="">เลือกวัตถุดิบ</option>{materials.filter(m=>m.is_active!==false).map(m=><option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}</select></label><label>จำนวน<input required type="number" min="0.000001" step="any" value={b.qty} onChange={e=>setBom(rows=>rows.map((r,j)=>i===j?{...r,qty:e.target.value}:r))}/></label><button type="button" disabled={bom.length===1} onClick={()=>setBom(rows=>rows.filter((_,j)=>i!==j))}>นำบรรทัดออก</button></div>)}<button type="button" onClick={()=>setBom(rows=>[...rows,{material_id:'',qty:'1'}])}>เพิ่มวัตถุดิบ</button></>}
      </>}
      {task.kind==='pick'&&<><p>รอบนี้รวมเฉพาะคำขอที่อยู่ในรายการ/ตัวกรองตอนเปิด เลือกวัตถุดิบที่หยิบจริง ระบบเก็บรายการแยกตามแต่ละงาน วัตถุดิบอัตโนมัติจะตัดเมื่อหยิบรายการด้วยมือครบ</p>{pickRound.error&&<p role="alert">{pickRound.error}</p>}{pickRound.groups.map(group=><div key={group.material_id}><label className="inv-pick-line"><input type="checkbox" checked={selected.includes(group.material_id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,group.material_id]:ids.filter(id=>id!==group.material_id))}/><span>{group.name} · {group.qty} {group.unit} · {group.order_count} งาน</span></label><details><summary>ดูรายละเอียดรายงาน</summary>{group.lines.map(line=><p key={`${line.transaction_id}:${line.line_id}`}>{line.order_ref} · {line.qty} {group.unit}</p>)}</details></div>)}</>}
      {task.kind==='cancel'&&<><p>{task.row.order_ref} · {task.row.model_name}</p><label>เหตุผล<textarea required value={note} onChange={e=>setNote(e.target.value)}/></label>
        {issued&&<><h3>ยอดที่จะคืนเข้าคลังเต็มจำนวน</h3>{returns.map(r=><p key={r.id}>{r.name} +{r.qty} {r.unit}</p>)}<p role="note">ใช้ได้เฉพาะเมื่อของจริงคืนครบทั้งหมด ยังไม่รองรับการปรับยอดคืนรายวัตถุดิบหรือบันทึกผลผลิตไม่สำเร็จแยกประเภท หากคืนไม่ครบ หยุดและแจ้งหัวหน้า</p><label><input required type="checkbox" checked={confirmedReturn} onChange={e=>setConfirmedReturn(e.target.checked)}/> ตรวจแล้ว ได้รับของคืนครบตามยอดข้างต้น</label></>}
      </>}
      <button className="inv-primary" type="submit" disabled={task.kind==='pick'&&!selected.length}>ยืนยัน</button>
    </fieldset></form>
    {error&&<p role="alert">{error}</p>}{operation&&<OperationResult operation={operation} onFailure={e=>{operationRef.current=null;setOperation(null);setError(workflowError(e));}} onSuccess={()=>{setDone(true);onSuccess();}}/>}
    <button disabled={sending} onClick={onClose}>{done?'เสร็จแล้ว':operation?'กลับไปตรวจสอบสถานะ':'ปิด'}</button>
    {operation&&!done&&<p className="inv-muted">อย่าส่งรายการเดิมใหม่ หน้าหลักจะตรวจสอบรายการค้างให้ก่อนทำงานต่อ</p>}
  </section>;
}
