import {test} from 'node:test';import assert from 'node:assert/strict';
import {previewReference,attachRequestSettings,requestReferenceContract} from './requestReferences.js';
import {prepareWorkflow} from './inventoryWorkflow.js';
const model={id:'m',category:'Sleepplug',request_contract:requestReferenceContract,order_prefix:'ZG'};
test('configured prefix preserves zeros and raw input; rejects nonnumeric input',()=>{
 assert.deepEqual(previewReference(model,' 0001 '),{raw:' 0001 ',canonical:'ZG0001'});
 assert.throws(()=>previewReference(model,'Z1'));
 assert.throws(()=>previewReference({...model,order_prefix:null},'1'));
 assert.equal(previewReference({...model,order_prefix:''},'001').canonical,'001');
});
test('Repair optional reference uses modern contract and keeps manual quantities',()=>{
 let sent;const api={create_request_v2:p=>(sent=p)};
 prepareWorkflow(api,'create',{order_ref:'',repair_spec:{subtype:'CIEM',note:'repair',bom:[{material_id:'a',qty:'0.125',picked:true}]}},{role:'staff',requestContract:requestReferenceContract});
 assert.equal(sent.order_ref,'');assert.equal(sent.model_id,null);assert.deepEqual(sent.repair_spec.bom,[{material_id:'a',qty:'0.125'}]);
 assert.throws(()=>prepareWorkflow(api,'create',{order_ref:'',repair_spec:{note:'repair',bom:[]}},{role:'staff',requestContract:requestReferenceContract}));
});
test('Package can submit without primary UUID; standalone intent explicit',()=>{
 let sent;const api={create_request_v2:p=>(sent=p)};
 for(const work_mode of ['bundled_package','standalone_package']){
 prepareWorkflow(api,'create',{model_id:'m',order_ref:'001',work_mode},{role:'staff',model:{...model,category:'CIEM',order_prefix:null,work_kind:'supplemental'}});
 assert.equal(sent.work_mode,work_mode);assert.ok(!('primary_request_id' in sent));
 }
});
test('capability fails closed on errors; only absent RPC keeps legacy behavior',async()=>{
 assert.deepEqual(await attachRequestSettings({request_reference_settings:async()=>{throw {code:'PGRST202'};}},[model]),[model]);
 await assert.rejects(attachRequestSettings({request_reference_settings:async()=>{throw Error('network');}},[model]));
});

test('Package ignores unrelated model prefix and preserves numeric reference',()=>{
 assert.equal(previewReference({...model,work_kind:'supplemental'},'001').canonical,'001');
});

test('modern multi-order validates all numeric input before creating operations',async()=>{
 const {createMultiOrderBatch}=await import('./inventoryRequestUX.js');let calls=0;
 assert.throws(()=>createMultiOrderBatch({create_request_v2(){calls++;}},[{model_id:'m',order_ref:'001'},{model_id:'m',order_ref:'ZG2'}],{role:'staff',models:[model]}));
 assert.equal(calls,0);
});
