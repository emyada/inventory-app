export function cancelEligibility(row, role, userId) {
  if (['cancelled','production_not_completed','legacy_completed_shipped'].includes(row.workflow_state)) return 'รายการนี้ยกเลิกแล้ว';
  if (role === 'admin') return null;
  if (role !== 'staff' || row.created_by !== userId) return 'ไม่มีสิทธิ์ยกเลิกคำขอนี้';
  if (Number(row.picked_lines) > 0 || row.bom_snapshot?.some(b => b.picked) || row.has_allocation) return 'เริ่มหยิบแล้ว ต้องให้หัวหน้ายกเลิกและคืนยอด';
  return null; // Server checks allocations unavailable to this read RPC; UI is advisory only.
}
export function workflowError(error) {
  const message = error?.message || 'ส่งรายการไม่สำเร็จ';
  if (/order.*conflict|order.*already|duplicate/i.test(message)) return `เลขออเดอร์ซ้ำ: CIEM ซ้ำรุ่นเดิมไม่ได้; หมวดผลิตอื่นซ้ำเลขออเดอร์ไม่ได้ (${message})`;
  if (/insufficient stock/i.test(message)) return `วัตถุดิบไม่พอ รายการยังไม่สำเร็จ (${message})`;
  if (/Only admin|issue\/allocation/i.test(message)) return `ต้องให้หัวหน้ายกเลิกและคืนยอด (${message})`;
  return message;
}
export function prepareWorkflow(api, kind, input, { role, userId, row, model } = {}) {
  if (kind === 'create') {
    if (!['admin','staff'].includes(role)) throw new Error('ไม่มีสิทธิ์สร้างคำขอ');
    if (!input.order_ref?.trim() && (input.repair_spec || model?.category!=='Universal' || model.id!==input.model_id)) throw new Error('กรุณาระบุเลขออเดอร์');
    if (input.repair_spec) {
      if (!input.repair_spec.note?.trim() || !input.repair_spec.bom?.length) throw new Error('งานซ่อมต้องมีหมายเหตุและวัตถุดิบ');
      return api.create_request({ model_id: null, order_ref: input.order_ref.trim(), repair_spec: {
        subtype: input.repair_spec.subtype, note: input.repair_spec.note.trim(),
        bom: input.repair_spec.bom.map(b => ({ material_id: b.material_id, qty: b.qty })),
      } });
    }
    if (!input.model_id) throw new Error('กรุณาเลือกรุ่น');
    return api.create_request({ model_id: input.model_id, order_ref: (input.order_ref||'').trim(), repair_spec: null });
  }
  if (kind === 'pick') {
    if (role !== 'admin') throw new Error('เฉพาะหัวหน้าจึงยืนยันหยิบได้');
    const items = input.items.map(b => ({ transaction_id: b.transaction_id, line_id: b.line_id }))
      .sort((a,b) => `${a.transaction_id}:${a.line_id}`.localeCompare(`${b.transaction_id}:${b.line_id}`));
    if (!items.length) throw new Error('กรุณาเลือกบรรทัดที่หยิบ');
    return api.confirm_pick({ items });
  }
  if (kind === 'cancel') {
    const denial = cancelEligibility(row, role, userId); if (denial) throw new Error(denial);
    if (!input.reason?.trim()) throw new Error('กรุณาระบุเหตุผล');
    return api.cancel_request({ transaction_id: row.id, reason: input.reason.trim(),
      legacy_return_verified: role === 'admin' && input.legacy_return_verified === true });
  }
  throw new Error('Unsupported workflow');
}
