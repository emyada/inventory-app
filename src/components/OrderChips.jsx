import React, {useState} from 'react';
import {addOrderChips,removeOrderChip} from '../lib/inventoryRequestUX.js';
export function OrderChips({values,onChange,draft,onDraftChange,reviewed,onReviewedChange}) {
 const [error,setError]=useState('');
 function add(text){try{const next=addOrderChips(values,text);onChange(next);onDraftChange('');onReviewedChange(false);setError('');}catch(e){setError(e.message);}}
 return <div className="inv-order-chips">
  <label htmlFor="sleepplug-order-draft">Order codes <small>พิมพ์ทีละรหัส แล้วกด Enter หรือเพิ่ม</small></label>
  <div className="inv-chip-entry"><input id="sleepplug-order-draft" value={draft} autoComplete="off" enterKeyHint="done"
   onChange={e=>{onDraftChange(e.target.value);onReviewedChange(false);setError('');}}
   onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();add(draft);}}}
   onPaste={e=>{e.preventDefault();if(draft.trim()){setError('Add or clear the unfinished code before pasting.');return;}add(e.clipboardData.getData('text'));}}/>
  <button type="button" onClick={()=>add(draft)} disabled={!draft.trim()}>เพิ่มรหัส</button></div>
  <p className="inv-muted">วางหลายรหัสได้ คั่นด้วยบรรทัดใหม่, comma, semicolon, tab หรือช่องว่าง รหัสซ้ำจะไม่เพิ่มซ้ำ</p>
  <ul aria-label="Order list" className="inv-chips">{values.map((v,i)=><li key={v.toLowerCase()}><span>{v}</span><button type="button" aria-label={`Remove ${v}`} onClick={()=>{onChange(removeOrderChip(values,i));onReviewedChange(false);}}>×</button></li>)}</ul>
  <p aria-live="polite">{values.length} รายการ</p>{error&&<p role="alert">{error}</p>}
  <label><input type="checkbox" required checked={reviewed} onChange={e=>onReviewedChange(e.target.checked)}/> ตรวจรหัสทุกรายการแล้ว แต่ละรายการคือหนึ่งคำขอ</label>
 </div>;
}
