import React, { useState } from 'react';
import { Check, Package, Users } from 'lucide-react';
import { C, mono } from '../theme';

export function PickQueueView({ transactions, materialsById, onBulkPick }) {
  const [busyId, setBusyId] = useState(null);

  // An order is "open" as long as at least one of its lines hasn't been picked yet.
  const openOrders = transactions.filter(t => t.bom_snapshot.some(b => !b.picked));

  // Aggregate every not-yet-picked line across all open orders — this is the
  // ONLY place the stock lead needs to tick. One tick here clears that
  // material across every order that's waiting on it.
  const totals = {};
  openOrders.forEach(t => {
    t.bom_snapshot.filter(b => !b.picked).forEach(b => {
      if (!totals[b.material_id]) totals[b.material_id] = { name: b.material_name, unit: b.unit, qty: 0, orders: 0 };
      totals[b.material_id].qty += b.qty;
      totals[b.material_id].orders += 1;
    });
  });
  const totalRows = Object.entries(totals).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.qty - a.qty);

  // Read-only summary grouped by staff, purely for reference/handoff — not for ticking.
  const byStaff = {};
  openOrders.forEach(t => {
    const key = t.staff_name || 'ไม่ระบุชื่อ';
    if (!byStaff[key]) byStaff[key] = { orders: [], byModel: {} };
    byStaff[key].orders.push(t);
    byStaff[key].byModel[t.model_name] = (byStaff[key].byModel[t.model_name] || 0) + 1;
  });

  async function handleBulkPick(materialId) {
    setBusyId(materialId);
    const { error } = await onBulkPick(materialId);
    setBusyId(null);
    if (error) alert(error);
  }

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>คิวรอเบิก</div>
      <div style={{ fontSize: 11.5, color: C.textDim, marginBottom: 14 }}>{openOrders.length} ออเดอร์ยังไม่จ่ายครบ</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: C.amber, marginBottom: 8 }}>
        <Package size={14} /> รวมที่ต้องหยิบตอนนี้ — ติ๊กเมื่อหยิบครบแล้ว
      </div>

      {totalRows.length === 0 && (
        <div style={{ fontSize: 13, color: C.textDim, textAlign: 'center', padding: '20px 0' }}>ไม่มีของค้างหยิบตอนนี้ 🎉</div>
      )}

      <div className="grid-list" style={{ marginBottom: 22 }}>
        {totalRows.map(r => (
          <button key={r.id} disabled={busyId === r.id} onClick={() => handleBulkPick(r.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%', boxSizing: 'border-box',
              background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer',
            }}>
            <div style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${C.line}` }}>
              {busyId === r.id ? <span style={{ fontSize: 10, color: C.textDim }}>...</span> : null}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
              <div style={{ fontSize: 10.5, color: C.textDim }}>จาก {r.orders} ออเดอร์</div>
            </div>
            <div style={{ ...mono, fontWeight: 700, color: C.teal, flexShrink: 0 }}>{r.qty} {r.unit}</div>
          </button>
        ))}
      </div>

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
              <div style={{ fontWeight: 700, fontSize: 13 }}>{staff}</div>
              <div style={{ ...mono, fontSize: 11.5, color: C.textDim }}>{info.orders.length} ออเดอร์</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {Object.entries(info.byModel).map(([name, count]) => (
                <div key={name} style={{ background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 8, padding: '4px 9px', fontSize: 11.5 }}>
                  {name} <span style={{ ...mono, color: C.teal, fontWeight: 700 }}>x{count}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {info.orders.map(t => {
                const done = t.bom_snapshot.filter(b => b.picked).length;
                const total = t.bom_snapshot.length;
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
    </div>
  );
}
