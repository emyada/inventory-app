import {createHash,createHmac,randomUUID} from 'node:crypto';
import {loadReportingDataset} from '../src/lib/reportingEngine.js';
import {createCanonicalExportSnapshot} from '../src/lib/reportingExport.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const check=(condition,code,status=400)=>{if(!condition)throw Object.assign(new Error(code),{code,status});};
export function syncConfig(env){
 const id=env.REPORTING_SPREADSHEET_ID;
 check(env.REPORTING_SYNC_ENABLED==='staging-approved'&&env.REPORTING_SUPABASE_URL==='https://hkfgzbeoobfnilrzpxwj.supabase.co'&&env.REPORTING_PUBLIC_KEY?.startsWith('sb_publishable_'), 'UNAVAILABLE',503);
 check(/^[\w-]{20,}$/.test(id||'')&&env.REPORTING_ALLOWED_SPREADSHEET_IDS?.split(',').includes(id)&&env.REPORTING_MASTERPLAN_ID&&id!==env.REPORTING_MASTERPLAN_ID,'UNAVAILABLE',503);
 check(/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(env.REPORTING_SCRIPT_URL||'')&&env.REPORTING_HMAC_SECRET?.length>=32&&env.REPORTING_DESTINATION_VERSION,'UNAVAILABLE',503);
 return {url:env.REPORTING_SUPABASE_URL,key:env.REPORTING_PUBLIC_KEY,id,script:env.REPORTING_SCRIPT_URL,secret:env.REPORTING_HMAC_SECRET,version:env.REPORTING_DESTINATION_VERSION};
}
export async function scriptSync(config,snapshot,fetcher=fetch){
 const payload=JSON.stringify(snapshot),payloadHash=hash(payload);
 check(Buffer.byteLength(payload)<=1800000,'REPORT_TOO_LARGE',413);
 const envelope={destination:config.id,version:config.version,timestamp:Date.now(),nonce:randomUUID(),payloadHash,payload};
 envelope.signature=createHmac('sha256',config.secret).update(JSON.stringify([envelope.destination,envelope.version,envelope.timestamp,envelope.nonce,payloadHash])).digest('hex');
 let response=await fetcher(config.script,{method:'POST',redirect:'manual',headers:{'Content-Type':'text/plain'},body:JSON.stringify(envelope),signal:AbortSignal.timeout(60000)});
 if([302,303].includes(response.status)){
  const location=new URL(response.headers.get('location'));
  check(location.protocol==='https:'&&location.hostname==='script.googleusercontent.com'&&!location.username&&!location.password,'SYNC_UNCONFIRMED',502);
  response=await fetcher(location.href,{redirect:'error',signal:AbortSignal.timeout(60000)});
 }
 const result=await response.json();
 check(result.status!=='recovery_required','RECOVERY_REQUIRED',409);
 check(response.ok&&result.status==='complete'&&result.hash===payloadHash&&result.destination===config.id&&typeof result.completedAt==='string','SYNC_UNCONFIRMED',502);
 return {status:'complete',completedAt:result.completedAt,url:`https://docs.google.com/spreadsheets/d/${config.id}/edit`,hash:payloadHash};
}
export function reportingSyncHandler({env,createClient,fetcher=fetch,readReport=loadReportingDataset}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store, private');res.setHeader('Pragma','no-cache');res.setHeader('X-Content-Type-Options','nosniff');
  try{
   check(req.method==='POST','METHOD_NOT_ALLOWED',405);
   const config=syncConfig(env);
   const token=/^Bearer ([^\s]+)$/.exec(req.headers.authorization||'')?.[1];check(token,'UNAUTHORIZED',401);
   const client=createClient(config.url,config.key,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
   const {data,error}=await client.auth.getUser(token);check(!error&&data?.user?.id,'UNAUTHORIZED',401);
   const profile=await client.from('profiles').select('role').eq('id',data.user.id).single();check(!profile.error&&profile.data?.role==='admin','FORBIDDEN',403);
   const body=req.body;check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).sort().join(',')==='cutoffSequence,from,mappingRevision,snapshotHash,to','INVALID_REQUEST');
   check(/^[a-f0-9-]{36}$/.test(body.mappingRevision||'')&&/^\d+$/.test(String(body.cutoffSequence))&&/^[a-f0-9]{64}$/.test(body.snapshotHash||''),'INVALID_REQUEST');
   const report=await readReport(client,body),snapshot=createCanonicalExportSnapshot(report,'admin');
   check(hash(JSON.stringify(snapshot))===body.snapshotHash,'REPORT_CHANGED',409);
   res.status(200).json(await scriptSync(config,snapshot,fetcher));
  }catch(error){res.status(error.status||502).json({code:error.code||'SYNC_UNCONFIRMED'});}
 };
}
