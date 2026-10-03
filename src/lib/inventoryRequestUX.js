import {localDay, validatePeriod} from './inventoryReports.js';
import {prepareWorkflow} from './inventoryWorkflow.js';
export const closedRequest = r => Boolean(r.cancelled_at || r.closure_kind) || ['completed','cancelled','production_not_completed','legacy_completed_shipped'].includes(r.workflow_state);
export function filterRequests(rows,{view='all',search='',status='',from='',to='',dateBasis='created'}={}) {
 if(from&&to)validatePeriod(from,to);
 return rows.filter(r=>(view==='all'||(view==='history'?closedRequest(r):!closedRequest(r)))
  &&(!status||r.workflow_state===status)
  && `${r.order_ref||''} ${r.model_name||''} ${r.staff_name||''}`.toLowerCase().includes(search.trim().toLowerCase())
  &&(!(from||to)||(dateBasis==='issued'?(r.issue_times||[]):[r.created_at]).some(at=>(!from||localDay(at)>=from)&&(!to||localDay(at)<=to))));
}
export function employeeStatus(r) {
 if(r.cancelled_at||r.workflow_state==='cancelled')return 'ยกเลิกแล้ว';
 if(r.closure_kind==='production_not_completed'||r.workflow_state==='production_not_completed')return 'ปิดงาน / คืนวัสดุแล้ว';
 if(closedRequest(r))return 'เสร็จแล้ว';
 return r.workflow_state==='partially_picked'?'กำลังจัดของ':'รอหัวหน้าจัดของ';
}
export function sleepplugReferences(text) {
 const refs=String(text).split(/[\s,;]+/u).map(s=>s.trim()).filter(Boolean);
 if(!refs.length)throw new Error('กรุณาระบุรหัสออเดอร์');
 const seen=new Set();
 for(const ref of refs){const key=ref.toLowerCase();if(seen.has(key))throw new Error('มีรหัสออเดอร์ซ้ำ กรุณาตรวจรายการ');seen.add(key);}
 return refs;
}
// UI convenience only: each order has its own existing atomic/idempotent operation.
// A batch is NOT an atomic server transaction. Never continue after uncertain results.
export function createSleepplugBatch(api,text,context) {
 if(context.model?.category!=='Sleepplug'||!['staff','admin'].includes(context.role))throw new Error('ไม่รองรับรายการหลายออเดอร์นี้');
 const refs=sleepplugReferences(text);const listeners=new Set();let flight;
 let snapshot={loading:false,status:'idle',rows:refs.map(order_ref=>({order_ref,status:'waiting'}))};
 const publish=next=>{snapshot=next;listeners.forEach(fn=>fn());};
 function execute(){
  if(flight)return flight;
  flight=Promise.resolve().then(async()=>{
   publish({...snapshot,loading:true,status:'submitting'});
   for(let i=0;i<refs.length;i++){
    let op;
    try{
     op=prepareWorkflow(api,'create',{model_id:context.model.id,order_ref:refs[i],repair_spec:null},context);
     const result=await op.execute();
     if(op.getSnapshot().status!=='succeeded'||op.getSnapshot().storageError)throw new Error('ตรวจสอบผลก่อนส่งออเดอร์ถัดไป');
     publish({...snapshot,rows:snapshot.rows.map((r,j)=>j===i?{...r,status:'succeeded',result}:r)});
    }catch(error){
     publish({...snapshot,loading:false,status:'stopped',rows:snapshot.rows.map((r,j)=>j===i?{...r,status:op?.getSnapshot().status==='failed'?'failed':'review',error:error.message}:r)});
     return snapshot;
    }
   }
   publish({...snapshot,loading:false,status:'succeeded'});return snapshot;
  });
  return flight;
 }
 return {execute,getSnapshot:()=>snapshot,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
}

// Order codes have no global format contract. Flag obvious joined letter/number codes,
// never auto-split them by guessing a prefix or order length. All chips require review.
export function addOrderChips(existing,text) {
 const tokens=String(text).split(/[\s,;]+/u).map(s=>s.trim()).filter(Boolean);
 if(tokens.some(t=>/[\p{L}]+\d+[\p{L}]+\d+/u.test(t)))throw new Error('Possible joined order codes: separate each order before adding.');
 const seen=new Set(existing.map(s=>s.toLowerCase()));const next=[...existing];
 for(const t of tokens)if(!seen.has(t.toLowerCase())){seen.add(t.toLowerCase());next.push(t);}
 return next;
}
export const removeOrderChip=(chips,index)=>chips.filter((_,i)=>i!==index);
export function reviewedOrderChips(chips,draft,reviewed) {
 if(draft.trim())throw new Error('Add or clear the unfinished order code first.');
 if(!reviewed)throw new Error('Review the visible order list before confirming.');
 return sleepplugReferences(chips.join('\n'));
}
