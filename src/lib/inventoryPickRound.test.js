import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPickRound,expandPickSelection} from './inventoryPickRound.js';
const line=(id,qty='2',extra={})=>({line_id:id,material_id:'m',material_name:'Part',unit:'pcs',qty,picked:false,requires_picking:true,...extra});
test('one material row expands exact request/line pairs with decimal-safe total',()=>{
 const rows=[{id:'r1',order_ref:'o1',lines:[line('l1','0.1')]},{id:'r2',order_ref:'o2',lines:[line('l2','0.2')]}];const before=JSON.stringify(rows);
 const g=buildPickRound(rows);assert.equal(g.length,1);assert.equal(g[0].qty,'0.3');assert.equal(g[0].order_count,2);
 assert.deepEqual(expandPickSelection(g,['m']),[{transaction_id:'r1',line_id:'l1'},{transaction_id:'r2',line_id:'l2'}]);assert.equal(JSON.stringify(rows),before);
 rows[0].lines[0].qty=99;assert.equal(g[0].qty,'0.3');assert.equal(g[0].lines[0].qty,'0.1');
});
test('automatic, picked, closed and PNA1539 cannot enter a picking round',()=>{
 const rows=[{id:'r',lines:[line('a','2',{requires_picking:false}),line('b','2',{picked:true}),line('c')]},...['legacy_completed_shipped','cancelled','production_not_completed'].map(workflow_state=>({id:workflow_state,workflow_state,lines:[line('x')]})),{id:'5f2f513f-7f7f-4e93-8956-b36ad24df708',lines:[line('p')]}];
 assert.deepEqual(expandPickSelection(buildPickRound(rows),['m']),[{transaction_id:'r',line_id:'c'}]);
});
test('selection never includes unselected materials; invalid identities and duplicate lines fail closed',()=>{
 const rows=[{id:'r',lines:[line('a'),line('b','3',{material_id:'n'})]}];const g=buildPickRound(rows);
 assert.deepEqual(expandPickSelection(g,['n']),[{transaction_id:'r',line_id:'b'}]);assert.throws(()=>expandPickSelection(g,['unknown']));assert.throws(()=>expandPickSelection(g,['m','m']));
 assert.throws(()=>buildPickRound([{id:'r',lines:[line('a'),line('a')]}]));assert.throws(()=>buildPickRound([{id:'r',lines:[line('a'),line('b','2',{unit:'g'})]}]));
});
