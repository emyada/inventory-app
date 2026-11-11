import {ReferenceHistory} from './ReferenceHistory.jsx';
import {attachRequestSettings,previewReference,requestReferenceContract} from '../lib/requestReferences.js';
import {MultiOrderDraft} from './MultiOrderDraft.jsx';
import {cancellationReasons,cancellationReason,hasIssuedStock,restorationWarning} from '../lib/inventoryCancellation.js';
import {InventoryOrderConfirmation} from './InventoryOrderConfirmation.jsx';
import {ModalHeader} from './InventoryUI.jsx';
import {X} from 'lucide-react';
import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {useInventoryOperation} from '../hooks/useInventoryOperation.js';
import {OrderChips} from './OrderChips.jsx';
import {createSleepplugBatch,createMultiOrderBatch,reviewedOrderChips} from '../lib/inventoryRequestUX.js';
import {prepareWorkflow,workflowError} from '../lib/inventoryWorkflow.js';
import {buildPickRound,expandPickSelection} from '../lib/inventoryPickRound.js';
import {loadActiveModels,managementCatalog} from '../lib/inventoryModelCatalog.js';
import {loadAllMovements,returnableMaterials} from '../lib/inventoryReports.js';
function OperationResult({operation,onSuccess,onFailure}) {
  const state=useInventoryOperation(operation);const notified=useRef(false);
  useEffect(()=>{if(state.status==='succeeded'&&!notified.current){notified.current=true;onSuccess();}if(state.status==='failed'&&!notified.current){notified.current=true;onFailure(state.error);}},[state.status,state.error,onSuccess,onFailure]);
  return <div aria-live="polite">{state.loading&&<p>กำลังบันทึก กรุณารอ…</p>}{state.status==='succeeded'&&<p className="inv-success">บันทึกสำเร็จแล้ว{state.data?.completed?' — เบิกครบแล้ว':''}</p>}{state.error&&<p role="alert">{workflowError(state.error)}</p>}{state.storageError&&<p role="alert">ไม่สามารถเก็บสถานะการส่งในเครื่องได้ อย่าส่งรายการซ้ำ กรุณาตรวจสอบผลก่อน</p>}{state.status==='unknown'&&<p>ยังยืนยันผลไม่ได้ กลับไปตรวจสอบรายการค้างก่อนส่งอีกครั้ง</p>}</div>;
}
function BatchResult({batch}) {
 const state=useSyncExternalStore(batch.subscribe,batch.getSnapshot,batch.getSnapshot);
 return <div aria-live="polite"><p>{state.loading?'กำลังส่งทีละออเดอร์…':state.status==='succeeded'?'ส่งครบแล้ว':'หยุดส่ง กรุณาตรวจสอบรายการที่ไม่สำเร็จก่อนทำต่อ'}</p>
 {state.rows.map(r=><p key={r.index??r.order_ref}>{r.model_name&&`${r.model_name} · `}{r.order_ref} — {{waiting:'ยังไม่ได้ส่ง',succeeded:'สำเร็จ',failed:'ไม่สำเร็จ',review:'รอตรวจสอบผล'}[r.status]}{r.error&&' · '+r.error}</p>)}
 <p>แต่ละออเดอร์บันทึกแยกกัน รายการที่สำเร็จแล้วจะไม่ส่งซ้ำ</p></div>;
}
function LegacyWorkflowForm({task,api,role,userId,profile,onClose,onSuccess,createBlocked=false}) {
  const [models,setModels]=useState(task.model?[task.model]:[]);const [materials,setMaterials]=useState([]);const [preview,setPreview]=useState([]);const [returns,setReturns]=useState([]);
  const [catalogError,setCatalogError]=useState(null);const [catalogLoading,setCatalogLoading]=useState(true);const [previewLoading,setPreviewLoading]=useState(false);
  const [modelId,setModelId]=useState(task.model?.id||'');const [orderRef,setOrderRef]=useState('');const repair=Boolean(task.repair);const [note,setNote]=useState('');
  const [subtype,setSubtype]=useState('CIEM');const [bom,setBom]=useState([{material_id:'',qty:'1'}]);const [selected,setSelected]=useState([]);
  const [sending,setSending]=useState(false);const [operation,setOperation]=useState(null);const operationRef=useRef(null);const [error,setError]=useState(null);const [done,setDone]=useState(false);const [confirmedReturn,setConfirmedReturn]=useState(false);
  const [batchMode,setBatchMode]=useState(false);const [batchRefs,setBatchRefs]=useState([]);const [batchDraft,setBatchDraft]=useState('');const [batchReviewed,setBatchReviewed]=useState(false);const [batch,setBatch]=useState(null);
  const [reasonCode,setReasonCode]=useState('');
  const [workMode,setWorkMode]=useState('bundled_package');
  const [requestContract,setRequestContract]=useState(null);
  const [multiMode,setMultiMode]=useState(false);const [multiRows,setMultiRows]=useState([{model_id:task.model?.id||'',order_ref:''}]);const [multiReviewed,setMultiReviewed]=useState(false);
  const issued=task.kind==='cancel'&&hasIssuedStock(task.row);
  useEffect(()=>{let active=true;setCatalogLoading(true);async function load(){
    if(task.kind==='create'){const [m,s]=await Promise.all([loadActiveModels().then(m=>attachRequestSettings(api,m)),api.list_materials()]);if(active){setModels(m);setRequestContract(m[0]?.request_contract||null);setMaterials(s);}}
    if(issued&&role==='admin'){
      const history=await loadAllMovements(api);
      if(active)setReturns(returnableMaterials(history.rows,task.row.id));
    }
  }load().catch(e=>{if(active)setCatalogError(e.message);}).finally(()=>{if(active)setCatalogLoading(false);});return()=>{active=false;};},[task,api,issued,role]);
  useEffect(()=>{let active=true;setPreview([]);setPreviewLoading(false);if(!modelId||repair||task.kind!=='create')return;setPreviewLoading(true);managementCatalog.loadBom(modelId).then(rows=>{if(active)setPreview(rows);}).catch(e=>{if(active)setCatalogError(e.message);}).finally(()=>{if(active)setPreviewLoading(false);});return()=>{active=false;};},[modelId,repair,task.kind]);
  const [pickRound]=useState(()=>{try{return {groups:task.kind==='pick'?buildPickRound((task.rows||[task.row]).filter(Boolean)):[]};}catch(e){return {groups:[],error:e.message};}});
  function submit(e){e.preventDefault();if(operationRef.current||batch)return;
    try{

      if(task.kind==='create'&&multiMode&&!repair){
       if(!multiReviewed)throw new Error('กรุณาตรวจทุกรายการก่อนส่ง');
       const run=createMultiOrderBatch(api,multiRows,{role,userId,models});
       operationRef.current=run;setBatch(run);setError(null);setSending(true);
       run.execute().then(result=>{setDone(result.status==='succeeded');onSuccess();}).finally(()=>setSending(false));return;
      }
      if(task.kind==='create'&&batchMode&&!repair&&models.find(m=>m.id===modelId)?.category==='Sleepplug'){
       const run=createSleepplugBatch(api,reviewedOrderChips(batchRefs,batchDraft,batchReviewed).join('\n'),{role,userId,model:models.find(m=>m.id===modelId)});
       operationRef.current=run;setBatch(run);setError(null);setSending(true);
       run.execute().then(result=>{setDone(result.status==='succeeded');onSuccess();}).finally(()=>setSending(false));return;
      }
      if(pickRound.error)throw new Error(pickRound.error);
      if(issued&&!confirmedReturn)throw new Error('กรุณายืนยันว่ารับทราบผลการคืนยอดทางบัญชี');
      const input=task.kind==='create'?{model_id:modelId,order_ref:orderRef,work_mode:models.find(m=>m.id===modelId)?.work_kind==='supplemental'?workMode:'standard',repair_spec:repair?{subtype,note,bom:bom.map(b=>({material_id:b.material_id,qty:b.qty}))}:null}
        :task.kind==='pick'?{items:expandPickSelection(pickRound.groups,selected)}:{reason:cancellationReason(reasonCode,note),legacy_return_verified:false};
      const prepared=prepareWorkflow(api,task.kind,input,{role,userId,requestContract,row:task.row,model:models.find(m=>m.id===modelId)});operationRef.current=prepared;setOperation(prepared);setError(null);setSending(true);prepared.execute().catch(()=>{}).finally(()=>setSending(false));
    }catch(e){setError(workflowError(e));}
  }
  const locked=(task.kind==='create'&&createBlocked)||Boolean(operation)||Boolean(batch)||catalogLoading||previewLoading||Boolean(catalogError);
  return <section className="inv-form"><ModalHeader title={task.kind==='create'?'ยื่นคำขอเบิก':task.kind==='pick'?'ยืนยันหยิบ':issued?'ยกเลิกและคืนเต็มจำนวน':'ยกเลิกคำขอ'} onClose={onClose} busy={sending}/>{task.kind==='create'&&!repair&&task.model&&<div className="inv-model-summary"><strong>{task.model.name}</strong><span>{task.model.category}</span></div>}
    <p className="inv-muted">ผู้รับผิดชอบ: {profile?.full_name||'บัญชีที่เข้าสู่ระบบ'}</p>
    {(catalogLoading||previewLoading)&&<p role="status">กำลังโหลดข้อมูล…</p>}{catalogError&&<p role="alert">{catalogError} กรุณาปิดแล้วเปิดใหม่</p>}
    <form onSubmit={submit}><fieldset disabled={locked}>
      {task.kind==='create'&&!repair&&<button type="button" aria-pressed={multiMode} onClick={()=>{setMultiMode(v=>!v);setMultiReviewed(false);}}>หลายออเดอร์ / หลายรุ่น</button>}
      {task.kind==='create'&&multiMode&&!repair&&<MultiOrderDraft rows={multiRows} onChange={setMultiRows} models={models} reviewed={multiReviewed} onReviewedChange={setMultiReviewed}/>}
      {task.kind==='create'&&(!multiMode||repair)&&<>{repair&&<p>ซ่อมและอื่นๆ</p>}
        {!repair&&models.find(m=>m.id===modelId)?.category==='Sleepplug'&&<button type="button" aria-pressed={batchMode} onClick={()=>setBatchMode(v=>!v)}>เพิ่มหลายออเดอร์พร้อมกัน</button>}
        {batchMode&&!repair&&models.find(m=>m.id===modelId)?.category==='Sleepplug'?<OrderChips values={batchRefs} onChange={setBatchRefs} draft={batchDraft} onDraftChange={setBatchDraft} reviewed={batchReviewed} onReviewedChange={setBatchReviewed}/>:
        <label>{!repair&&models.find(m=>m.id===modelId)?.category==='Universal'?'อ้างอิงงานแพ็ก (ไม่บังคับ)':'ออเดอร์ / เลขอ้างอิง'}<input required={(repair&&requestContract!==requestReferenceContract)||(!repair&&models.find(m=>m.id===modelId)?.category!=='Universal')} autoFocus value={orderRef} onChange={e=>setOrderRef(e.target.value)}/></label>}
        {!repair&&models.find(m=>m.id===modelId)?.work_kind==='supplemental'&&<label>ประเภท Package<select value={workMode} onChange={e=>setWorkMode(e.target.value)}><option value="bundled_package">Package ของออร์เดอร์ CIEM (ส่งก่อน CIEM ได้)</option><option value="standalone_package">ขายแยก — Others</option></select></label>}
        {!repair&&orderRef&&<p>อ้างอิงที่จะบันทึก: {(()=>{try{return previewReference(models.find(m=>m.id===modelId),orderRef).canonical;}catch(e){return e.message;}})()}</p>}
        {repair&&requestContract===requestReferenceContract&&<ReferenceHistory api={api} reference={orderRef} category={subtype}/>}
        {repair&&requestContract===requestReferenceContract&&<p>เลขอ้างอิงลูกค้าไม่บังคับ หากระบุจะเก็บเพื่อค้นประวัติ โดยไม่รวมเป็นออร์เดอร์ผลิตใหม่</p>}
        {!repair?<>{!task.model&&<label>รุ่น<select required value={modelId} onChange={e=>{setModelId(e.target.value);setBatchMode(false);setBatchReviewed(false);}}><option value="">เลือกรุ่น</option>{models.filter(m=>!task.model||m.category===task.model.category).map(m=><option key={m.id} value={m.id}>{m.name} · {m.category}</option>)}</select></label>}
          <details><summary>วัตถุดิบตามรุ่น</summary>{preview.map(b=>{const m=materials.find(x=>x.id===b.material_id);return <p key={b.id}>{m?.name||'วัตถุดิบ'} · {b.qty} {m?.unit}</p>;})}<p className="inv-muted">ระบบจะบันทึก BOM ณ เวลาส่งคำขอ การตัดสต็อกเป็นไปตามสัญญาเซิร์ฟเวอร์ที่ติดตั้ง ตรวจสอบสถานะคำขอหลังบันทึก</p></details></>
          :<><label>ประเภทงานซ่อม<select value={subtype} onChange={e=>setSubtype(e.target.value)}>{['CIEM','Tactical','Lifestyle','Sleepplug','อื่นๆ'].map(s=><option key={s}>{s}</option>)}</select></label><label>เหตุผล / หมายเหตุ<textarea required value={note} onChange={e=>setNote(e.target.value)}/></label>
            {bom.map((b,i)=><div className="inv-bom-line" key={i}><label>วัตถุดิบ<select required value={b.material_id} onChange={e=>setBom(rows=>rows.map((r,j)=>i===j?{...r,material_id:e.target.value}:r))}><option value="">เลือกวัตถุดิบ</option>{materials.filter(m=>m.is_active!==false).map(m=><option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}</select></label><label>จำนวน<input required type="number" min="0.000001" step="any" value={b.qty} onChange={e=>setBom(rows=>rows.map((r,j)=>i===j?{...r,qty:e.target.value}:r))}/></label><button type="button" disabled={bom.length===1} onClick={()=>setBom(rows=>rows.filter((_,j)=>i!==j))} aria-label="นำวัตถุดิบออก" title="นำออก"><X size={18}/></button></div>)}<button type="button" onClick={()=>setBom(rows=>[...rows,{material_id:'',qty:'1'}])}>เพิ่มวัตถุดิบ</button></>}
      </>}
      {task.kind==='pick'&&<><details><summary>ขอบเขตรอบหยิบ</summary><p>รวมคำขอในตัวกรองตอนเปิด วัตถุดิบอัตโนมัติตัดเมื่อหยิบด้วยมือครบ</p></details>{pickRound.error&&<p role="alert">{pickRound.error}</p>}{pickRound.groups.map(group=><div key={group.material_id}><label className="inv-pick-line"><input type="checkbox" checked={selected.includes(group.material_id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,group.material_id]:ids.filter(id=>id!==group.material_id))}/><span>{group.name} · {group.qty} {group.unit} · {group.order_count} งาน</span></label><details><summary>ออเดอร์ที่เกี่ยวข้อง</summary>{group.lines.map(line=><p key={`${line.transaction_id}:${line.line_id}`}>{line.order_ref} · {line.qty} {group.unit}</p>)}</details></div>)}</>}
      {task.kind==='cancel'&&<><p>{task.row.order_ref} · {task.row.model_name}</p><label>เหตุผล<select required value={reasonCode} onChange={e=>setReasonCode(e.target.value)}><option value="">เลือกเหตุผล</option>{cancellationReasons.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select></label><label>รายละเอียดเพิ่มเติม (ไม่บังคับ)<textarea value={note} onChange={e=>setNote(e.target.value)}/></label>
        {issued&&<><h3>ยอดที่จะคืนเข้าคลังเต็มจำนวน</h3>{returns.map(r=><p key={r.id}>{r.name} +{r.qty} {r.unit}</p>)}<p role="note">{restorationWarning}</p><label><input required type="checkbox" checked={confirmedReturn} onChange={e=>setConfirmedReturn(e.target.checked)}/> รับทราบการคืนยอดบัญชีและความเสี่ยงที่ยอดอาจต่างจากวัสดุจริง</label></>}
      </>}
      <button className="inv-primary" type="submit" disabled={task.kind==='pick'&&!selected.length}>{task.kind==='create'?'ยืนยันคำขอเบิก':task.kind==='pick'?'ยืนยันหยิบ':'ยืนยันยกเลิก'}</button>
    </fieldset></form>
    {batch&&<BatchResult batch={batch}/>}{error&&<p role="alert">{error}</p>}{operation&&<OperationResult operation={operation} onFailure={e=>{operationRef.current=null;setOperation(null);setError(workflowError(e));}} onSuccess={()=>{setDone(true);onSuccess();}}/>}
    {operation&&!done&&!sending&&<button onClick={onClose}>ตรวจสอบรายการค้าง</button>}
    {operation&&!done&&<p className="inv-muted">อย่าส่งรายการเดิมใหม่ หน้าหลักจะตรวจสอบรายการค้างให้ก่อนทำงานต่อ</p>}
  </section>;
}

export function InventoryWorkflowForm(props) {
 if(props.task.kind==='pick') return <InventoryOrderConfirmation {...props}/>;
 return <LegacyWorkflowForm {...props}/>;
}
