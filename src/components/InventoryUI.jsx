import React, {useEffect, useRef, useState} from 'react';
import {X, Plus, MoreHorizontal} from 'lucide-react';
import {decimal} from '../lib/inventoryManagement.js';

export function ModalHeader({title,onClose,busy=false}) {
 return <header className="inv-modal-header"><h2>{title}</h2><button type="button" className="inv-icon" aria-label="ปิด" title="ปิด" disabled={busy} onClick={onClose}><X size={20}/></button></header>;
}
export function Overflow({label,children}) {
 const ref=useRef(null);const [open,setOpen]=useState(false);const [pos,setPos]=useState(null);
 // Close when tapping anywhere else (including another card's menu), after choosing an item, or on Escape.
 // Place the popup in the viewport (fixed) so it is never clipped by the screen edge or a scrolling parent.
 useEffect(()=>{if(!open){setPos(null);return undefined;}
  const place=()=>{const el=ref.current;if(!el)return;const r=el.getBoundingClientRect();
   const w=Math.min(220,window.innerWidth*0.75,window.innerWidth-16);
   const left=Math.max(8,Math.min(r.right-w,window.innerWidth-w-8));
   setPos({position:'fixed',top:Math.round(r.bottom+4),left:Math.round(left),right:'auto',width:Math.round(w)});};
  place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
  const outside=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
  const key=e=>{if(e.key==='Escape')setOpen(false);};
  document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
 },[open]);
 return <details className="inv-overflow" ref={ref} open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary aria-label={label} title={label}><MoreHorizontal size={20}/></summary><div className="inv-overflow-body" style={pos||undefined} onClick={e=>{if(e.target.closest('button'))setOpen(false);}}>{children}</div></details>;
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
