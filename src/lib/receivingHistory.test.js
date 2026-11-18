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
 // Stock added by a stocktake count is shown too (own type), other reasons stay out.
 const withCount=[...rows,{...rows[0],id:'c1',reason:'stocktake_adjustment_in'},{...rows[0],id:'x1',reason:'production_issue'}];
 assert.equal(receivingRows(withCount).length,26);
 assert.equal(receivingRows(withCount,{type:'Counted Up'}).length,1);
});
test('Bangkok boundaries and invalid ranges',()=>{
 assert.equal(receivingRows([{...rows[0],occurred_at:'2026-10-31T17:00:00Z'}],{from:'2026-11-01',to:'2026-11-01'}).length,1);
 assert.equal(receivingRows([{...rows[0],occurred_at:'2026-10-31T16:59:59Z'}],{from:'2026-11-01',to:'2026-11-01'}).length,0);
 assert.throws(()=>receivingRows(rows,{from:'2026-11-02',to:'2026-11-01'}));
});

import {receivingGroups} from './receivingHistory.js';
test('receivingGroups splits purchases / cancellation returns / store returns / counts, newest first, capped',()=>{
 const mk=(id,reason,t)=>({id,reason,delta:'1',occurred_at:t,sequence_no:id,material_name:'M'+id});
 const rows=receivingRows([mk(1,'purchase','2026-11-01T00:00:00Z'),mk(2,'cancellation_return','2026-11-02T00:00:00Z'),mk(3,'purchase','2026-11-03T00:00:00Z'),mk(4,'store_return','2026-11-04T00:00:00Z'),mk(5,'production_issue','2026-11-05T00:00:00Z')]);
 const g=Object.fromEntries(receivingGroups(rows,1).map(x=>[x.type,x]));
 assert.equal(g.Purchased.count,2);assert.equal(g.Purchased.rows.length,1);assert.equal(g.Purchased.rows[0].id,3);
 assert.equal(g['Returned to Stock'].count,1);assert.equal(g['Returned from Store'].count,1);assert.equal(g['Counted Up'].count,0);
});
