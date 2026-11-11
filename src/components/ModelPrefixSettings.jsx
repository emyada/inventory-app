import React,{useEffect,useRef,useState} from 'react';
import {requestReferenceContract} from '../lib/requestReferences.js';
export function ModelPrefixSettings({api,model,role}) {
 const [loaded,setLoaded]=useState(null),[prefix,setPrefix]=useState(''),[reason,setReason]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[submitted,setSubmitted]=useState(false);
 const operation=useRef(null);
 const eligible=role==='admin'&&model?.id&&['Sleepplug','Lifestyle'].includes(model.category);
 useEffect(()=>{if(!eligible)return;let live=true;
 api.request_reference_settings().then(r=>{if(!live)return;if(r.contract!==requestReferenceContract)throw Error('Backend prefix ยังไม่พร้อม');const item=r.models.find(m=>m.model_id===model.id);if(!item)throw Error('ไม่พบรุ่น');setLoaded(item);setPrefix(item.order_prefix??'');}).catch(e=>{if(live)setMessage(e.message);});return()=>{live=false;};
 },[api,model?.id,eligible]);
 if(!eligible)return null;
 async function submit(e){e.preventDefault();if(operation.current||!loaded)return;
  setBusy(true);setMessage('');
  try{const op=api.set_model_prefix({model_id:model.id,prefix,expected_revision:loaded.prefix_revision,reason:reason.trim()});operation.current=op;setSubmitted(true);
   await op.execute();setMessage('บันทึก prefix แล้ว มีผลกับคำขอใหม่เท่านั้น');
  }catch(e){setMessage(e.message+' — ตรวจรายการค้างก่อนส่งซ้ำ');}finally{setBusy(false);}
 }
 return <details><summary>Prefix ของรุ่น (Admin)</summary><form onSubmit={submit}><fieldset disabled={!loaded||busy||submitted}>
 <label>Prefix<select value={prefix} onChange={e=>setPrefix(e.target.value)}>{['','Z','ZG','PL','PN'].map(p=><option key={p} value={p}>{p||'ไม่มี prefix (ตัวเลขล้วน)'}</option>)}</select></label>
 <label>เหตุผล<input required value={reason} onChange={e=>setReason(e.target.value)}/></label><button type="submit">บันทึก Prefix แยกจาก BOM</button>
 </fieldset></form><p role="status">{message||(!loaded?'กำลังตรวจ backend…':'Staff จะกรอกเฉพาะตัวเลข เก็บ input เดิมและเลขเต็มแยกกัน')}</p></details>;
}
