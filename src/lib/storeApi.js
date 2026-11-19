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

// A sale may be saved without a tag ("waiting for tag"); a non-empty tag must still pass validateSaleTag.
export function optionalSaleTag(tag) {
  return String(tag ?? '').trim() ? validateSaleTag(tag) : null;
}
export const PENDING_TAG_WARN_DAYS = 3;
const bangkokDay = value => new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
// Whole Bangkok calendar days since the sale was recorded.
export function daysWaiting(createdAt, now = Date.now()) {
  const days = Math.round((Date.parse(bangkokDay(now)) - Date.parse(bangkokDay(createdAt))) / 86400000);
  return Number.isFinite(days) && days > 0 ? days : 0;
}
export const isPendingSale = sale => Boolean(sale?.pending);
export function pendingSummary(sales, now = Date.now()) {
  const pending = (sales || []).filter(isPendingSale);
  return { total: pending.length, overdue: pending.filter(s => daysWaiting(s.created_at, now) >= PENDING_TAG_WARN_DAYS).length };
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
  const source = item.source || 'store';
  const found = next.find(row => row.kind === item.kind && row.id === item.id && (row.source || 'store') === source);
  if (found) found.qty += qty; else next.push({ kind: item.kind, id: item.id, name: item.name, unit: item.unit, qty, source });
  return next;
}
export const cartLines = cart => cart.map(row => ({ kind: row.kind, id: row.id, qty: row.qty, ...(row.source === 'main' ? { source: 'main' } : {}) }));

export function storeError(error) {
  const message = error?.message || 'ทำรายการไม่สำเร็จ';
  if (message === 'DUPLICATE_SALE_TAG') return 'แท็กนี้ถูกใช้ไปแล้ว';
  if (message === 'SALE_TAG_REQUIRED') return `ต้องกรอกรหัสแท็กการขาย (อย่างน้อย ${SALE_TAG_MIN} ตัวอักษร)`;
  if (/^MAIN_STOCK_SHORT/.test(message)) return `ของในคลังหลักไม่พอ: ${message.replace(/^MAIN_STOCK_SHORT:\s*/, '')} (ยังไม่ตัดอะไรเลย)`;
  if (message === 'FEEDBACK_MESSAGE_REQUIRED') return 'พิมพ์ข้อความอย่างน้อย 3 ตัวอักษร';
  if (message === 'ORDER_INVALID') return 'ลำดับสินค้าไม่ถูกต้อง ลองรีเฟรชหน้าแล้วจัดใหม่';
  if (message === 'FEEDBACK_TOO_MANY') return 'ส่งบ่อยเกินไป รออีกสักครู่แล้วลองใหม่';
  if (message === 'SALE_REASON_REQUIRED') return 'ต้องใส่เหตุผลการขายอื่นๆ ก่อนบันทึก';
  if (message === 'SALE_TAG_ALREADY_SET') return 'ใบนี้มีแท็กแล้ว';
  if (/Finite positive quantity/i.test(message)) return 'จุดเตือนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป';
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

export const storeSaleStatusLabel = (status, pending = false) => (status === 'cancelled' ? 'ยกเลิก' : pending ? 'รอแท็ก' : 'ขายแล้ว');
export const linesSummary = lines => (lines || []).map(l => `${l.name} ×${l.qty}${l.source === 'main' ? ' (คลังหลัก)' : ''}`).join(', ');

// ---- low-stock warning (per-item threshold, set by admin) ----
// min_qty null = no warning. qty<=0 → 'out' (only if a threshold is set), qty<=min → 'low'.
export function stockLevel(row) {
  const min = row?.min_qty;
  if (min === null || min === undefined || min === '') return 'ok';
  const qty = Number(row.qty), limit = Number(min);
  if (!Number.isFinite(limit)) return 'ok';
  if (qty <= 0) return 'out';
  return qty <= limit ? 'low' : 'ok';
}
export const lowStockCount = rows => (rows || []).filter(r => stockLevel(r) !== 'ok').length;
const LEVEL_ORDER = { out: 0, low: 1, ok: 2 };
// warning items first (out, then low), the rest keep their given order
export const sortLowFirst = rows => (rows || []).map((r, i) => ({ r, i })).sort((a, b) => LEVEL_ORDER[stockLevel(a.r)] - LEVEL_ORDER[stockLevel(b.r)] || a.i - b.i).map(x => x.r);
// "" → clear threshold (null); otherwise number >= 0
export function parseMinQty(value) {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('จุดเตือนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  return Number(text);
}

// ---- sold board: items sold in a month (store report + main-stock sales) ----
export function soldBoard(storeItems, mainItems) {
  const out = [];
  for (const r of storeItems || []) {
    const qty = Number(r.sold || 0) - Number(r.sale_cancelled || 0);
    if (qty > 0) out.push({ key: `${r.item_kind}:${r.item_id || r.name}`, name: r.name, unit: r.unit, kind: r.item_kind, qty });
  }
  for (const r of mainItems || []) {
    const qty = Number(r.qty || 0);
    if (qty > 0) out.push({ key: `main:${r.material_id || r.name}`, name: r.name, unit: r.unit, kind: 'main', qty });
  }
  return out.sort((a, b) => b.qty - a.qty || String(a.name).localeCompare(String(b.name), 'th'));
}

// ---- sell-page order (admin sets it; everyone sees it) ----
const orderKey = (kind, id) => `${kind}:${id}`;
// items: [{kind,id,name}] · order: [{item_kind,item_id,position}] → ordered items first, the rest by name
export function sortByStoreOrder(items, order) {
  const pos = new Map((order || []).map(o => [orderKey(o.item_kind, o.item_id), Number(o.position)]));
  return (items || []).map((it, i) => ({ it, i, p: pos.has(orderKey(it.kind, it.id)) ? pos.get(orderKey(it.kind, it.id)) : Infinity }))
    .sort((a, b) => a.p === b.p ? String(a.it.name).localeCompare(String(b.it.name), 'th') || a.i - b.i : a.p - b.p)
    .map(x => x.it);
}
export function moveItem(list, index, delta) {
  const j = index + delta;
  if (index < 0 || index >= list.length || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}
// visible items in the new order first, then already-ordered items that are not on screen (so they keep a place)
export function orderPayload(visible, order) {
  const seen = new Set(visible.map(v => orderKey(v.kind, v.id)));
  const rest = [...(order || [])].sort((a, b) => a.position - b.position).filter(o => !seen.has(orderKey(o.item_kind, o.item_id)));
  return [...visible.map(v => ({ kind: v.kind, id: v.id })), ...rest.map(o => ({ kind: o.item_kind, id: o.item_id }))];
}

// which store sub-pages each role gets, in display order (store staff: no "อื่นๆ" and no "รายงาน")
export const storeModeKeys = role => role === 'store' ? ['sell', 'stock', 'sales'] : ['stock', 'sales', 'sell', 'other', 'report'];
