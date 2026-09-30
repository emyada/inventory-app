// Read-only report projections. Requirements never stand in for stock movements.
export const PRODUCT_CATEGORIES = ['CIEM', 'Tactical', 'Lifestyle', 'Sleepplug', 'Universal'];
export const WORKFLOW_LABELS = {legacy_completed_shipped:'Completed/shipped (legacy attestation)',pending:'รอหยิบ', partially_picked:'หยิบบางส่วน', completed:'เบิกครบแล้ว', cancelled:'ยกเลิกแล้ว', production_not_completed:'ผลิตไม่สำเร็จ / คืนแล้ว'};
export const MOVEMENT_LABELS = {opening_balance:'ยอดตั้งต้นเพิ่มเติม',purchase:'รับเข้า',production_issue:'เบิกออก',cancellation_return:'คืนจากการยกเลิก',stocktake_adjustment_in:'ปรับเพิ่มจากการนับ',stocktake_adjustment_out:'ปรับลดจากการนับ'};
export const workspaceTabs = role => role==='admin' ? ['floor','queue','materials','requests','report'] : role==='staff' ? ['floor','requests'] : role==='purchasing' ? ['materials','report'] : [];
function parts(value) {
  const match=/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if(!match) throw new Error('ข้อมูลจำนวนไม่ถูกต้อง ไม่สามารถสรุปรายงานได้');
  let scale=(match[3]||'').length-Number(match[4]||0);
  if(Math.abs(scale)>1000)throw new Error('จำนวนอยู่นอกขอบเขตรายงาน');
  let n=BigInt(match[2]+(match[3]||''))*(match[1]?-1n:1n);
  if(scale<0){n*=10n**BigInt(-scale);scale=0;}return {n,scale};
}
export function sumAmounts(values) {
  const numbers=values.map(parts); const scale=Math.max(0,...numbers.map(v=>v.scale));
  const total=numbers.reduce((a,v)=>a+v.n*10n**BigInt(scale-v.scale),0n);
  const sign=total<0n?'-':'';const digits=(total<0n?-total:total).toString().padStart(scale+1,'0');
  const text=scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits;
  return sign+(scale?text.replace(/\.?0+$/,''):text);
}
export const negative = value => sumAmounts([value])==='0'?'0':String(value).startsWith('-')?String(value).slice(1):'-'+value;
export function localDay(value) {
  const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new Error('วันที่ในรายงานไม่ถูกต้อง');
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
export function validatePeriod(from,to) {
  for(const s of [from,to])if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw new Error('กรุณาเลือกวันที่ให้ถูกต้อง');
  if(from>to)throw new Error('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด');
}
export const inPeriod=(date,from,to)=>localDay(date)>=from&&localDay(date)<=to;
export function requestRows(requests,from,to) {
  validatePeriod(from,to);
  return requests.filter(r=>inPeriod(r.created_at,from,to)).map(r=>({request_id:r.id,order_ref:r.order_ref,model_id:r.model_id,model_name:r.model_name,category:r.category,
    created_at:r.created_at,requester:r.staff_name,status:r.workflow_state,accounting_evidence:r.accounting_evidence||'',cancelled_at:r.cancelled_at||'',note:r.note||''}));
}
export function modelSummary(rows) {
  const groups=new Map();for(const r of rows){const key=JSON.stringify([r.model_id,r.model_name,r.category]);
    const g=groups.get(key)||{model_id:r.model_id,model_name:r.model_name,category:r.category,requests:0,legacy_completed_shipped:0,pending:0,partially_picked:0,completed:0,cancelled:0,production_not_completed:0};
    g.requests++;if(Object.hasOwn(g,r.status))g[r.status]++;groups.set(key,g);
  }return [...groups.values()];
}
export function requirementRows(requests,from,to) {
  const rows=requestRows(requests,from,to);const byId=new Map(rows.map(r=>[r.request_id,r]));
  return requests.filter(r=>byId.has(r.id)).flatMap(r=>(r.bom_snapshot||[]).map(line=>({...byId.get(r.id),line_id:line.line_id||'',material_id:line.material_id,material_name:line.material_name,unit:line.unit,required_qty:line.qty,requires_picking:line.requires_picking!==false,picked:line.picked===true})));
}
export function movementRows(movements,from,to) {
  validatePeriod(from,to);return movements.filter(m=>inPeriod(m.occurred_at,from,to)).map(({allocations: _allocations,...row})=>row);
}
export function allocationRows(movements,requests,from,to) {
  const byId=new Map(requests.map(r=>[r.id,r]));
  return movements.filter(m=>inPeriod(m.occurred_at,from,to)).flatMap(m=>(m.allocations||[]).map(a=>{
    const r=byId.get(a.transaction_id);return {movement_id:m.id,operation_id:m.operation_id,occurred_at:m.occurred_at,reason:m.reason,
      request_id:a.transaction_id,line_id:a.line_id,order_ref:a.order_ref||r?.order_ref||'',model_id:r?.model_id||'',model_name:r?.model_name||'',category:r?.category||'',
      material_id:m.material_id,material_name:m.material_name,unit:m.unit,allocated_delta:a.delta,actor_id:m.actor_id,legacy_verified:a.legacy_verified};
  }));
}
export function materialActivity(movements,from,to) {
  const groups=new Map();for(const m of movementRows(movements,from,to)){
    const g=groups.get(m.material_id)||{material_id:m.material_id,material_name:m.material_name,unit:m.unit,opening_additions:'0',purchase:'0',issue:'0',returned:'0',adjustment_in:'0',adjustment_out:'0',movement_count:0};
    const mapping={opening_balance:['opening_additions',false],purchase:['purchase',false],production_issue:['issue',true],cancellation_return:['returned',false],stocktake_adjustment_in:['adjustment_in',false],stocktake_adjustment_out:['adjustment_out',true]};
    const rule=mapping[m.reason];if(!rule)throw new Error('พบประเภทรายการที่รายงานยังไม่รองรับ');
    g[rule[0]]=sumAmounts([g[rule[0]],rule[1]?negative(m.delta):m.delta]);g.movement_count++;groups.set(m.material_id,g);
  }
  return [...groups.values()].map(g=>({...g,net_usage:sumAmounts([g.issue,negative(g.returned)])}));
}
export function balanceMismatches(balances,activity) {
  const byId=new Map(activity.map(r=>[r.material_id,r]));const errors=[];
  for(const b of balances){const a=byId.get(b.id);for(const key of ['opening_additions','purchase','issue','returned','adjustment_in','adjustment_out']){
    if(sumAmounts([b[key]??0])!==sumAmounts([a?.[key]??0]))errors.push(`${b.name}: ${key}`);
  }
  if(sumAmounts([b.movement_count??0])!==sumAmounts([a?.movement_count??0]))errors.push(`${b.name}: movement_count`);
  if(b.coverage==='complete' && sumAmounts([b.opening,b.opening_additions,b.purchase,negative(b.issue),b.returned,b.adjustment_in,negative(b.adjustment_out)])!==sumAmounts([b.closing]))errors.push(`${b.name}: closing`);
  }
  for(const a of activity)if(!balances.some(b=>b.id===a.material_id))errors.push(`${a.material_name}: missing balance`);
  return errors;
}
export async function loadAllRequests(api) {
  const rows=[];const seen=new Set();let cursor={};
  for(let page=0;page<1000;page++){
    const batch=await api.list_my_requests({...cursor,limit:500});if(!Array.isArray(batch))throw new Error('ข้อมูลคำขอไม่สมบูรณ์');
    for(const r of batch){if(seen.has(r.id))throw new Error('ข้อมูลคำขอซ้ำระหว่างโหลด กรุณาโหลดใหม่');seen.add(r.id);rows.push(r);}
    if(batch.length<500)return rows;const last=batch.at(-1);if(!last?.created_at||!last.id)throw new Error('ไม่สามารถอ่านหน้าถัดไป');cursor={after_at:last.created_at,after_id:last.id};
  }throw new Error('รายงานมีข้อมูลมากเกินขอบเขต หยุดโดยไม่ส่งออกรายงานบางส่วน');
}
export async function loadAllMovements(api) {
  const rows=[];const seen=new Set();let after=0,cutoff;
  for(let page=0;page<1000;page++){
    const result=await api.list_movements({after_sequence:after,...(cutoff===undefined?{}:{cutoff_sequence:cutoff}),limit:500});
    if(!Array.isArray(result?.rows)||!Number.isSafeInteger(result.cutoff_sequence)||result.cutoff_sequence<0)throw new Error('ข้อมูลประวัติไม่สมบูรณ์');
    if(cutoff!==undefined&&result.cutoff_sequence!==cutoff)throw new Error('ขอบเขตประวัติเปลี่ยน กรุณาโหลดใหม่');cutoff=result.cutoff_sequence;
    for(const r of result.rows){if(seen.has(r.id)||!Number.isSafeInteger(r.sequence_no)||r.sequence_no<=after||r.sequence_no>cutoff)throw new Error('ลำดับประวัติไม่ถูกต้อง');seen.add(r.id);rows.push(r);after=r.sequence_no;}
    if(result.rows.length<500)return {rows,cutoff};
  }throw new Error('ประวัติมากเกินขอบเขต หยุดโดยไม่ส่งออกบางส่วน');
}
export async function loadReportData(api,role,from,to) {
  if(!['admin','purchasing'].includes(role))throw new Error('ไม่มีสิทธิ์ดูรายงาน');validatePeriod(from,to);
  const [requests,movementData]=await Promise.all([role==='admin'?loadAllRequests(api):Promise.resolve([]),loadAllMovements(api)]);
  const balance=await api.balance_report({date_from:from,date_to:to,timezone:'Asia/Bangkok'});
  if(!Array.isArray(balance?.materials))throw new Error('ข้อมูลยอดคงเหลือไม่สมบูรณ์');
  const activity=materialActivity(movementData.rows,from,to);
  return {requests,movements:movementData.rows,balances:balance.materials,activity,cutoff:movementData.cutoff,capturedAt:new Date().toISOString(),mismatches:balanceMismatches(balance.materials,activity)};
}
// Formula-safe CSV. Human report names remain unchanged except dangerous spreadsheet prefixes.
export function reportCSV(rows,columns,meta) {
  const safe=value=>{let s=String(value??'');if(/^[\s]*[=+@-]/.test(s)&&!/^-[0-9]+(?:\.[0-9]+)?$/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const metadata=Object.entries(meta).map(([key,value])=>[key,value]);
  const keys=columns.map(c=>c[0]);return '\uFEFF'+[...metadata,[],columns.map(c=>c[1]),...rows.map(r=>keys.map(k=>r[k]))].map(row=>row.map(safe).join(',')).join('\r\n');
}

// Preview only: the server authorizes and calculates the actual full return.
export function returnableMaterials(movements,requestId) {
  const totals=new Map();
  for(const m of movements) for(const a of m.allocations||[]) if(a.transaction_id===requestId) {
    if(!['production_issue','cancellation_return'].includes(m.reason))throw new Error('Unexpected allocated movement');
    const row=totals.get(m.material_id)||{id:m.material_id,name:m.material_name,unit:m.unit,qty:'0'};
    row.qty=sumAmounts([row.qty,negative(a.delta)]);totals.set(m.material_id,row);
  }
  const rows=[...totals.values()];
  if(rows.some(r=>r.qty.startsWith('-')))throw new Error('Return history does not reconcile');
  return rows.filter(r=>r.qty!=='0');
}
