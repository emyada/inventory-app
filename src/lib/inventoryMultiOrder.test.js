import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMultiOrderBatch} from './inventoryRequestUX.js';
import {buildPickRound} from './inventoryPickRound.js';
const models=[{id:'m1',name:'One',category:'CIEM'},{id:'m2',name:'Two',category:'Sleepplug'}];
test('multi-model orders use distinct operations; never accept client BOM or quantity',async()=>{
 const calls=[]; const api={create_request:p=>{const id=calls.length+1;calls.push(p);return {execute:async()=>({transaction_id:`t${id}`}),getSnapshot:()=>({status:'succeeded'})};}};
 const draft=[{model_id:'m1',order_ref:'001',bom:[{qty:999}]},{model_id:'m2',order_ref:'001'}];
 const batch=createMultiOrderBatch(api,draft,{role:'staff',models});draft[0].order_ref='changed';
 const flight=batch.execute();assert.equal(batch.execute(),flight);
 const result=await flight; assert.equal(result.status,'succeeded');
 assert.deepEqual(calls.map(p=>[p.model_id,p.order_ref]),[['m1','001'],['m2','001']]);
 assert.ok(calls.every(p=>p.repair_spec===null&&!('bom' in p)));
 assert.deepEqual(result.rows.map(r=>r.result.transaction_id),['t1','t2']);
 await batch.execute();assert.equal(calls.length,2);
});
test('unknown or storage failure stops later orders and preserves earlier success',async()=>{
 for(const storageError of [false,true]){
 let count=0;const api={create_request:()=>{const i=++count;return {execute:async()=>{if(i===2&&!storageError)throw Error('lost');return {transaction_id:`t${i}`};},getSnapshot:()=>({status:i===2&&!storageError?'unknown':'succeeded',storageError:i===2&&storageError})};}};
 const batch=createMultiOrderBatch(api,[{model_id:'m1',order_ref:'1'},{model_id:'m2',order_ref:'2'},{model_id:'m1',order_ref:'3'}],{role:'admin',models});
 const result=await batch.execute();assert.equal(count,2);assert.deepEqual(result.rows.map(r=>r.status),['succeeded','review','waiting']);
 await batch.execute();assert.equal(count,2);
 }
});
test('all entries validate before any operation; no global-reference collision rule',()=>{
 const api={create_request:()=>{throw Error('must not be reached');}};
 for(const rows of [[],[{model_id:'missing',order_ref:'1'}],[{model_id:'m1',order_ref:''}],[{model_id:'m1',order_ref:'x'},{model_id:'m1',order_ref:' X '}]])assert.throws(()=>createMultiOrderBatch(api,rows,{role:'staff',models}));
 assert.throws(()=>createMultiOrderBatch(api,[{model_id:'m1',order_ref:'1'}],{role:'purchasing',models}));
});
test('shared picking material keeps two request identities and exact allocations',()=>{
 const rows=['t1','t2'].map((id,i)=>({id,order_ref:'001',model_name:models[i].name,confirmation_contract:'admin-whole-order-v1',bom_snapshot:[{line_id:`l${i}`,material_id:'mat',material_name:'Shared',unit:'g',qty:'0.125',picked:false,requires_picking:false}]}));
 const groups=buildPickRound(rows.map(r=>({...r,lines:r.bom_snapshot})));assert.equal(groups.length,1);assert.equal(String(groups[0].qty),'0.25');assert.deepEqual(groups[0].lines.map(l=>l.transaction_id),['t1','t2']);
});

 test('actual operation journal assigns a distinct stable UUID to every submitted order',async()=>{
 const {createInventoryApi}=await import('./inventoryApi.js');
 const {createOperationStore}=await import('./inventoryOperation.js');
 let next=0;const calls=[];const memory=new Map();const storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k),key:i=>[...memory.keys()][i],get length(){return memory.size;}};
 const api=createInventoryApi({rpc:async(name,args)=>{calls.push({name,args});return {data:{transaction_id:`t${calls.length}`},error:null};}}, {mutationsEnabled:true,uuid:()=>`op-${++next}`,operationStore:createOperationStore({storage})});
 const batch=createMultiOrderBatch(api,[{model_id:'m1',order_ref:'1'},{model_id:'m2',order_ref:'2'}],{role:'staff',models});
 await batch.execute();await batch.execute();
 assert.deepEqual(calls.map(c=>c.args.p_operation_id),['op-1','op-2']);
 assert.ok(calls.every(c=>c.name==='inventory_create_request'));
 });
