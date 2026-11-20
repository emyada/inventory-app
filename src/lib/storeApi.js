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
  if (message === 'TAG_CHANNEL_MISMATCH') return TAG_MISMATCH_TEXT;
  if (message === 'CHANNEL_NAME_INVALID') return 'ชื่อช่องทางต้องยาว 1–30 ตัวอักษร';
  if (message === 'CHANNEL_NAME_DUPLICATE') return 'มีช่องทางชื่อนี้แล้ว';
  if (message === 'CHANNEL_RULE_INVALID') return 'กฎของเลขแท็กไม่ถูกต้อง ตรวจคำขึ้นต้น จำนวนหลัก และตัวเลือกวันที่';
  if (message === 'CHANNEL_RULE_CONFLICT') return 'กฎนี้ชนกับช่องทางอื่นหรือแท็กที่ขายไปแล้ว บันทึกไม่ได้';
  if (message === 'CHANNEL_IN_USE') return 'ช่องทางนี้เคยมียอดขายแล้ว ลบไม่ได้ ให้ใช้ “ปิดใช้งาน” แทน';
  if (message === 'CHANNEL_SYSTEM') return 'ช่องทางของระบบ แก้ ปิด หรือลบไม่ได้';
  if (message === 'CHANNEL_NOT_FOUND') return 'ไม่พบช่องทางนี้ ลองรีเฟรชหน้า';
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

// newest first, first n (for the "ขายล่าสุด" panel on the sell page)
export const latestSales = (sales, n = 3) => [...(sales || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, n);

// ---- sales channels (TikTok / Shipnity / admin-added): the tag number decides the channel ----
export const TAG_MISMATCH_TEXT = 'ไม่ตรงกับช่องทางที่มีอยู่ ติ๊กอื่นๆ เพื่อทำรายการ';
export const CHANNEL_COLORS = [['red', 'แดง'], ['blue', 'น้ำเงิน'], ['amber', 'ส้ม'], ['green', 'เขียว'], ['purple', 'ม่วง'], ['gray', 'เทา']];
const DATE_BODY = '[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])';
// Same rule builder as the database (inventory_store_save_channel); null = invalid spec.
export function buildChannelPattern(spec) {
  const prefix = String(spec?.prefix ?? '').trim().toUpperCase();
  const digits = Number(spec?.digits || 0);
  const withDate = Boolean(spec?.with_date), withSeq = Boolean(spec?.with_seq);
  if (!/^[A-Z0-9]{0,8}$/.test(prefix) || (withSeq && !withDate)) return null;
  if (!withDate && !(Number.isInteger(digits) && digits >= 1 && digits <= 30)) return null;
  const lead = prefix || (withDate ? '[A-Z]{1,3}' : '');
  const body = withDate ? DATE_BODY + (withSeq ? '-[1-9][0-9]{0,3}' : '') : `[0-9]{${digits}}`;
  return `^${lead}${body}$`;
}
export function describeChannelRule(channel) {
  const spec = channel?.spec;
  if (!spec) return channel?.is_system ? 'ไม่ตรวจรูปแบบ ติ๊กเองเมื่อแท็กไม่ตรงช่องทางอื่น' : '—';
  const prefix = String(spec.prefix || '').trim();
  if (spec.with_date) return `${prefix || 'ตัวอักษร 1–3 ตัว'} + วันที่ 6 หลัก (ปีเดือนวัน)${spec.with_seq ? ' + ขีด + ลำดับ 1–4 หลัก' : ''}`;
  return `${prefix ? prefix + ' + ' : ''}ตัวเลขล้วน ${spec.digits} หลัก`;
}
// First active channel (list is ordered by position) whose rule matches the tag; null = no match.
export function matchChannel(tag, channels) {
  const value = String(tag ?? '').trim().toUpperCase();
  if (!value) return null;
  for (const c of channels || []) {
    if (!c.active || !c.pattern) continue;
    try { if (new RegExp(c.pattern).test(value)) return c; } catch { /* bad rule: ignore */ }
  }
  return null;
}
// state of the tag box: 'empty' | 'match' | 'mismatch' | 'other' (mismatch + ticked อื่นๆ)
export function tagChannelState(tag, channels, other) {
  if (!String(tag ?? '').trim()) return {state: 'empty', channel: null};
  const channel = matchChannel(tag, channels);
  if (channel) return {state: 'match', channel};
  return {state: other ? 'other' : 'mismatch', channel: null};
}
// can the sale be saved? Without a loaded channel list the database still enforces the lock.
export const tagChannelOk = (tag, channels, other) => !String(tag ?? '').trim() || !(channels || []).length || tagChannelState(tag, channels, other).state !== 'mismatch';
export const channelOtherFlag = (tag, channels, other) => (other && !matchChannel(tag, channels) ? {other: true} : {});
