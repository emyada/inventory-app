import React, {useState} from 'react';
import {X, Plus, MoreHorizontal} from 'lucide-react';
import {decimal} from '../lib/inventoryManagement.js';

export function ModalHeader({title,onClose,busy=false}) {
 return <header className="inv-modal-header"><h2>{title}</h2><button type="button" className="inv-icon" aria-label="ปิด" title="ปิด" disabled={busy} onClick={onClose}><X size={20}/></button></header>;
}
export function Overflow({label,children}) {
 return <details className="inv-overflow"><summary aria-label={label} title={label}><MoreHorizontal size={20}/></summary><div className="inv-overflow-body">{children}</div></details>;
}
export function BomEditor({materials,rows,onChange}) {
 const [materialId,setMaterialId]=useState(''),[quantity,setQuantity]=useState('1'),[error,setError]=useState('');
 function add(){try{
  const material=materials.find(m=>m.id===materialId&&m.is_active!==false);
  if(!material)throw new Error('เลือกวัตถุดิบ');
  if(rows.some(r=>r.material_id===materialId))throw new Error('มีวัตถุดิบนี้แล้ว แก้จำนวนในรายการเดิมได้');
  const qty=decimal(quantity,true);onChange([...rows,{material_id:materialId,qty}]);setMaterialId('');setQuantity('1');setError('');
 }catch(e){setError(e.message);}}
 function enter(e){if(e.key==='Enter'){e.preventDefault();add();}}
 return <section aria-label="BOM" className="inv-bom-editor"><h3>BOM</h3><div className="inv-bom-entry">
 <label>วัตถุดิบ<select value={materialId} onChange={e=>setMaterialId(e.target.value)} onKeyDown={enter}><option value="">เลือกวัตถุดิบ</option>{materials.filter(m=>m.is_active!==false&&!rows.some(r=>r.material_id===m.id)).map(m=><option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}</select></label>
 <label>จำนวน<input inputMode="decimal" value={quantity} onChange={e=>setQuantity(e.target.value)} onKeyDown={enter}/></label>
 <button type="button" className="inv-icon" aria-label="เพิ่มวัตถุดิบใน BOM" title="เพิ่มวัตถุดิบ" onClick={add}><Plus size={20}/></button></div>
 {error&&<p role="alert">{error}</p>}
 <ul className="inv-bom-rows">{rows.map((row,i)=>{const m=materials.find(m=>m.id===row.material_id);return <li key={row.material_id+':'+i}><span>{m?.name||row.material_id}<small>{m?.unit}{m?.is_active===false?' · ปิดใช้งาน':''}</small></span><input aria-label={'จำนวน '+(m?.name||row.material_id)} required inputMode="decimal" value={row.qty} onChange={e=>onChange(rows.map((r,j)=>i===j?{...r,qty:e.target.value}:r))}/><button type="button" className="inv-icon" aria-label={'นำ '+(m?.name||row.material_id)+' ออกจาก BOM'} title="นำออก" onClick={()=>onChange(rows.filter((_,j)=>j!==i))}><X size={18}/></button></li>;})}</ul>
 </section>;
}
