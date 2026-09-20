import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {managementKinds,managementPayload,createManagementSubmission,needsManagementConfirmation,managementError,decimal,version} from './inventoryManagement.js';
import {createInventoryApi as apiFactory} from './inventoryApi.js';
import {createRecoveryInventory as recoveryFactory} from './inventoryRecovery.js';
import {createManagementCatalog} from './inventoryManagementCatalog.js';
const U='11111111-1111-4111-8111-111111111111',M='22222222-2222-4222-8222-222222222222',O='33333333-3333-4333-8333-333333333333';
const row={id:M,name:'Synthetic',unit:'pcs',qty:'10.00',qty_version:7,low_stock_threshold:'1',is_active:true,requires_picking:true};
const inputs={
 create_material:{name:' New ',unit:'ml',initial_qty:'2.5',low_stock_threshold:'0.1',requires_picking:false,reason:'opening'},
 update_material:{name:' Edit ',unit:'pcs',qty:'999',low_stock_threshold:'2',requires_picking:false},
 set_material_active:{is_active:false,reason:'archive'},
 receive_purchase:{quantity:'0.25',reference:'PO-test',note:'synthetic'},
 stocktake:{counted_qty:'9.5',expected_version:999,reason:'counted'},
 save_model:{name:'Model',category:'CIEM',is_active:true,bom:[{material_id:M,qty:'0.50',picked:true,received:true,id:U}]},
 set_model_active:{is_active:false,reason:'archive model'},
};
const makeSubmission=(api,kind,extras={})=>createManagementSubmission({api,kind,input:inputs[kind],row,role:'admin',loadMaterial:async()=>row,confirm:async()=>true,...extras});
for(const kind of managementKinds){
 test(kind+': success uses RPC allowlisted payload only',async()=>{
  const calls=[];const api=createInventoryApi({rpc:async(name,args)=>{calls.push({name,args});return{data:{ok:true,pending_request_count:2}};}},{uuid:()=>O});
  const command=makeSubmission(api,kind);assert.deepEqual(await command.execute(),{ok:true,pending_request_count:2});
  assert.equal(calls.length,1);assert.equal(calls[0].name,'inventory_'+kind);assert.equal(calls[0].args.p_operation_id,O);
  assert.ok(!('p_qty' in calls[0].args));assert.ok(!('p_status' in calls[0].args));
  if(kind==='stocktake'){assert.equal(calls[0].args.p_expected_version,'7');assert.equal(calls[0].args.p_counted_qty,'9.5');}
  if(kind==='update_material'){assert.equal(calls[0].args.p_unit,'pcs');assert.ok(!('p_initial_qty' in calls[0].args));}
  if(kind==='save_model')assert.deepEqual(calls[0].args.p_bom,[{material_id:M,qty:'0.5'}]);
 });
 test(kind+': permissions enforce admin/staff/purchasing before any IO',async()=>{
  for(const role of ['admin','staff','purchasing','unknown']){
   const allowed=role==='admin'||(role==='purchasing'&&kind==='receive_purchase');
   if(allowed)assert.doesNotThrow(()=>managementPayload(kind,inputs[kind],role,row));
   else{
    const cmd=makeSubmission({},kind,{role,loadMaterial:()=>assert.fail('read before permission')});
    await assert.rejects(cmd.execute(),e=>e.code==='UI_FORBIDDEN');assert.equal(cmd.operation,null);
   }
  }
 });
}
test('validation: no unit change, empty BOM/reason, negative/nonfinite/zero receipt, precise decimals',()=>{
 assert.throws(()=>managementPayload('update_material',{...inputs.update_material,unit:'g'},'admin',row),/หน่วย/);
 for(const bad of ['', '-1','NaN','Infinity','1e3'])assert.throws(()=>decimal(bad));
 assert.equal(decimal('0001.2300'),'1.23');assert.equal(decimal('9007199254740993.001'),'9007199254740993.001');
 assert.throws(()=>version(9007199254740992));assert.equal(version('9007199254740993'),'9007199254740993');
 assert.throws(()=>managementPayload('receive_purchase',{quantity:'0'},'admin',row));
 for(const kind of ['set_material_active','set_model_active'])assert.throws(()=>managementPayload(kind,{...inputs[kind],reason:' '},'admin',row));
 assert.throws(()=>managementPayload('create_material',{...inputs.create_material,reason:''},'admin'));
 assert.throws(()=>managementPayload('save_model',{...inputs.save_model,bom:[]},'admin',row));
 assert.throws(()=>managementPayload('stocktake',{counted_qty:'9',reason:''},'admin',row));
 assert.equal(managementPayload('stocktake',{counted_qty:'10.0',reason:''},'admin',row).reason,'');
});
test('stocktake/update fetch fresh row; new material/model IDs and status remain server-owned',async()=>{
 let calls=0;let payload;
 const api={update_material:p=>{payload=p;return {execute:async()=>({ok:true})};}};
 await makeSubmission(api,'update_material',{loadMaterial:async()=>{calls++;return {...row,qty:88};}}).execute();
 assert.equal(calls,1);assert.equal(payload.unit,row.unit);assert.ok(!('qty' in payload));
 assert.equal(managementPayload('save_model',inputs.save_model,'admin',undefined).model_id,null);
 assert.ok(!('is_active' in managementPayload('save_model',inputs.save_model,'admin',row)));
});
test('confirm rejected for archive/stocktake/BOM allocates no operation; duplicate confirmation guard',async()=>{
 for(const kind of ['stocktake','set_material_active','set_model_active','save_model']){
  let confirmations=0;
  assert.equal(needsManagementConfirmation(kind,row),true);
  const cmd=makeSubmission({},kind,{confirm:async()=>{confirmations++;return false;}});
  const a=cmd.execute();assert.equal(cmd.execute(),a);assert.deepEqual(await a,{cancelled:true});assert.equal(confirmations,1);assert.equal(cmd.operation,null);
 }
});
test('version changes before stocktake: reload latest, no confirmation, RPC or UUID',async()=>{
 let latest;
 const cmd=makeSubmission({},'stocktake',{loadMaterial:async()=>({...row,qty:'12',qty_version:8}),onLatest:r=>latest=r,confirm:()=>assert.fail('no stale confirmation')});
 await assert.rejects(cmd.execute(),e=>e.code==='STALE_QTY_VERSION');assert.equal(cmd.operation,null);assert.equal(latest.qty_version,8);
});
test('server version race: code retained, no success, latest row reloaded',async()=>{
 let reads=0,latest;
 const api=createInventoryApi({rpc:async()=>({status:400,error:{code:'P0001',message:'Stock changed; recount/review required'}})},{uuid:()=>O});
 const cmd=makeSubmission(api,'stocktake',{loadMaterial:async()=>({...row,qty_version:++reads===1?7:8}),onLatest:r=>latest=r});
 await assert.rejects(cmd.execute(),e=>e.code==='P0001');assert.equal(cmd.operation.getSnapshot().status,'failed');assert.equal(latest.qty_version,8);
 assert.match(managementError(cmd.operation.getSnapshot().error),/P0001/);
});
test('pending-material archive error and diagnostic code preserved',async()=>{
 const api=createInventoryApi({rpc:async()=>({status:400,error:{code:'P0001',message:'Material used by pending requests: synthetic',details:'details'}})},{uuid:()=>O});
 const cmd=makeSubmission(api,'set_material_active');await assert.rejects(cmd.execute());
 assert.match(managementError(cmd.operation.getSnapshot().error),/รอหยิบ.*P0001/);
});
function memoryStorage(){const data=new Map();return {get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};}
for(const kind of managementKinds){
 test(kind+': response lost + reload uses original UUID; committed lookup does not repeat mutation',async()=>{
  let writes=0,lookupState='not_found',ids=0;const calls=[];const storage=memoryStorage();
  const dbKind={set_material_active:'archive_material',receive_purchase:'purchase'}[kind]||kind;
  const client={rpc:async(name,args)=>{
   calls.push({name,args:structuredClone(args)});
   if(name==='inventory_get_operation_result')return {data:{found:lookupState==='completed',completed:lookupState==='completed',kind:dbKind,result:{ok:true,pending_request_count:3}}};
   if(name==='inventory_list_materials')return {data:[row]};
   writes++;throw new Error('response lost');
  }};
  const make=()=>createRecoveryInventory(client,{userId:U,currentUserId:async()=>U,storage,uuid:()=>{ids++;return O;}});
  const recovery=make();const cmd=makeSubmission(recovery.api,kind);const a=cmd.execute();assert.equal(cmd.execute(),a);await assert.rejects(a,/lost/);
  assert.equal(writes,1);lookupState='completed';
  const reloaded=make();assert.deepEqual(await reloaded.check(O),{state:'completed',result:{ok:true,pending_request_count:3}});
  assert.equal(writes,1);assert.equal(ids,1);assert.deepEqual(await reloaded.list(),[]);
 });
}
test('not-found purchase replay keeps UUID/arguments and double retry sends once',async()=>{
 const storage=memoryStorage();let writes=0;const args=[];
 const recovery=createRecoveryInventory({rpc:async(name,p)=>{
  if(name==='inventory_get_operation_result')return {data:{found:false,completed:false}};
  writes++;args.push(p);if(writes===1)throw new Error('lost');return{data:{ok:true}};
 }},{userId:U,currentUserId:async()=>U,storage,uuid:()=>O});
 await assert.rejects(makeSubmission(recovery.api,'receive_purchase').execute());
 const a=recovery.retry(O);assert.equal(recovery.retry(O),a);await a;assert.deepEqual(args[0],args[1]);assert.equal(writes,2);
});
test('stale stocktake replay receives definitive rollback and retires old payload',async()=>{
 const storage=memoryStorage();let writes=0,ver=7,reads=0;
 const recovery=createRecoveryInventory({rpc:async(name)=>{
  if(name==='inventory_get_operation_result')return {data:{found:false,completed:false}};
  if(name==='inventory_list_materials'){reads++;return {data:[{...row,qty_version:ver}]};}
  writes++;if(ver===8)return {status:500,error:{code:'P0001',message:'Stock changed; recount/review required'}};throw new Error('lost');
 }},{userId:U,currentUserId:async()=>U,storage,uuid:()=>O});
 await assert.rejects(makeSubmission(recovery.api,'stocktake').execute());ver=8;
 await assert.rejects(recovery.retry(O),e=>e.code==='P0001');
 assert.equal(writes,2);assert.equal(reads,0);assert.equal((await recovery.list()).length,0);
});
test('model catalog reads all pages/inactive models and BOM; no mutation methods',async()=>{
 const calls=[];const client={from:table=>{
  const trace={table};calls.push(trace);
  const q={select:c=>{trace.columns=c;return q;},order:()=>q,range:(a,b)=>{trace.range=[a,b];return q;},eq:(k,v)=>{trace.filter=[k,v];return q;},
   then:(resolve)=>resolve({data:trace.range[0]===0?Array.from({length:100},(_,i)=>({id:i,is_active:i%2===0})):[]})};return q;
 }};
 const catalog=createManagementCatalog(client);
 assert.equal((await catalog.listModels()).length,100);await catalog.loadBom(M);
 assert.equal(calls[0].filter,undefined);assert.deepEqual(calls[2].filter,['model_id',M]);assert.equal(calls[1].range[0],100);
});
test('B2b entry is behind V2; legacy App unchanged; new UI has no table mutation fallback',()=>{
 const base=JSON.parse(readFileSync('docs/inventory-migration-drafts/REACT_B2B_BASELINE.json','utf8'));
 assert.equal(readFileSync('src/App.jsx','utf8').replaceAll('\r\n','\n'),base['src/App.jsx']);
 for(const path of ['src/components/InventoryManagementForm.jsx','src/components/InventoryModelsPanel.jsx','src/lib/inventoryManagement.js','src/lib/inventoryManagementCatalog.js']){
  const code=readFileSync(path,'utf8');assert.ok(!/\.(insert|update|upsert|delete)\s*\(/.test(code));assert.ok(!/received/.test(code));
 }
 const ui=readFileSync('src/views/InventoryV2.jsx','utf8');
 assert.ok(ui.includes("['admin','purchasing'].includes(role)"));assert.ok(ui.includes('recoveryBlocked'));
});

function createInventoryApi(client,options={}) {return apiFactory(client,{mutationsEnabled:true,...options});}

function createRecoveryInventory(client,options={}) {return recoveryFactory(client,{mutationsEnabled:true,...options});}
