import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fetchReportingView,selectReport,modelKey} from '../lib/reportingView.js';
import {createInventoryApi} from '../lib/inventoryApi.js';
import {createRecoveryInventory} from '../lib/inventoryRecovery.js';
const uuid='00000000-0000-4000-8000-000000000001';
const filters={from:'2026-10-01',to:'2026-10-31',mappingRevision:uuid};
test('real recovery adapter preserves denied, missing mapping and limit states',async()=>{
 for(const [error,status] of [[{code:'42501',message:'Admin required'},'denied'],[{code:'P0001',message:'Unknown mapping'},'mapping'],[{code:'54000',message:'REPORT_LIMIT: bytes'},'error']]) {
  let reads=0;
  const {api}=createRecoveryInventory({rpc:async(name)=>{assert.equal(name,'reporting_read_evidence_v1');reads++;return {error};}},{userId:uuid,currentUserId:async()=>uuid,storage:null});
  const result=await fetchReportingView(api,'admin',filters);
  assert.equal(result.status,status);assert.equal(reads,1);
  if(error.code==='54000') assert.match(result.message,/ขีดจำกัด/);
 }
});
const product={report_category:'CIEM',model_id:'m',model_name:'Recorded model',request_count:1,ambiguous_count:0};
const row={...product,material_id:'mat',material_name:'Recorded resin',unit:'g',gross_issued:'0.125',returned:'0.025',net_consumption:'0.1'};
const report={date_from:filters.from,date_to:filters.to,cutoff_sequence:'12',mapping_revision:uuid,products:[product],materials:[row],model_materials:[row],orders:[{...product,request_id:'r',order_ref:'00001',first_issue_at:'2026-10-01T00:00:00Z',identity_ambiguous:false}],evidence:[{...row,request_id:'r',order_ref:'00001'}],warnings:[]};
test('permission and missing mapping do not send requests',async()=>{
 const api={reporting_read_evidence:()=>{throw Error('must not call');}};
 assert.equal((await fetchReportingView(api,'staff',filters)).status,'denied');
 assert.equal((await fetchReportingView(api,'admin',{...filters,mappingRevision:''})).status,'mapping');
 assert.equal((await fetchReportingView(api,'admin',{...filters,from:'invalid'})).status,'error');
});
test('read failures distinguish permissions, absent mapping, limits and transport',async()=>{
 for(const [error,status] of [[{code:'42501'},'denied'],[{message:'Unknown mapping'},'mapping'],[{code:'54000'},'error'],[{message:'private secret'},'error']]) {
  const result=await fetchReportingView({reporting_read_evidence:async()=>({error})},'admin',filters);
  assert.equal(result.status,status);assert.ok(!JSON.stringify(result).includes('private secret'));
 }
});
test('read adapter calls only reporting RPC with exact cutoff and revision',async()=>{
 const calls=[];const api=createInventoryApi({rpc:async(name,args)=>{calls.push({name,args});return {data:{contract:'reporting-evidence-v1',complete:true,cutoff_sequence:'0',mapping:{revision_id:uuid,entries:[]},requests:[],movements:[]}};}});
 const result=await fetchReportingView(api,'admin',filters);
 assert.equal(result.status,'ready');assert.equal(result.report.order_count,0);
 assert.deepEqual(calls,[{name:'reporting_read_evidence_v1',args:{p_cutoff_sequence:null,p_mapping_revision:uuid}}]);
});
test('category/model drilldown preserves canonical rows without recalculating',()=>{
 assert.equal(selectReport(report,'CIEM',modelKey(product)).materials[0],row);
 assert.equal(selectReport(report,'Tactical').orders.length,0);
 assert.equal(selectReport(report,'All Materials').materials[0],row);
 assert.equal(selectReport(report,'CIEM','other').orders.length,0);
});
test('offline Reports UI states, totals, drilldown and unknown evidence',async()=>{
 const server=await createServer({configFile:false,envDir:false,resolve:{preserveSymlinks:true},ssr:{external:['react','react-dom']},server:{middlewareMode:true,hmr:false,watch:null}});
 try {
  const {ReportingResult,CanonicalReports,CompactReport}=await server.ssrLoadModule('/src/components/CanonicalReports.jsx');
  const render=state=>renderToStaticMarkup(React.createElement(ReportingResult,{state,view:'CIEM',model:'',onModel:()=>{}}));
  const compact=view=>renderToStaticMarkup(React.createElement(CompactReport,{state:{status:'ready',report:{...report,order_count:1}},view}));
  assert.match(compact('Product Category'),/CIEM/);
  assert.doesNotMatch(compact('Product Category'),/00001/);
  assert.match(compact('Material'),/ใช้สุทธิ/);
  assert.match(compact('Technician'),/ไม่ใช้ผู้ยื่นคำขอแทนผู้เบิก/);

  assert.match(render({status:'mapping'}),/ชุดจัดหมวดสินค้า/);assert.doesNotMatch(render({status:'mapping'}),/เบิกทั้งหมด/);
  assert.match(render({status:'denied'}),/Admin/);assert.match(render({status:'loading'}),/role="status"/);
  assert.match(render({status:'error',message:'Failure'}),/role="alert"/);
  const ready=render({status:'ready',report});for(const text of ['0.125','0.025','0.1','00001','Request UUID','Recorded model','Asia/Bangkok']) assert.ok(ready.includes(text));
  assert.match(render({status:'ready',report:{...report,warnings:[{code:'UNMAPPED_PACKAGE',request_id:'unknown'}]}}),/UNMAPPED_PACKAGE/);
  assert.match(render({status:'ready',report:{...report,products:[],orders:[],model_materials:[],evidence:[]}}),/ไม่มีข้อมูล/);
  const html=renderToStaticMarkup(React.createElement(CanonicalReports,{api:{},role:'admin'}));
  for(const view of ['All Products','All Materials','CIEM','Tactical','Lifestyle','Sleepplug','Repair &amp; Others']) assert.ok(html.includes(view));
  assert.match(renderToStaticMarkup(React.createElement(CanonicalReports,{api:{},role:'purchasing'})),/ไม่มีสิทธิ์/);
 }finally{await server.close();}
});

test('canonical exports require Admin and ready mapping; no controls for unauthorized roles',async()=>{
 const server=await createServer({configFile:false,envDir:false,resolve:{preserveSymlinks:true},ssr:{external:['react','react-dom']},server:{middlewareMode:true,hmr:false,watch:null}});
 try {
  const {CanonicalExportControls}=await server.ssrLoadModule('/src/components/CanonicalReports.jsx');
  const render=(state,role='admin')=>renderToStaticMarkup(React.createElement(CanonicalExportControls,{state,role}));
  for(const status of ['mapping','loading','idle','denied','error'])assert.equal((render({status}).match(/disabled/g)||[]).length,2);
  assert.equal(render({status:'ready',report},'staff'),'');
  assert.equal(render({status:'ready',report},'purchasing'),'');
  assert.equal((render({status:'ready',report:{}}).match(/disabled/g)||[]).length,2);
  const html=render({status:'ready',report:{...report,mapping_revision:uuid}});assert.ok(html.includes('Excel (.xlsx)'));assert.ok(html.includes('CSV (.zip)'));assert.ok(!html.includes('disabled'));
 }finally{await server.close();}
});
