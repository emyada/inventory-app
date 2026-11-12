import React,{useEffect,useRef,useState} from 'react';
import {orderRequirements,prepareOrderConfirmation} from '../lib/inventoryOrderConfirmation.js';
import {workflowError} from '../lib/inventoryWorkflow.js';
export function InventoryOrderConfirmation({task,api,role,onClose,onSuccess}) {
 const rows=(task.rows||[task.row]).filter(Boolean);
 const [id,setId]=useState(''),[materials,setMaterials]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[status,setStatus]=useState('');
 const operation=useRef(null);const flight=useRef(false);
 useEffect(()=>{let active=true;if(role!=='admin')return;
 api.list_materials().then(r=>{if(active)setMaterials(r);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[api,role]);
 if(role!=='admin')return <p role="alert">เฉพาะ Admin ยืนยันตัดสต็อก</p>;
 let required=[],problem='';try{if(id)required=orderRequirements(rows.find(r=>r.id===id),materials);}catch(e){problem=e.message;}
 const blocked=loading||Boolean(error)||Boolean(problem)||!required.length||required.some(r=>r.insufficient)||Boolean(status);
 async function confirm(){if(blocked||flight.current||operation.current)return;flight.current=true;setStatus('checking');
  try{const fresh=await api.list_materials();setMaterials(fresh);const need=orderRequirements(rows.find(r=>r.id===id),fresh);
   if(need.some(r=>r.insufficient))throw new Error('วัตถุดิบไม่พอ คำขอยังคงรออยู่');
   const op=prepareOrderConfirmation(api,rows,[id],role);operation.current=op;setStatus('submitting');
   await op.execute();const result=op.getSnapshot();setStatus(result.status);
   if(result.status==='succeeded')onSuccess();else setError(workflowError(result.error||new Error('ตรวจสอบรายการค้างด้วย UUID เดิมก่อนส่งซ้ำ')));
  }catch(e){setError(workflowError(e));setStatus(operation.current?'review':'');}finally{flight.current=false;}}
 return <section className="inv-form"><h2>Admin ยืนยันตัดสต็อกต่อออเดอร์</h2>
 <p>ตรวจวัสดุครบทั้งออเดอร์ก่อนยืนยัน ระบบตรวจยอดและสิทธิ์อีกครั้งบนเซิร์ฟเวอร์</p>
 <label>ออเดอร์<select value={id} disabled={Boolean(status)} onChange={e=>{setId(e.target.value);setError('');}}><option value="">เลือกหนึ่งออเดอร์</option>{rows.map(r=><option key={r.id} value={r.id}>{r.order_ref} · {r.model_name}</option>)}</select></label>
 {loading&&<p role="status">กำลังตรวจยอด…</p>}{(error||problem)&&<p role="alert">{error||problem}</p>}
 {required.map(r=><p key={r.id}>{r.name} · ต้องใช้ {r.required} {r.unit} · คงเหลือ {r.available??'ไม่ทราบ'} {r.insufficient?'— ไม่เพียงพอ / ตรวจสอบข้อมูล':''}</p>)}
 {id&&<details><summary>Allocation ของออเดอร์</summary>{rows.find(r=>r.id===id)?.bom_snapshot?.filter(b=>!b.picked).map(b=><p key={b.line_id}>{b.material_name} · {b.qty} {b.unit} · {b.line_id}</p>)}</details>}
 <button disabled={blocked} onClick={confirm}>ยืนยันทั้งออเดอร์</button><button disabled={['checking','submitting'].includes(status)} onClick={onClose}>ปิด / ตรวจสอบรายการค้าง</button>
 {status&&<p role="status">{status==='succeeded'?'บันทึกสำเร็จ':status==='submitting'||status==='checking'?'กำลังดำเนินการ…':'ตรวจสอบผลด้วยรายการค้างเดิม ห้ามสร้าง UUID ใหม่'}</p>}
 </section>;
}
