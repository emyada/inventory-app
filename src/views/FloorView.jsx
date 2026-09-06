import React from 'react';
import { Plus, AlertTriangle, Pencil, Wrench } from 'lucide-react';
import { C, btnGhost, isRepairCategory } from '../theme';

export function FloorView({ category, models, materialsById, onProduce, role, onAddModel, onEditModel, onRepairRequest }) {
  if (isRepairCategory(category)) {
    return (
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>{category}</div>
        <div style={{ fontSize: 12.5, color: C.textDim, marginBottom: 16, lineHeight: 1.6 }}>
          หมวดนี้ไม่มีรุ่นสำเร็จรูป — แต่ละเคสยื่นคำขอแยกกันเอง พร้อมระบุสาเหตุและเลือกวัตถุดิบเองได้อิสระ
        </div>
        <button onClick={onRepairRequest}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', background: C.amber, color: C.bg, border: 'none', borderRadius: 12, padding: '16px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
          <Wrench size={16} /> ยื่นคำขอเบิก (ซ่อม/เคสพิเศษ)
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{category}</div>
        {role === 'admin' && (
          <button onClick={onAddModel} style={btnGhost}><Plus size={13} style={{ marginRight: 4 }} /> เพิ่มรุ่น</button>
        )}
      </div>
      <div className="grid-list">
        {models.map(model => {
          const shortage = model.bom.some(b => (materialsById[b.material_id]?.qty ?? 0) < b.qty);
          return (
            <div key={model.id} style={{ position: 'relative', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
              {role === 'admin' && (
                <button onClick={() => onEditModel(model)} title="แก้ไขรุ่นนี้"
                  style={{ position: 'absolute', top: 10, right: 10, background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 7, padding: 5, cursor: 'pointer', color: C.textDim }}>
                  <Pencil size={12} />
                </button>
              )}
              <button onClick={() => onProduce(model)} style={{ all: 'unset', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', width: '100%', boxSizing: 'border-box', paddingRight: role === 'admin' ? 30 : 0 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5 }}>{model.name}</div>
                    {shortage && <AlertTriangle size={13} color={C.red} />}
                  </div>
                  <div style={{ fontSize: 11, color: C.textDim, marginTop: 3 }}>{model.bom.length} วัตถุดิบ/ชิ้น</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.bg, background: C.amber, fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 20, flexShrink: 0 }}>
                  <Plus size={13} /> ผลิต
                </div>
              </button>
            </div>
          );
        })}
        {models.length === 0 && <div style={{ color: C.textDim, fontSize: 13 }}>ยังไม่มีรุ่นในหมวดนี้</div>}
      </div>
    </div>
  );
}
