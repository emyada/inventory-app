import React, { useState } from 'react';
import { Minus, Plus, PackagePlus } from 'lucide-react';
import { Modal, Field } from './Modal';
import { C, inputStyle, btnPrimary, stepperBtn } from '../theme';

export function RestockForm({ material, onConfirm, onClose }) {
  const [amount, setAmount] = useState(1);
  const [staffName, setStaffName] = useState('');
  const [busy, setBusy] = useState(false);
  const canSubmit = amount > 0 && staffName.trim().length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    await onConfirm(material.id, amount, staffName.trim());
    setBusy(false);
  }
  return (
    <Modal onClose={onClose} title={`รับของเข้าคลัง — ${material.name}`}>
      <div style={{ fontSize: 12, color: C.textDim, marginBottom: 10 }}>คงเหลือตอนนี้ {material.qty} {material.unit}</div>
      <Field label={`จำนวนที่ซื้อเข้าเพิ่ม (${material.unit})`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setAmount(a => Math.max(1, a - 1))} style={stepperBtn}><Minus size={14} /></button>
          <input type="number" style={{ ...inputStyle, textAlign: 'center' }} value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)} />
          <button onClick={() => setAmount(a => a + 1)} style={stepperBtn}><Plus size={14} /></button>
        </div>
      </Field>
      <Field label="ชื่อผู้รับของเข้า *">
        <input style={inputStyle} value={staffName} onChange={e => setStaffName(e.target.value)} placeholder="ชื่อของคุณ" />
      </Field>
      <button onClick={submit} disabled={!canSubmit} style={{ ...btnPrimary, width: '100%', marginTop: 8, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
        <PackagePlus size={14} style={{ marginRight: 6 }} /> ยืนยันรับเข้า {amount} {material.unit}
      </button>
    </Modal>
  );
}
