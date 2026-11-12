import {useRefreshRead} from '../hooks/useRefreshRead.js';
import React, {useState} from 'react';
import {REPORT_VIEWS,modelKey,selectReport,fetchReportingView} from '../lib/reportingView.js';
import './CanonicalReports.css';
import {ReportingSync} from './ReportingSync.jsx';
function Table({rows,columns}) {
 const [page,setPage]=useState(0); const last=Math.max(0,Math.ceil(rows.length/25)-1),current=Math.min(page,last);
 return <><div className="inv-table-scroll"><table><thead><tr>{columns.map(([k,label])=><th key={k}>{label}</th>)}</tr></thead><tbody>{rows.slice(current*25,current*25+25).map((r,i)=><tr key={i}>{columns.map(([k])=><td key={k}>{r[k]==null?'—':String(r[k])}</td>)}</tr>)}</tbody></table></div>{!rows.length&&<p>ไม่มีข้อมูลในช่วงที่เลือก</p>}{last>0&&<div className="inv-actions"><button disabled={!current} onClick={()=>setPage(current-1)}>ก่อนหน้า</button><span>{current+1}/{last+1}</span><button disabled={current===last} onClick={()=>setPage(current+1)}>ถัดไป</button></div>}</>;
}
export function ReportingResult({state,view,model,onModel}) {
 if(state.status==='denied') return <p role="alert">ไม่มีสิทธิ์ — รายงานนี้สำหรับ Admin เท่านั้น</p>;
 if(state.status==='mapping') return <p role="status">ต้องอนุมัติชุดจัดหมวดสินค้าก่อน กรุณาขอรหัสชุดข้อมูล (Mapping UUID) จากผู้ดูแล จึงจะสรุปยอดได้</p>;
 if(state.status==='loading') return <p role="status">กำลังโหลดรายงาน…</p>;
 if(state.status==='error') return <p role="alert">{state.message}</p>;
 if(state.status!=='ready') return <p>เลือกช่วงวันที่และชุดจัดหมวดสินค้า แล้วกดโหลดรายงาน</p>;
 const report=state.report, selected=selectReport(report,view,model);
 const options=selectReport(report,view).products;
 const materials=selected.materials.map(row=>({...row,material_name:report.evidence.find(e=>e.material_id===row.material_id)?.material_name||row.material_id}));
 return <>
  <p>Asia/Bangkok · {report.date_from} – {report.date_to} · ข้อมูลถึงรายการที่ {report.cutoff_sequence}</p>
  <p className="inv-muted">ชุดจัดหมวดสินค้า {report.mapping_revision} · นับคำขอหลักจากการเบิกจริงครั้งแรกเท่านั้น Package เพิ่มการใช้วัตถุดิบ แต่ไม่เพิ่มจำนวนออเดอร์</p>
  {report.warnings.length>0&&<aside role="status"><strong>มีรายการยังไม่จัดหมวดหรือหลักฐานที่ต้องตรวจสอบ — ไม่ถือว่าเป็นยอดครบถ้วนที่ยืนยันแล้ว</strong><Table rows={report.warnings} columns={[["code","คำเตือน"],["request_id","รหัสคำขอ (Request UUID)"],["material_id","รหัสวัตถุดิบ"]]}/></aside>}
  {view!=='All Materials'&&<>
   <label>รุ่นสินค้า<select value={model} onChange={e=>onModel(e.target.value)}><option value="">ทุกรุ่น</option>{options.map(p=><option key={modelKey(p)} value={modelKey(p)}>{p.report_category} / {p.model_name}</option>)}</select></label>
   <h3>จำนวนคำขอหลัก</h3><Table rows={selected.products} columns={[["report_category","หมวด"],["model_name","รุ่น"],["request_count","ออเดอร์เบิกครั้งแรก"],["ambiguous_count","อ้างอิงกำกวม"]]}/>
  </>}
  <h3>การใช้วัตถุดิบ{view==='All Materials'?'ทั้งหมด':'ตามรุ่น'}</h3>
  <Table key={view+model} rows={materials} columns={[...(view==='All Materials'?[]:[["report_category","หมวด"],["model_name","รุ่น"]]),["material_name","วัตถุดิบ"],["unit","หน่วย"],["gross_issued","เบิกทั้งหมด"],["returned","คืนเข้าคลัง"],["net_consumption","ใช้สุทธิ"]]}/>
  {view!=='All Materials'&&<details><summary>รายละเอียดออเดอร์ ({selected.orders.length})</summary><Table rows={selected.orders} columns={[["order_ref","อ้างอิง"],["request_id","รหัสคำขอ (Request UUID)"],["model_name","รุ่น"],["first_issue_at","วันเวลาเบิกครั้งแรก (พร้อมเขตเวลา)"],["identity_ambiguous","กำกวม"]]}/></details>}
  <details><summary>หลักฐานการใช้ / แพ็กเกจ / ยังไม่จัดหมวด</summary><Table rows={selected.evidence} columns={[["order_ref","อ้างอิง"],["request_id","รหัสคำขอ (Request UUID)"],["model_name","รุ่น / การจัดกลุ่ม"],["primary_request_id","คำขอหลัก"],["material_name","วัตถุดิบ"],["unit","หน่วย"],["gross_issued","เบิก"],["returned","คืน"]]}/></details>
 </>;
}
export function CanonicalExportControls({state,role}) {
 const [progress,setProgress]=useState(null);
 const busy=progress?.state===state&&progress.status==='busy';
 const enabled=role==='admin'&&state.status==='ready'&&!!state.report?.mapping_revision;
 async function exportFile(format){
  if(!enabled||busy)return;
  setProgress({state,status:'busy',message:'กำลังสร้างไฟล์…'});
  try {
   const {createCanonicalExport,downloadCanonicalExport}=await import('../lib/reportingExport.js');
   downloadCanonicalExport(createCanonicalExport(state.report,role,format));
   setProgress({state,status:'success',message:'สร้างไฟล์แล้วและส่งให้เบราว์เซอร์ดาวน์โหลด'});
  } catch {setProgress({state,status:'error',message:'ส่งออกไม่สำเร็จ ข้อมูลอาจเกินขีดจำกัด ไม่มีการส่งออกบางส่วน'});}
 }
 if(role!=='admin')return null;
 return <div className="canonical-export">
  <div className="inv-actions"><button type="button" disabled={!enabled||busy} onClick={()=>exportFile('xlsx')}>Excel (.xlsx)</button><button type="button" disabled={!enabled||busy} onClick={()=>exportFile('zip')}>CSV (.zip)</button></div>
  <p className="inv-muted">ส่งออกทุกหมวดในช่วงวันที่ที่โหลด ไม่จำกัดตามแท็บหรือรุ่นที่เปิด · CSV: นำเข้ารหัสและทศนิยมเป็น Text เพื่อรักษาเลขศูนย์นำหน้าและความแม่นยำ</p>
  {!enabled&&<p>ต้องโหลดรายงานด้วยชุดจัดหมวดสินค้าที่อนุมัติก่อนส่งออก</p>}
  {progress?.state===state&&<p role={progress.status==='error'?'alert':'status'}>{progress.message}</p>}
 </div>;
}
export function CanonicalReports({api,role,revision,compact=false}) {
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const [from,setFrom]=useState(today.slice(0,8)+'01'),[to,setTo]=useState(today),[mapping,setMapping]=useState('');
 const [overview,setOverview]=useState('Product Category');
 const [view,setView]=useState('All Products'),[model,setModel]=useState(''),[request,setRequest]=useState(null),[state,setState]=useState({status:'mapping'});
 useRefreshRead(async()=>{if(!request)return null;const result=await fetchReportingView(api,role,request);if(result.status==='error')throw new Error(result.message);return result;},result=>{if(result)setState({...result,request,revision,api});},e=>setState({status:'error',message:e.message,request,revision,api}),[api,role,request,revision]);
 const change=setter=>event=>{setter(event.target.value);setRequest(null);setState({status:'idle'});setModel('');};
 const displayed=request&&(state.request!==request||state.revision!==revision||state.api!==api)?{status:'loading'}:state;
 if(role!=='admin') return <ReportingResult state={{status:'denied'}}/>;
 return <section className="canonical-reports" aria-label="รายงานการเบิกจริง">
  <h2>{compact?'สรุปการเบิกจริง':'รายงานการเบิกจริง'}</h2>
  <form className="inv-filters" onSubmit={e=>{e.preventDefault();setModel('');setRequest({from,to,mappingRevision:mapping.trim()});}}>
   <label>ตั้งแต่ (Bangkok)<input type="date" required value={from} onChange={change(setFrom)}/></label>
   <label>ถึง (Bangkok)<input type="date" required value={to} onChange={change(setTo)}/></label>
   <label>รหัสชุดจัดหมวดสินค้าที่อนุมัติ (Mapping UUID)<input value={mapping} onChange={change(setMapping)} autoComplete="off" placeholder="UUID ของ Mapping ที่อนุมัติแล้ว"/></label>
   <button disabled={displayed.status==='loading'}>โหลดรายงาน</button>
  </form>
  {compact?<><nav className="inv-subnav" aria-label="มุมมองภาพรวม">{['Product Category','Material','Technician'].map(v=><button key={v} aria-pressed={overview===v} onClick={()=>setOverview(v)}>{v}</button>)}</nav><CompactReport state={displayed} view={overview}/></>:<><nav className="inv-subnav" aria-label="มุมมองรายงาน">{[...REPORT_VIEWS,'Unmapped'].map(v=><button key={v} aria-pressed={view===v} onClick={()=>{setView(v);setModel('');}}>{v}</button>)}</nav>
  <CanonicalExportControls state={displayed} role={role}/>
  <ReportingSync state={displayed} role={role}/>
  <ReportingResult state={displayed} view={view} model={model} onModel={setModel}/></>}
 </section>;
}

