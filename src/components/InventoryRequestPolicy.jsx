import {isDefinitiveFailure} from '../lib/inventoryFailure.js';
import React,{useEffect,useRef,useState} from 'react';
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
 return <aside className="inv-environment">รับคำขอใหม่จากพนักงาน: {policy?(policy.employee_requests_enabled?'เปิด':'ปิด'):'ตรวจสอบไม่ได้'} <button disabled={disabled||busy||!policy} onClick={toggle}>{pending.current?'ตรวจสอบ / ส่งซ้ำรายการเดิม':policy?.employee_requests_enabled?'ปิดรับคำขอใหม่':'เปิดรับคำขอใหม่'}</button>{error&&<p role="alert">{error}</p>}</aside>;
}
