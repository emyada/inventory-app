import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {simulateInventory,loadSimulationCatalog,calculateSimulation,simulationCategories,loadSimulationAvailability,simulationSelectionReady} from './inventorySimulation.js';
const catalog={models:[{id:'a',name:'A',category:'CIEM'},{id:'b',name:'B',category:'Sleepplug'}],materials:[{id:'m',name:'Resin',unit:'ml',qty:'9.75'},{id:'n',name:'Case',unit:'pcs',qty:'2'}]};
const boms={a:[{material_id:'m',qty:'0.1'},{material_id:'n',qty:'1'}],b:[{material_id:'m',qty:'0.2'}]};
const entries=[{model_id:'a',category:'CIEM',quantity:'2',mode:'Using'},{model_id:'b',category:'Sleepplug',quantity:'3',mode:'Used'}];
const run=(overrides={})=>simulateInventory({...catalog,boms,entries,...overrides});
test('multiple categories/models share material by ID; Used never adds unused',()=>{
 assert.deepEqual(run(),[{material_id:'m',material_name:'Resin',unit:'ml',total_bom:'0.8',simulated_unused:'0.2',current_stock:'9.75',simulated_combined_total:'9.95'},{material_id:'n',material_name:'Case',unit:'pcs',total_bom:'2',simulated_unused:'2',current_stock:'2',simulated_combined_total:'4'}]);
});
test('decimal multiplication/addition is exact and has no pair/side inference',()=>{
 const result=run({entries:[{...entries[0],quantity:'0.3'}]});assert.equal(result[0].total_bom,'0.03');assert.equal(result[0].simulated_combined_total,'9.78');assert.equal(result[1].total_bom,'0.3');
 assert.equal(run({boms:{...boms,a:[{material_id:'m',qty:0.0000001}]}})[0].total_bom,'0.6000002');
});
test('all Used retains stock; repeated Using entries aggregate intentionally',()=>{
 assert.equal(run({entries:entries.map(e=>({...e,mode:'Used'}))})[0].simulated_combined_total,'9.75');
 assert.equal(run({entries:[entries[0],entries[0]]})[0].simulated_unused,'0.4');
});
test('empty calculation, zero stock and identical names with distinct IDs',()=>{
 assert.deepEqual(run({entries:[]}),[]);
 const materials=catalog.materials.map(m=>({...m,name:'same',qty:'0'}));assert.equal(run({materials}).length,2);
});
test('missing/empty BOM, missing material, unknown model and wrong category fail closed',()=>{
 for(const patch of [{boms:{}},{boms:{...boms,a:[]}},{materials:[]},{entries:[{...entries[0],model_id:'missing'}]},{entries:[{...entries[0],category:'Universal'}]}])assert.throws(()=>run(patch));
});
test('duplicate/ambiguous BOM and catalog identities fail closed',()=>{
 assert.throws(()=>run({boms:{...boms,a:[...boms.a,boms.a[0]]}}));
 assert.throws(()=>run({models:[...catalog.models,catalog.models[0]]}));
 assert.throws(()=>run({materials:[...catalog.materials,catalog.materials[0]]}));
 assert.throws(()=>run({boms:{...boms,a:boms.a.map(line=>({...line,id:'duplicate'}))}}));
});
test('missing/conflicting units and malformed quantities reject entire calculation',()=>{
 assert.throws(()=>run({boms:{...boms,a:[{material_id:'m',qty:1,unit:'g'}]}}));
 assert.throws(()=>run({materials:catalog.materials.map(m=>({...m,unit:''}))}));
 for(const quantity of ['','0','-1','NaN','1e2','1,000','0.0000000000001'])assert.throws(()=>run({entries:[{...entries[0],quantity}]}));
 assert.throws(()=>run({boms:{...boms,a:[{material_id:'m'}]}}));
 assert.throws(()=>run({materials:catalog.materials.map(m=>({...m,qty:null}))}));
 assert.throws(()=>run({entries:[{...entries[0],mode:'unknown'}]}));
});
test('input data stays unchanged; selected BOM read once; only read functions called',async()=>{
 const before=JSON.stringify({catalog,boms,entries});const calls=[];
 const data=await loadSimulationCatalog({listMaterials:async()=>{calls.push('materials');return catalog.materials;},listModels:async()=>{calls.push('models');return catalog.models;}},'purchasing');
 const result=await calculateSimulation(data,[...entries,entries[0]],async id=>{calls.push(id);return boms[id];});
 assert.deepEqual(calls,['materials','models','a','b']);assert.equal(result.rows.length,2);assert.equal(JSON.stringify({catalog,boms,entries}),before);
 await assert.rejects(loadSimulationCatalog({listMaterials:()=>assert.fail(),listModels:()=>assert.fail()},'staff'));
});
test('calculator UI has no mutation RPC, operation/recovery controller, or direct table write',()=>{
 const ui=readFileSync(new URL('../components/InventorySimulation.jsx',import.meta.url),'utf8');
 assert.deepEqual([...ui.matchAll(/api\.([a-z_]+)\(/g)].map(m=>m[1]),['list_materials','list_materials']);
 assert.doesNotMatch(ui,/\.rpc\(|\.insert\(|\.update\(|\.delete\(|prepareWorkflow|createOperation|confirm_pick|receive_purchase/);
});
test('read failures never yield partial simulation',async()=>{
 await assert.rejects(calculateSimulation(catalog,entries,async id=>{if(id==='b')throw new Error('missing read');return boms[id];}));
});
test('refresh discovers arbitrary future categories/models including empty BOM categories',async()=>{
 const models=[...catalog.models];
 const reader={listMaterials:async()=>catalog.materials,listModels:async()=>[...models]};
 const first=await loadSimulationCatalog(reader,'admin');
 models.push({id:'future',name:'Future',category:'New custom category'},{id:'empty',name:'Empty',category:'No BOM yet'});
 const next=await loadSimulationCatalog(reader,'admin');
 assert.deepEqual(simulationCategories(first.models),['CIEM','Sleepplug']);
 assert.deepEqual(simulationCategories(next.models),['CIEM','Sleepplug','New custom category','No BOM yet']);
 const checked=await loadSimulationAvailability(next,async id=>id==='empty'?[]:boms[id]||boms.b);
 assert.equal(checked.availability.future.valid,true);assert.equal(checked.availability.empty.valid,false);
 assert.match(checked.availability.empty.reason,/ไม่มี BOM/);
 assert.equal(simulationSelectionReady(checked,[...entries,{model_id:'future',category:'New custom category',quantity:'1',mode:'Using'}]),true);
 assert.equal(simulationSelectionReady(checked,[...entries,{model_id:'empty',category:'No BOM yet'}]),false);
});
test('invalid/unreadable BOM disables model without removing category; later refresh enables it',async()=>{
 const invalid=await loadSimulationAvailability(catalog,async id=>{if(id==='a')throw new Error('private server detail');return [{material_id:'m',qty:'1',unit:'g'}];});
 assert.deepEqual(simulationCategories(invalid.models),['CIEM','Sleepplug']);
 assert.equal(simulationSelectionReady(invalid,entries),false);
 assert.match(invalid.availability.b.reason,/หน่วย/);assert.ok(!JSON.stringify(invalid).includes('private server detail'));
 const valid=await loadSimulationAvailability(catalog,async id=>boms[id]);
 assert.equal(simulationSelectionReady(valid,entries),true);
 assert.equal(simulationSelectionReady(valid,[]),false);
 assert.equal(simulationSelectionReady(valid,[{...entries[0],model_id:'removed'}]),false);
 const ui=readFileSync(new URL('../components/InventorySimulation.jsx',import.meta.url),'utf8');
 assert.match(ui,/disabled=\{!simulationSelectionReady\(catalog,entries\)\}/);
 assert.doesNotMatch(ui,/PRODUCT_CATEGORIES|\['CIEM'/);
});
