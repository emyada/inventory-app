import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRecoveryInventory as recoveryFactory} from './inventoryRecovery.js';
const U='11111111-1111-4111-8111-111111111111', V='22222222-2222-4222-8222-222222222222', O='33333333-3333-4333-8333-333333333333';
function fixture() {
 const data=new Map();const calls=[];let user=U;let mode='lost';let ids=0;
 const storage={get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const client={rpc:async(name,args)=>{calls.push({name,args:structuredClone(args)});
  if(name==='inventory_get_operation_result') return {data:mode==='committed'?{found:true,completed:true,kind:'confirm_pick',result:{issued_lines:2}}:mode==='waiting'?{found:true,completed:false,kind:'confirm_pick'}:{found:false,completed:false}};
  if(mode==='lost')throw new Error('response lost');return {data:{issued_lines:2}};
 }};
 const make=(id=U)=>createRecoveryInventory(client,{userId:id,currentUserId:async()=>user,storage,uuid:()=>{ids++;return O;}});
 return {data,calls,make,setMode:m=>mode=m,setUser:u=>user=u,ids:()=>ids};
}
async function seed(f){const api=f.make().api;await assert.rejects(api.confirm_pick({items:[{transaction_id:U,line_id:V}]}).execute(),/response lost/);}
test('committed response lost: reload lookup returns result, removes replay, no second mutation',async()=>{
 const f=fixture();await seed(f);f.setMode('committed');const reloaded=f.make();
 assert.equal((await reloaded.list()).length,1);
 assert.deepEqual(await reloaded.check(O),{state:'completed',result:{issued_lines:2}});
 assert.equal(f.calls.filter(c=>c.name==='inventory_confirm_pick').length,1);assert.equal(f.data.size,0);assert.equal(f.ids(),1);
});
test('not completed: checking and retry wait without mutation or new UUID',async()=>{
 const f=fixture();await seed(f);f.setMode('waiting');const r=f.make();
 assert.deepEqual(await r.check(O),{state:'waiting'});assert.deepEqual(await r.retry(O),{state:'waiting'});
 assert.equal(f.ids(),1);assert.equal(f.calls.filter(c=>c.name==='inventory_confirm_pick').length,1);assert.equal(f.data.size,1);
});
test('not found: no automatic mutation; explicit replay after reload preserves arguments and UUID',async()=>{
 const f=fixture();await seed(f);f.setMode('success');const r=f.make();
 assert.deepEqual(await r.check(O),{state:'not_found'});assert.equal(f.calls.filter(c=>c.name==='inventory_confirm_pick').length,1);
 const rows=await r.list();assert.deepEqual(rows[0].arguments,{p_items:[{transaction_id:U,line_id:V}]});
 const a=r.retry(O);assert.equal(r.retry(O),a);await a;
 const writes=f.calls.filter(c=>c.name==='inventory_confirm_pick');assert.deepEqual(writes[0],writes[1]);assert.equal(f.ids(),1);assert.equal(f.data.size,0);
});
test('another user cannot enumerate, read or retry; old controller stops after account switch',async()=>{
 const f=fixture();await seed(f);const old=f.make();f.setUser(V);const other=f.make(V);const n=f.calls.length;
 assert.deepEqual(await other.list(),[]);await assert.rejects(other.check(O));await assert.rejects(other.retry(O));
 await assert.rejects(old.list(),/ผู้ใช้เปลี่ยน/);await assert.rejects(old.retry(O),/ผู้ใช้เปลี่ยน/);assert.equal(f.calls.length,n);
});
test('corrupted storage blocks lookup, mutation and fresh UUID without deleting evidence',async()=>{
 const f=fixture();await seed(f);f.data.set([...f.data.keys()][0],'{');const r=f.make();const n=f.calls.length;
 await assert.rejects(r.list(),/เสียหาย/);await assert.rejects(r.retry(O));
 await assert.rejects(r.api.confirm_pick({items:[]}).execute());assert.equal(f.calls.length,n);assert.equal(f.ids(),1);assert.equal(f.data.size,1);
});
test('fingerprint mismatch fails closed; replay only stores allowlisted metadata and arguments',async()=>{
 const f=fixture();await seed(f);const key=[...f.data.keys()][0],row=JSON.parse(f.data.get(key));
 assert.deepEqual(Object.keys(row).sort(),['arguments','created_at','intent_key','operation_id','payload_fingerprint','rpc_name','status'].sort());
 row.arguments.p_items=[];f.data.set(key,JSON.stringify(row));await assert.rejects(f.make().list(),/fingerprint/);
});
test('live retry checks committed operation before repeating mutation',async()=>{
 const f=fixture();const op=f.make().api.confirm_pick({items:[{transaction_id:U,line_id:V}]});
 const a=op.execute();assert.equal(a,op.execute());await assert.rejects(a);f.setMode('committed');
 assert.deepEqual(await op.retry(),{issued_lines:2});assert.equal(f.calls.filter(c=>c.name==='inventory_confirm_pick').length,1);assert.equal(f.data.size,0);
});

test('secret-shaped nested arguments rejected before persistence or RPC',async()=>{
 const f=fixture();const r=f.make();
 await assert.rejects(r.api.create_request({repair_spec:{access_token:'never-store'}}).execute(),/secret/);
 assert.equal(f.data.size,0);assert.equal(f.calls.length,0);
});
test('storage unavailable keeps memory replay and warning, never repeats committed mutation',async()=>{
 let count=0,committed=false;
 const r=createRecoveryInventory({rpc:async(name)=>{
  if(name==='inventory_get_operation_result')return {data:committed?{found:true,completed:true,kind:'confirm_pick',result:{ok:true}}:{found:false,completed:false}};
  count++;committed=true;throw new Error('lost');
 }},{userId:U,currentUserId:async()=>U,storage:null,uuid:()=>O});
 const op=r.api.confirm_pick({items:[]});await assert.rejects(op.execute());assert.ok(r.getWarning());
 assert.deepEqual(await r.retry(O),{state:'completed',result:{ok:true}});assert.equal(count,1);assert.deepEqual(await r.list(),[]);
});

function createRecoveryInventory(client,options={}) {return recoveryFactory(client,{mutationsEnabled:true,...options});}
