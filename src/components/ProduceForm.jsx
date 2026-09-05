import React, { useState } from 'react';
import { Send, X, Layers } from 'lucide-react';
import { Modal, Field } from './Modal';
import { C, mono, inputStyle, btnPrimary, btnGhost } from '../theme';

// Splits pasted text on newlines / commas / spaces so a whole block of codes
// (e.g. copy-pasted from a chat or spreadsheet) can be dropped in at once.
function splitCodes(text) {
  return text.split(/[\n,\s]+/).map(s => s.trim()).filter(Boolean);
}

function ChipInput({ codes, setCodes }) {
  const [draft, setDraft] = useState('');

  function commitDraft() {
    const parts = splitCodes(draft);
    if (parts.length === 0) return;
    setCodes([...codes, ...parts.filter(p => !codes.includes(p))]);
    setDraft('');
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          style={{ ...inputStyle, flex: 1 }}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitDraft(); } }}
          onPaste={e => {
            const pasted = e.clipboardData.getData('text');
            if (splitCodes(pasted).length > 1) {
              e.preventDefault();
              setCodes([...codes, ...splitCodes(pasted).filter(p => !codes.includes(p))]);
            }
          }}
          placeholder="พิมพ์รหัสแล้วกด Enter เช่น Z21212"
        />
        <button type="button" onClick={commitDraft} style={stepperLike}>+</button>
      </div>
      {codes.length > 0 && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {codes.map(code => (
              <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 5, background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 20, padding: '5px 6px 5px 10px', fontSize: 12, ...mono }}>
                {code}
                <button type="button" onClick={() => setCodes(codes.filter(c => c !== code))}
                  style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', display: 'flex', padding: 2 }}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: C.amber, fontWeight: 600, marginTop: 8 }}>รวม {codes.length} ออเดอร์</div>
        </>
      )}
    </div>
  );
}

export function ProduceForm({ model, materialsById, onConfirm, onConfirmBatch, onClose }) {
  const isSleeplug = model.category === 'Sleeplug';
  const [batchMode, setBatchMode] = useState(false);
  const [orderRef, setOrderRef] = useState('');
  const [codes, setCodes] = useState([]);
  const [staffName, setStaffName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  const canSubmit = staffName.trim().length > 0 && !busy &&
    (batchMode ? codes.length > 0 : orderRef.trim().length > 0);

  async function submit() {
    setBusy(true);
    if (batchMode) {
      setProgress({ done: 0, total: codes.length });
      await onConfirmBatch(model, codes, staffName.trim(), (done) => setProgress({ done, total: codes.length }));
    } else {
      await onConfirm(model, orderRef.trim(), staffName.trim());
    }
    setBusy(false);
  }

  return (
    <Modal onClose={onClose} title={`ยื่นคำขอเบิก — ${model.name}`}>
      {isSleeplug && (
        <button type="button" onClick={() => setBatchMode(!batchMode)}
          style={{ ...btnGhost, marginBottom: 12, color: batchMode ? C.amber : C.text, borderColor: batchMode ? C.amber : C.line }}>
          <Layers size={13} style={{ marginRight: 6 }} />
          {batchMode ? 'โหมดหลายออเดอร์ (เปิดอยู่)' : 'เพิ่มหลายออเดอร์พร้อมกัน'}
        </button>
      )}

      {batchMode ? (
        <Field label="รหัสออเดอร์ (พิมพ์ทีละอันหรือวางทั้งลิสต์) *">
          <ChipInput codes={codes} setCodes={setCodes} />
        </Field>
      ) : (
        <Field label="ชื่อ/รหัสออเดอร์ลูกค้า *">
          <input style={inputStyle} value={orderRef} onChange={e => setOrderRef(e.target.value)} placeholder="เช่น ORD-2026-014 หรือชื่อลูกค้า" />
        </Field>
      )}

      <Field label="ชื่อผู้กดผลิต (ช่าง) *">
        <input style={inputStyle} value={staffName} onChange={e => setStaffName(e.target.value)} placeholder="ชื่อของคุณ" />
      </Field>

      <div style={{ fontSize: 12, color: C.textDim, margin: '10px 0 6px' }}>
        {batchMode
          ? `วัตถุดิบต่อ 1 ออเดอร์ (ระบบจะคูณให้ครบ ${codes.length || 0} ออเดอร์อัตโนมัติ):`
          : 'วัตถุดิบที่จะขอเบิก (หัวหน้าสต๊อกจะเป็นคนหยิบและติ๊กยืนยันให้ ยังไม่หักสต๊อกตอนนี้):'}
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
        <Send size={14} style={{ marginRight: 6 }} />
        {busy
          ? (progress ? `กำลังส่ง ${progress.done}/${progress.total}...` : 'กำลังส่งคำขอ...')
          : (batchMode ? `ส่งคำขอเบิก ${codes.length || ''} ออเดอร์` : 'ส่งคำขอเบิก')}
      </button>
    </Modal>
  );
}

const stepperLike = { background: '#252932', border: '1px solid #33383F', color: '#EDEAE2', borderRadius: 7, padding: '0 16px', cursor: 'pointer', fontSize: 16, fontWeight: 700 };
