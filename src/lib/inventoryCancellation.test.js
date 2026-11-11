import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cancellationReason,cancellationReasons,hasIssuedStock,restorationWarning} from './inventoryCancellation.js';
import {prepareWorkflow} from './inventoryWorkflow.js';
test('selected reason is required; optional details retain audit context',()=>{
 assert.throws(()=>cancellationReason(''),/เลือกเหตุผล/);
 assert.throws(()=>cancellationReason('invented'),/เลือกเหตุผล/);
 for(const r of cancellationReasons) assert.equal(cancellationReason(r.value),`[${r.value}] ${r.label}`);
 assert.match(cancellationReason('wrong_model','  details  '),/ — details$/);
});
test('issued evidence covers snapshot and allocation even without picked count',()=>{
 assert.equal(hasIssuedStock({picked_lines:0}),false);
 for(const row of [{picked_lines:1},{has_allocation:true},{bom_snapshot:[{picked:true}]}]) assert.equal(hasIssuedStock(row),true);
 assert.match(restorationWarning,/ไม่ใช่การยืนยัน/);
});
test('cancellation preserves single-order UUID and existing role boundaries',()=>{
 const calls=[];const api={cancel_request:p=>{calls.push(p);return p;}};
 const row={id:'one-order',created_by:'staff',picked_lines:0,workflow_state:'pending'};
 const reason=cancellationReason('customer_cancel');
 prepareWorkflow(api,'cancel',{reason},{role:'staff',userId:'staff',row});
 assert.deepEqual(calls[0],{transaction_id:'one-order',reason,legacy_return_verified:false});
 assert.throws(()=>prepareWorkflow(api,'cancel',{reason},{role:'staff',userId:'staff',row:{...row,has_allocation:true}}));
 prepareWorkflow(api,'cancel',{reason},{role:'admin',userId:'admin',row:{...row,has_allocation:true}});
 assert.equal(calls.length,2);
});
