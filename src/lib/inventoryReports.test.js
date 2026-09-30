import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sumAmounts,negative,requestRows,requirementRows,modelSummary,allocationRows,materialActivity,balanceMismatches,loadAllRequests,loadAllMovements,loadReportData,reportCSV,returnableMaterials,workspaceTabs,PRODUCT_CATEGORIES} from './inventoryReports.js';
import {prepareWorkflow,cancelEligibility} from './inventoryWorkflow.js';
const from='2026-09-01',to='2026-09-30';
const request={id:'r1',model_id:'model',model_name:'Historical one-side',category:'CIEM',order_ref:'ORDER',created_at:'2026-09-01T00:00:00Z',workflow_state:'completed',bom_snapshot:[{line_id:'line',material_id:'mat',material_name:'Liquid',unit:'ml',qty:'0.5',requires_picking:false,picked:true}]};
const movement=(id,reason,delta,allocation=true)=>({id,material_id:'mat',material_name:'Liquid',unit:'ml',reason,delta,occurred_at:'2026-09-02T00:00:00Z',allocations:allocation?[{transaction_id:'r1',line_id:'line',delta}]:[]});
test('decimal arithmetic preserves fractions, negatives, zero and scientific inputs',()=>{
 assert.equal(sumAmounts(['0.1','0.2']),'0.3');assert.equal(sumAmounts(['20','-2','2']),'20');assert.equal(sumAmounts(['1e-3','0.009']),'0.01');assert.equal(sumAmounts(['-2.5','2.5']),'0');assert.equal(negative('-0.25'),'0.25');assert.throws(()=>sumAmounts(['NaN']));
});
test('historical model counts are per request; cancelled excludes completion and no pair inference',()=>{
 const rows=requestRows([request,{...request,id:'r2',workflow_state:'cancelled'},{...request,id:'r3',model_name:'Renamed later',workflow_state:'pending'}],from,to);
 const groups=modelSummary(rows);assert.equal(groups.length,2);assert.deepEqual([groups[0].requests,groups[0].completed,groups[0].cancelled],[2,1,1]);
 const requirements=requirementRows([request],from,to);assert.equal(requirements[0].required_qty,'0.5');assert.equal(requirements[0].model_name,'Historical one-side');assert.equal(requirements[0].model_id,'model');
});
test('Bangkok period boundary follows request creation and excludes adjacent periods',()=>{
 assert.equal(requestRows([{...request,created_at:'2026-08-31T17:00:00Z'}],from,to).length,1);
 assert.equal(requestRows([{...request,created_at:'2026-09-30T17:00:00Z'}],from,to).length,0);
 assert.throws(()=>requestRows([],to,from));
});
test('actual usage and return preview derive from allocated movements, not current BOM',()=>{
 const moves=[movement('p','purchase','10',false),movement('i','production_issue','-0.75'),movement('r','cancellation_return','0.5')];
 const a=materialActivity(moves,from,to)[0];assert.deepEqual([a.purchase,a.issue,a.returned,a.net_usage,a.movement_count],['10','0.75','0.5','0.25',3]);
 assert.equal(returnableMaterials(moves,'r1')[0].qty,'0.25');assert.deepEqual(returnableMaterials(moves,'unrelated'),[]);
 const detail=allocationRows(moves,[request],from,to);assert.equal(detail.length,2);assert.equal(detail[0].model_name,request.model_name);assert.equal(sumAmounts(detail.map(r=>r.allocated_delta)),'-0.25');
 assert.throws(()=>returnableMaterials([movement('r','cancellation_return','2')],'r1'));
});
test('opening, purchases and stocktake adjustment reconcile without fabricated equal-count movement',()=>{
 const a=materialActivity([movement('o','opening_balance','2.5',false),movement('p','purchase','0.75',false),movement('s','stocktake_adjustment_out','-0.5',false)],from,to)[0];
 const b={id:'mat',name:'Liquid',coverage:'complete',opening:0,closing:'2.75',...a,movement_count:3};
 assert.deepEqual(balanceMismatches([b],[a]),[]);assert.ok(balanceMismatches([{...b,closing:3}],[a]).includes('Liquid: closing'));
 assert.ok(balanceMismatches([{...b,movement_count:4}],[a]).includes('Liquid: movement_count'));
 assert.ok(balanceMismatches([{...b,purchase:1}],[a]).length);assert.deepEqual(balanceMismatches([{...b,coverage:'before_coverage',opening:null,closing:null}],[a]),[]);
});
test('all movement pages share cutoff and duplicates fail closed',async()=>{
 const first=Array.from({length:500},(_,i)=>({id:String(i),sequence_no:i+1}));const calls=[];
 const out=await loadAllMovements({list_movements:async args=>{calls.push(args);return {cutoff_sequence:501,rows:calls.length===1?first:[{id:'last',sequence_no:501}]};}});
 assert.equal(out.rows.length,501);assert.equal(calls[1].cutoff_sequence,501);assert.equal(calls[1].after_sequence,500);
 await assert.rejects(loadAllMovements({list_movements:async()=>({cutoff_sequence:500,rows:first})}));
});
test('request export loads every page and rejects duplicate pages',async()=>{
 const batch=Array.from({length:500},(_,i)=>({...request,id:String(i)}));let calls=0;
 assert.equal((await loadAllRequests({list_my_requests:async args=>{calls++;if(calls===2){assert.equal(args.after_id,'499');return [];}return batch;}})).length,500);
 await assert.rejects(loadAllRequests({list_my_requests:async()=>batch}));
});
test('purchasing report never requests the admin/staff request RPC',async()=>{
 let calls=0;const api={list_my_requests:()=>assert.fail('forbidden read'),list_movements:async()=>{calls++;return {rows:[],cutoff_sequence:0};},balance_report:async()=>({materials:[]})};
 assert.deepEqual((await loadReportData(api,'purchasing',from,to)).requests,[]);assert.equal(calls,1);
 await assert.rejects(loadReportData(api,'staff',from,to));assert.equal(calls,1);
});
test('CSV preserves historical model IDs, all rows, decimal values and blocks formula strings',()=>{
 const text=reportCSV([{model_name:'=malicious',model_id:'historic',qty:'-0.25'}],[['model_name','Model'],['model_id','ID'],['qty','Delta']],{from,to});
 assert.ok(text.startsWith('\uFEFF'));assert.ok(text.includes("'=malicious"));assert.ok(text.includes('"historic","-0.25"'));assert.ok(text.includes(from));
});
test('workspace visibility and Universal metadata do not imply a finished-stock workflow',()=>{
 assert.deepEqual(workspaceTabs('staff'),['floor','requests']);assert.deepEqual(workspaceTabs('purchasing'),['materials','report']);assert.deepEqual(workspaceTabs('unknown'),[]);assert.ok(PRODUCT_CATEGORIES.includes('Universal'));
 const ui=readFileSync('src/components/InventoryWorkspacePanels.jsx','utf8');assert.ok(ui.includes("m.category==='Universal'"));
});
test('grouped pick submits UUID pairs only and cancellation/order reuse is left to server',()=>{
 let payload;const api={confirm_pick:p=>{payload=p;return {};},create_request:p=>p};
 prepareWorkflow(api,'pick',{items:[{transaction_id:'t',line_id:'l',qty:19}]},{role:'admin'});assert.deepEqual(payload,{items:[{transaction_id:'t',line_id:'l'}]});
 assert.ok(cancelEligibility({workflow_state:'cancelled'},'admin','a'));
 const input={model_id:'m',order_ref:' SAME '};assert.deepEqual(prepareWorkflow(api,'create',input,{role:'staff'}),{model_id:'m',order_ref:'SAME',repair_spec:null});
});
test('new report and workspace cannot write inventory directly or use editable BOM for history',()=>{
 for(const path of ['src/lib/inventoryReports.js','src/components/InventoryReports.jsx','src/components/InventoryWorkspacePanels.jsx']){
 const text=readFileSync(path,'utf8');assert.doesNotMatch(text,/\.(insert|update|delete|upsert|rpc)\(/);
 }
 assert.doesNotMatch(readFileSync('src/components/InventoryReports.jsx','utf8'),/loadBom|model_bom/);
});
