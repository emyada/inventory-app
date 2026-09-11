import React, { useRef, useState } from 'react';
import { Check, Package, Users, Save } from 'lucide-react';
import { C, mono } from '../theme';

const EXCLUDED_MODELS = [
  'Sleepplug',
  'Sleepplug Glow',
  'Sleepplug-Glow-ข้างเดียว',
  'Sleepplug-ข้างเดียว',
  'Sleepplug-ตัน'
];

const EXCLUDED_CATEGORIES = [
  'ซ่อมและอื่นๆ'
];

export function PickQueueView({ transactions, materialsById, onBulkPickBatch }) {
  const [staged, setStaged] = useState([]); // [{ txId, materialId, tx }]
  const [confirming, setConfirming] = useState(false);

  // ดึงรายการออเดอร์ที่ยังมีวัตถุดิบรอเบิก
  const openOrders = transactions.filter(t => t.bom_snapshot?.some(b => !b.picked));

  // คำนวณยอดรวมวัตถุดิบ โดยเก็บ Reference ของออเดอร์ไว้ทั้งหมด
  const totals = {};
  const stagedKeys = new Set(staged.map(s => s.txId + s.materialId));

  openOrders.forEach(t => {
    t.bom_snapshot?.filter(b => !b.picked).forEach(b => {
      // จับกลุ่มตาม ชื่อวัตถุดิบ + หน่วย เพื่อป้องกันปัญหา ID ไม่ตรงกัน
      const key = `${b.material_name}_${b.unit}`;
      if (!totals[key]) {
        totals[key] = { id: key, name: b.material_name, unit: b.unit, qty: 0, refs: [] };
      }
      totals[key].qty += b.qty;
      totals[key].refs.push({ txId: t.id, materialId: b.material_id, tx: t });
    });
  });

  const totalRows = Object.values(totals).sort((a, b) => b.qty - a.qty);

  // เช็กว่าวัตถุดิบกลุ่มนี้ถูกติ๊กเลือกครบทุกออเดอร์หรือยัง
  function isRowStaged(row) {
    return row.refs.every(r => stagedKeys.has(r.txId + r.materialId));
  }

  // ฟังก์ชันติ๊กเลือก / ถอนการเลือก (อัปเดตครอบคลุมทุกออเดอร์ที่ใช้วัตถุดิบนี้)
  function toggleRow(row) {
    const allStaged = isRowStaged(row);
    setStaged(s => {
      const withoutRow = s.filter(x => !row.refs.some(r => r.txId === x.txId && r.materialId === x.materialId));
      return allStaged ? withoutRow : [...withoutRow, ...row.refs.map(r => ({ txId: r.txId, materialId: r.materialId, tx: r.tx }))];
    });
  }

  // สรุปตามรายชื่อพนักงาน
  const byStaff = {};
  openOrders.forEach(t => {
    const key = t.staff_name || 'ไม่ระบุชื่อ';
    if (!byStaff[key]) byStaff[key] = { orders: [], byModel: {} };
    byStaff[key].orders.push(t);
    byStaff[key].byModel[t.model_name] = (byStaff[key].byModel[t.model_name] || 0) + 1;
  });

  const processingRef = useRef(false);

  // ฟังก์ชันกดปุ่มสีส้ม "ยืนยันหยิบแล้ว"
  async function handleConfirm() {
    if (processingRef.current || staged.length === 0) return;
    processingRef.current = true;
    setConfirming(true);
    try {
      // ดึงเฉพาะ material_id ส่งกลับไปตัดสต๊อก
      const materialIdsToPick = Array.from(new Set(staged.map(s => s.materialId)));
      
      const { errors } = await onBulkPickBatch(materialIdsToPick, (transaction) => {
        const isExcludedModel = EXCLUDED_MODELS.includes(transaction.model_name);
        const isExcludedCategory = EXCLUDED_CATEGORIES.includes(transaction.category);
        return isExcludedModel || isExcludedCategory;
      });

      setStaged([]); // ล้างรายการที่เลือกออก
      if (errors && errors.length > 0) alert(errors.join('\n'));
    } finally {
      processingRef.current = false;
      setConfirming(false);
    }
  }

  return (
    <div style={{ paddingBottom: staged.length > 0 ? 80 : 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>คิวรอเบิก</div>
      <div style={{ fontSize: 11.5, color: C.textDim, marginBottom: 14 }}>{openOrders.length} ออเดอร์ยังไม่จ่ายครบ</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: C.amber, marginBottom: 8 }}>
        <Package size={14} /> รวมที่ต้องหยิบตอนนี้ — ติ๊กแล้วกด "ยืนยัน" ด้านล่างทีเดียว
      </div>

      {totalRows.length === 0 && (
        <div style={{ fontSize: 13, color: C.textDim, textAlign: 'center', padding: '20px 0' }}>ไม่มีของค้างหยิบตอนนี้ 🎉</div>
      )}

      {/* รายการวัตถุดิบ */}
      <div className="grid-list" style={{ marginBottom: 22 }}>
        {totalRows.map(r => {
          const staged_ = isRowStaged(r);
          return (
            <button key={r.id} onClick={() => toggleRow(r)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%', boxSizing: 'border-box',
                background: staged_ ? 'rgba(63,167,150,0.1)' : C.panel, 
                border: `1px solid ${staged_ ? C.teal : C.line}`, 
                borderRadius: 10, padding: '10px 12px', cursor: 'pointer', color: C.text,
                transition: 'all 0.15s ease'
              }}>
              <div style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${staged_ ? C.teal : C.line}`, background: staged_ ? C.teal : 'transparent' }}>
                {staged_ && <Check size={13} color={C.bg} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text, textDecoration: staged_ ? 'line-through' : 'none', opacity: staged_ ? 0.6 : 1 }}>{r.name}</div>
                <div style={{ fontSize: 10.5, color: C.textDim }}>จาก {r.refs.length} ออเดอร์</div>
              </div>
              <div style={{ ...mono, fontWeight: 700, color: staged_ ? C.textDim : C.teal, flexShrink: 0 }}>{r.qty} {r.unit}</div>
            </button>
          );
        })}
      </div>

      {/* สรุปตามพนักงาน */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: C.textDim, marginBottom: 8 }}>
        <Users size={14} /> สรุปตามพนักงาน
      </div>
      {Object.keys(byStaff).length === 0 && (
        <div style={{ fontSize: 13, color: C.textDim }}>—</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Object.entries(byStaff).map(([staff, info]) => (
          <div key={staff} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{staff}</div>
              <div style={{ ...mono, fontSize: 11.5, color: C.textDim }}>{info.orders.length} ออเดอร์</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {Object.entries(info.byModel).map(([name, count]) => (
                <div key={name} style={{ background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 8, padding: '4px 9px', fontSize: 11.5, color: C.text }}>
                  {name} <span style={{ ...mono, color: C.teal, fontWeight: 700 }}>x{count}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {info.orders.map(t => {
                const done = t.bom_snapshot?.filter(b => b.picked).length || 0;
                const total = t.bom_snapshot?.length || 0;
                const complete = done === total;
                return (
                  <div key={t.id} title={`${done}/${total} รายการ`}
                    style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, ...mono, padding: '3px 7px', borderRadius: 20, background: complete ? 'rgba(63,167,150,0.14)' : C.panelAlt, color: complete ? C.teal : C.textDim, border: `1px solid ${complete ? C.teal : C.line}` }}>
                    {complete && <Check size={10} />} {t.order_ref}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ปุ่มยืนยันด้านล่าง */}
      {staged.length > 0 && (
        <div style={{ position: 'fixed', bottom: 62, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 99, padding: '0 14px', boxSizing: 'border-box' }}>
          <button onClick={handleConfirm} disabled={confirming}
            style={{ width: '100%', maxWidth: 480 - 28, background: C.amber, color: C.bg, border: 'none', borderRadius: 12, padding: '13px', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.4)' }}>
            <Save size={16} /> {confirming ? 'กำลังยืนยัน...' : `ยืนยันหยิบแล้ว (${staged.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
