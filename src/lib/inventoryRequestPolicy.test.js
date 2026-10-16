import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {employeeMayCreate} from './inventoryRequestPolicy.js';
import {workflowError} from './inventoryWorkflow.js';
test('Staff fails closed; Admin switch exemption; Purchasing remains denied',()=>{for(const p of [null,{}, {employee_requests_enabled:false}]){assert.equal(employeeMayCreate('staff',p),false);assert.equal(employeeMayCreate('admin',p),true);}assert.equal(employeeMayCreate('staff',{employee_requests_enabled:true}),true);assert.equal(employeeMayCreate('purchasing',{employee_requests_enabled:true}),false);});
test('clear disabled error',()=>assert.match(workflowError(new Error('NEW_REQUESTS_DISABLED')),/รายการเดิม/));
test('SQL gate is create-only, locked, before insert; audited setter restricted',()=>{const sql=readFileSync('docs/phase3-request-switch-review/REQUEST_SWITCH.review.sql','utf8');assert.ok(sql.includes("pg_advisory_xact_lock(72401,1)"));assert.match(sql,/p_kind='create_request' AND r<>'admin'/);assert.match(sql,/employee_requests_enabled boolean NOT NULL DEFAULT true/);assert.match(sql,/IS DISTINCT FROM 'admin'/);assert.match(sql,/revision=p_expected_revision/);assert.match(sql,/RETURN a.result/);assert.match(sql,/ENABLE ROW LEVEL SECURITY/);assert.match(sql,/Source mismatch/);assert.match(sql,/inventory_retired_operation_ids/);assert.doesNotMatch(sql,/UPDATE public.materials|DELETE FROM|TRUNCATE/);});
test('UI only blocks create and polls/focus-refreshes',()=>{const form=readFileSync('src/components/InventoryWorkflowForm.jsx','utf8');assert.ok(form.includes("task.kind==='create'&&createBlocked"));const ui=readFileSync('src/components/InventoryRequestPolicy.jsx','utf8');assert.ok(ui.includes("setInterval(load,15000)"));assert.ok(ui.includes("addEventListener('focus',load)"));});
import {createSleepplugBatch} from './inventoryRequestUX.js';
import {createInventoryApi} from './inventoryApi.js';
import {createOperationStore} from './inventoryOperation.js';
const memoryStorage=()=>{const rows=new Map();return {get length(){return rows.size;},key:i=>[...rows.keys()][i],getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};};
test('OFF server denial stops Sleepplug after earlier successful order without retrying it',async()=>{
 const calls=[];const api=createInventoryApi({rpc:async(name,args)=>{calls.push(args);return calls.length===1?{data:{transaction_id:'first'},error:null}:{data:null,error:{code:'P0001',message:'NEW_REQUESTS_DISABLED'}};}},{mutationsEnabled:true,operationStore:createOperationStore({storage:memoryStorage()}),uuid:()=>crypto.randomUUID()});
 const batch=createSleepplugBatch(api,'one two three',{role:'staff',model:{id:'model',category:'Sleepplug'}});
 const result=await batch.execute();assert.equal(result.status,'stopped');assert.equal(calls.length,2);assert.deepEqual(result.rows.map(r=>r.status),['succeeded','failed','waiting']);assert.notEqual(calls[0].p_operation_id,calls[1].p_operation_id);
});
test('normal and repair server denial are terminal, not silently retried',async()=>{
 for(const repair_spec of [null,{subtype:'CIEM',note:'repair',bom:[{material_id:'m',qty:1}]}]){
 let calls=0;const api=createInventoryApi({rpc:async()=>{calls++;return {data:null,error:{code:'P0001',message:'NEW_REQUESTS_DISABLED'}};}},{mutationsEnabled:true,uuid:()=>crypto.randomUUID()});
 const op=api.create_request({model_id:repair_spec?null:'m',order_ref:'one',repair_spec});await assert.rejects(op.execute(),/NEW_REQUESTS_DISABLED/);await assert.rejects(op.retry());assert.equal(calls,1);
 }
});
