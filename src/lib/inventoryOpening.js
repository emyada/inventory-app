import {sumAmounts} from './inventoryReports.js';
import {rpcData,isDefinitiveFailure} from './inventoryFailure.js';
const actions=Object.freeze({save_opening_draft:['revision','manifest','counts'],finalize_opening_balance:['revision','manifest','confirmation'],activate_inventory:['finalized_operation_id','confirmation']});
export function openingCounts(materials,values) {
 const counts={};
 for(const material of materials){
  const raw=values[material.id];
  if(raw===undefined||raw===null||String(raw).trim()==='')continue;
  if(!/^(?:\d+)(?:\.\d+)?$/.test(String(raw).trim()))throw new Error('จำนวนต้องเป็นเลขศูนย์หรือเลขบวก');
  const number=Number(raw);
  if(!Number.isFinite(number)||number<0||number>Number.MAX_SAFE_INTEGER)throw new Error('จำนวนอยู่นอกช่วงที่รองรับ');
  if(sumAmounts([String(number)])!==sumAmounts([String(raw).trim()]))throw new Error('จำนวนมีทศนิยมละเอียดเกินกว่าจะบันทึกได้ตรง กรุณาตรวจสอบ');
  counts[material.id]=number;
 }
 return counts;
}
export function openingProgress(materials,values){const counts=openingCounts(materials,values);return {counts,entered:Object.keys(counts).length,total:materials.length,complete:materials.length>0&&Object.keys(counts).length===materials.length};}
export function normalInventoryEnabled(policy,status){return policy.mutationsEnabled===true&&status?.phase===4&&status?.active===true;}
// One durable intent per actor/project. This journal contains no credentials or sessions.
// An uncertain outcome must be resolved/retried using this UUID, never replaced.
export function createOpeningApi(client,{userId,projectRef,assertAccess,currentUserId,storage=globalThis.localStorage,uuid=()=>crypto.randomUUID()}={}){
 const key=`inventory.opening.v1:${projectRef}:${userId}`;let inFlight=null;
 async function access(){assertAccess();if(await currentUserId()!==userId)throw new Error('บัญชีผู้ใช้เปลี่ยน กรุณาโหลดใหม่');}
 function validate(row){if(!row||!actions[row.action]||!/^[0-9a-f-]{36}$/i.test(row.id)||!row.input||Object.keys(row.input).sort().join()!==[...actions[row.action]].sort().join())throw new Error('ข้อมูลรายการค้างไม่ถูกต้อง ต้องตรวจสอบก่อนดำเนินการ');return row;}
 function pending(){const raw=storage.getItem(key);return raw?validate(JSON.parse(raw)):null;}
 function clear(){storage.removeItem(key);if(storage.getItem(key)!==null)throw new Error('ยังล้างสถานะรายการที่ยืนยันแล้วไม่ได้ กรุณาโหลดใหม่');}
 function perform(row){
  if(inFlight)return inFlight;
  inFlight=(async()=>{await access();validate(row);const existing=pending();if(existing&&JSON.stringify(existing)!==JSON.stringify(row))throw new Error('ต้องตรวจสอบรายการค้างก่อน');
   storage.setItem(key,JSON.stringify(row));if(storage.getItem(key)!==JSON.stringify(row))throw new Error('บันทึกรายการก่อนส่งไม่ได้');
   const args=Object.fromEntries(Object.entries(row.input).map(([k,v])=>['p_'+k,v]));
   let result;try{result=rpcData(await client.rpc('inventory_'+row.action,{p_operation_id:row.id,...args}),{mutation:true});}catch(error){if(isDefinitiveFailure(error))clear();throw error;}
   clear();return result;
  })().finally(()=>{inFlight=null;});return inFlight;
 }
 return Object.freeze({pending,
  status:async()=>{await access();return rpcData(await client.rpc('inventory_setup_status',{}));},
  run:(action,input)=>{if(pending())throw new Error('ต้องตรวจสอบรายการค้างก่อน');return perform(validate({id:uuid(),action,input}));},
  retry:()=>{const row=pending();if(!row)throw new Error('ไม่มีรายการค้าง');return perform(row);},
  resolve:async()=>{await access();const row=pending();if(!row)return null;const result=rpcData(await client.rpc('inventory_get_operation_result',{p_operation_id:row.id}));
   const kinds={save_opening_draft:'opening_draft',finalize_opening_balance:'opening_balance',activate_inventory:'activate_inventory'};
   if(result.found){if(result.completed!==true||result.kind!==kinds[row.action]||!result.result)throw new Error('ผลรายการไม่ตรง ต้องตรวจสอบ');clear();return result.result;}
   return null;
  },
 });
}
