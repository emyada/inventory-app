import React,{useRef,useState} from 'react';
export function ReferenceHistory({api,reference,category}) {
 const [result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);const flight=useRef(false);
 const key=JSON.stringify([reference,category]);
 async function load(){if(flight.current)return;flight.current=true;setBusy(true);setError('');
 try{const rows=await api.reference_history({reference,category});if(!Array.isArray(rows))throw Error('Invalid history response');setResult({key,rows});}
 catch(e){setError(e.message);}finally{flight.current=false;setBusy(false);}}
 if(!reference.trim())return null;
 return <section><button type="button" disabled={busy} onClick={load}>ดูประวัติเลขอ้างอิงในหมวดนี้</button>
 <p>แสดงตามสิทธิ์และเลขอ้างอิง ไม่ใช่การยืนยันความสัมพันธ์ Package ในประวัติเก่า</p>
 {error&&<p role="alert">{error}</p>}{result?.key===key&&<ul>{result.rows.map(r=><li key={r.request_id}>{r.order_ref} · {r.category} · {r.issued_at?'มีประวัติเบิก':'ยังไม่เบิก'} · {r.request_id}</li>)}{!result.rows.length&&<li>ไม่พบประวัติที่มีสิทธิ์อ่าน</li>}</ul>}</section>;
}
