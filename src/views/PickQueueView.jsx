import React, { useState } from 'react';
import { Check, Package, ListChecks } from 'lucide-react';
import { C, mono } from '../theme';

export function PickQueueView({ transactions, materialsById, onPick, onUnpick }) {
  const [busyKey, setBusyKey] = useState(null);

  // An order is "open" as long as at least one of its lines hasn't been picked yet.
  const openOrders = transactions
    .filter(t => t.bom_snapshot.some(b => !b.picked))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // oldest request first

  // Aggregate every not-yet-picked line across all open orders, so the stock
  // lead can gather everything needed in one trip instead of order-by-order.
  const totals = {};
  openOrders.forEach(t => {
    t.bom_snapshot.filter(b => !b.picked).forEach(b => {
      if (!totals[b.material_id]) totals[b.material_id] = { name: b.material_name, unit: b.unit, qty: 0 };
      totals[b.material_id].qty += b.qty;
    });
  });
  const totalRows = Object.values(totals).sort((a, b) => b.qty - a.qty);

  async function handlePick(tx, materialId) {
    const key = tx.id + materialId;
    setBusyKey(key);
    const { error } = await onPick(tx, materialId);
    setBusyKey(null);
    if (error) alert(error); // simple inline feedback; matches shortage-style warnings elsewhere
  }

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>คิวรอเบิก</div>
      <div style={{ fontSize: 11.5, color: C.textDim, marginBottom: 14 }}>{openOrders.length} ออเดอร์ยังไม่จ่ายครบ</div>

      {totalRows.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: C.amber, marginBottom: 8 }}>
            <Package size={14} /> รวมที่ต้องหยิบตอนนี้
          </div>
          <div className="grid-list">
            {totalRows.map(r => (
              <div key={r.name + r.unit} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 9, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>{r.name}</span>
                <span style={{ ...mono, fontWeight: 700, color: C.teal, flexShrink: 0 }}>{r.qty} {r.unit}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: C.textDim, marginBottom: 8 }}>
        <ListChecks size={14} /> แยกตามออเดอร์ — ติ๊กทีละรายการ
      </div>

      {openOrders.length === 0 && (
        <div style={{ fontSize: 13, color: C.textDim, textAlign: 'center', padding: '30px 0' }}>ไม่มีออเดอร์ค้างเบิกตอนนี้ 🎉</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {openOrders.map(tx => {
          const doneCount = tx.bom_snapshot.filter(b => b.picked).length;
          return (
            <div key={tx.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{tx.model_name} <span style={{ color: C.textDim, fontWeight: 400, fontSize: 11.5 }}>· {tx.category}</span></div>
                  <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>ออเดอร์ {tx.order_ref} · ช่าง {tx.staff_name}</div>
                </div>
                <div style={{ ...mono, fontSize: 11, color: C.textDim, flexShrink: 0 }}>{doneCount}/{tx.bom_snapshot.length}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {tx.bom_snapshot.map(b => {
                  const m = materialsById[b.material_id];
                  const enough = m && m.qty >= b.qty;
                  const key = tx.id + b.material_id;
                  return (
                    <button key={b.material_id} disabled={b.picked || busyKey === key}
                      onClick={() => handlePick(tx, b.material_id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', width: '100%',
                        background: b.picked ? 'rgba(63,167,150,0.1)' : C.panelAlt,
                        border: `1px solid ${b.picked ? C.teal : C.line}`, borderRadius: 8, padding: '8px 10px',
                        cursor: b.picked ? 'default' : 'pointer', boxSizing: 'border-box',
                      }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: b.picked ? C.teal : 'transparent', border: `1.5px solid ${b.picked ? C.teal : C.line}`,
                      }}>
                        {b.picked && <Check size={13} color={C.bg} />}
                      </div>
                      <span style={{ flex: 1, fontSize: 12.5, color: b.picked ? C.textDim : C.text, textDecoration: b.picked ? 'line-through' : 'none' }}>{b.material_name}</span>
                      <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: b.picked ? C.textDim : (enough ? C.text : C.red), flexShrink: 0 }}>
                        {b.qty} {b.unit}{!b.picked && !enough && ' ⚠'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
