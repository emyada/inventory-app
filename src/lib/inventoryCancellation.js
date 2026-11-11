export const cancellationReasons = Object.freeze([
  ['model_change','ลูกค้าเปลี่ยนรุ่น'], ['package_change','เปลี่ยน Package'],
  ['wrong_model','เลือกรุ่นผิด'], ['wrong_reference','เลขออเดอร์ผิด'],
  ['wrong_materials','วัสดุหรือจำนวนผิด'], ['customer_cancel','ลูกค้ายกเลิก'], ['other','อื่นๆ'],
].map(([value,label])=>Object.freeze({value,label})));
export function cancellationReason(code, details='') {
  const option=cancellationReasons.find(r=>r.value===code);
  if(!option) throw new Error('กรุณาเลือกเหตุผลยกเลิก');
  return `[${option.value}] ${option.label}${details.trim()?` — ${details.trim()}`:''}`;
}
export function hasIssuedStock(row) {
  return Number(row?.picked_lines)>0 || Boolean(row?.has_allocation) || Boolean(row?.bom_snapshot?.some(line=>line.picked));
}
export const restorationWarning='คืนยอดทางบัญชีเต็มจำนวนที่ยังไม่ได้คืน ไม่ใช่การยืนยันว่ามีวัสดุจริงครบ หากใช้วัสดุไปแล้ว ยอดบัญชีอาจต่างจากของจริง';
