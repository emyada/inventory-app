import React, { useState } from 'react';
import { Minus, Plus, PackagePlus } from 'lucide-react';
import { Modal, Field } from './Modal';
import { inputStyle, btnPrimary, stepperBtn } from '../theme';

export function RestockForm({ material, onConfirm, onClose }) {
  const [amount, setAmount] = useState(1);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (amount <= 0) return;
    setBusy(true);
    await onConfirm(material.id, amount);
    setBusy(false);
  }
  return (
    <Modal onClose={onClose} title={`รับของเข้าคลัง — ${material.name}`}>
      <div style={{ fontSize: 12, color: '#9A9FA8', marginBottom: 10 }}>คงเหลือตอนนี้ {material.qty} {material.unit}</div>
      <Field label={`จำนวนที่ซื้อเข้าเพิ่ม (${material.unit})`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setAmount(a => Math.max(1, a - 1))} style={stepperBtn}><Minus size={14} /></button>
          <input type="number" style={{ ...inputStyle, textAlign: 'center' }} value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)} />
          <button onClick={() => setAmount(a => a + 1)} style={stepperBtn}><Plus size={14} /></button>
        </div>
      </Field>
      <button onClick={submit} disabled={busy} style={{ ...btnPrimary, width: '100%', marginTop: 8 }}>
        <PackagePlus size={14} style={{ marginRight: 6 }} /> ยืนยันรับเข้า {amount} {material.unit}
      </button>
    </Modal>
  );
}
