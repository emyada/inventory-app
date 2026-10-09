import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pendingWorkerGroups,UNASSIGNED_WORKER} from './inventoryRequestPresentation.js';
import {filterRequests} from './inventoryRequestUX.js';
import {buildPickRound} from './inventoryPickRound.js';

test('pending counts use unique request IDs, not material lines or submitter names',()=>{
 const pending={id:'a',staff_name:'Submitting supervisor',workflow_state:'pending',lines:[{line_id:'1'},{line_id:'2'}]};
 const partial={id:'b',staff_name:'Other submitter',workflow_state:'partially_picked'};
 const rows=[pending,partial,pending,{id:'c',workflow_state:'completed'},{id:'d',workflow_state:'cancelled'},{id:'e',workflow_state:'pending',cancelled_at:'2026-10-08'},{id:'f',workflow_state:'production_not_completed'},{id:'g',workflow_state:'legacy_completed_shipped'},{id:'h',workflow_state:'pending',can_pick:false}];
 const before=JSON.stringify(rows);const groups=pendingWorkerGroups(rows);
 assert.equal(groups.length,1);assert.equal(groups[0].key,UNASSIGNED_WORKER);assert.equal(groups[0].name,'ยังไม่ระบุช่าง');assert.deepEqual(groups[0].rows,[pending,partial]);assert.equal(JSON.stringify(rows),before);
 assert.deepEqual(pendingWorkerGroups([]),[]);
});
test('all request categories remain visible by default; filters retain their existing scope',()=>{
 const rows=['CIEM','Tactical','Lifestyle','Sleepplug','Universal','ซ่อมและอื่นๆ'].map((category,i)=>({id:String(i),order_ref:`Z${i}`,category,model_name:`Model ${i}`,created_at:'2026-10-08T01:00:00Z',workflow_state:i?'pending':'completed'}));
 assert.deepEqual(filterRequests(rows),rows);
 assert.equal(filterRequests(rows,{search:'Z3'}).length,1);
 assert.equal(filterRequests(rows,{status:'pending'}).length,5);
 assert.equal(filterRequests(rows,{from:'2026-10-07',to:'2026-10-07'}).length,0);
});
test('presentation grouping leaves existing picking identities and totals unchanged',()=>{
 const line=(line_id,qty)=>({line_id,material_id:'m',material_name:'Driver',unit:'pcs',qty,requires_picking:true,picked:false});
 const rows=[{id:'a',order_ref:'Z1',workflow_state:'pending',lines:[line('1',2)]},{id:'b',order_ref:'Z2',workflow_state:'partially_picked',lines:[line('2',3)]}];
 const before=buildPickRound(rows);pendingWorkerGroups(rows);assert.deepEqual(buildPickRound(rows),before);assert.equal(before[0].qty,'5');assert.equal(before[0].order_count,2);
});
