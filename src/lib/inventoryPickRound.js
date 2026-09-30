import {sumAmounts} from './inventoryReports.js';
import {manualPendingLines} from './inventoryV2Reads.js';
const historical='5f2f513f-7f7f-4e93-8956-b36ad24df708';
// Freeze snapshot identities; never recalculate requirements from current material/BOM data.
export function buildPickRound(requests) {
 const groups=new Map(),seen=new Set();
 for(const r of requests){
  if(r.id===historical||r.can_pick===false||r.cancelled_at||['cancelled','production_not_completed','legacy_completed_shipped'].includes(r.workflow_state))continue;
  for(const line of manualPendingLines(r)){
   if(!r.id||!line.line_id||!line.material_id)throw new Error('Missing picking identity');
   const key=JSON.stringify([r.id,line.line_id]);if(seen.has(key))throw new Error('Duplicate picking line');seen.add(key);
   const g=groups.get(line.material_id)||{material_id:line.material_id,name:line.material_name,unit:line.unit,qty:'0',lines:[]};
   if(g.unit!==line.unit)throw new Error('Conflicting snapshot units');
   const qty=sumAmounts([line.qty]);if(qty==='0'||qty.startsWith('-'))throw new Error('Invalid picking quantity');
   g.qty=sumAmounts([g.qty,qty]);g.lines.push({transaction_id:r.id,line_id:line.line_id,order_ref:r.order_ref,qty});groups.set(line.material_id,g);
  }
 }
 return [...groups.values()].map(g=>({...g,order_count:new Set(g.lines.map(l=>l.transaction_id)).size}));
}
export function expandPickSelection(groups,selected){
 const ids=new Set(selected);if(ids.size!==selected.length||selected.some(id=>!groups.some(g=>g.material_id===id)))throw new Error('Invalid picking selection');
 return groups.filter(g=>ids.has(g.material_id)).flatMap(g=>g.lines.map(({transaction_id,line_id})=>({transaction_id,line_id})));
}
