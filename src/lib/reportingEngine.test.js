import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildReportingDataset, bangkokBounds, loadReportingDataset} from './reportingEngine.js';
const period = {from:'2026-10-01',to:'2026-10-31'};
const request = (id,model='primary',category='CIEM',ref='00001',unit='g') => ({id,model_id:model,model_name:model,category,order_ref:ref,bom_snapshot:[{line_id:'line',material_id:'mat',unit}]});
const movement = (id,seq,req,delta,at='2026-10-01T00:00:00Z',unit='g') => ({id,sequence_no:String(seq),material_id:'mat',material_name:'วัสดุ',unit,delta,reason:delta.startsWith('-')?'production_issue':'cancellation_return',occurred_at:at,allocations:[{transaction_id:req.id,line_id:'line',order_ref:req.order_ref,delta}]});
function fixture() {
 const r=request('r');
 return {contract:'reporting-evidence-v1',complete:true,cutoff_sequence:'9',mapping:{revision_id:'revision1',entries:[{model_id:'primary',work_kind:'primary',report_category:'CIEM'},{model_id:'package',work_kind:'supplemental',report_category:'CIEM'}]},requests:[r],movements:[movement('m',1,r,'-0.1')]};
}
const run = x => buildReportingDataset(x,period);
test('Bangkok inclusive dates use exclusive following midnight',()=>{
 assert.deepEqual(bangkokBounds('2026-10-01','2026-10-31'),{from:'2026-09-30T17:00:00.000Z',to_exclusive:'2026-10-31T17:00:00.000Z'});
 assert.throws(()=>bangkokBounds('2026-02-30','2026-03-01'));
});
test('first issue across all history counts once, later issues only usage',()=>{
 const x=fixture(); x.movements.push(movement('later',2,x.requests[0],'-0.2')); assert.equal(run(x).order_count,1); assert.equal(run(x).materials[0].gross_issued,'0.3');
 x.movements[0].occurred_at='2026-09-30T16:59:59Z'; assert.equal(run(x).order_count,0); assert.equal(run(x).materials[0].gross_issued,'0.2');
});
test('exact date boundaries and immutable result',()=>{
 const x=fixture(); x.movements[0].occurred_at='2026-09-30T17:00:00Z'; x.movements.push(movement('end',2,x.requests[0],'-4','2026-10-31T17:00:00Z'));
 const report=run(x); assert.equal(report.materials[0].gross_issued,'0.1'); assert.ok(Object.isFrozen(report.evidence[0])); assert.equal(x.movements.length,2);
});
test('cross-category references remain independent',()=>{
 const x=fixture(),r=request('r2','p2','Tactical'); x.requests.push(r); x.mapping.entries.push({model_id:'p2',work_kind:'primary',report_category:'Tactical'}); x.movements.push(movement('m2',2,r,'-1'));
 const out=run(x); assert.equal(out.order_count,2); assert.equal(out.warnings.length,0);
});
test('same-category ambiguous identities flag UUIDs without merging',()=>{
 const x=fixture(),r=request('r2','primary','CIEM',' 00001 '); x.requests.push(r); x.movements.push(movement('m2',2,r,'-1'));
 assert.equal(run(x).order_count,2); assert.equal(run(x).orders.filter(o=>o.identity_ambiguous).length,2);
});
test('Package contributes usage but zero count, uniquely linked',()=>{
 const x=fixture(),r=request('pkg','package'); x.requests.push(r); x.movements.push(movement('pkgMove',2,r,'-0.2'));
 const out=run(x); assert.equal(out.order_count,1); assert.equal(out.model_materials.length,1); assert.equal(out.model_materials[0].gross_issued,'0.3'); assert.equal(out.evidence[1].primary_request_id,'r');
});
test('orphan or ambiguous Package stays unmapped',()=>{
 const x=fixture(),p=request('pkg','package','CIEM','unmatched'); x.requests.push(p); x.movements.push(movement('pkgMove',2,p,'-0.2'));
 assert.ok(run(x).model_materials.some(r=>r.model_name==='Unmapped Package'));
 p.order_ref='00001'; x.movements[1].allocations[0].order_ref='00001'; const r=request('r2'); x.requests.push(r); x.movements.push(movement('third',3,r,'-1'));
 assert.equal(run(x).evidence[1].model_name,'Unmapped Package');
});
test('missing mapping never guesses primary from names',()=>{
 const x=fixture(); x.mapping.entries=[]; const out=run(x); assert.equal(out.order_count,0); assert.equal(out.materials[0].gross_issued,'0.1'); assert.equal(out.warnings[0].code,'UNMAPPED_MODEL');
});
test('returns and cancelled requests preserve gross and net',()=>{
 const x=fixture(); x.requests[0].status='cancelled'; x.movements.push(movement('return',2,x.requests[0],'0.025'));
 assert.deepEqual(run(x).materials[0],{material_id:'mat',unit:'g',gross_issued:'0.1',returned:'0.025',net_consumption:'0.075'}); assert.equal(run(x).order_count,1);
 x.movements[0].occurred_at='2026-09-01T00:00:00Z'; assert.equal(run(x).materials[0].net_consumption,'-0.025');
});
test('exact decimals beyond floating point precision',()=>{
 const x=fixture(); x.movements[0].delta='-9007199254740993.123456789'; x.movements[0].allocations[0].delta=x.movements[0].delta;
 assert.equal(run(x).materials[0].net_consumption,'9007199254740993.123456789');
 x.movements[0].delta=-0.1; assert.throws(()=>run(x),/exact string/);
});
test('recorded units stay separate, conflicting snapshot units reject',()=>{
 const x=fixture(),r=request('r2','primary','CIEM','other','pcs'); x.requests.push(r); x.movements.push(movement('m2',2,r,'-1',undefined,'pcs'));
 assert.equal(run(x).materials.length,2); assert.ok(run(x).warnings.some(w=>w.code==='MULTIPLE_RECORDED_UNITS'));
 r.bom_snapshot[0].unit='ml'; assert.throws(()=>run(x),/unit mismatch/);
});
test('shared movement reconciles allocations without duplicate movement totals',()=>{
 const x=fixture(),r=request('r2','primary','CIEM','other'); x.requests.push(r); x.movements[0].delta='-0.3'; x.movements[0].allocations.push({transaction_id:r.id,line_id:'line',order_ref:r.order_ref,delta:'-0.2'});
 assert.equal(run(x).materials[0].gross_issued,'0.3'); x.movements[0].delta='-0.4'; assert.throws(()=>run(x),/reconciliation/);
});
test('cutoff, duplicate allocations and incomplete evidence fail closed',()=>{
 const x=fixture(); x.cutoff_sequence='0'; assert.throws(()=>run(x),/cutoff/); x.cutoff_sequence='9'; x.complete=false; assert.throws(()=>run(x),/Incomplete/);
 x.complete=true; x.movements[0].allocations.push({...x.movements[0].allocations[0]}); x.movements[0].delta='-0.2'; assert.throws(()=>run(x),/Duplicate allocation/);
});
test('adapter calls only read RPC and propagates denied reads safely',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:fixture()};}};
 assert.equal((await loadReportingDataset(client,{...period,mappingRevision:'revision1'})).order_count,1);
 assert.deepEqual(calls,[{name:'reporting_read_evidence_v1',args:{p_cutoff_sequence:null,p_mapping_revision:'revision1'}}]);
 await assert.rejects(loadReportingDataset({rpc:async()=>({error:{message:'private detail'}})},{...period}),/denied or unavailable/);
});
test('null-model repair subtypes count once and retain subtype material totals',()=>{
 for (const subtype of ['CIEM','Tactical','Lifestyle','Sleepplug','อื่นๆ']) {
  const x=fixture(),r=x.requests[0]; r.model_id=null; r.category='ซ่อมและอื่นๆ'; r.model_name=subtype;
  x.movements.push(movement('second',2,r,'-0.2'),movement('return',3,r,'0.025'));
  const out=run(x); assert.equal(out.order_count,1); assert.equal(out.orders[0].model_id,null);
  assert.equal(out.orders[0].report_category,'Repair & Others'); assert.equal(out.orders[0].model_name,subtype);
  assert.equal(out.model_materials[0].net_consumption,'0.275'); assert.equal(out.classification_complete,true);
 }
});
test('null model does not infer repair from name alone or accept unknown subtype',()=>{
 for (const [category,subtype] of [['CIEM','CIEM'],['ซ่อมและอื่นๆ','unknown'],['ซ่อมและอื่นๆ',null],['Repair','CIEM']]) {
  const x=fixture(); Object.assign(x.requests[0],{model_id:null,category,model_name:subtype});
  const out=run(x); assert.equal(out.order_count,0); assert.equal(out.classification_complete,false);
  assert.equal(out.materials[0].gross_issued,'0.1'); assert.ok(out.warnings.some(w=>w.code==='UNMAPPED_MODEL'));
 }
});
test('repair and normal category same reference never merge; repairs retain UUID ambiguity',()=>{
 const x=fixture(),r=request('repair',null,'ซ่อมและอื่นๆ');r.model_name='CIEM';x.requests.push(r);x.movements.push(movement('repairMove',2,r,'-1'));
 let out=run(x);assert.equal(out.order_count,2);assert.equal(out.business_identities_unambiguous,true);
 const r2={...r,id:'repair2'};x.requests.push(r2);x.movements.push(movement('repairMove2',3,r2,'-1'));
 out=run(x);assert.equal(out.order_count,3);assert.equal(out.orders.filter(o=>o.identity_ambiguous).length,2);
});
