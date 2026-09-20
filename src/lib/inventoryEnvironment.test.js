import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {InventoryModeBanner} from '../components/InventoryModeBanner.js';
import {inventoryEnvironmentPolicy,assertInventoryEnvironment,bootstrapInventory} from './inventoryEnvironment.js';
import {createInventoryApi,mutationParameters,readParameters} from './inventoryApi.js';
import {createRecoveryInventory} from './inventoryRecovery.js';
const REF='abcdefghijklmnopqrst', U='11111111-1111-4111-8111-111111111111';
const env={VITE_INVENTORY_V2_ENABLED:'true',VITE_SUPABASE_EXPECTED_PROJECT_REF:REF,
 VITE_SUPABASE_URL:'https://'+REF+'.supabase.co',VITE_SUPABASE_ANON_KEY:'MOCK-NOT-A-CREDENTIAL'};
function configured(settings=env){
 const policy=inventoryEnvironmentPolicy(settings);const calls=[];
 const api=createInventoryApi({rpc:async(name,args)=>{calls.push({name,args});return {data:[]};}},
  {mutationsEnabled:policy.mutationsEnabled,assertAccess:()=>assertInventoryEnvironment(policy),uuid:()=>assert.fail('unexpected UUID')});
 return {policy,api,calls};
}
test('matching expected ref: boot and all six read RPCs work with mutations default false',async()=>{
 const {policy,api,calls}=configured();let rendered=false;
 assert.equal(policy.error,null);assert.equal(policy.mutationsEnabled,false);
 await bootstrapInventory(policy,{load:async()=>({ok:true}),render:v=>rendered=v.ok,blocked:()=>assert.fail('blocked')});
 assert.equal(rendered,true);assert.equal(Object.keys(readParameters).length,6);
 for(const name of Object.keys(readParameters))await api[name](name==='get_operation_result'?{operation_id:U}:{});
 assert.equal(calls.length,6);
});
test('mismatch: no App/Auth import, no render and no RPC including reads',async()=>{
 const {policy,api,calls}=configured({...env,VITE_SUPABASE_EXPECTED_PROJECT_REF:'zzzzzzzzzzzzzzzzzzzz'});
 let blocks=0;
 assert.equal(await bootstrapInventory(policy,{load:()=>assert.fail('imported'),render:()=>assert.fail('rendered'),blocked:()=>blocks++}),false);
 await assert.rejects(api.list_materials(),e=>e.code==='INVENTORY_ENV_BLOCKED');
 assert.throws(()=>api.create_material({}),e=>e.code==='INVENTORY_ENV_BLOCKED');assert.equal(blocks,1);assert.equal(calls.length,0);
});
test('every mutation rejected before network/UUID for false, missing or nonliteral true',()=>{
 for(const value of [undefined,'false','TRUE','1','',true]){
  const {api,calls}=configured({...env,VITE_INVENTORY_MUTATIONS_ENABLED:value});
  for(const name of Object.keys(mutationParameters))assert.throws(()=>api[name]({}),e=>e.code==='INVENTORY_MUTATIONS_DISABLED');
  assert.equal(calls.length,0);
 }
 const api=createInventoryApi({rpc:()=>assert.fail('network')});
 for(const name of Object.keys(mutationParameters))assert.throws(()=>api[name]({}),/mutations disabled/);
});
test('explicit true permits mutation only with valid project',async()=>{
 const policy=inventoryEnvironmentPolicy({...env,VITE_INVENTORY_MUTATIONS_ENABLED:'true'});let calls=0;
 const api=createInventoryApi({rpc:async()=>{calls++;return {data:{ok:true}};}},{mutationsEnabled:policy.mutationsEnabled,assertAccess:()=>assertInventoryEnvironment(policy),uuid:()=>U});
 await api.create_material({name:'mock'}).execute();assert.equal(calls,1);
});
test('read-only recovery can lookup but cannot replay or prepare mutation',async()=>{
 let calls=0,authReads=0;
 const recovery=createRecoveryInventory({rpc:async()=>{calls++;return {data:{found:false,completed:false}};}},
  {userId:U,currentUserId:async()=>{authReads++;return U;},storage:null,
   assertAccess:()=>assertInventoryEnvironment(inventoryEnvironmentPolicy(env))});
 assert.throws(()=>recovery.retry(U),e=>e.code==='INVENTORY_MUTATIONS_DISABLED');
 for(const name of Object.keys(mutationParameters))assert.throws(()=>recovery.api[name]({}),e=>e.code==='INVENTORY_MUTATIONS_DISABLED');
 assert.equal(calls,0);assert.equal(authReads,0);
 await recovery.api.get_operation_result({operation_id:U});assert.equal(calls,1);
});
test('missing env and invalid URL configurations fail closed',async()=>{
 for(const settings of [{},{...env,VITE_SUPABASE_EXPECTED_PROJECT_REF:''},{...env,VITE_SUPABASE_ANON_KEY:''},
  {...env,VITE_SUPABASE_URL:'https://'+REF+'.supabase.co.evil.invalid'},
  {...env,VITE_SUPABASE_URL:'http://'+REF+'.supabase.co'},
  {...env,VITE_SUPABASE_URL:'https://user:pass@'+REF+'.supabase.co'},
  {...env,VITE_SUPABASE_URL:'https://'+REF+'.supabase.co/path'}]){
  const policy=inventoryEnvironmentPolicy(settings);assert.ok(policy.error);
  await bootstrapInventory(policy,{load:()=>assert.fail('import'),render:()=>assert.fail('render'),blocked:()=>{}});
 }
});
test('feature flag false retains legacy App and ignores V2-only expected ref check',async()=>{
 const policy=inventoryEnvironmentPolicy({...env,VITE_INVENTORY_V2_ENABLED:'false',VITE_SUPABASE_EXPECTED_PROJECT_REF:''});
 assert.equal(policy.error,null);assert.equal(policy.v2Enabled,false);assert.equal(policy.banner,null);
 let loaded=false;await bootstrapInventory(policy,{load:async()=>{loaded=true;return {};},render:()=>{},blocked:()=>assert.fail('legacy blocked')});
 assert.equal(loaded,true);
 const base=JSON.parse(readFileSync('docs/inventory-migration-drafts/REACT_C1_BASELINE.json','utf8'));
 assert.equal(readFileSync('src/App.jsx','utf8').replaceAll('\r\n','\n'),base['src/App.jsx']);
});
test('real banner component renders exact read-only label; omitted for legacy or enabled mutations',()=>{
 const html=renderToStaticMarkup(createElement(InventoryModeBanner,{policy:inventoryEnvironmentPolicy(env)}));
 assert.equal(html,'<aside role="status">STAGING — READ ONLY</aside>');
 for(const patch of [{VITE_INVENTORY_V2_ENABLED:'false'},{VITE_INVENTORY_MUTATIONS_ENABLED:'true'}])
  assert.equal(renderToStaticMarkup(createElement(InventoryModeBanner,{policy:inventoryEnvironmentPolicy({...env,...patch})})),'');
 const ui=readFileSync('src/views/InventoryV2.jsx','utf8');assert.ok(ui.includes('actionBusy={!mutationsEnabled'));
 assert.ok(ui.includes('task && mutationsEnabled'));assert.ok(ui.includes('InventoryModeBanner policy={inventoryEnvironment}'));
 const recovery=readFileSync('src/components/InventoryRecoveryPanel.jsx','utf8');
 assert.ok(recovery.includes("mutationsEnabled && states[row.operation_id]==='not_found'"));
});
test('staging example has no credentials; scripts/local ignores are configured',()=>{
 const example=readFileSync('.env.staging.example','utf8');
 assert.match(example,/VITE_SUPABASE_URL=\r?\n/);assert.match(example,/VITE_SUPABASE_ANON_KEY=\r?\n/);
 assert.match(example,/VITE_SUPABASE_EXPECTED_PROJECT_REF=qowhwyiooxxvdbnerlpa/);
 const pkg=JSON.parse(readFileSync('package.json','utf8'));assert.match(pkg.scripts['dev:staging'],/--mode staging/);
 assert.match(pkg.scripts['build:staging'],/--mode staging/);
 const ignored=readFileSync('.gitignore','utf8');assert.ok(ignored.includes('.env*.local'));assert.ok(ignored.includes('.env.staging.local'));
});
