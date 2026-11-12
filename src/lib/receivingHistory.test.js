import {test} from 'node:test';
import assert from 'node:assert/strict';
import {receivingRows} from './receivingHistory.js';
const rows=Array.from({length:25},(_,i)=>({id:String(i),sequence_no:i+1,occurred_at:`2026-11-01T${String(i%24).padStart(2,'0')}:00:00Z`,reason:i===0?'cancellation_return':'purchase',delta:'0.125',material_name:'วัสดุ '+i,actor_id:'user-'+i,reference:'RCV-'+i}));
test('history filters recorded evidence, orders newest first and retains decimals',()=>{
 assert.equal(receivingRows(rows).length,25);
 assert.equal(receivingRows(rows,{type:'Returned to Stock'}).length,1);
 assert.equal(receivingRows(rows,{search:'user-24'})[0].id,'24');
 assert.equal(receivingRows(rows,{search:'RCV-24'})[0].delta,'0.125');
 assert.equal(receivingRows(rows)[0].id,'23');
 assert.equal(receivingRows([...rows,{...rows[0],reason:'stocktake_adjustment_in'}]).length,25);
});
test('Bangkok boundaries and invalid ranges',()=>{
 assert.equal(receivingRows([{...rows[0],occurred_at:'2026-10-31T17:00:00Z'}],{from:'2026-11-01',to:'2026-11-01'}).length,1);
 assert.equal(receivingRows([{...rows[0],occurred_at:'2026-10-31T16:59:59Z'}],{from:'2026-11-01',to:'2026-11-01'}).length,0);
 assert.throws(()=>receivingRows(rows,{from:'2026-11-02',to:'2026-11-01'}));
});
