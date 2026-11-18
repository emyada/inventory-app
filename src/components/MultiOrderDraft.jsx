import {previewReference} from '../lib/requestReferences.js';
import React from 'react';
// `model` given = one model only: the model is fixed and rows differ by order number only.
export function MultiOrderDraft({rows,onChange,models,reviewed,onReviewedChange,model}) {
 const change=next=>{onChange(next);onReviewedChange(false);};
 const rowModel=row=>model||models.find(m=>m.id===row.model_id);
 return <section aria-label={model?'หลายออเดอร์ รุ่นเดียว':'หลายออเดอร์หลายรุ่น'}>
 {model&&<p><strong>รุ่น: {model.name}</strong> ({model.category}) — ทุกออเดอร์ด้านล่างเป็นรุ่นนี้เท่านั้น</p>}
 <p>แต่ละแถวเป็นหนึ่งออเดอร์ แยกการบันทึกและการยกเลิก ส่งทีละรายการและหยุดเมื่อยืนยันผลไม่ได้</p>
 {rows.map((row,i)=><div className="inv-bom-line" key={i}>
  {!model&&<label>รุ่น {i+1}<select required value={row.model_id} onChange={e=>change(rows.map((r,j)=>i===j?{...r,model_id:e.target.value}:r))}><option value="">เลือกรุ่น</option>{models.map(m=><option key={m.id} value={m.id}>{m.category} · {m.name}</option>)}</select></label>}
  <label>เลขออเดอร์ {i+1}<input required value={row.order_ref} onChange={e=>change(rows.map((r,j)=>i===j?{...r,order_ref:e.target.value}:r))}/></label>
  {rowModel(row)?.work_kind==='supplemental'&&<label>Package<select required value={row.work_mode||''} onChange={e=>change(rows.map((r,j)=>i===j?{...r,work_mode:e.target.value}:r))}><option value="">เลือกประเภท</option><option value="bundled_package">ออร์เดอร์ CIEM</option><option value="standalone_package">ขายแยก / Others</option></select></label>}
  <p>{(()=>{try{return previewReference(rowModel(row),row.order_ref).canonical;}catch(e){return e.message;}})()}</p>
  <button type="button" disabled={rows.length===1} onClick={()=>change(rows.filter((_,j)=>j!==i))}>นำแถว {i+1} ออก</button>
 </div>)}
 <button type="button" onClick={()=>change([...rows,{model_id:model?.id||'',order_ref:''}])}>{model?'เพิ่มออเดอร์':'เพิ่มออเดอร์ / รุ่น'}</button>
 <p>ใช้ BOM ของแต่ละรุ่นที่เซิร์ฟเวอร์บันทึกตอนส่ง ไม่แก้จำนวน BOM จากหน้านี้</p>
 <label><input type="checkbox" required checked={reviewed} onChange={e=>onReviewedChange(e.target.checked)}/> {model?'ตรวจเลขออเดอร์ทุกแถวแล้ว':'ตรวจรุ่นและเลขออเดอร์ทุกแถวแล้ว'}</label>
 </section>;
}
