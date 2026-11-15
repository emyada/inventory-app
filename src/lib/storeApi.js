// Storefront helpers: sale tag rules mirror the database (inventory_store_create_sale).
export const SALE_TAG_MIN = 3;
export const SALE_TAG_MAX = 64;

// Same normalisation as the database: trim, upper-case, ignore spaces - _ / .
export function saleTagKey(tag) {
  return String(tag ?? '').trim().toUpperCase().replace(/[\s\-_/.]/g, '');
}
export function validateSaleTag(tag) {
  const value = String(tag ?? '').trim();
  if (value.length < SALE_TAG_MIN || saleTagKey(value).length < SALE_TAG_MIN) {
    throw new Error(`ต้องกรอกรหัสแท็กการขาย (อย่างน้อย ${SALE_TAG_MIN} ตัวอักษร)`);
  }
  if (value.length > SALE_TAG_MAX) throw new Error(`รหัสแท็กยาวเกิน ${SALE_TAG_MAX} ตัวอักษร`);
  return value;
}

export function parseDuplicateSale(error) {
  if (!error || error.message !== 'DUPLICATE_SALE_TAG') return null;
  try {
    const detail = JSON.parse(error.details);
    return detail && typeof detail === 'object' ? detail : {};
  } catch { return {}; }
}

export function parseQty(value, kind) {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('จำนวนต้องเป็นตัวเลขมากกว่า 0');
  const qty = Number(text);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('จำนวนต้องมากกว่า 0');
  if (kind === 'model' && !Number.isInteger(qty)) throw new Error('จำนวนชุดต้องเป็นจำนวนเต็ม');
  return qty;
}

// cart row: {kind,id,name,unit,qty}; merging keeps one row per item.
export function addToCart(cart, item, qty) {
  const next = cart.map(row => ({ ...row }));
  const found = next.find(row => row.kind === item.kind && row.id === item.id);
  if (found) found.qty += qty; else next.push({ kind: item.kind, id: item.id, name: item.name, unit: item.unit, qty });
  return next;
}
export const cartLines = cart => cart.map(row => ({ kind: row.kind, id: row.id, qty: row.qty }));

export function storeError(error) {
  const message = error?.message || 'ทำรายการไม่สำเร็จ';
  if (message === 'DUPLICATE_SALE_TAG') return 'แท็กนี้ถูกใช้ไปแล้ว';
  if (message === 'SALE_TAG_REQUIRED') return `ต้องกรอกรหัสแท็กการขาย (อย่างน้อย ${SALE_TAG_MIN} ตัวอักษร)`;
  if (/Insufficient store stock/i.test(message)) return `ของหน้าร้านไม่พอ (${message.replace(/^.*?:\s*/, '')})`;
  if (/Insufficient stock/i.test(message)) return `วัตถุดิบในคลังหลักไม่พอสำหรับโอนครั้งนี้ (${message.replace(/^.*?:\s*/, '')})`;
  if (/Model has no BOM/i.test(message)) return 'รุ่นนี้ยังไม่มี BOM จึงโอนเป็นชุดไม่ได้';
  if (/Model not found or inactive/i.test(message)) return 'ไม่พบรุ่นหรือรุ่นถูกปิดใช้งาน';
  if (/Sale not found/i.test(message)) return 'ไม่พบรายการขาย หรือถูกยกเลิกไปแล้ว';
  if (/Cancel reason required/i.test(message)) return 'ต้องใส่เหตุผลการยกเลิก';
  if (/No change/i.test(message)) return 'ยอดนับเท่ากับยอดในระบบ ไม่มีอะไรต้องปรับ';
  if (/Permission denied/i.test(message)) return 'ไม่มีสิทธิ์ทำรายการนี้';
  return message;
}

export const storeSaleStatusLabel = status => (status === 'cancelled' ? 'ยกเลิก' : 'ขายแล้ว');
export const linesSummary = lines => (lines || []).map(l => `${l.name} ×${l.qty}`).join(', ');
