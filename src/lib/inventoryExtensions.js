// UI validation only; server allocations and authorization remain authoritative.
export function canCloseNotCompleted(row,role) {
  return role==='admin' && row.inventory_version===1 && !row.cancelled_at && !row.closure_kind
    && !['cancelled','production_not_completed','legacy_completed_shipped'].includes(row.workflow_state)
    && Array.isArray(row.returnable_lines) && row.returnable_lines.length>0;
}
export function physicalReturnDefaults(row) {
  if(!Array.isArray(row.returnable_lines)||!row.returnable_lines.length)throw new Error('ไม่พบยอดที่คืนได้ กรุณาโหลดคำขอใหม่');
  return row.returnable_lines.map(line=>{
    const snapshot=row.bom_snapshot?.find(b=>b.line_id===line.line_id);
    if(!snapshot||!Number.isFinite(Number(line.returnable_qty))||Number(line.returnable_qty)<0)throw new Error('ข้อมูลยอดคืนไม่ครบ กรุณาโหลดใหม่');
    return {line_id:line.line_id,name:snapshot.material_name,unit:snapshot.unit,max:String(line.returnable_qty),quantity:String(line.returnable_qty)};
  });
}
export function prepareExtension(api,kind,input,{role,row}={}) {
  if(role!=='admin')throw new Error('เฉพาะหัวหน้าเท่านั้น');
  if(kind==='close_not_completed'){
    if(!canCloseNotCompleted(row,role))throw new Error('คำขอนี้ไม่สามารถปิดงานด้วยยอดคืนจริงได้');
    if(!input.reason?.trim())throw new Error('กรุณาระบุเหตุผล');
    const defaults=physicalReturnDefaults(row);
    if(!Array.isArray(input.returns)||input.returns.length!==defaults.length)throw new Error('ระบุยอดคืนให้ครบทุกบรรทัด');
    const seen=new Set();
    const returns=input.returns.map(r=>{
      const line=defaults.find(d=>d.line_id===r.line_id);const qty=Number(r.quantity);
      if(!line||seen.has(r.line_id)||String(r.quantity).trim()===''||!Number.isFinite(qty)||qty<0||qty>Number(line.max))throw new Error('ยอดคืนต้องไม่เกินยอดที่ยังคืนได้');
      seen.add(r.line_id);return {line_id:r.line_id,quantity:String(r.quantity)};
    }).sort((a,b)=>a.line_id.localeCompare(b.line_id));
    return api.close_not_completed({transaction_id:row.id,reason:input.reason.trim(),returns});
  }
  if(kind==='issue_finished'){
    if(!row?.request_id||!input.reference?.trim()||!input.note?.trim())throw new Error('กรุณาระบุอ้างอิงและหมายเหตุ');
    return api.issue_finished({packing_request_id:row.request_id,quantity:1,reference:input.reference.trim(),note:input.note.trim()});
  }
  throw new Error('Unsupported extension action');
}
