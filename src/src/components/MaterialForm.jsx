import React, { useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { Modal, Field } from './Modal';
import { UnitSelect } from './UnitSelect';
import { C, inputStyle, btnPrimary, btnGhost } from '../theme';

export function MaterialForm({ material, isNew, onSave, onDelete, onClose }) {
  const [m, setM] = useState(material);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!m.name.trim()) return;
    setBusy(true);
    await onSave(m);
    setBusy(false);
  }
  return (
    <Modal onClose={onClose} title={isNew ? 'เพิ่มวัตถุดิบใหม่' : 'แก้ไขวัตถุดิบ'}>
      <Field label="ชื่อวัตถุดิบ"><input style={inputStyle} value={m.name} onChange={e => setM({ ...m, name: e.target.value })} /></Field>
      <Field label="หน่วยนับ"><UnitSelect value={m.unit} onChange={u => setM({ ...m, unit: u })} /></Field>
      <Field label="จำนวนคงเหลือ"><input type="number" style={inputStyle} value={m.qty} onChange={e => setM({ ...m, qty: parseFloat(e.target.value) || 0 })} /></Field>
      <Field label="แจ้งเตือนเมื่อเหลือน้อยกว่าหรือเท่ากับ">
        <input type="number" style={inputStyle} value={m.low_stock_threshold ?? 2} onChange={e => setM({ ...m, low_stock_threshold: parseFloat(e.target.value) || 0 })} />
      </Field>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={submit} disabled={busy} style={{ ...btnPrimary, flex: 1 }}><Save size={14} style={{ marginRight: 6 }} />บันทึก</button>
        {onDelete && <button onClick={onDelete} style={{ ...btnGhost, color: C.red }}><Trash2 size={14} /></button>}
      </div>
    </Modal>
  );
}
