import React, { useEffect, useState } from 'react';
import { Trash2, Clock } from 'lucide-react';
import { C, mono } from '../theme';

const CANCEL_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

function minutesLeft(createdAt) {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  return Math.max(0, Math.ceil((CANCEL_WINDOW_MS - elapsed) / 60000));
}

function pickStatus(bomSnapshot) {
  const total = bomSnapshot.length;
  const done = bomSnapshot.filter(b => b.picked).length;
  if (done === 0) return { label: 'รอเบิก', color: C.textDim };
  if (done === total) return { label: 'เบิกครบแล้ว', color: C.teal };
  return { label: `เบิกแล้ว ${done}/${total}`, color: C.amber };
}

export function MyOrders({ transactions, userId, onCancel }) {
  const [, forceTick] = useState(0);
  // re-render every 30s so the countdown / cancel-eligibility stays accurate
  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const mine = transactions
    .filter(t => t.created_by === userId)
    .slice(0, 15);

  if (mine.length === 0) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.textDim, marginBottom: 8 }}>ออเดอร์ล่าสุดของฉัน</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {mine.map(t => {
          const left = minutesLeft(t.created_at);
          const canCancel = left > 0;
          const status = pickStatus(t.bom_snapshot);
          return (
            <div key={t.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 9, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{t.model_name}</div>
                <div style={{ fontSize: 10.5, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>ออเดอร์ {t.order_ref}</div>
                <div style={{ fontSize: 10.5, color: status.color, fontWeight: 600, marginTop: 2 }}>{status.label}</div>
              </div>
              {canCancel ? (
                <button onClick={() => onCancel(t)} title={`ยกเลิกได้อีก ${left} นาที`}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: `1px solid ${C.line}`, borderRadius: 7, padding: '5px 8px', color: C.red, cursor: 'pointer', fontSize: 10.5, flexShrink: 0, ...mono }}>
                  <Trash2 size={12} /> {left}น.
                </button>
              ) : (
                <div title="เกิน 30 นาทีแล้ว ให้หัวหน้าช่างยกเลิกแทน"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.textDim, fontSize: 10.5, flexShrink: 0 }}>
                  <Clock size={12} /> หมดเวลา
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
