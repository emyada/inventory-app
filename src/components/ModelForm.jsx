import React, { useState } from 'react';
import { Save, Trash2, Plus, Minus } from 'lucide-react';
import { Modal, Field } from './Modal';
import { C, mono, inputStyle, btnPrimary, btnGhost, stepperBtn, CATEGORIES } from '../theme';

export function ModelForm({ model, isNew, materials, onSave, onDelete, onClose }) {
  const [name, setName] = useState(model.name);
  const [category, setCategory] = useState(model.category);
  const [bom, setBom] = useState(model.bom); // [{material_id, qty}]
  const [pick, setPick] = useState(materials[0]?.id || '');
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);

  function addLine() {
    if (!pick) return;
    setBom([...bom.filter(b => b.material_id !== pick), { material_id: pick, qty }]);
  }
  function removeLine(mid) { setBom(bom.filter(b => b.material_id !== mid)); }
  function changeQty(mid, delta) {
    setBom(bom.map(b => b.material_id === mid ? { ...b, qty: Math.max(0, b.qty + delta) } : b));
  }
  async function submit() {
    if (!name.trim() || bom.length === 0) return;
    setBusy(true);
    await onSave({ id: model.id, name, category, bom });
    setBusy(false);
  }

  return (
    <Modal onClose={onClose} title={isNew ? 'เพิ่มรุ่นสินค้าใหม่' : `แก้ไขรุ่น — ${model.name}`}>
      <Field label="ชื่อรุ่น"><input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="เช่น IPXQ" /></Field>
      <Field label="หมวด">
        <select style={inputStyle} value={category} onChange={e => setCategory(e.target.value)}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="เพิ่มวัตถุดิบเข้าสูตร (BOM)">
        <div style={{ display: 'flex', gap: 6 }}>
          <select style={{ ...inputStyle, flex: 1 }} value={pick} onChange={e => setPick(e.target.value)}>
            {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input type="number" style={{ ...inputStyle, width: 56 }} value={qty} onChange={e => setQty(parseFloat(e.target.value) || 1)} />
          <button onClick={addLine} style={stepperBtn}><Plus size={14} /></button>
        </div>
      </Field>
      <div style={{ maxHeight: 180, overflowY: 'auto', margin: '8px 0' }}>
        {bom.length === 0 && <div style={{ fontSize: 12, color: C.textDim }}>ยังไม่มีวัตถุดิบในสูตรนี้</div>}
        {bom.map(b => {
          const mat = materials.find(m => m.id === b.material_id);
          return (
            <div key={b.material_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '6px 0', borderBottom: `1px solid ${C.line}`, gap: 6 }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mat?.name || '(ไม่พบวัตถุดิบนี้แล้ว)'}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <button onClick={() => changeQty(b.material_id, -1)} style={{ ...stepperBtn, padding: 4 }}><Minus size={11} /></button>
                <span style={{ ...mono, minWidth: 34, textAlign: 'center' }}>{b.qty} {mat?.unit}</span>
                <button onClick={() => changeQty(b.material_id, 1)} style={{ ...stepperBtn, padding: 4 }}><Plus size={11} /></button>
                <button onClick={() => removeLine(b.material_id)} style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', padding: '0 0 0 4px', display: 'flex' }}><Trash2 size={13} /></button>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={submit} disabled={busy} style={{ ...btnPrimary, flex: 1 }}>
          <Save size={14} style={{ marginRight: 6 }} /> {isNew ? 'สร้างรุ่นนี้' : 'บันทึกการแก้ไข'}
        </button>
        {onDelete && <button onClick={onDelete} style={{ ...btnGhost, color: C.red }}><Trash2 size={14} /></button>}
      </div>
    </Modal>
  );
}
