import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash,createHmac} from 'node:crypto';
import {syncConfig,scriptSync,reportingSyncHandler} from './reporting-sync.js';
import {createCanonicalExportSnapshot} from '../src/lib/reportingExport.js';
import {exportFixture} from '../docs/phase4c3-review/exportFixture.mjs';
import {syncCanonicalReport} from '../src/lib/reportingSync.js';
const env={REPORTING_SYNC_ENABLED:'staging-approved',REPORTING_SUPABASE_URL:'https://hkfgzbeoobfnilrzpxwj.supabase.co',REPORTING_PUBLIC_KEY:'sb_publishable_mock',REPORTING_SPREADSHEET_ID:'synthetic-reporting-id-0001',REPORTING_ALLOWED_SPREADSHEET_IDS:'synthetic-reporting-id-0001',REPORTING_MASTERPLAN_ID:'blocked-id',REPORTING_SCRIPT_URL:'https://script.google.com/macros/s/mock/exec',REPORTING_HMAC_SECRET:'mock-only-secret-not-a-live-key-000',REPORTING_DESTINATION_VERSION:'1'};
const config=syncConfig(env),snapshot=createCanonicalExportSnapshot(exportFixture(),'admin');
function script(){
 const props=new Map(Object.entries({REPORTING_SPREADSHEET_ID:config.id,MASTERPLAN_ID:'blocked-id',REPORTING_ONLY:'true',DESTINATION_VERSION:'1',HMAC_SECRET:config.secret}));
 const names=snapshot.tabs.map(t=>t.title).concat(['Metadata','_Sync']);
 const state={reads:0,writes:0,stamp:[],fail:null,requests:[]};
 const context={PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},Utilities:{DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(_,s)=>[...createHash('sha256').update(s).digest()],computeHmacSha256Signature:(s,k)=>[...createHmac('sha256',k).update(s).digest()]},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},Sheets:{Spreadsheets:{get:()=>{state.reads++;return {sheets:names.map((title,sheetId)=>({properties:{title,sheetId,gridProperties:{rowCount:100,columnCount:30}}}))};},Values:{get:()=>({values:[state.stamp]})},batchUpdate:({requests})=>{state.writes++;if(state.fail==='before')throw Error('mock failure');state.requests=requests;state.stamp=requests.at(-1).updateCells.rows[0].values.map(v=>v.userEnteredValue.stringValue);if(state.fail==='after')throw Error('lost response');}}},ContentService:{MimeType:{JSON:1},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})}};
 vm.createContext(context);vm.runInContext(readFileSync(new URL('../docs/phase4c4-review/ReportingSync.gs',import.meta.url),'utf8'),context);
 return {state,props,send:q=>context.doPost({postData:{contents:JSON.stringify(q)}})};
}
async function envelope(s=snapshot){let q;await scriptSync(config,s,async(_url,options)=>{q=JSON.parse(options.body);return {ok:true,json:async()=>({status:'complete',hash:q.payloadHash,destination:config.id,completedAt:'mock'})};});return q;}
test('canonical seven tabs plus evidence exceptions and metadata; raw strings preserve Thai/zeros/decimals/formulas',async()=>{
 const h=script(),q=await envelope();assert.equal(h.send(q).status,'complete');assert.equal(h.state.requests.length,12);
 for(let i=0;i<snapshot.tabs.length;i++)assert.equal(JSON.stringify(h.state.requests[i].updateCells.rows.slice(1).map(r=>Array.from(r.values,v=>v.userEnteredValue.stringValue))),JSON.stringify(snapshot.tabs[i].rows.map(r=>r.map(v=>v==null?'':String(v)))));
 assert.match(JSON.stringify(h.state.requests),/00001/);assert.match(JSON.stringify(h.state.requests),/ไทย/);assert.ok(!JSON.stringify(h.state.requests).includes('formulaValue'));
});
test('identical retry returns stored success without another write',async()=>{const h=script(),q=await envelope();assert.equal(h.send(q).status,'complete');assert.equal(h.send(q).status,'complete');assert.equal(h.state.writes,1);});
test('lost successful response recovers from atomic stamp',async()=>{const h=script(),q=await envelope();h.state.fail='after';assert.equal(h.send(q).status,'recovery_required');assert.equal(h.send(q).status,'complete');assert.equal(h.state.writes,1);});
test('uncertain noncommitted request blocks automatic retry and different reports',async()=>{const h=script(),q=await envelope();h.state.fail='before';assert.equal(h.send(q).status,'recovery_required');h.state.fail=null;assert.equal(h.send(q).status,'recovery_required');assert.equal(h.state.writes,1);});
for(const field of ['signature','payload','destination','timestamp'])test(`tampered ${field} rejected before Google access`,async()=>{const h=script(),q=await envelope();q[field]=field==='timestamp'?0:'tampered';assert.equal(h.send(q).status,'recovery_required');assert.equal(h.state.reads,0);});
test('missing mapping rejected before Google access',async()=>{const h=script(),s=structuredClone(snapshot);s.metadata.mapping_revision=null;assert.equal(h.send(await envelope(s)).status,'recovery_required');assert.equal(h.state.reads,0);});
test('missing config / wrong target / Masterplan fail closed',()=>{for(const e of [{},{...env,REPORTING_SUPABASE_URL:'https://other.invalid'},{...env,REPORTING_SPREADSHEET_ID:'blocked-id'}])assert.throws(()=>syncConfig(e));});
for(const role of ['staff','purchasing',null])test(`server rejects ${role} before report reads`,async()=>{
 const client={auth:{getUser:async()=>({data:{user:role?{id:'user'}:null}})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role}})})})})};
 const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;}};
 await reportingSyncHandler({env,createClient:()=>client,fetcher:()=>{throw Error('must not call');}})({method:'POST',headers:{authorization:'Bearer mock'},body:{}},res);assert.equal(res.code,role?403:401);
});
test('transport rejects untrusted redirects',async()=>{await assert.rejects(scriptSync(config,snapshot,async()=>({status:302,headers:{get:()=> 'https://attacker.invalid/'}})));});
test('Google recovery-required becomes an actionable controlled error',async()=>{await assert.rejects(scriptSync(config,snapshot,async()=>({ok:true,json:async()=>({status:'recovery_required'})})),e=>e.code==='RECOVERY_REQUIRED'&&e.status===409);});
test('older authenticated report cannot overwrite a newer completion',async()=>{const h=script(),q=await envelope();h.state.stamp=['different-hash','mock',String(q.timestamp+1)];assert.equal(h.send(q).status,'recovery_required');assert.equal(h.state.writes,0);});
test('browser sends filters and hash only; unavailable response controlled; mapping required',async()=>{
 await assert.rejects(syncCanonicalReport(exportFixture(),{token:'mock',fetcher:async(_u,o)=>{const body=JSON.parse(o.body);assert.equal(Object.keys(body).length,5);assert.ok(body.snapshotHash);assert.equal(o.cache,'no-store');return {ok:false,json:async()=>({code:'UNAVAILABLE'})};}}),/not configured/);
 await assert.rejects(syncCanonicalReport({...exportFixture(),mapping_revision:null},{token:'mock'}));
});
test('Admin server uses caller credentials and verifies exact canonical hash before transport',async()=>{
 const body={from:'2026-10-01',to:'2026-10-31',mappingRevision:snapshot.metadata.mapping_revision,cutoffSequence:'99',snapshotHash:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
 let reads=0,sends=0;
 const client={auth:{getUser:async()=>({data:{user:{id:'admin-user'}}})},from:name=>{assert.equal(name,'profiles');return {select:()=>({eq:(column,id)=>{assert.equal(column,'id');assert.equal(id,'admin-user');return {single:async()=>({data:{role:'admin'}})};}})};}};
 const handler=reportingSyncHandler({env,createClient:(url,key,options)=>{assert.equal(url,config.url);assert.equal(key,env.REPORTING_PUBLIC_KEY);assert.equal(options.global.headers.Authorization,'Bearer mock');return client;},readReport:async(c,b)=>{assert.equal(c,client);assert.equal(b.cutoffSequence,'99');reads++;return exportFixture();},fetcher:async(_u,o)=>{sends++;const q=JSON.parse(o.body);return {ok:true,json:async()=>({status:'complete',hash:q.payloadHash,destination:q.destination,completedAt:'mock'})};}});
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;}};
 await handler({method:'POST',headers:{authorization:'Bearer mock'},body},res);assert.equal(res.code,200);assert.equal(sends,1);assert.match(res.headers['Cache-Control'],/no-store/);
 await handler({method:'POST',headers:{authorization:'Bearer mock'},body:{...body,snapshotHash:'0'.repeat(64)}},res);assert.equal(res.code,409);assert.equal(sends,1);assert.equal(reads,2);
});
