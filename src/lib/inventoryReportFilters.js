import {requestRows,requirementRows,allocationRows,movementRows,materialActivity,PRODUCT_CATEGORIES,inPeriod,validatePeriod} from './inventoryReports.js';
export const REPAIR_CATEGORY='ซ่อมและอื่นๆ';
export function reportProjection(data,from,to,{category='',status='',search='',material=''}={}) {
 if(Array.isArray(data.categoryUsage)) {
  if(status||search.trim())throw new Error('Request filters are unavailable for Purchasing');
  const allocations=data.categoryUsage.filter(a=>(!category||a.category===category)&&(!material||a.material_id===material));
  const scoped=Boolean(category);
  const moves=scoped?allocations.map(a=>({...a,id:JSON.stringify([a.sequence_no,a.category,a.model_id,a.model_name]),delta:a.allocated_delta,qty_before:null,qty_after:null}))
   :movementRows(data.movements,from,to).filter(m=>!material||m.material_id===material);
  const balances=scoped?materialActivity(moves,from,to).map(a=>({...a,id:a.material_id,name:a.material_name,opening:null,closing:null,purchase:null,opening_additions:null,adjustment_in:null,adjustment_out:null,coverage:'category_usage_only'}))
   :data.balances.filter(b=>!material||b.id===material);
  return {rows:[],requirements:[],allocations,moves,balances,scoped};
 }
 const match=r=>(!category||r.category===category)&&(!status||r.workflow_state===status)
  && `${r.order_ref||''} ${r.model_name||''} ${r.category||''}`.toLowerCase().includes(search.trim().toLowerCase());
 const matching=data.requests.filter(match);const ids=new Set(matching.map(r=>r.id));
 const rows=requestRows(matching,from,to);
 const requirements=requirementRows(matching,from,to);
 const scoped=Boolean(category||status||search.trim());
 const allocations=allocationRows(data.movements,data.requests,from,to).filter(a=>(!scoped||ids.has(a.request_id))&&(!material||a.material_id===material));
 // A movement can span many orders/categories. Sum ONLY selected allocations.
 // Never label the full movement delta or shared stock balance as category stock.
 const moves=scoped?allocations.map(a=>({...a,id:a.movement_id,delta:a.allocated_delta,reference:a.order_ref,qty_before:null,qty_after:null}))
  :movementRows(data.movements,from,to).filter(m=>!material||m.material_id===material);
 const activity=materialActivity(moves,from,to);
 const balances=scoped?activity.map(a=>({...a,id:a.material_id,name:a.material_name,opening:null,closing:null,purchase:null,opening_additions:null,adjustment_in:null,adjustment_out:null,coverage:'category_usage_only'}))
  :data.balances.filter(b=>!material||b.id===material);
 return {rows,requirements,allocations,moves,balances,scoped};
}

// One request per category, regardless of how many allocations/partial picks it has.
// Status is current at capture, not a reconstruction of status on a historical date.
export function categoryOverview(requests,from,to,{basis='issued',category='',status='',search=''}={}) {
 validatePeriod(from,to);
 const groups=new Map([...PRODUCT_CATEGORIES,REPAIR_CATEGORY].map(category=>[category,{category,requests:0,completed:0,partially_picked:0,pending:0,cancelled:0,production_not_completed:0,legacy_completed_shipped:0}]));
 const seen=new Set();
 for(const r of requests){
  if(seen.has(r.id))throw new Error('Duplicate request in category overview');seen.add(r.id);
  if(category&&r.category!==category||status&&r.workflow_state!==status||!`${r.order_ref||''} ${r.model_name||''} ${r.category||''}`.toLowerCase().includes(search.trim().toLowerCase()))continue;
  const times=basis==='issued'?(r.issue_times||[]):[r.created_at];
  if(!times.some(at=>at&&inPeriod(at,from,to)))continue;
  const cat=r.category||'Unclassified';const g=groups.get(cat)||{category:cat,requests:0,completed:0,partially_picked:0,pending:0,cancelled:0,production_not_completed:0,legacy_completed_shipped:0};
  g.requests++;if(Object.hasOwn(g,r.workflow_state)&&r.workflow_state!=='requests')g[r.workflow_state]++;
  groups.set(cat,g);
 }
 return [...groups.values()].filter(g=>!category||g.category===category);
}
