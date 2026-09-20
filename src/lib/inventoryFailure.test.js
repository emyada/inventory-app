import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRecoveryInventory as recoveryFactory} from './inventoryRecovery.js';
import {createInventoryApi as apiFactory} from './inventoryApi.js';
import {createOperationStore} from './inventoryOperation.js';
import {createManagementSubmission} from './inventoryManagement.js';
import {isDefinitiveFailure} from './inventoryFailure.js';
const U='11111111-1111-4111-8111-111111111111',M='22222222-2222-4222-8222-222222222222';
function harness(){
 const memory=new Map();let n=0;const calls=[];let respond=async()=>({data:{ok:true}});
 const storage={get length(){return memory.size;},key:i=>[...memory.keys()][i],getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
 const client={rpc:async(name,args)=>{calls.push({name,args:structuredClone(args)});return respond(name,args);}};
 const recovery=createRecoveryInventory(client,{userId:U,currentUserId:async()=>U,storage,uuid:()=>'33333333-3333-4333-8333-'+String(++n).padStart(12,'0')});
 const op=payload=>recovery.api.receive_purchase({material_id:M,quantity:payload,reference:'test',note:''});
 return {memory,client,storage,recovery,op,calls,respond:fn=>respond=fn,ids:()=>n};
}
for(const code of ['P0001','23505','23514','42501','PGRST202']){
 test(code+' structured mutation error (HTTP 500) removes replay; edited/new intent uses a new UUID',async()=>{
  const h=harness();let fail=true;
  h.respond(async name=>name==='inventory_get_operation_result'?{data:{found:false,completed:false}}:fail?{status:500,error:{code,message:'database rejected',details:'details'}}:{data:{ok:true}});
  const old=h.op('1');const a=old.execute();assert.equal(old.execute(),a);
  await assert.rejects(a,e=>isDefinitiveFailure(e)&&e.code===code);assert.equal(h.memory.size,0);
  await assert.rejects(old.retry());assert.equal(h.calls.filter(c=>c.name==='inventory_receive_purchase').length,1);
  fail=false;const next=h.op('2');await next.execute();assert.notEqual(next.id,old.id);assert.equal(h.ids(),2);
  assert.equal(h.calls.filter(c=>c.name==='inventory_receive_purchase').length,2);assert.equal(h.memory.size,0);
 });
}
for(const mode of ['network','timeout','response lost','no code','unknown code','thrown code']){
 test(mode+' retains payload/UUID and replays once per explicit retry',async()=>{
  const h=harness();let fail=true;
  h.respond(async name=>{
   if(name==='inventory_get_operation_result')return {data:{found:false,completed:false}};
   if(!fail)return {data:{ok:true}};
   if(mode==='no code')return {status:500,error:{message:'unknown server result'}};
   if(mode==='unknown code')return {status:500,error:{code:'ECONNRESET',message:'disconnected'}};
   const e=new Error(mode);if(mode==='thrown code')e.code='P0001';throw e;
  });
  const op=h.op('1');await assert.rejects(op.execute());const saved=[...h.memory.values()][0];
  assert.equal(op.getSnapshot().status,'unknown');assert.equal((await h.recovery.list()).length,1);
  fail=false;const a=op.retry();assert.equal(op.retry(),a);await a;
  const writes=h.calls.filter(c=>c.name==='inventory_receive_purchase');assert.deepEqual(writes[0].args,writes[1].args);assert.equal(writes.length,2);assert.equal(h.ids(),1);
  assert.ok(saved.includes('"p_quantity":"1"'));assert.equal(h.memory.size,0);
 });
}
test('structured lookup error cannot retire an unresolved mutation',async()=>{
 const h=harness();let lookupFail=false;
 h.respond(async name=>name==='inventory_get_operation_result'?(lookupFail?{status:500,error:{code:'42501',message:'lookup denied'}}:{data:{found:false,completed:false}}):Promise.reject(new Error('lost')));
 const op=h.op('1');await assert.rejects(op.execute());lookupFail=true;
 await assert.rejects(op.retry(),e=>!isDefinitiveFailure(e));assert.equal(h.memory.size,1);assert.equal(h.ids(),1);
 assert.equal(h.calls.filter(c=>c.name==='inventory_receive_purchase').length,1);
});
test('stocktake definitive stale error reloads then explicit confirmation uses fresh version and UUID',async()=>{
 const h=harness();let v=1,confirms=0;const row=()=>({id:M,qty:'10',qty_version:v});
 h.respond(async(name,args)=>{
  if(name==='inventory_get_operation_result')return {data:{found:false,completed:false}};
  if(args.p_expected_version==='1'){v=2;return {status:500,error:{code:'P0001',message:'Stock changed; recount/review required'}};}
  return {data:{qty_before:10,qty_after:9,delta:-1}};
 });
 let latest=row();
 const make=()=>createManagementSubmission({api:h.recovery.api,kind:'stocktake',role:'admin',row:latest,input:{counted_qty:'9',reason:'counted'},loadMaterial:async()=>row(),onLatest:r=>latest=r,confirm:async()=>{confirms++;return true;}});
 const old=make();await assert.rejects(old.execute(),isDefinitiveFailure);assert.equal(h.memory.size,0);assert.equal(latest.qty_version,2);
 const next=make();const a=next.execute();assert.equal(next.execute(),a);await a;
 assert.notEqual(old.operation.id,next.operation.id);assert.equal(confirms,2);
 const writes=h.calls.filter(c=>c.name==='inventory_stocktake');assert.equal(writes.length,2);assert.deepEqual(writes.map(c=>c.args.p_expected_version),['1','2']);
});
test('base operation metadata also removed after database rollback',async()=>{
 const h=harness();const store=createOperationStore({storage:h.storage});
 const api=createInventoryApi({rpc:async()=>({status:500,error:{code:'23514',message:'constraint failed'}})},{operationStore:store,uuid:()=>M});
 await assert.rejects(api.create_request({model_id:M,order_ref:'x'}).execute(),isDefinitiveFailure);
 assert.equal(h.memory.size,0);
});
test('replay removal failure fails closed rather than enabling new intent',async()=>{
 const h=harness();h.storage.removeItem=()=>{throw new Error('blocked');};
 h.respond(async name=>name==='inventory_get_operation_result'?{data:{found:false,completed:false}}:{error:{code:'P0001',message:'rejected'},status:500});
 const op=h.op('1');await assert.rejects(op.execute(),e=>!isDefinitiveFailure(e));
 assert.equal(op.getSnapshot().status,'unknown');assert.equal(h.memory.size,1);assert.equal(h.ids(),1);
});

for(const response of [{data:null,error:null},{status:500,data:undefined},{}]){
 test('missing confirmed database result retains pending: '+JSON.stringify(response),async()=>{
  const h=harness();h.respond(async name=>name==='inventory_get_operation_result'?{data:{found:false,completed:false}}:response);
  const op=h.op('1');await assert.rejects(op.execute(),e=>!isDefinitiveFailure(e));
  assert.equal(op.getSnapshot().status,'unknown');assert.equal(h.memory.size,1);assert.equal(h.ids(),1);
 });
}

function createInventoryApi(client,options={}) {return apiFactory(client,{mutationsEnabled:true,...options});}

function createRecoveryInventory(client,options={}) {return recoveryFactory(client,{mutationsEnabled:true,...options});}
