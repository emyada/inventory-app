import React, {useEffect, useRef, useState} from 'react';
import {groupRequirements, splitByStock} from '../lib/pickQueue.js';
import {prepareOrderConfirmation} from '../lib/inventoryOrderConfirmation.js';
import {workflowError} from '../lib/inventoryWorkflow.js';
const fmt = n => Number(n).toLocaleString('th-TH', {maximumFractionDigits: 3});

// Confirm all selected orders (one person or several) in a single atomic call (server rejects partial orders).
export function PickGroupConfirmation({task, api, role, onClose, onSuccess}) {
  const rows = (task.rows || []).filter(Boolean);
  const [selected, setSelected] = useState(() => rows.map(r => r.id));
  const [materials, setMaterials] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [status, setStatus] = useState('');
  const operation = useRef(null), flight = useRef(false);
  useEffect(() => {
    let active = true; if (role !== 'admin') return undefined;
    api.list_materials({include_inactive: true}).then(r => { if (active) setMaterials(r); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, role]);
  if (role !== 'admin') return <p role="alert">เฉพาะ Admin ยืนยันตัดสต็อก</p>;
  const chosen = rows.filter(r => selected.includes(r.id));
  let need = [], problem = '';
  try { need = groupRequirements(chosen, materials); } catch (e) { problem = e.message; }
  const short = need.filter(r => r.insufficient);
  const split = !loading && !problem && short.length ? splitByStock(chosen, materials) : null;
  const blocked = loading || Boolean(error) || Boolean(problem) || !chosen.length || !need.length || short.length > 0 || Boolean(status);
  async function confirm() {
    if (blocked || flight.current || operation.current) return;
    flight.current = true; setStatus('checking');
    try {
      const fresh = await api.list_materials({include_inactive: true}); setMaterials(fresh);
      if (groupRequirements(chosen, fresh).some(r => r.insufficient)) throw new Error('วัตถุดิบไม่พอ คำขอยังคงรออยู่');
      const op = prepareOrderConfirmation(api, rows, chosen.map(r => r.id), role); operation.current = op; setStatus('submitting');
      await op.execute(); const result = op.getSnapshot(); setStatus(result.status);
      if (result.status === 'succeeded') onSuccess(); else setError(workflowError(result.error || new Error('ตรวจสอบรายการค้างด้วย UUID เดิมก่อนส่งซ้ำ')));
    } catch (e) { setError(workflowError(e)); setStatus(operation.current ? 'review' : ''); } finally { flight.current = false; }
  }
  return <section className="inv-form"><h2>ติ๊กหยิบครบ — {task.name}</h2>
    <p>ตรวจออเดอร์แล้วยืนยัน ระบบตัดสต็อกทุกออเดอร์ที่เลือกพร้อมกัน ถ้าของไม่พอจะไม่ตัดอะไรเลย</p>
    <fieldset disabled={Boolean(status)}><legend>ออเดอร์ ({chosen.length}/{rows.length})</legend>
      {rows.map(r => <label key={r.id} className="pq-pick"><input type="checkbox" checked={selected.includes(r.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, r.id] : ids.filter(id => id !== r.id))}/> {r.order_ref} · {r.model_name}{r.staff_name ? ` · ${r.staff_name}` : ''}</label>)}
    </fieldset>
    {loading && <p role="status">กำลังตรวจยอด…</p>}
    {(error || problem) && <p role="alert">{error || problem}</p>}
    <details open={short.length > 0 || undefined}><summary>ของชิ้นที่หยิบ (รวม {need.length} รายการ)</summary>
      {need.map(r => <p key={r.id}>{r.name} · {fmt(r.required)} {r.unit} · คงเหลือ {r.available == null ? 'ไม่ทราบ' : fmt(r.available)} {r.insufficient ? '— ไม่พอ' : ''}</p>)}</details>
    {split && split.short.length > 0 && <div role="alert" className="pq-warn">
      <p>วัตถุดิบไม่พอสำหรับ {split.short.length} ออเดอร์: {split.short.map(x => `${x.row.order_ref} (ขาด ${x.lacking.join(', ')})`).join(' · ')}</p>
      {split.fit.length > 0 && <button type="button" onClick={() => setSelected(split.fit.map(r => r.id))}>เอาออเดอร์ที่ขาดออก (เหลือ {split.fit.length} ออเดอร์ที่หยิบได้)</button>}
    </div>}
    <button className="inv-primary" disabled={blocked} onClick={confirm}>ยืนยันหยิบ {chosen.length} ออเดอร์</button>
    <button disabled={['checking', 'submitting'].includes(status)} onClick={onClose}>ปิด / ตรวจสอบรายการค้าง</button>
    {status && <p role="status">{status === 'succeeded' ? 'บันทึกสำเร็จ' : status === 'submitting' || status === 'checking' ? 'กำลังดำเนินการ…' : 'ตรวจสอบผลด้วยรายการค้างเดิม ห้ามสร้าง UUID ใหม่'}</p>}
  </section>;
}
