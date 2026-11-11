export async function snapshotDigest(snapshot) {
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot)));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function syncCanonicalReport(report,{token,fetcher=fetch}) {
 const {createCanonicalExportSnapshot}=await import('./reportingExport.js');
 const snapshot=createCanonicalExportSnapshot(report,'admin');
 const body={from:report.date_from,to:report.date_to,mappingRevision:report.mapping_revision,cutoffSequence:report.cutoff_sequence,snapshotHash:await snapshotDigest(snapshot)};
 if(!token)throw new Error('Sign in again before synchronizing.');
 const response=await fetcher('/api/reporting-sync',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
 const result=await response.json().catch(()=>({code:'UNAVAILABLE'}));
 if(result.code==='RECOVERY_REQUIRED')throw new Error('Sync paused. Ask the maintainer to inspect the reporting sync marker and configuration; no automatic retry was performed.');
 if(!response.ok||result.status!=='complete')throw new Error(result.code==='REPORT_CHANGED'?'Report changed. Reload before syncing.':result.code==='UNAVAILABLE'?'Google sync is not configured for this environment.':'Sync not confirmed. Retry the same loaded report; do not change the period until resolved.');
 return result;
}
