import React, { useRef, useState } from 'react';
import { Check, Package, Save, Trash2, Calendar } from 'lucide-react';
import { C, mono, tabBtn, tabBtnActive } from '../theme';

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

function getTodayString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function pickStatus(bomSnapshot = []) {
  const total = bomSnapshot.length;
  if (total === 0) return { label: 'ไม่มีรายการ', color: C.textDim };
  const done = bomSnapshot.filter(b => b.received).length;
  if (done === 0) return { label: 'รอเบิก', color: C.textDim };
  if (done === total) return { label: 'เบิกครบแล้ว', color: C.teal };
  return { label: `รับแล้ว ${done}/${total}`, color: C.amber };
}

export function RecheckView({ transactions, userId, onConfirmBatch, onCancel }) {
  const [sub, setSub] = useState('active'); // active | history
  const [staged, setStaged] = useState([]); // [{txId, materialId}]
  const [confirming, setConfirming] = useState(false);
  
  // เพิ่ม State สำหรับจำรายการที่เพิ่งกดรับสำเร็จ (ป้องกันหน้าจอค้าง)
  const [confirmedKeys, setConfirmedKeys] = useState(new Set());

  const todayStr = getTodayString();
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);

  const myOrders = transactions.filter(t => t.created_by === userId);

  const historyOrders = myOrders.filter(t => {
    if (!t.created_at) return false;
    const txDate = t.created_at.slice(0, 10);
    return txDate >= startDate && txDate <= endDate;
  });

  const myRecheckOrders = myOrders.filter(t => 
    !EXCLUDED_MODELS.includes(t.model_name) &&
    !EXCLUDED_CATEGORIES.includes(t.category)
  );

  const totals = {};
  const stagedKeys = new Set(staged.map(s => s.txId + s.materialId));

  myRecheckOrders.forEach(t => {
    t.bom_snapshot?.filter(b => b.picked && !b.received).forEach(b => {
      const itemKey = t.id + b.material_id;
      // ถ้าเคยยืนยันไปแล้วใน Session นี้ ให้ซ่อนออกทันที
      if (confirmedKeys.has(itemKey)) return;

      const key = b.material_id;
      if (!totals[key]) totals[key] = { name: b.material_name, unit: b.unit, qty: 0, refs: [] };
      totals[key].qty += b.qty;
      totals[key].refs.push({ txId: t.id, materialId: b.material_id, tx: t });
    });
  });

  const totalRows = Object.entries(totals).map(([id, v]) => ({ id, ...v }));

  function isRowStaged(row) {
    return row.refs.every(r => stagedKeys.has(r.txId + r.materialId));
  }

  function toggleRow(row) {
    const allStaged = isRowStaged(row);
    setStaged(s => {
      const withoutRow = s.filter(x => !row.refs.some(r => r.txId === x.txId && r.materialId === x.materialId));
      return allStaged ? withoutRow : [...withoutRow, ...row.refs.map(r => ({ txId: r.txId, materialId: r.materialId, tx: r.tx }))];
    });
  }

  const processingRef = useRef(false);
  async function handleConfirm() {
    if (processingRef.current) return;
    processingRef.current = true;
    setConfirming(true);
    try {
      const result = await onConfirmBatch(staged.map(s => ({ tx: s.tx, materialId: s.materialId })));
      
      // บันทึก Keys ของรายการที่กดยืนยันแล้ว เพื่อเคลียร์ออกจาก UI ทันที
      const justConfirmed = new Set(staged.map(s => s.txId + s.materialId));
      setConfirmedKeys(prev => new Set([...prev, ...justConfirmed]));
      setStaged([]);

      if (result?.errors && result.errors.length > 0) {
        alert(result.errors.join('\n'));
      }
    } catch (err) {
      console.error(err);
    } finally {
      processingRef.current = false;
      setConfirming(false);
    }
  }

  return (
    <div style={{ paddingBottom: staged.length > 0 ? 64 : 0 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, color: C.text }}>เช็ครับของ</div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button onClick={() => setSub('active')} style={{ ...tabBtn, ...(sub === 'active' ? tabBtnActive : {}) }}>กำลังดำเนินการ</button>
        <button onClick={() => setSub('history')} style={{ ...tabBtn, ...(sub === 'history' ? tabBtnActive : {}) }}>ประวัติการเบิก</button>
      </div>

      {sub === 'active' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: C.amber, marginBottom: 10 }}>
            <Package size={14} /> ของที่หัวหน้าหยิบให้แล้ว — เช็คแล้วติ๊ก
          </div>

          {totalRows.length === 0 && (
            <div style={{ fontSize: 13, color: C.textDim, textAlign: 'center', padding: '30px 0' }}>ไม่มีของรอเช็ครับตอนนี้</div>
          )}

          <div className="grid-list">
            {totalRows.map(row => {
              const staged_ = isRowStaged(row);
              return (
                <button key={row.id} onClick={() => toggleRow(row)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%', boxSizing: 'border-box',
                    background: staged_ ? 'rgba(63,167,150,0.1)' : C.panel, border: `1px solid ${staged_ ? C.teal : C.line}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer', color: C.text,
                  }}>
                  <div style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${staged_ ? C.teal : C.line}`, background: staged_ ? C.teal : 'transparent' }}>
                    {staged_ && <Check size={13} color={C.bg} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: staged_ ? 'line-through' : 'none', opacity: staged_ ? 0.6 : 1 }}>{row.name}</div>
                    <div style={{ fontSize: 10.5, color: C.textDim }}>จาก {row.refs.length} ออเดอร์</div>
                  </div>
                  <div style={{ ...mono, fontWeight: 700, color: staged_ ? C.textDim : C.teal, flexShrink: 0 }}>{row.qty} {row.unit}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {sub === 'history' && (
        <div>
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: '10px 12px', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: C.textDim }}>
              <Calendar size={14} /> เลือกช่วงวันที่ต้องการดู
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input 
                type="date" 
                value={startDate} 
                onChange={e => setStartDate(e.target.value)}
                style={{ flex: 1, background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 6, padding: '6px 8px', color: C.text, fontSize: 12 }}
              />
              <span style={{ fontSize: 12, color: C.textDim }}>ถึง</span>
              <input 
                type="date" 
                value={endDate} 
                onChange={e => setEndDate(e.target.value)}
                style={{ flex: 1, background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 6, padding: '6px 8px', color: C.text, fontSize: 12 }}
              />
            </div>
          </div>

          <div style={{ fontSize: 11.5, color: C.textDim, marginBottom: 8, paddingLeft: 2 }}>
            พบ {historyOrders.length} รายการ
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {historyOrders.length === 0 && (
              <div style={{ fontSize: 13, color: C.textDim, textAlign: 'center', padding: '20px 0' }}>ไม่มีประวัติการเบิกในช่วงวันที่เลือก</div>
            )}
            {historyOrders.map(t => {
              const status = pickStatus(t.bom_snapshot);
              return (
                <div key={t.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 9, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: C.text }}>{t.model_name} <span style={{ color: C.textDim, fontWeight: 400, fontSize: 11 }}>· {t.category}</span></div>
                    <div style={{ fontSize: 10.5, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>ออเดอร์ {t.order_ref} · {t.created_at?.slice(0, 10)}</div>
                    <div style={{ fontSize: 10.5, color: status.color, fontWeight: 600, marginTop: 2 }}>{status.label}</div>
                  </div>
                  <button onClick={() => onCancel(t)} title="ยกเลิกออเดอร์นี้"
                    style={{ background: 'none', border: `1px solid ${C.line}`, borderRadius: 7, padding: 6, color: C.red, cursor: 'pointer', display: 'flex', flexShrink: 0 }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {staged.length > 0 && (
        <div style={{ position: 'fixed', bottom: 62, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 25, padding: '0 14px', boxSizing: 'border-box' }}>
          <button onClick={handleConfirm} disabled={confirming}
            style={{ width: '100%', maxWidth: 480 - 28, background: C.amber, color: C.bg, border: 'none', borderRadius: 12, padding: '13px', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.4)' }}>
            <Save size={16} /> {confirming ? 'กำลังยืนยัน...' : `ยืนยันรับของแล้ว (${staged.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
