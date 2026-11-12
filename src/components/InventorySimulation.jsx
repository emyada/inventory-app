import React, {useEffect, useState} from 'react';
import {managementCatalog} from '../lib/inventoryModelCatalog.js';
import {loadSimulationCatalog, calculateSimulation, loadSimulationAvailability, simulationCategories, simulationSelectionReady} from '../lib/inventorySimulation.js';
import './InventoryReportTools.css';

export function InventorySimulation({api, role, catalogReader = managementCatalog}) {
  const [catalog,setCatalog]=useState(null), [entries,setEntries]=useState([]), [result,setResult]=useState(null);
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [reload,setReload]=useState(0);
  useEffect(()=>{let live=true;
    loadSimulationCatalog({listMaterials:()=>api.list_materials({include_inactive:true}),listModels:()=>catalogReader.listModels()},role)
      .then(value=>loadSimulationAvailability(value,id=>catalogReader.loadBom(id)))
      .then(value=>{if(live){setCatalog(value);setError('');}}).catch(()=>{if(live)setError('อ่านข้อมูลไม่ได้ กรุณาลองโหลดใหม่');});
    return()=>{live=false;};
  },[api,role,catalogReader,reload]);
  if (!['admin','purchasing'].includes(role)) return null;
  function edit(i,patch){setEntries(rows=>rows.map((row,n)=>n===i?{...row,...patch}:row));setResult(null);setError('');}
  async function calculate(){setBusy(true);setResult(null);setError('');try{
    // Refresh stock at calculation time; period closing stock is never used as current stock.
    const fresh=await loadSimulationCatalog({listMaterials:()=>api.list_materials({include_inactive:true}),listModels:()=>catalogReader.listModels()},role);
    const checked=await loadSimulationAvailability(fresh,id=>catalogReader.loadBom(id));
    setCatalog(checked);
    if(!simulationSelectionReady(checked,entries))throw new Error('รุ่นหรือ BOM ใช้งานไม่ได้ กรุณาตรวจรายการที่เลือก');
    const answer=await calculateSimulation(fresh,entries,id=>catalogReader.loadBom(id));
    setResult(answer.rows);
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  const categories=simulationCategories(catalog?.models||[]);
  return <section className="report-simulation" aria-label="เครื่องคำนวณจำลองสต็อก">
    <h3>เครื่องคำนวณ Using / Used</h3>
    <p className="simulation-warning">ค่าจำลองเท่านั้น ไม่ใช่สต็อกพร้อมใช้จริง · ไม่บันทึกหรือเปลี่ยนสต็อก/ออเดอร์</p>
    <p>Using: สมมติว่าวัตถุดิบที่เคยเบิกสำหรับงานยังไม่เสร็จยังเหลืออยู่ จึงบวกกลับเฉพาะในการจำลอง · Used: ใช้ไปแล้ว ไม่บวกกลับ</p>
    <p className="inv-muted">ไม่ได้ตรวจยืนยันว่ายอด Using เคยเบิกหรือยังไม่ถูกใช้จริง ใช้ BOM ปัจจุบันตามรุ่นที่เลือก ไม่คำนวณประวัติออเดอร์ใหม่ ไม่แปลงคู่/ข้างหรือหน่วย</p>
    {!catalog&&!error&&<p role="status">กำลังอ่านรุ่นและสต็อก…</p>}
    <fieldset disabled={busy||!catalog} className="simulation-inputs">
      {entries.map((entry,i)=><div className="simulation-entry" key={i}>
        <label>หมวด {i+1}<select value={entry.category} onChange={e=>edit(i,{category:e.target.value,model_id:''})}><option value="">เลือกหมวด</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
        <label>รุ่น<select value={entry.model_id} onChange={e=>edit(i,{model_id:e.target.value})}><option value="">เลือกรุ่น</option>{(catalog?.models||[]).filter(m=>m.category===entry.category).map(m=><option key={m.id} value={m.id}>{m.name}{m.is_active===false?' (ปิดใช้งาน)':''}{!catalog.availability[m.id]?.valid?' — คำนวณไม่ได้':''}</option>)}</select></label>
        <label>จำนวนรุ่น<input inputMode="decimal" value={entry.quantity} onChange={e=>edit(i,{quantity:e.target.value})}/></label>
        <label>สมมติฐาน<select value={entry.mode} onChange={e=>edit(i,{mode:e.target.value})}><option>Using</option><option>Used</option></select></label>
        <button type="button" aria-label={`ลบรายการ ${i+1}`} onClick={()=>{setEntries(rows=>rows.filter((_,n)=>n!==i));setResult(null);}}>ลบ</button>
        {catalog&&entry.model_id&&!catalog.availability[entry.model_id]?.valid&&<p role="status">{catalog.availability[entry.model_id]?.reason||'ไม่พบรุ่นนี้หลังรีเฟรช'} · ไม่สามารถคำนวณรายการนี้</p>}
      </div>)}
      <div className="inv-actions"><button type="button" onClick={()=>{setEntries(rows=>[...rows,{category:'',model_id:'',quantity:'1',mode:'Using'}]);setResult(null);}}>+ เพิ่มรุ่น / หมวด</button><button type="button" disabled={!simulationSelectionReady(catalog,entries)} onClick={calculate}>{busy?'กำลังคำนวณ…':'คำนวณจำลอง'}</button></div>
    </fieldset>
    <button type="button" disabled={busy} onClick={()=>{setCatalog(null);setResult(null);setReload(n=>n+1);}}>อ่านข้อมูลใหม่</button>
    {error&&<p role="alert">{error} · ไม่แสดงผลคำนวณบางส่วน</p>}
    {result&&<><p className="inv-muted">สต็อกอ่านเมื่อ {new Date(catalog.capturedAt).toLocaleString('th-TH')} · BOM และสต็อกอาจเปลี่ยนภายหลัง ไม่ใช่การจองสต็อก</p><div className="inv-table-scroll"><table><thead><tr>{['วัตถุดิบ / หน่วย','Total BOM','Simulated Unused (สมมติ)','Current Stock','Simulated Combined Total (สมมติ)'].map(title=><th key={title}>{title}</th>)}</tr></thead><tbody>{result.map(row=><tr key={row.material_id}><td>{row.material_name} · {row.unit}</td><td>{row.total_bom}</td><td className="simulation-value">{row.simulated_unused}</td><td>{row.current_stock}</td><td className="simulation-value">{row.simulated_combined_total}</td></tr>)}</tbody></table></div><p>Simulated Combined Total = Current Stock + Simulated Unused · Total BOM รวมทั้ง Using และ Used</p></>}
  </section>;
}
