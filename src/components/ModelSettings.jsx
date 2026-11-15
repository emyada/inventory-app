import React,{useEffect,useRef,useState} from 'react';
import {requestReferenceContract} from '../lib/requestReferences.js';
export const prefixOptions=['','Z','ZG','PL','PN'];
export const prefixLabel=p=>p||'ไม่มี prefix (ตัวเลขล้วน)';
// Shared by "create model" (before the model exists) and "edit model" (ModelSettings below).
export function ModelTypeFields({prefix,isPackage,onPrefix,onPackage}) {
 return <>
  <label>ประเภทรุ่น<select value={isPackage?'package':'driver'} onChange={e=>onPackage(e.target.value==='package')}>
   <option value="driver">งานหลัก / Driver (ห้ามเลขออเดอร์ซ้ำในรุ่นเดียวกัน)</option>
   <option value="package">Package (ใช้เลขออเดอร์เดียวกับงานหลักได้)</option></select></label>
  {!isPackage&&<label>Prefix หน้าเลขออเดอร์<select value={prefix} onChange={e=>onPrefix(e.target.value)}>
   {prefixOptions.map(p=><option key={p} value={p}>{prefixLabel(p)}</option>)}</select></label>}
 </>;
}
export function ModelSettings({api,model,role}) {
 const [loaded,setLoaded]=useState(null),[prefix,setPrefix]=useState(''),[isPackage,setIsPackage]=useState(false),[reason,setReason]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[submitted,setSubmitted]=useState(false);
 const operation=useRef(null);
 const eligible=role==='admin'&&Boolean(model?.id)&&model.is_active!==false;
 useEffect(()=>{if(!eligible)return;let live=true;
  api.request_reference_settings().then(r=>{if(!live)return;if(r.contract!==requestReferenceContract)throw Error('Backend ยังไม่พร้อม');const item=r.models.find(m=>m.model_id===model.id);if(!item)throw Error('ไม่พบรุ่น');setLoaded(item);setPrefix(item.order_prefix??'');setIsPackage(item.work_kind==='supplemental');}).catch(e=>{if(live)setMessage(e.message);});return()=>{live=false;};
 },[api,model?.id,eligible]);
 if(!eligible)return null;
 async function submit(e){e.preventDefault();if(operation.current||!loaded)return;
  setBusy(true);setMessage('');
  try{const op=api.set_model_settings({model_id:model.id,prefix:isPackage?'':prefix,is_package:isPackage,expected_revision:loaded.prefix_revision,reason:reason.trim()});operation.current=op;setSubmitted(true);
   await op.execute();setMessage('บันทึกแล้ว มีผลกับคำขอใหม่เท่านั้น');
  }catch(e){setMessage(e.message+' — ตรวจรายการค้างก่อนส่งซ้ำ');}finally{setBusy(false);}
 }
 return <details><summary>ประเภทรุ่นและ Prefix (Admin)</summary><form onSubmit={submit}><fieldset disabled={!loaded||busy||submitted}>
  <ModelTypeFields prefix={prefix} isPackage={isPackage} onPrefix={setPrefix} onPackage={setIsPackage}/>
  <label>เหตุผล<input required value={reason} onChange={e=>setReason(e.target.value)}/></label><button type="submit">บันทึกประเภท/Prefix แยกจาก BOM</button>
 </fieldset></form><p role="status">{message||(!loaded?'กำลังตรวจ backend…':'พนักงานจะกรอกเฉพาะตัวเลข ระบบเติม prefix ให้ ถ้ามีคำขอค้างของรุ่นนี้จะเปลี่ยนประเภทไม่ได้')}</p></details>;
}
