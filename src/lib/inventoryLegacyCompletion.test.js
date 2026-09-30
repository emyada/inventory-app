import test from 'node:test';
import assert from 'node:assert/strict';
import {requestRows,requirementRows,modelSummary,materialActivity} from './inventoryReports.js';
import {cancelEligibility} from './inventoryWorkflow.js';
import {canCloseNotCompleted} from './inventoryExtensions.js';
const row={id:'5f2f513f-7f7f-4e93-8956-b36ad24df708',created_at:'2026-09-25T03:58:46Z',model_id:'historical',model_name:'IMPAX PRO',category:'Tactical',workflow_state:'legacy_completed_shipped',inventory_version:0,accounting_evidence:'unverified',created_by:'owner',bom_snapshot:[{material_id:'m',qty:2,unit:'pcs',picked:false,received:false}]};
test('legacy completion preserves requirements and uncertainty without fabricated consumption',()=>{
 const before=JSON.stringify(row);const rows=requestRows([row],'2026-09-01','2026-09-30');
 assert.equal(rows[0].accounting_evidence,'unverified');
 assert.equal(modelSummary(rows)[0].legacy_completed_shipped,1);
 assert.equal(modelSummary(rows)[0].completed,0);
 assert.equal(requirementRows([row],'2026-09-01','2026-09-30')[0].required_qty,2);
 assert.equal(requirementRows([row],'2026-09-01','2026-09-30')[0].picked,false);
 assert.deepEqual(materialActivity([],'2026-09-01','2026-09-30'),[]);
 assert.equal(JSON.stringify(row),before);
});
test('legacy historical completion offers no cancellation or actual-return action to any role',()=>{
 for(const role of ['admin','staff','purchasing']){assert.ok(cancelEligibility(row,role,'owner'));assert.equal(canCloseNotCompleted(row,role),false);}
});
