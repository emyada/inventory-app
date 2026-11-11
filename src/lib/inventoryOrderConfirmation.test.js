import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareOrderConfirmation,orderRequirements} from './inventoryOrderConfirmation.js';
import {buildPickRound} from './inventoryPickRound.js';
const orders=[{id:'a',order_ref:'Z1',bom_snapshot:[{line_id:'m',requires_picking:true},{line_id:'auto',requires_picking:false}]},{id:'b',order_ref:'Z2',bom_snapshot:[{line_id:'other'}]}];
test('new queue includes automatic-only and exact combined stock requirements',()=>{
 const lines=[{line_id:'a',material_id:'m',material_name:'M',unit:'g',qty:'0.1',requires_picking:false},{line_id:'b',material_id:'m',material_name:'M',unit:'g',qty:'0.2',requires_picking:true}];
 const order={id:'o',order_ref:'Z1',confirmation_contract:'admin-whole-order-v1',bom_snapshot:lines,lines};
 assert.equal(buildPickRound([order])[0].qty,'0.3');
 assert.equal(orderRequirements(order,[{id:'m',unit:'g',qty:'0.3'}])[0].insufficient,false);
 assert.equal(orderRequirements(order,[{id:'m',unit:'g',qty:'0.299'}])[0].insufficient,true);
 assert.equal(orderRequirements(order,[])[0].insufficient,true);
 assert.throws(()=>orderRequirements({...order,confirmation_contract:undefined},[]));
});
test('whole selected order includes Automatic and preserves separate order allocations',()=>{
 const before=JSON.stringify(orders);let payload;
 const journal={execute(){}};
 assert.equal(prepareOrderConfirmation({confirm_pick:p=>(payload=p,journal)},orders,['a'],'admin'),journal);
 assert.deepEqual(payload.items,[{transaction_id:'a',line_id:'auto'},{transaction_id:'a',line_id:'m'}]);
 assert.equal(JSON.stringify(orders),before);
});
test('Staff and Purchasing cannot initiate confirmation',()=>{
 for(const role of ['staff','purchasing',null])assert.throws(()=>prepareOrderConfirmation({confirm_pick:()=>assert.fail()},orders,['a'],role));
});
test('manual-only queue projections and ambiguous/closed selections fail closed',()=>{
 const api={confirm_pick:()=>assert.fail()};
 assert.throws(()=>prepareOrderConfirmation(api,[{id:'a',order_ref:'Z1',lines:orders[0].bom_snapshot}],['a'],'admin'));
 for(const ids of [[],['a','a'],['unknown']])assert.throws(()=>prepareOrderConfirmation(api,orders,ids,'admin'));
 assert.throws(()=>prepareOrderConfirmation(api,[{...orders[0],workflow_state:'cancelled'}],['a'],'admin'));
});
test('historically picked lines are never included for another deduction',()=>{
 const row={...orders[0],bom_snapshot:orders[0].bom_snapshot.map(x=>({...x,picked:x.line_id==='m'}))};let payload;
 prepareOrderConfirmation({confirm_pick:p=>(payload=p)},[row],['a'],'admin');
 assert.deepEqual(payload.items,[{transaction_id:'a',line_id:'auto'}]);
});
