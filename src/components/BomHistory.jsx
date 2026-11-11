import React,{useState} from 'react';
export function BomHistory({api,modelId,role}) {
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(role!=='admin')return null;
 async function load(){setBusy(true);setError('');try{const r=await api.bom_history({model_id:modelId});setData(r.entries);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section aria-label="ประวัติแก้ BOM"><button type="button" disabled={busy} onClick={load}>ดูประวัติแก้ BOM</button>
 <p>แสดงล่าสุด 100 รายการ · ผู้แก้แสดงด้วย UUID · คำขอเดิมรวมงานค้างใช้ snapshot เดิม</p>
 {busy&&<p role="status">กำลังโหลด…</p>}{error&&<p role="alert">{error}</p>}
 {data?.length===0&&<p>ยังไม่มีประวัติที่บันทึกด้วยระบบนี้</p>}
 {data?.map(e=><details key={e.operation_id}><summary>{e.changed_at} · {e.actor_id} · {e.reason}</summary>{['before_bom','after_bom'].map(k=><div key={k}><strong>{k==='before_bom'?'ก่อน':'หลัง'}</strong><ul>{e[k].map(b=><li key={b.material_id}>{b.material_id}: {b.qty}</li>)}</ul></div>)}</details>)}
 </section>;
}
