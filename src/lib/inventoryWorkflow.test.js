import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryApi as apiFactory } from './inventoryApi.js';
import { createOperationStore } from './inventoryOperation.js';
import { prepareWorkflow, cancelEligibility, workflowError } from './inventoryWorkflow.js';
const staff = { role:'staff', userId:'s' };
function fixture(response) {
  const calls=[]; let count=0;
  const api=createInventoryApi({rpc:async(name,args)=>{calls.push({name,args});return response(name,args,calls.length);}},
    {uuid:()=>`operation-${++count}`,operationStore:createOperationStore({storage:null})});
  return {api,calls};
}
test('create sends model/order only; server handles mixed/auto-only completion', async()=>{
  for(const completed of [false,true]) {
    const {api,calls}=fixture(async()=>({data:{transaction_id:'tx',completed},error:null}));
    const op=prepareWorkflow(api,'create',{model_id:'m',order_ref:' order ',staff_name:'forged',qty:99,picked:true},staff);
    assert.equal((await op.execute()).completed,completed);
    assert.deepEqual(calls[0].args,{p_model_id:'m',p_order_ref:'order',p_repair_spec:null,p_operation_id:'operation-1'});
    assert.equal(calls.length,1);
  }
});
test('duplicate/insufficient-stock create errors never mark success',async()=>{
  for(const message of ['Active order/category/model conflict','Insufficient stock']) {
    const {api}=fixture(async()=>({error:{code:'P0001',message},status:400}));
    const op=prepareWorkflow(api,'create',{model_id:'m',order_ref:'o'},staff);
    await assert.rejects(op.execute()); assert.equal(op.getSnapshot().status,'failed');
    assert.ok(workflowError(op.getSnapshot().error).includes(message));
  }
});
test('repair requires note and strips trusted fields from custom BOM',async()=>{
  const {api,calls}=fixture(async()=>({data:{completed:true},error:null}));
  assert.throws(()=>prepareWorkflow(api,'create',{order_ref:'o',repair_spec:{note:' ',bom:[]}},staff));
  await prepareWorkflow(api,'create',{order_ref:'o',repair_spec:{subtype:'CIEM',note:' test ',bom:[{material_id:'mat',qty:'0.25',picked:true}]}},staff).execute();
  assert.deepEqual(calls[0].args.p_repair_spec,{subtype:'CIEM',note:'test',bom:[{material_id:'mat',qty:'0.25'}]});
});
test('partial and last pick send exact UUID pairs only, with no automatic deduction call',async()=>{
  const {api,calls}=fixture(async()=>({data:{issued_lines:1},error:null}));
  for(const line_id of ['partial','last']) await prepareWorkflow(api,'pick',{items:[{transaction_id:'tx',line_id,qty:50,material_id:'ignored'}]},{role:'admin'}).execute();
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(c=>c.args.p_items),[[{transaction_id:'tx',line_id:'partial'}],[{transaction_id:'tx',line_id:'last'}]]);
  assert.ok(calls.every(c=>c.name==='inventory_confirm_pick'));
});
test('staff cancels own unpicked without time limit; picked/allocation needs admin',async()=>{
  const row={id:'t',created_by:'s',picked_lines:0,created_at:'2000-01-01',workflow_state:'pending'};
  const {api,calls}=fixture(async()=>({data:{cancelled:true},error:null}));
  await prepareWorkflow(api,'cancel',{reason:' reason '},{...staff,row}).execute();
  assert.equal(calls[0].args.p_transaction_id,'t');
  assert.throws(()=>prepareWorkflow(api,'cancel',{reason:'reason'},{...staff,row:{...row,picked_lines:1}}),/หัวหน้า/);
  assert.ok(cancelEligibility({...row,has_allocation:true},'staff','s'));
  assert.ok(cancelEligibility(row,'staff','other'));
  await prepareWorkflow(api,'cancel',{reason:'return'},{role:'admin',userId:'a',row:{...row,picked_lines:1}}).execute();
  assert.equal(calls[1].name,'inventory_cancel_request');
});
test('server can deny staff cancellation for unseen allocation',async()=>{
  const {api}=fixture(async()=>({error:{code:'P0001',message:'Only admin may cancel a request after any stock issue/allocation'},status:400}));
  const op=prepareWorkflow(api,'cancel',{reason:'reason'},{...staff,row:{id:'t',created_by:'s',picked_lines:0}});
  await assert.rejects(op.execute()); assert.match(workflowError(op.getSnapshot().error),/หัวหน้า/);
});
test('double click one RPC; response lost retry same operation UUID and payload',async()=>{
  const {api,calls}=fixture(async(_name,_args,n)=>{if(n===1)throw new Error('response lost');return {data:{transaction_id:'committed'},error:null};});
  const op=prepareWorkflow(api,'create',{model_id:'m',order_ref:'o'},staff);
  const first=op.execute(); assert.equal(op.execute(),first); await assert.rejects(first);
  assert.equal(calls.length,1); await op.retry(); assert.deepEqual(calls[0],calls[1]);
  assert.equal(op.getSnapshot().status,'succeeded');
});
function createInventoryApi(client,options={}) {return apiFactory(client,{mutationsEnabled:true,...options});}