export function CompactReport({state,view}) {
 if(state.status!=='ready')return <ReportingResult state={state}/>;
 const r=state.report;
 if(view==='Technician')return <p role="status">ยังไม่มีข้อมูลผู้เบิกและจำนวนออเดอร์ต่อช่างที่ยืนยันจาก Reporting Engine ไม่ใช้ผู้ยื่นคำขอแทนผู้เบิก</p>;
 const categories=Object.entries(r.products.reduce((a,p)=>({...a,[p.report_category]:(a[p.report_category]||0)+p.request_count}),{}));
 return <><p>คำขอหลัก {r.order_count} · วัตถุดิบ {r.materials.length} · ข้อควรตรวจสอบ {r.warnings.length}</p>{r.warnings.length>0&&<p role="status">มีรายการยังไม่จัดหมวด / ข้อมูลกำกวม กรุณาดูรายงานฉบับเต็ม</p>}{view==='Product Category'?<ul>{categories.map(([name,count])=><li key={name}>{name}: {count}</li>)}</ul>:<Table rows={r.materials.map(m=>({...m,material_name:r.evidence.find(e=>e.material_id===m.material_id)?.material_name||m.material_id}))} columns={[["material_name","วัตถุดิบ"],["unit","หน่วย"],["gross_issued","เบิก"],["returned","คืน"],["net_consumption","ใช้สุทธิ"]]}/>}</>;
}
