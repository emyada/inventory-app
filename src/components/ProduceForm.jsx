import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { Modal, Field } from './Modal';
import { C, mono, inputStyle, btnPrimary } from '../theme';

export function ProduceForm({ model, materialsById, onConfirm, onClose }) {
  const [orderRef, setOrderRef] = useState('');
  const [staffName, setStaffName] = useState('');
  const [busy, setBusy] = useState(false);
  const canSubmit = orderRef.trim().length > 0 && staffName.trim().length > 0 && !busy;

  async function submit() {
    setBusy(true);
    await onConfirm(model, orderRef.trim(), staffName.trim());
    setBusy(false);
  }

  return (
    <Modal onClose={onClose} title={`ยื่นคำขอเบิก — ${model.name}`}>
      <Field label="ชื่อ/รหัสออเดอร์ลูกค้า *">
        <input style={inputStyle} value={orderRef} onChange={e => setOrderRef(e.target.value)} placeholder="เช่น ORD-2026-014 หรือชื่อลูกค้า" />
      </Field>
      <Field label="ชื่อผู้กดผลิต (ช่าง) *">
        <input style={inputStyle} value={staffName} onChange={e => setStaffName(e.target.value)} placeholder="ชื่อของคุณ" />
      </Field>
      <div style={{ fontSize: 12, color: C.textDim, margin: '10px 0 6px' }}>
        วัตถุดิบที่จะขอเบิก (หัวหน้าสต๊อกจะเป็นคนหยิบและติ๊กยืนยันให้ ยังไม่หักสต๊อกตอนนี้):
      </div>
      <div style={{ maxHeight: 170, overflowY: 'auto', marginBottom: 14 }}>
        {model.bom.map(b => {
          const m = materialsById[b.material_id]; if (!m) return null;
          const enough = m.qty >= b.qty;
          return (
            <div key={b.material_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12, borderBottom: `1px solid ${C.line}`, color: enough ? C.text : C.red }}>
              <span>{m.name}</span>
              <span style={mono}>{b.qty} {m.unit} {!enough && '⚠ ของเหลือน้อย'}</span>
            </div>
          );
        })}
      </div>
      <button onClick={submit} disabled={!canSubmit}
        style={{ ...btnPrimary, width: '100%', opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
        <Send size={14} style={{ marginRight: 6 }} /> {busy ? 'กำลังส่งคำขอ...' : 'ส่งคำขอเบิก'}
      </button>
    </Modal>
  );
}
