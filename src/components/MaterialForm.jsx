import React, { useState } from 'react';
import { X, Save, Trash2 } from 'lucide-react';
import { C } from '../theme';

export function MaterialForm({ material, onSave, onDelete, onClose }) {
  const [name, setName] = useState(material?.name || '');
  const [unit, setUnit] = useState(material?.unit || 'pcs');
  const [qty, setQty] = useState(material ? String(material.qty) : '0');
  const [threshold, setThreshold] = useState(material?.low_stock_threshold ? String(material.low_stock_threshold) : '2');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return alert('กรุณากรอกชื่อวัตถุดิบ');
    setLoading(true);
    try {
      await onSave({
        id: material?.id,
        name: name.trim(),
        unit,
        qty: Number(qty) || 0,
        low_stock_threshold: Number(threshold) || 2,
      });
      onClose();
    } catch (err) {
      alert(err.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, width: '100%', maxWidth: 400, padding: 20, color: C.text }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{material ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบใหม่'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: C.textDim, display: 'block', marginBottom: 4 }}>ชื่อวัตถุดิบ</label>
            <input value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, boxSizing: 'border-box' }} />
          </div>

          <div>
            <label style={{ fontSize: 12, color: C.textDim, display: 'block', marginBottom: 4 }}>หน่วยนับ</label>
            <select value={unit} onChange={e => setUnit(e.target.value)} style={{ width: '100%', background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, boxSizing: 'border-box' }}>
              <option value="pcs">pcs</option>
              <option value="ml">ml</option>
              <option value="g">g</option>
              <option value="ชุด">ชุด</option>
              <option value="ม้วน">ม้วน</option>
              <option value="กล่อง">กล่อง</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, color: C.textDim, display: 'block', marginBottom: 4 }}>จำนวนคงเหลือ</label>
            <input type="number" value={qty} onChange={e => setQty(e.target.value)} style={{ width: '100%', background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, boxSizing: 'border-box' }} />
          </div>

          <div>
            <label style={{ fontSize: 12, color: C.amber, fontWeight: 600, display: 'block', marginBottom: 4 }}>แจ้งเตือนเมื่อเหลือน้อยกว่าหรือเท่ากับ</label>
            <input type="number" value={threshold} onChange={e => setThreshold(e.target.value)} placeholder="2" style={{ width: '100%', background: C.bg, border: `1px solid ${C.amber}`, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, boxSizing: 'border-box' }} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="submit" disabled={loading} style={{ flex: 1, background: C.amber, color: C.bg, border: 'none', borderRadius: 10, padding: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Save size={16} /> {loading ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            {material && onDelete && (
              <button type="button" onClick={() => onDelete(material.id)} style={{ background: 'rgba(239,68,68,0.1)', border: `1px solid ${C.red}`, color: C.red, borderRadius: 10, padding: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
