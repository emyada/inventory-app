import React, { useState } from 'react';
import { Check, ClipboardCheck } from 'lucide-react';
import { C, mono } from '../theme';

export function RecheckView({ transactions, userId, onConfirm }) {
  const [busyKey, setBusyKey] = useState(null);

  // Only this person's own orders, and only ones with at least one picked
  // line still waiting on their confirmation.
  const myOpenOrders = transactions
    .filter(t => t.created_by === userId)
    .filter(t => t.bom_snapshot.some(b => b.picked && !b.received))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  async function handleConfirm(tx, materialId) {
    const key = tx.id + materialId;
    setBusyKey(key);
    const { error } = await onConfirm(tx, materialId);
    setBusyKey(null);
    if (error) alert(error);
  }

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>เช็ครับของ</div>
      <div style={{ fontSize: 11.5, color: C.textDim, marginBottom: 14, lineHeight: 1.5 }}>
        พอหัวหน้าสต๊อกหยิบของให้แล้ว มาติ๊กยืนยันที่นี่ว่าได้รับครบตรงตามจำนวนจริง
      </div>

      {myOpenOrders.length === 0 && (
        <div style={{ fontSize: 13, color: C.textDim, textAlign: 'center', padding: '30px 0' }}>ไม่มีของรอเช็ครับตอนนี้</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {myOpenOrders.map(tx => {
          const pendingLines = tx.bom_snapshot.filter(b => b.picked && !b.received);
          const waitingLines = tx.bom_snapshot.filter(b => !b.picked);
          return (
            <div key={tx.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{tx.model_name} <span style={{ color: C.textDim, fontWeight: 400, fontSize: 11.5 }}>· {tx.category}</span></div>
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>ออเดอร์ {tx.order_ref}</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {pendingLines.map(b => {
                  const key = tx.id + b.material_id;
                  return (
                    <button key={b.material_id} disabled={busyKey === key} onClick={() => handleConfirm(tx, b.material_id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', width: '100%', boxSizing: 'border-box',
                        background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 8, padding: '8px 10px', cursor: 'pointer',
                      }}>
                      <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, border: `1.5px solid ${C.line}` }} />
                      <span style={{ flex: 1, fontSize: 12.5 }}>{b.material_name}</span>
                      <span style={{ ...mono, fontSize: 12, fontWeight: 700 }}>{b.qty} {b.unit}</span>
                    </button>
                  );
                })}
                {waitingLines.map(b => (
                  <div key={b.material_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', fontSize: 12, color: C.textDim }}>
                    <ClipboardCheck size={13} />
                    <span style={{ flex: 1 }}>{b.material_name}</span>
                    <span style={{ ...mono }}>รอหัวหน้าหยิบ</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
