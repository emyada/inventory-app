import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertCategoryReconciliation,loadCategoryUsage,movementRows,sumAmounts,negative,requestRows,requirementRows,modelSummary,allocationRows,materialActivity,balanceMismatches,loadAllRequests,loadAllMovements,loadReportData,reportCSV,returnableMaterials,workspaceTabs,PRODUCT_CATEGORIES} from './inventoryReports.js';
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
 let calls=0;const api={list_my_requests:()=>assert.fail('forbidden read'),list_movements:async()=>{calls++;return {rows:[],cutoff_sequence:0};},purchase_category_usage_report:async()=>({rows:[],cutoff_sequence:0,next_sequence:0,has_more:false}),balance_report:async()=>({materials:[]})};
 assert.deepEqual((await loadReportData(api,'purchasing',from,to)).requests,[]);assert.equal(calls,1);
 await assert.rejects(loadReportData(api,'staff',from,to));assert.equal(calls,1);
});
test('CSV preserves historical model IDs, all rows, decimal values and blocks formula strings',()=>{
 const text=reportCSV([{model_name:'=malicious',model_id:'historic',qty:'-0.25'}],[['model_name','Model'],['model_id','ID'],['qty','Delta']],{from,to});
 assert.ok(text.startsWith('\uFEFF'));assert.ok(text.includes("'=malicious"));assert.ok(text.includes('"historic","-0.25"'));assert.ok(text.includes(from));
});
test('workspace visibility and Universal metadata do not imply a finished-stock workflow',()=>{
 assert.deepEqual(workspaceTabs('staff'),['floor','requests']);assert.deepEqual(workspaceTabs('purchasing'),['materials','report']);assert.deepEqual(workspaceTabs('unknown'),[]);assert.ok(PRODUCT_CATEGORIES.includes('Universal'));
 const ui=readFileSync('src/components/InventoryWorkspacePanels.jsx','utf8');assert.ok(ui.includes("...PRODUCT_CATEGORIES"));
 const shell=readFileSync('src/views/InventoryV2.jsx','utf8');const reports=readFileSync('src/components/InventoryReports.jsx','utf8');
 assert.doesNotMatch(shell,/InventoryFinishedStock|issue_finished/);assert.doesNotMatch(reports,/InventoryFinishedReport/);
 assert.ok(ui.includes("onAction({kind:'create',model:m})"));
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

test('receipt metadata exports separately without changing historical receipt values',()=>{
 const old={...movement('manual','purchase','20',false),reference:'RCV-20260930-001',note:'original'};
 const documented={...old,id:'documented',reference:'RCV-20261001-1000',receipt_document:{supplier_source:'Shop',document_type:'both',po_number:'P1',invoice_number:'I1'}};
 const rows=movementRows([old,documented],'2026-09-01','2026-10-02');
 assert.equal(rows[0].reference,old.reference);assert.equal(rows[0].note,'original');assert.equal(rows[0].supplier_source,'');
 assert.equal(rows[1].po_number,'P1');assert.equal(rows[1].invoice_number,'I1');assert.equal(rows[1].delta,'20');
 const csv=reportCSV(rows,[['reference','RCV'],['supplier_source','Source'],['po_number','PO'],['invoice_number','Invoice']],{});
 assert.ok(csv.includes('P1'));assert.ok(csv.includes('RCV-20260930-001'));
});

test('Purchasing category pages share cutoff and allow several category rows at one sequence',async()=>{
 const a={sequence_no:2,category:'CIEM',model_id:'m',model_name:'Old name',material_id:'mat',reason:'production_issue',allocated_delta:'-2'};
 const calls=[];const api={purchase_category_usage_report:async p=>{calls.push(p);return calls.length===1?{rows:[a,{...a,category:'Sleepplug'}],cutoff_sequence:9,next_sequence:2,has_more:true}:{rows:[],cutoff_sequence:9,next_sequence:9,has_more:false};}};
 assert.equal((await loadCategoryUsage(api,from,to,9)).length,2);assert.equal(calls[1].after_sequence,2);assert.equal(calls[1].cutoff_sequence,9);
 await assert.rejects(loadCategoryUsage({purchase_category_usage_report:async()=>({rows:[],cutoff_sequence:10,next_sequence:0,has_more:false})},from,to,9));
 await assert.rejects(loadCategoryUsage({purchase_category_usage_report:async()=>({rows:[],cutoff_sequence:9,next_sequence:0,has_more:true})},from,to,9));
 await assert.rejects(loadCategoryUsage({purchase_category_usage_report:async()=>({rows:[a,a],cutoff_sequence:9,next_sequence:2,has_more:false})},from,to,9));
});

test('category projection reconciliation fails closed on missing, duplicated or foreign effects',()=>{
 const m={...movement('issue','production_issue','-3'),sequence_no:1,allocations:[{delta:'-2'},{delta:'-1'}]};
 const rows=[{sequence_no:1,allocated_delta:'-2'},{sequence_no:1,allocated_delta:'-1'}];
 assert.doesNotThrow(()=>assertCategoryReconciliation([m],rows,from,to));
 assert.throws(()=>assertCategoryReconciliation([m],rows.slice(0,1),from,to));
 assert.throws(()=>assertCategoryReconciliation([m],[...rows,rows[0]],from,to));
 assert.throws(()=>assertCategoryReconciliation([m],[{sequence_no:2,allocated_delta:'-3'}],from,to));
});

test('accepted V21 receipt survives normal history and Sheets CSV projection with metadata and Bangkok date',()=>{
 const movement={id:'9347327b-92bb-44ad-9739-217fc8552db1',operation_id:'e64ac16a-24a4-44de-9c1c-66955246dcb4',reference:'RCV-20261003-001',occurred_at:'2026-10-02T23:32:52.247995Z',reason:'purchase',delta:'0.25',qty_before:'2.75',qty_after:'3.00',version_before:5,version_after:6,actor_id:'a514aabb-f7b0-4fd8-81d7-74ce99bddf4a',note:'TEST-ONLY Receiving V2.1 Final UAT',receipt_document:{supplier_source:'TEST-ONLY Staging UAT',document_type:'none',po_number:null,invoice_number:null}};
 const rows=movementRows([movement],'2026-10-03','2026-10-03');assert.equal(rows.length,1);
 assert.equal(rows[0].document_type,'none');assert.equal(rows[0].supplier_source,'TEST-ONLY Staging UAT');
 assert.equal(rows[0].po_number,'');assert.equal(rows[0].invoice_number,'');assert.equal(rows[0].actor_id,movement.actor_id);
 assert.equal(movementRows([movement],'2026-10-02','2026-10-02').length,0);
 const csv=reportCSV(rows,[['reference','RCV'],['supplier_source','Source'],['document_type','Document'],['note','Note'],['delta','Quantity']],{timezone:'Asia/Bangkok'});
 assert.ok(csv.includes('RCV-20261003-001'));assert.ok(csv.includes('TEST-ONLY Receiving V2.1 Final UAT'));assert.ok(csv.includes('"0.25"'));
});
