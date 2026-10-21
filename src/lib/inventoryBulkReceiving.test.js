import test from 'node:test';
import assert from 'node:assert/strict';
import {bulkPayload} from './inventoryBulkReceiving.js';
import {createRecoveryInventory} from './inventoryRecovery.js';
const U='11111111-1111-4111-8111-111111111111',M='22222222-2222-4222-8222-222222222222',O='33333333-3333-4333-8333-333333333333';
const materials=[{id:M,is_active:true}],fields={document_type:'none'};
const line={material_id:M,quantity:'0.125',unit_purchase_price:''};
test('decimal strings and absent price preserved; no document required',()=>{
 const p=bulkPayload('admin',[line],fields,materials);assert.equal(p.lines[0].quantity,'0.125');assert.equal(p.lines[0].unit_purchase_price,null);assert.equal(p.invoice_number,null);
 assert.equal(bulkPayload('admin',[{...line,unit_purchase_price:'0'}],fields,materials).lines[0].unit_purchase_price,'0');
});
test('roles, duplicates, missing/inactive materials and invalid quantities fail closed',()=>{
 for(const role of ['staff','purchasing'])assert.throws(()=>bulkPayload(role,[line],fields,materials));
 assert.throws(()=>bulkPayload('admin',[line,line],fields,materials));
 assert.throws(()=>bulkPayload('admin',[line],fields,[]));
 for(const q of ['0','-1','NaN','Infinity','1e2',''])assert.throws(()=>bulkPayload('admin',[{...line,quantity:q}],fields,materials));
 assert.throws(()=>bulkPayload('admin',[{...line,unit_purchase_price:'-1'}],fields,materials));
});
test('shared metadata, optional numbers, invalid calendar dates and bounds',()=>{
 const p=bulkPayload('admin',[line],{document_type:'both',supplier_source:' Shop ',document_date:'2026-10-17',note:'note'},materials);
 assert.equal(p.supplier_source,'Shop');assert.equal(p.po_number,null);assert.equal(p.document_date,'2026-10-17');
 assert.throws(()=>bulkPayload('admin',[line],{...fields,document_date:'2026-02-30'},materials));
 assert.throws(()=>bulkPayload('admin',[],fields,materials));
 assert.throws(()=>bulkPayload('admin',[line],{...fields,note:'a'.repeat(4001)},materials));
});
test('response loss and reload recover purchase kind without a second write',async()=>{
 const memory=new Map(),calls=[];let completed=false,ids=0;
 const storage={get length(){return memory.size;},key:i=>[...memory.keys()][i],getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
 const result={reference:'RCV-20261017-001',lines:[]};
 const client={rpc:async(name,args)=>{calls.push({name,args});if(name==='inventory_get_operation_result')return {data:completed?{found:true,completed:true,kind:'purchase',result}:{found:false,completed:false}};completed=true;throw new Error('response lost');}};
 const make=()=>createRecoveryInventory(client,{userId:U,currentUserId:async()=>U,storage,mutationsEnabled:true,uuid:()=>{ids++;return O;}});
 const op=make().api.receive_purchase_batch(bulkPayload('admin',[line],fields,materials));
 await assert.rejects(op.execute());assert.equal(memory.size,1);
 assert.deepEqual(await make().retry(O),{state:'completed',result});
 assert.equal(calls.filter(x=>x.name==='inventory_receive_purchase_batch').length,1);assert.equal(ids,1);assert.equal(memory.size,0);
});
test('explicit retry after not-found uses identical UUID and payload',async()=>{
 let fail=true;const calls=[];
 const client={rpc:async(name,args)=>{if(name==='inventory_get_operation_result')return {data:{found:false,completed:false}};calls.push(structuredClone(args));if(fail)throw new Error('offline');return {data:{reference:'RCV-TEST',lines:[]}};}};
 const r=createRecoveryInventory(client,{userId:U,currentUserId:async()=>U,storage:null,mutationsEnabled:true,uuid:()=>O});
 await assert.rejects(r.api.receive_purchase_batch(bulkPayload('admin',[line],fields,materials)).execute());fail=false;
 await r.retry(O);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].p_operation_id,O);
});
