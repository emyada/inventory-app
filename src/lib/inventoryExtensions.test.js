import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInventoryApi} from './inventoryApi.js';
import {createRecoveryInventory} from './inventoryRecovery.js';
import {prepareWorkflow,cancelEligibility} from './inventoryWorkflow.js';
import {canCloseNotCompleted,physicalReturnDefaults,prepareExtension} from './inventoryExtensions.js';
import {modelSummary,WORKFLOW_LABELS} from './inventoryReports.js';
const U='11111111-1111-4111-8111-111111111111',O='22222222-2222-4222-8222-222222222222';
const row={id:'request',inventory_version:1,workflow_state:'completed',returnable_lines:[{line_id:'line',material_id:'m',issued_qty:3,returnable_qty:'2.5'}],bom_snapshot:[{line_id:'line',material_name:'Historical',qty:99,unit:'g'}]};
test('Universal uses selected model, permits blank reference only for Universal, no pair scaling',()=>{
 const api={create_request:x=>x};const input={model_id:'u',order_ref:''};
 assert.deepEqual(prepareWorkflow(api,'create',input,{role:'staff',model:{id:'u',category:'Universal'}}),{model_id:'u',order_ref:'',repair_spec:null});
 for(const model of [undefined,{id:'u',category:'CIEM'},{id:'other',category:'Universal'}])assert.throws(()=>prepareWorkflow(api,'create',input,{role:'staff',model}));
 assert.throws(()=>prepareWorkflow(api,'create',input,{role:'purchasing',model:{id:'u',category:'Universal'}}));
});
test('actual returns default from allocations, never current or historical BOM requirements',()=>{
 assert.equal(physicalReturnDefaults(row)[0].quantity,'2.5');
 let sent;const api={close_not_completed:x=>{sent=x;return x;}};
 for(const quantity of ['0','0.25','2.5']){
  prepareExtension(api,'close_not_completed',{reason:' physical return ',returns:[{line_id:'line',quantity,material_id:'forged'}]},{role:'admin',row});
  assert.deepEqual(sent,{transaction_id:'request',reason:'physical return',returns:[{line_id:'line',quantity}]});
 }
 for(const quantity of ['','-1','2.6','NaN','Infinity'])assert.throws(()=>prepareExtension(api,'close_not_completed',{reason:'r',returns:[{line_id:'line',quantity}]},{role:'admin',row}));
 for(const returns of [[],[{line_id:'foreign',quantity:1}],[{line_id:'line',quantity:1},{line_id:'line',quantity:1}]])assert.throws(()=>prepareExtension(api,'close_not_completed',{reason:'r',returns},{role:'admin',row}));
});
test('typed closure/outflow role and closure guards remain separate from ordinary cancellation',()=>{
 for(const role of ['staff','purchasing']){assert.equal(canCloseNotCompleted(row,role),false);assert.throws(()=>prepareExtension({},'issue_finished',{reference:'r',note:'n'},{role,row:{request_id:'pack'}}));}
 assert.equal(canCloseNotCompleted({...row,inventory_version:0},'admin'),false);
 assert.equal(canCloseNotCompleted({...row,closure_kind:'production_not_completed'},'admin'),false);
 assert.ok(cancelEligibility({workflow_state:'production_not_completed'},'admin','a'));
 let payload;prepareExtension({issue_finished:x=>{payload=x;}},'issue_finished',{reference:' ref ',note:' note ',quantity:99},{role:'admin',row:{request_id:'pack'}});
 assert.deepEqual(payload,{packing_request_id:'pack',quantity:1,reference:'ref',note:'note'});
});
test('new RPC names/arguments are exact and mutation-disabled mode blocks before network',async()=>{
 const calls=[];const client={rpc:async(name,args)=>{calls.push({name,args});return {data:[],error:null};}};
 const readonly=createInventoryApi(client);for(const name of ['issue_finished','close_not_completed'])assert.throws(()=>readonly[name]({}));assert.equal(calls.length,0);
 await readonly.list_finished_stock();assert.deepEqual(calls[0],{name:'inventory_list_finished_stock',args:{}});
 await readonly.finished_balance_report({date_from:'2026-09-01',date_to:'2026-09-28',timezone:'Asia/Bangkok'});
 assert.equal(calls[1].name,'inventory_finished_balance_report');
 const api=createInventoryApi(client,{mutationsEnabled:true,uuid:()=>O});
 assert.throws(()=>api.close_not_completed({status:'forged'}));
 const op=api.issue_finished({packing_request_id:'pack',quantity:1,reference:'r',note:'n'});const a=op.execute();assert.equal(op.execute(),a);await a;
 assert.equal(calls.filter(x=>x.name==='inventory_issue_finished').length,1);
 assert.equal(calls.at(-1).args.p_operation_id,O);
});
test('lost new mutation response recovers through correct saved operation kind without another mutation',async()=>{
 for(const [rpc,kind,args] of [['issue_finished','finished_out',{packing_request_id:'p',quantity:1,reference:'r',note:'n'}],['close_not_completed','cancel_request',{transaction_id:'r',reason:'n',returns:[{line_id:'l',quantity:'0'}]}]]){
  const data=new Map();const storage={get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  let written=false,writes=0;const result={saved:true};
  const client={rpc:async(name)=>{if(name==='inventory_get_operation_result')return {data:written?{found:true,completed:true,kind,result}:{found:false,completed:false},error:null};writes++;written=true;throw new TypeError('response lost');}};
  const make=()=>createRecoveryInventory(client,{userId:U,currentUserId:()=>U,storage,uuid:()=>O,mutationsEnabled:true});
  await assert.rejects(make().api[rpc](args).execute());assert.equal(data.size,1);
  assert.deepEqual(await make().check(O),{state:'completed',result});assert.equal(writes,1);assert.equal(data.size,0);
 }
});
test('typed closure never counts as completed production',()=>{
 const totals=modelSummary([{model_id:'m',model_name:'Historical',category:'CIEM',status:'production_not_completed'}])[0];
 assert.equal(totals.completed,0);assert.equal(totals.production_not_completed,1);assert.ok(WORKFLOW_LABELS.production_not_completed);
});
