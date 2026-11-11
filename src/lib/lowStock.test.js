import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stockAlert,stockSummary} from './lowStock.js';
test('threshold boundaries and zero are distinct',()=>{
 for(const [qty,status] of [[1,'low'],[2,'low'],[3,'ok'],[0,'out'],['0.125','low']])
  assert.equal(stockAlert({qty,low_stock_threshold:2}).status,status);
});
test('missing or invalid thresholds never become invented zero',()=>{
 for(const threshold of [null,undefined,'', ' ',false,NaN,Infinity,-1,'invalid']){
  assert.equal(stockAlert({qty:1,low_stock_threshold:threshold}).status,'unconfigured');
  assert.equal(stockAlert({qty:0,low_stock_threshold:threshold}).status,'out');
 }
 assert.equal(stockAlert({qty:1,low_stock_threshold:0}).status,'ok');
 assert.equal(stockAlert({qty:null,low_stock_threshold:2}).status,'unknown');
});
test('issue, receiving, return and stocktake read refresh recompute without mutating inputs',()=>{
 const original=Object.freeze({id:'a',qty:3,low_stock_threshold:2,is_active:true});
 assert.deepEqual([3,2,0,5,1,4].map(qty=>stockAlert({...original,qty}).status),['ok','low','out','ok','low','ok']);
 assert.equal(original.qty,3);
 const s=stockSummary([original,{...original,id:'b',qty:0},{...original,id:'c',qty:1},{...original,id:'d',qty:0,is_active:false},{...original,id:'e',low_stock_threshold:null}]);
 assert.equal(s.out,1);assert.equal(s.low,1);assert.equal(s.unconfigured,1);assert.deepEqual(s.affected.map(m=>m.id),['b','c']);
});
