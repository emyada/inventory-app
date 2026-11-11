import React,{useState,useRef} from 'react';
import {syncCanonicalReport} from '../lib/reportingSync.js';
export function ReportingSync({state,role,run=defaultRun,configured=import.meta.env?.VITE_REPORTING_SYNC_ENABLED==='true'}){
 const [result,setResult]=useState(null),[lastSuccess,setLastSuccess]=useState(null),[busy,setBusy]=useState(false),inFlight=useRef(false);
 const enabled=configured&&role==='admin'&&state.status==='ready'&&!!state.report?.mapping_revision;
 async function sync(){if(!enabled||inFlight.current)return;inFlight.current=true;setBusy(true);setResult(null);const report=state.report;try{const completed=await run(report);setResult({...completed,report});setLastSuccess(completed.completedAt);}catch(error){setResult({error:error.message,report});}finally{inFlight.current=false;setBusy(false);}}
 if(role!=='admin'||!configured)return null;
 return <div className="canonical-export"><button type="button" disabled={!enabled||busy} onClick={sync}>{busy?'กำลัง Sync…':'Sync to Google Sheets'}</button>
 {!enabled&&<p>ต้องโหลดรายงานด้วย Mapping ที่อนุมัติก่อน Sync</p>}
 {result&&result.report===state.report&&<p role={result.error?'alert':'status'}>{result.error||`Sync สำเร็จ · ล่าสุด ${result.completedAt}`}</p>}
 {lastSuccess&&<p>Last confirmed sync in this session: {lastSuccess}</p>}</div>;
}
async function defaultRun(report){const {supabase}=await import('../lib/supabaseClient.js');const {data}=await supabase.auth.getSession();return syncCanonicalReport(report,{token:data?.session?.access_token});}
