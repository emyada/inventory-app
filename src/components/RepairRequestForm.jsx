import React, { useState } from 'react';
import { Send, Plus, Minus, Trash2 } from 'lucide-react';
import { Modal, Field } from './Modal';
import { C, mono, inputStyle, btnPrimary, stepperBtn, REPAIR_SUBTYPES } from '../theme';

export function RepairRequestForm({ materials, onConfirm, onClose }) {
  const [orderRef, setOrderRef] = useState('');
  const [subType, setSubType] = useState(REPAIR_SUBTYPES[0]);
  const [note, setNote] = useState('');
  const [staffName, setStaffName] = useState('');
  const [bom, setBom] = useState([]); // [{material_id, qty}]
  const [pick, setPick] = useState(materials[0]?.id || '');
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);

  const canSubmit = orderRef.trim().length > 0 && note.trim().length > 0 && staffName.trim().length > 0 && !busy;

  function addLine() {
    if (!pick) return;
    setBom([...bom.filter(b => b.material_id !== pick), { material_id: pick, qty }]);
  }
  function removeLine(mid) { setBom(bom.filter(b => b.material_id !== mid)); }
  function changeQty(mid, delta) {
    setBom(bom.map(b => b.material_id === mid ? { ...b, qty: Math.max(0, b.qty + delta) } : b));
  }

  async function submit() {
    setBusy(true);
    await onConfirm({ orderRef: orderRef.trim(), subType, note: note.trim(), staffName: staffName.trim(), bom });
    setBusy(false);
  }

  return (
    <Modal onClose={onClose} title="ยื่นคำขอเบิก — ซ่อม/เคสพิเศษ">
      <Field label="ชื่อหรือรหัสลูกค้า *">
        <input style={inputStyle} value={orderRef} onChange={e => setOrderRef(e.target.value)} placeholder="เช่น ชื่อลูกค้า หรือรหัสงาน" />
      </Field>
      <Field label="หมวด">
        <select style={inputStyle} value={subType} onChange={e => setSubType(e.target.value)}>
          {REPAIR_SUBTYPES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="สาเหตุหรือรายละเอียด *">
        <textarea style={{ ...inputStyle, minHeight: 64, resize: 'vertical', fontFamily: 'inherit' }}
          value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น ลำโพงข้างซ้ายไม่มีเสียง ขอเปลี่ยนสาย" />
      </Field>
      <Field label="ผู้ขอเบิกหรือผู้ซ่อม *">
        <input style={inputStyle} value={staffName} onChange={e => setStaffName(e.target.value)} placeholder="ชื่อของคุณ" />
      </Field>

      <Field label="วัตถุดิบที่จะขอเบิก (ถ้ามี)">
        <div style={{ display: 'flex', gap: 6 }}>
          <select style={{ ...inputStyle, flex: 1 }} value={pick} onChange={e => setPick(e.target.value)}>
            {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input type="number" style={{ ...inputStyle, width: 56 }} value={qty} onChange={e => setQty(parseFloat(e.target.value) || 1)} />
          <button type="button" onClick={addLine} style={stepperBtn}><Plus size={14} /></button>
        </div>
      </Field>

      {bom.length > 0 && (
        <div style={{ maxHeight: 150, overflowY: 'auto', margin: '8px 0' }}>
          {bom.map(b => {
            const mat = materials.find(m => m.id === b.material_id);
            return (
              <div key={b.material_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '6px 0', borderBottom: `1px solid ${C.line}`, gap: 6 }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mat?.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <button type="button" onClick={() => changeQty(b.material_id, -1)} style={{ ...stepperBtn, padding: 4 }}><Minus size={11} /></button>
                  <span style={{ ...mono, minWidth: 34, textAlign: 'center' }}>{b.qty} {mat?.unit}</span>
                  <button type="button" onClick={() => changeQty(b.material_id, 1)} style={{ ...stepperBtn, padding: 4 }}><Plus size={11} /></button>
                  <button type="button" onClick={() => removeLine(b.material_id)} style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', padding: '0 0 0 4px', display: 'flex' }}><Trash2 size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button onClick={submit} disabled={!canSubmit}
        style={{ ...btnPrimary, width: '100%', marginTop: 10, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
        <Send size={14} style={{ marginRight: 6 }} /> {busy ? 'กำลังส่งคำขอ...' : 'ส่งคำขอเบิก'}
      </button>
    </Modal>
  );
}
