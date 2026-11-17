import {isDefinitiveFailure} from '../lib/inventoryFailure.js';
import React,{useEffect,useRef,useState} from 'react';
import {Inbox} from 'lucide-react';
import {setRequestPolicy} from '../lib/inventoryRpcClient.js';
export function useRequestPolicy(api,revision){
 const [policy,setPolicy]=useState(null);
 useEffect(()=>{let alive=true,serial=0;const load=async()=>{const id=++serial;try{const p=await api.request_policy();if(alive&&id===serial)setPolicy(typeof p?.employee_requests_enabled==='boolean'?p:null);}catch{if(alive&&id===serial)setPolicy(null);}};
 load();const timer=setInterval(load,15000);window.addEventListener('focus',load);return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',load);};},[api,revision]);return policy;
}
export function RequestPolicySwitch({policy,disabled,onChanged}){
 const pending=useRef(null);const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function toggle(){if(busy)return;setBusy(true);setError('');try{
 pending.current ||= {p_operation_id:crypto.randomUUID(),p_enabled:!policy.employee_requests_enabled,p_expected_revision:policy.revision};
 await setRequestPolicy(pending.current);pending.current=null;onChanged();
 }catch(e){if(isDefinitiveFailure(e)){pending.current=null;onChanged();setError('สถานะเปลี่ยนหรือไม่มีสิทธิ์ กรุณาตรวจสถานะล่าสุด');}else setError('ยังไม่ยืนยันผล กดตรวจสอบ/ส่งซ้ำรายการเดิม');}finally{setBusy(false);}}
 const [open,setOpen]=useState(false),[confirm,setConfirm]=useState(false);
 const on=policy?.employee_requests_enabled===true;
 const label=policy?(on?'เปิดรับอยู่':'ปิดรับอยู่'):'ตรวจสอบไม่ได้';
 const resend=Boolean(pending.current);
 const act=async()=>{if(resend||confirm){setConfirm(false);await toggle();}else setConfirm(true);};
 return <>
  <button type="button" className="inv-hdr-icon" aria-label="รับคำขอใหม่จากพนักงาน" title={`รับคำขอใหม่จากพนักงาน: ${label}`} aria-expanded={open} onClick={()=>{setOpen(!open);setConfirm(false);}}>
   <Inbox size={18}/><span className={`inv-hdr-dot ${policy?(on?'on':'off'):'unknown'}`} aria-hidden="true"/></button>
  {open&&<div className="inv-hdr-panel inv-hdr-panel-sm"><button type="button" className="inv-hdr-close" aria-label="ปิด" onClick={()=>{setOpen(false);setConfirm(false);}}>✕</button>
   <h3>รับคำขอใหม่จากพนักงาน</h3><p>สถานะ: <strong>{label}</strong></p>
   {confirm&&<p>{on?'ปิดรับคำขอใหม่? พนักงานจะกดเบิกใหม่ไม่ได้ (รายการเดิมยังทำต่อได้)':'เปิดรับคำขอใหม่อีกครั้ง?'}</p>}
   <button type="button" disabled={disabled||busy||!policy} onClick={act}>{resend?'ตรวจสอบ / ส่งซ้ำรายการเดิม':confirm?(on?'ยืนยันปิดรับ':'ยืนยันเปิดรับ'):on?'ปิดรับคำขอใหม่':'เปิดรับคำขอใหม่'}</button>
   {confirm&&<button type="button" onClick={()=>setConfirm(false)}>ยกเลิก</button>}
   {error&&<p role="alert">{error}</p>}</div>}
 </>;
}
