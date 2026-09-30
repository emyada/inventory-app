import React,{useEffect,useState} from 'react';
import {ReportTable} from './InventoryReports.jsx';
import {reportCSV,sumAmounts,negative} from '../lib/inventoryReports.js';
import {downloadCSV} from '../utils/csv.js';
export function InventoryFinishedStock({api,role,revision,onAction,actionBusy}) {
 const [rows,setRows]=useState([]);const [error,setError]=useState(null);const [busy,setBusy]=useState(true);
 useEffect(()=>{let alive=true;setBusy(true);setError(null);api.list_finished_stock().then(r=>{if(!Array.isArray(r))throw new Error('ข้อมูลสินค้าสำเร็จรูปไม่ครบ');if(alive)setRows(r);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setBusy(false);});return()=>{alive=false;};},[api,revision]);
 return <section><h3>สินค้าสำเร็จรูป Universal</h3>{busy&&<p>กำลังโหลด…</p>}{error&&<p role="alert">{error}</p>}{!busy&&!error&&!rows.length&&<p>ยังไม่มีสินค้าสำเร็จรูป</p>}{!busy&&!error&&rows.map(r=><article className="inv-card" key={r.model_id}><h4>{r.model_name}</h4><strong>คงเหลือ {r.qty} ชิ้น</strong>{role==='admin'&&(r.available_packs||[]).map(pack=><p key={pack.request_id}>{pack.model_name} · {pack.staff_name} · {new Date(pack.created_at).toLocaleString('th-TH')} <button disabled={actionBusy} onClick={()=>onAction({kind:'issue_finished',row:pack})}>นำออก 1 ชิ้น</button></p>)}</article>)}</section>;
}
const columns=[['model_id','รหัสรุ่น'],['model_name','รุ่น'],['opening','ยกมา'],['packed','แพ็กเข้า'],['outflow','นำออก'],['packing_reversed','ย้อนงานแพ็ก'],['closing','คงเหลือ']];
export function InventoryFinishedReport({api,from,to,revision}) {
 const [state,setState]=useState({busy:true});
 useEffect(()=>{let alive=true;setState({busy:true});api.finished_balance_report({date_from:from,date_to:to,timezone:'Asia/Bangkok'}).then(data=>{
  if(!Array.isArray(data?.models)||!Array.isArray(data?.movements))throw new Error('ข้อมูลรายงานสำเร็จรูปไม่ครบ');
  if(data.models.some(r=>sumAmounts([r.opening,r.packed,negative(r.outflow),negative(r.packing_reversed)])!==sumAmounts([r.closing])))throw new Error('ยอดสินค้าสำเร็จรูปไม่ตรง กรุณาโหลดใหม่');
  if(alive)setState({busy:false,data});
 }).catch(e=>{if(alive)setState({busy:false,error:e.message});});return()=>{alive=false;};},[api,from,to,revision]);
 return <section><h3>สินค้าสำเร็จรูป Universal — แยกจากวัตถุดิบ</h3>{state.busy&&<p>กำลังโหลด…</p>}{state.error&&<p role="alert">{state.error}</p>}{state.data&&<><ReportTable rows={state.data.models} columns={columns}/><button onClick={()=>downloadCSV(`finished_${from}_${to}.csv`,reportCSV(state.data.models,columns,{from,to,timezone:'Asia/Bangkok',cutoff:state.data.cutoff_sequence}))}>ส่งออกยอดสินค้าสำเร็จรูป</button><ReportTable rows={state.data.movements.map(m=>({...m,kind_label:({pack_in:'แพ็กเข้า',out:'นำออก',pack_cancel:'ย้อนงานแพ็ก'})[m.kind]}))} columns={[["model_name","รุ่น ณ เวลาทำรายการ"],["kind_label","รายการ"],["delta","จำนวน"],["qty_before","ก่อน"],["qty_after","หลัง"],["reference","อ้างอิง"],["note","หมายเหตุ"]]}/></>}</section>;
}
