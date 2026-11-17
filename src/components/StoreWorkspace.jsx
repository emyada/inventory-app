import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useRefreshRead} from '../hooks/useRefreshRead.js';
import {useInventoryOperation} from '../hooks/useInventoryOperation.js';
import {ModalHeader} from './InventoryUI.jsx';
import {ReportTable} from './InventoryReports.jsx';
import {managementCatalog} from '../lib/inventoryModelCatalog.js';
import {localDay, reportCSV} from '../lib/inventoryReports.js';
import {downloadCSV} from '../utils/csv.js';
import {addToCart, cartLines, linesSummary, parseDuplicateSale, optionalSaleTag, parseQty, storeError, storeSaleStatusLabel, daysWaiting, pendingSummary, PENDING_TAG_WARN_DAYS, validateSaleTag} from '../lib/storeApi.js';

const fmtTime = value => new Date(value).toLocaleString('th-TH', {timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short'});
const fmtQty = n => Number(n).toLocaleString('th-TH', {maximumFractionDigits: 3});

function useStoreRead(load, revision, deps = []) {
  const [state, setState] = useState({busy: true, error: null, data: null});
  useRefreshRead(() => { setState(s => ({...s, busy: true, error: null})); return load(); },
    data => setState({busy: false, error: null, data}),
    e => setState({busy: false, error: e.message, data: null}),
    [revision, ...deps]);
  return state;
}
function ReadNote({state}) {
  return <>{state.busy && <p role="status">กำลังโหลด…</p>}{state.error && <p role="alert">{state.error} กรุณาโหลดใหม่</p>}</>;
}

// Shows progress/result of one prepared (idempotent) operation.
function OpResult({operation, onSuccess, onFailure}) {
  const state = useInventoryOperation(operation);
  const notified = useRef(false);
  useEffect(() => {
    if (notified.current) return;
    if (state.status === 'succeeded') { notified.current = true; onSuccess(state.data); }
    else if (state.status === 'failed') { notified.current = true; onFailure(state.error); }
  }, [state.status, state.error, state.data, onSuccess, onFailure]);
  return <div aria-live="polite">
    {state.loading && <p role="status">กำลังบันทึก…</p>}
    {state.status === 'unknown' && <p role="alert">ยังไม่ทราบผล กรุณากดลองอีกครั้ง (ใช้รายการเดิม ไม่เกิดซ้ำ) <button type="button" onClick={() => state.retry().catch(() => {})}>ลองอีกครั้ง</button></p>}
  </div>;
}

// Runs a mutation prepared by `prepare()`; blocks double submit.
function useOperation() {
  const [operation, setOperation] = useState(null);
  const [error, setError] = useState(null);
  const flight = useRef(null);
  const run = useCallback(prepare => {
    if (flight.current) return;
    try {
      const op = prepare();
      flight.current = op; setOperation(op); setError(null);
      op.execute().catch(() => {});
    } catch (e) { setError(storeError(e)); }
  }, []);
  const reset = useCallback(() => { flight.current = null; setOperation(null); }, []);
  return {operation, error, setError, run, reset, busy: Boolean(operation)};
}

/* ---------------- Sell (storefront stock, or "อื่นๆ" = main warehouse stock) ---------------- */
const normalizeStoreItem = i => ({key: `${i.item_kind}:${i.item_id}`, kind: i.item_kind, id: i.item_id, name: i.name, unit: i.unit, qty: Number(i.qty), category: i.category, source: 'store'});
const normalizeMainItem = i => ({key: `material:${i.material_id}`, kind: 'material', id: i.material_id, name: i.name, unit: i.unit, qty: i.qty == null ? null : Number(i.qty), inStock: Boolean(i.in_stock), pinned: Boolean(i.pinned), source: 'main'});

export function StoreSell({api, role, source = 'store', revision, onChanged, actionBusy}) {
  const isMain = source === 'main';
  const stock = useStoreRead(() => (isMain ? api.store_list_main_items() : api.store_list_stock()), revision, [source]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [tag, setTag] = useState('');
  const [qtyDraft, setQtyDraft] = useState({});
  const [message, setMessage] = useState('');
  const [duplicate, setDuplicate] = useState(null);
  const op = useOperation();
  const pinOp = useOperation();
  const all = useMemo(() => (stock.data || []).map(isMain ? normalizeMainItem : normalizeStoreItem), [stock.data, isMain]);
  const items = useMemo(() => all.filter(i => i.name.toLowerCase().includes(search.toLowerCase())), [all, search]);
  const quick = useMemo(() => all.filter(i => i.pinned && i.inStock), [all]);
  const inCart = item => cart.find(r => r.kind === item.kind && r.id === item.id && r.source === source)?.qty || 0;
  const canSeeQty = !isMain || role === 'admin';

  function add(item, rawQty) {
    try {
      const qty = parseQty(rawQty ?? qtyDraft[item.key] ?? '1', item.kind);
      if (isMain && !item.inStock) throw new Error(`${item.name} หมดในคลังหลัก`);
      if (!isMain && inCart(item) + qty > item.qty) throw new Error(`ของหน้าร้านมี ${fmtQty(item.qty)} ${item.unit} ใส่เกินไม่ได้`);
      if (isMain && item.qty != null && inCart(item) + qty > item.qty) throw new Error(`คลังหลักมี ${fmtQty(item.qty)} ${item.unit} ใส่เกินไม่ได้`);
      setCart(addToCart(cart, {kind: item.kind, id: item.id, name: item.name, unit: item.unit, source}, qty));
      setQtyDraft({...qtyDraft, [item.key]: '1'}); op.setError(null);
    } catch (e) { op.setError(e.message); }
  }
  function submit(e) {
    e.preventDefault(); setMessage(''); setDuplicate(null);
    op.run(() => {
      const clean = isMain ? optionalSaleTag(tag) : validateSaleTag(tag);
      if (!cart.length) throw new Error('เลือกสินค้าอย่างน้อย 1 รายการ');
      return api.store_create_sale({...(clean ? {tag: clean} : {}), lines: cartLines(cart)});
    });
  }
  function addToExisting() {
    op.reset();
    op.run(() => api.store_add_sale_lines({sale_id: duplicate.sale_id, lines: cartLines(cart)}, {intentKey: `add:${duplicate.sale_id}`}));
  }
  const done = useCallback(result => {
    setMessage(result?.tag ? `บันทึกการขาย ${result.tag} แล้ว` : 'บันทึกแล้ว — ตัดสต็อกแล้ว รอกรอกแท็กทีหลัง (ดูที่ รายการขาย)');
    setCart([]); setTag(''); setDuplicate(null); op.reset(); onChanged();
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- reset is stable
  }, [onChanged]);
  const failed = useCallback(error => {
    const dup = parseDuplicateSale(error);
    setDuplicate(dup); op.setError(dup ? null : storeError(error)); op.reset();
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- stable setters
  }, []);
  const disabled = actionBusy || op.busy;
  const togglePin = item => pinOp.run(() => api.store_set_pin({material_id: item.id, pinned: !item.pinned}, {intentKey: `pin:${item.id}:${!item.pinned}`}));

  return <section className="store-sell">
    <form className="store-sell-cart inv-card" onSubmit={submit}>
      <h3>ออเดอร์นี้{isMain ? ' (จากคลังหลัก)' : ''} <span className="inv-muted">· {cart.length} รายการ</span>{cart.length > 0 && <button type="button" className="store-clear" disabled={disabled} onClick={() => setCart([])}>ล้าง</button>}</h3>
      {!cart.length && <p className="inv-muted store-cart-empty">ยังไม่ได้เลือกสินค้า</p>}
      <ul className="inv-bom-rows store-cart-rows">{cart.map(r => <li key={`${r.kind}:${r.id}:${r.source}`}>
        <span>{r.name}<small>{r.kind === 'model' ? 'ชุด' : r.unit}</small></span><strong>×{fmtQty(r.qty)}</strong>
        <button type="button" className="inv-icon" aria-label={`เอา ${r.name} ออก`} disabled={disabled} onClick={() => setCart(cart.filter(x => x !== r))}>✕</button>
      </li>)}</ul>
      <div className="store-tag-row">
        <input aria-label="รหัสแท็กการขาย" required={!isMain} value={tag} onChange={e => { setTag(e.target.value); setDuplicate(null); }} placeholder={isMain ? 'แท็กการขาย (ใส่ทีหลังได้)' : 'แท็กการขาย (เลข Shopify) *'} aria-describedby="tag-help" autoComplete="off"/>
        <button type="submit" className="inv-primary" disabled={disabled || !cart.length || (!isMain && !tag.trim())}>{tag.trim() ? 'บันทึกการขาย' : 'บันทึก (รอแท็ก)'}</button>
      </div>
      <p id="tag-help" className="inv-muted store-tag-help">{isMain ? 'เว้นว่าง = ตัดคลังหลักทันที แล้วไปกรอกแท็กทีหลังที่ “รายการขาย”' : <><b className="store-req">ต้องใส่แท็ก</b> · 1 แท็ก = 1 ออเดอร์ ใช้ซ้ำไม่ได้ (ไม่สนตัวพิมพ์ ช่องว่าง ขีด)</>}</p>
      {duplicate && <div role="alert" className="store-duplicate">
        <p><b>แท็ก {duplicate.tag || tag} ถูกใช้แล้ว</b>{duplicate.seller_name ? ` โดย ${duplicate.seller_name}` : ''}{duplicate.created_at ? ` เมื่อ ${fmtTime(duplicate.created_at)}` : ''}</p>
        <p>ถ้าเป็นลูกค้าคนเดิมสั่งเพิ่ม ให้เพิ่มรายการในออเดอร์เดิม ถ้าเป็นคนละออเดอร์ให้แก้แท็ก</p>
        {cart.length > 0 && duplicate.sale_id && <button type="button" disabled={disabled} onClick={addToExisting}>เพิ่มรายการเหล่านี้ในออเดอร์เดิม</button>}
      </div>}
      {op.error && <p role="alert">{op.error}</p>}
      {message && <p role="status" className="inv-success">{message}</p>}
      {op.operation && <OpResult operation={op.operation} onSuccess={done} onFailure={failed}/>}
    </form>
    <div className="store-sell-pick">
      {isMain && quick.length > 0 && <div className="store-quick" aria-label="ของขายบ่อย">
        <span className="store-quick-label" aria-hidden="true">★</span>
        {quick.map(i => <button type="button" key={i.key} disabled={disabled} onClick={() => add(i, '1')}>+ {i.name}</button>)}
      </div>}
      <input className="store-search" aria-label="ค้นหาสินค้า" placeholder={isMain ? 'ค้นหาวัตถุดิบในคลังหลัก…' : 'ค้นหาสินค้า…'} value={search} onChange={e => setSearch(e.target.value)}/>
      <ReadNote state={stock}/>
      {pinOp.error && <p role="alert">{pinOp.error}</p>}
      {pinOp.operation && <OpResult operation={pinOp.operation} onSuccess={() => { pinOp.reset(); onChanged(); }} onFailure={e => { pinOp.setError(storeError(e)); pinOp.reset(); }}/>}
      {!stock.busy && !stock.error && !items.length && <p className="inv-empty">{isMain ? 'ไม่พบวัตถุดิบ' : 'ไม่มีของให้ขาย — รอหัวหน้าสต๊อกโอนของมาหน้าร้าน'}</p>}
      <div className="store-sell-scroll">{items.map(i => <article className="inv-card store-item" key={i.key}>
        <div className="store-item-info">
          <h3>{i.name}</h3>
          <p className="inv-muted">{!isMain && <>{i.kind === 'model' ? 'ชุดสำเร็จรูป' : 'อะไหล่'}{i.category ? ` · ${i.category}` : ''} · </>}{canSeeQty
            ? <><strong className="inv-balance">{fmtQty(i.qty - inCart(i))}</strong> {i.unit}{isMain ? ' ในคลังหลัก' : ''}</>
            : <strong className={i.inStock ? 'inv-ok' : 'inv-bad'}>{i.inStock ? 'มีของ' : 'หมด'}</strong>}</p>
        </div>
        {isMain && role === 'admin' && <button type="button" className="inv-icon store-pin" aria-pressed={i.pinned} aria-label={i.pinned ? `เอา ${i.name} ออกจากของขายบ่อย` : `ปักหมุด ${i.name} เป็นของขายบ่อย`} disabled={pinOp.busy} onClick={() => togglePin(i)}>{i.pinned ? '★' : '☆'}</button>}
        <div className="store-add">
          <input aria-label={`จำนวน ${i.name}`} inputMode="decimal" value={qtyDraft[i.key] ?? '1'} onChange={e => setQtyDraft({...qtyDraft, [i.key]: e.target.value})}/>
          <button type="button" className="inv-primary" disabled={disabled || (isMain && !i.inStock)} onClick={() => add(i)}>เพิ่ม</button>
        </div>
      </article>)}</div>
    </div>
  </section>;
}

/* ---------------- Stock at the storefront ---------------- */
function AdjustRow({api, item, onChanged}) {
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const op = useOperation();
  function submit(e) {
    e.preventDefault();
    op.run(() => {
      const n = Number(counted);
      if (!/^\d+(\.\d+)?$/.test(counted.trim()) || !Number.isFinite(n)) throw new Error('กรอกยอดนับเป็นตัวเลข');
      if (!reason.trim()) throw new Error('ต้องใส่เหตุผล');
      return api.store_adjust({item_kind: item.item_kind, item_id: item.item_id, counted_qty: n, reason: reason.trim()});
    });
  }
  if (!open) return <button type="button" onClick={() => setOpen(true)}>ปรับยอดตามที่นับ</button>;
  return <form className="store-adjust" onSubmit={submit}>
    <label>ยอดนับจริง ({item.unit})<input required inputMode="decimal" value={counted} onChange={e => setCounted(e.target.value)}/></label>
    <label>เหตุผล<input required value={reason} onChange={e => setReason(e.target.value)} placeholder="เช่น นับสิ้นเดือน"/></label>
    {op.error && <p role="alert">{op.error}</p>}
    <button type="submit" disabled={op.busy}>บันทึกยอดนับ</button>
    <button type="button" disabled={op.busy} onClick={() => setOpen(false)}>ยกเลิก</button>
    {op.operation && <OpResult operation={op.operation} onSuccess={() => { setOpen(false); op.reset(); onChanged(); }} onFailure={e => { op.setError(storeError(e)); op.reset(); }}/>}
  </form>;
}
export function StoreStock({api, role, revision, onChanged, actionBusy, onTransfer}) {
  const stock = useStoreRead(() => api.store_list_stock(), revision);
  return <section>
    <div className="inv-toolbar"><h2>ยอดคงเหลือหน้าร้าน</h2>
      {role === 'admin' && <button type="button" className="inv-primary" disabled={actionBusy} onClick={onTransfer}>โอนของไปหน้าร้าน</button>}</div>
    <ReadNote state={stock}/>
    {!stock.busy && !stock.error && !stock.data?.length && <p className="inv-empty">หน้าร้านยังไม่มีของ</p>}
    <div className="grid-list">{(stock.data || []).map(i => <article className="inv-card" key={`${i.item_kind}:${i.item_id}`}>
      <h3>{i.name}</h3>
      <p className="inv-muted">{i.item_kind === 'model' ? 'ชุดสำเร็จรูป' : 'อะไหล่'}{i.category ? ` · ${i.category}` : ''}</p>
      <p><strong className="inv-balance">{fmtQty(i.qty)}</strong> <span className="inv-muted">{i.unit}</span></p>
      {role === 'admin' && <AdjustRow api={api} item={i} onChanged={onChanged}/>}
    </article>)}</div>
  </section>;
}

/* ---------------- Transfer main → storefront (head of stock) ---------------- */
export function StoreTransferForm({api, onClose, onSuccess}) {
  const [lists, setLists] = useState({busy: true, models: [], materials: [], error: null});
  const [kind, setKind] = useState('model');
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('1');
  const [rows, setRows] = useState([]);
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const op = useOperation();
  useEffect(() => {
    let alive = true;
    Promise.all([managementCatalog.listModels(), api.list_materials({include_inactive: false})])
      .then(([models, materials]) => { if (alive) setLists({busy: false, error: null, models: models.filter(m => m.is_active).sort((a, b) => a.name.localeCompare(b.name)), materials: materials.filter(m => m.is_active !== false).sort((a, b) => a.name.localeCompare(b.name))}); })
      .catch(e => { if (alive) setLists({busy: false, error: e.message, models: [], materials: []}); });
    return () => { alive = false; };
  }, [api]);
  const options = kind === 'model' ? lists.models : lists.materials;
  function add() {
    try {
      const item = options.find(o => o.id === itemId);
      if (!item) throw new Error('เลือกรายการก่อน');
      setRows(addToCart(rows, {kind, id: item.id, name: item.name, unit: kind === 'model' ? 'ชุด' : item.unit}, parseQty(qty, kind)));
      setItemId(''); setQty('1'); op.setError(null);
    } catch (e) { op.setError(e.message); }
  }
  function submit(e) {
    e.preventDefault();
    op.run(() => {
      if (!rows.length) throw new Error('เพิ่มรายการที่จะโอนอย่างน้อย 1 รายการ');
      if (!confirmed) throw new Error('กรุณายืนยันก่อนโอน');
      return api.store_transfer({lines: cartLines(rows), note: note.trim() || undefined});
    });
  }
  return <section className="inv-form">
    <ModalHeader title="โอนของไปหน้าร้าน" onClose={onClose} busy={op.busy}/>
    <p className="inv-muted">ชุดสำเร็จรูป: ระบบตัดวัตถุดิบออกจากคลังหลักตาม BOM × จำนวนชุด ทันที แล้วนับเป็นของหน้าร้าน · อะไหล่: ย้ายจำนวนจากคลังหลักไปหน้าร้านตรงๆ</p>
    {lists.error && <p role="alert">{lists.error}</p>}
    <form onSubmit={submit}><fieldset disabled={op.busy || lists.busy}>
      <div className="inv-subnav"><button type="button" aria-pressed={kind === 'model'} onClick={() => { setKind('model'); setItemId(''); }}>ชุดสำเร็จรูป (ตามรุ่น)</button>
        <button type="button" aria-pressed={kind === 'material'} onClick={() => { setKind('material'); setItemId(''); }}>อะไหล่แยกขาย</button></div>
      <div className="inv-bom-entry">
        <label>{kind === 'model' ? 'รุ่น' : 'อะไหล่'}<select value={itemId} onChange={e => setItemId(e.target.value)}>
          <option value="">เลือก…</option>{options.map(o => <option key={o.id} value={o.id}>{o.name}{kind === 'model' ? ` (${o.category})` : ` — คลังหลัก ${fmtQty(o.qty)} ${o.unit}`}</option>)}</select></label>
        <label>จำนวน<input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)}/></label>
        <button type="button" className="inv-icon" aria-label="เพิ่มรายการ" onClick={add}>＋</button>
      </div>
      <ul className="inv-bom-rows">{rows.map(r => <li key={`${r.kind}:${r.id}`}><span>{r.name}<small>{r.kind === 'model' ? 'ชุดสำเร็จรูป' : 'อะไหล่'}</small></span><strong>×{fmtQty(r.qty)} {r.unit}</strong>
        <button type="button" className="inv-icon" aria-label={`เอา ${r.name} ออก`} onClick={() => setRows(rows.filter(x => x !== r))}>✕</button></li>)}</ul>
      <label>หมายเหตุ (ไม่บังคับ)<input value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น ล็อตเดือน พ.ย."/></label>
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>ยืนยัน: ตัดวัตถุดิบจากคลังหลักและย้ายไปหน้าร้านตามรายการนี้</label>
      {op.error && <p role="alert">{op.error}</p>}
      <button type="submit" className="inv-primary" disabled={!rows.length || !confirmed}>โอนไปหน้าร้าน</button>
    </fieldset></form>
    {op.operation && <OpResult operation={op.operation} onSuccess={() => { op.reset(); onSuccess(); onClose(); }} onFailure={e => { op.setError(storeError(e)); op.reset(); }}/>}
  </section>;
}

/* ---------------- Sales list / cancel ---------------- */
function CancelSale({api, sale, onDone, onClose}) {
  const [reason, setReason] = useState('');
  const op = useOperation();
  function submit(e) {
    e.preventDefault();
    op.run(() => {
      if (!reason.trim()) throw new Error('ต้องใส่เหตุผลการยกเลิก');
      return api.store_cancel_sale({sale_id: sale.sale_id, reason: reason.trim()}, {intentKey: `cancel:${sale.sale_id}`});
    });
  }
  return <form className="store-adjust" onSubmit={submit}>
    <p>ยกเลิกออเดอร์ <b>{sale.tag}</b> — ของจะกลับเข้ายอดหน้าร้าน และแท็กนี้ใช้ใหม่ได้</p>
    <label>เหตุผล<input required value={reason} onChange={e => setReason(e.target.value)} placeholder="เช่น ลูกค้าเปลี่ยนใจ / กรอกผิด"/></label>
    {op.error && <p role="alert">{op.error}</p>}
    <button type="submit" disabled={op.busy}>ยืนยันยกเลิกการขาย</button><button type="button" disabled={op.busy} onClick={onClose}>ไม่ยกเลิก</button>
    {op.operation && <OpResult operation={op.operation} onSuccess={() => { op.reset(); onDone(); }} onFailure={e => { op.setError(storeError(e)); op.reset(); }}/>}
  </form>;
}
const saleColumns = [['tag', 'แท็กการขาย'], ['status_label', 'สถานะ'], ['created_at_label', 'เวลา'], ['seller_name', 'ผู้ขาย'], ['items', 'รายการ'], ['cancel_reason', 'เหตุผลยกเลิก']];
const saleSource = s => ((s.lines || []).some(l => l.source === 'main') ? ((s.lines || []).every(l => l.source === 'main') ? 'จากคลังหลัก' : 'หน้าร้าน + คลังหลัก') : 'จากหน้าร้าน');

function SetTagForm({api, sale, onDone}) {
  const [tag, setTag] = useState('');
  const op = useOperation();
  function submit(e) {
    e.preventDefault();
    op.run(() => api.store_set_sale_tag({sale_id: sale.sale_id, tag: validateSaleTag(tag)}, {intentKey: `tag:${sale.sale_id}:${tag.trim()}`}));
  }
  const failed = useCallback(error => {
    const dup = parseDuplicateSale(error);
    op.setError(dup ? `แท็ก ${dup.tag || tag} ถูกใช้แล้ว${dup.seller_name ? ` โดย ${dup.seller_name}` : ''}` : storeError(error)); op.reset();
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- stable setters
  }, [tag]);
  return <form className="store-adjust" onSubmit={submit}>
    <label>กรอกแท็ก (เลข Shopify)<input required value={tag} onChange={e => { setTag(e.target.value); op.setError(null); }} autoComplete="off"/></label>
    {op.error && <p role="alert">{op.error}</p>}
    <button type="submit" className="inv-primary" disabled={op.busy || !tag.trim()}>บันทึกแท็ก</button>
    {op.operation && <OpResult operation={op.operation} onSuccess={() => { op.reset(); onDone(); }} onFailure={failed}/>}
  </form>;
}

function SaleCard({api, s, role, userId, actionBusy, cancelling, setCancelling, onChanged}) {
  const late = s.pending ? daysWaiting(s.created_at) : 0;
  return <article className="inv-card" key={s.sale_id}>
    <div className="inv-toolbar"><h3>{s.tag || 'ยังไม่มีแท็ก'}</h3>
      <span className={`inv-status ${s.status === 'cancelled' ? 'cancelled' : s.pending ? 'pending' : 'completed'}`}>{storeSaleStatusLabel(s.status, s.pending)}</span></div>
    <p className="inv-muted">{s.created_at_label} · {s.seller_name || '—'} · <span className="store-source">{saleSource(s)}</span>
      {late >= PENDING_TAG_WARN_DAYS && <> · <b className="store-late">ค้างแท็ก {late} วัน</b></>}</p>
    <ul className="store-lines">{s.lines.map((l, i) => <li key={i}>{l.name} <strong>×{fmtQty(l.qty)}</strong> <span className="inv-muted">{l.item_kind === 'model' ? 'ชุด' : l.unit}{l.source === 'main' ? ' · คลังหลัก' : ''}</span></li>)}</ul>
    {s.status === 'cancelled' && <p className="inv-muted">ยกเลิก: {s.cancel_reason}</p>}
    {s.pending && (role === 'admin' || s.seller_id === userId) && <SetTagForm api={api} sale={s} onDone={onChanged}/>}
    {s.status === 'active' && (role === 'admin' || s.seller_id === userId) && (cancelling === s.sale_id
      ? <CancelSale api={api} sale={s} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); onChanged(); }}/>
      : <button type="button" disabled={actionBusy} onClick={() => setCancelling(s.sale_id)}>ยกเลิกการขายนี้</button>)}
  </article>;
}

export function StoreSales({api, role, userId, revision, onChanged, actionBusy}) {
  const today = localDay(new Date());
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState('');
  const [cancelling, setCancelling] = useState(null);
  const state = useStoreRead(() => api.store_list_sales({date_from: from, date_to: to, timezone: 'Asia/Bangkok', limit: 1000}), revision, [from, to]);
  const rows = useMemo(() => (state.data || []).filter(s => !search.trim() || (s.tag || '').toLowerCase().includes(search.trim().toLowerCase()))
    .map(s => ({...s, status_label: storeSaleStatusLabel(s.status, s.pending), created_at_label: fmtTime(s.created_at), items: linesSummary(s.lines)})), [state.data, search]);
  const pending = rows.filter(s => s.pending && s.status === 'active').sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const rest = rows.filter(s => !(s.pending && s.status === 'active'));
  const card = s => <SaleCard key={s.sale_id} api={api} s={s} role={role} userId={userId} actionBusy={actionBusy} cancelling={cancelling} setCancelling={setCancelling} onChanged={onChanged}/>;
  return <section>
    <div className="inv-toolbar"><h2>รายการขายหน้าร้าน</h2>
      <button type="button" disabled={!rows.length} onClick={() => downloadCSV(`store_sales_${from}_${to}.csv`, reportCSV(rows, saleColumns, {from, to, timezone: 'Asia/Bangkok'}))}>ส่งออก CSV</button></div>
    <div className="inv-filters">
      <label>ตั้งแต่<input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)}/></label>
      <label>ถึง<input type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)}/></label>
      <label>ค้นหาแท็ก<input value={search} onChange={e => setSearch(e.target.value)} placeholder="แท็กการขาย"/></label>
    </div>
    <ReadNote state={state}/>
    {pending.length > 0 && <div className="store-pending-group">
      <h3>รอแท็ก ({pending.length} ใบ)</h3>
      <p className="inv-muted">ตัดสต็อกแล้ว แต่ยังไม่ได้กรอกเลข Shopify — แสดงเสมอไม่ว่าเลือกวันไหน</p>
      <div className="store-sales-list">{pending.map(card)}</div>
    </div>}
    {!state.busy && !state.error && !rest.length && !pending.length && <p className="inv-empty">ไม่มีรายการขายในช่วงที่เลือก</p>}
    <div className="store-sales-list">{rest.map(card)}</div>
  </section>;
}

/* ---------------- Workspace shell ---------------- */
export function StoreWorkspace({api, role, userId, revision, onChanged, actionBusy}) {
  const modes = role === 'store' ? [['sell', 'ขาย'], ['other', 'อื่นๆ'], ['stock', 'ยอดหน้าร้าน'], ['sales', 'รายการขาย'], ['report', 'รายงาน']] : [['stock', 'ยอดหน้าร้าน'], ['sales', 'รายการขาย'], ['sell', 'ขาย'], ['other', 'อื่นๆ'], ['report', 'รายงาน']];
  const [mode, setMode] = useState(modes[0][0]);
  const [transfer, setTransfer] = useState(false);
  const today = localDay(new Date());
  const pendingRead = useStoreRead(() => api.store_list_sales({date_from: today, date_to: today, timezone: 'Asia/Bangkok', limit: 1000}), revision);
  const pend = useMemo(() => pendingSummary((pendingRead.data || []).filter(s => s.status === 'active')), [pendingRead.data]);
  return <>
    <nav className="inv-subnav" aria-label="หน้าร้าน">{modes.map(([key, label]) => <button key={key} aria-pressed={mode === key} onClick={() => setMode(key)}>{label}{key === 'sales' && pend.total > 0 && <span className="store-badge" aria-label={`รอแท็ก ${pend.total} ใบ`}>{pend.total}</span>}</button>)}</nav>
    {pend.total > 0 && <div role="status" className={`store-pending-banner${pend.overdue ? ' late' : ''}`}>
      รอกรอกแท็ก {pend.total} ใบ{pend.overdue > 0 && ` — ค้างเกิน ${PENDING_TAG_WARN_DAYS} วัน ${pend.overdue} ใบ`}
      {mode !== 'sales' && <button type="button" onClick={() => setMode('sales')}>ไปกรอกแท็ก</button>}
    </div>}
    {mode === 'sell' && <StoreSell api={api} role={role} source="store" revision={revision} onChanged={onChanged} actionBusy={actionBusy}/>}
    {mode === 'other' && <StoreSell api={api} role={role} source="main" revision={revision} onChanged={onChanged} actionBusy={actionBusy}/>}
    {mode === 'stock' && <StoreStock api={api} role={role} revision={revision} onChanged={onChanged} actionBusy={actionBusy} onTransfer={() => setTransfer(true)}/>}
    {mode === 'sales' && <StoreSales api={api} role={role} userId={userId} revision={revision} onChanged={onChanged} actionBusy={actionBusy}/>}
    {mode === 'report' && <StoreReports api={api} revision={revision}/>}
    {transfer && <div className="inv-modal-backdrop"><div className="inv-modal" role="dialog" aria-modal="true" aria-label="โอนของไปหน้าร้าน">
      <StoreTransferForm api={api} onClose={() => setTransfer(false)} onSuccess={onChanged}/></div></div>}
  </>;
}

/* ---------------- Reports: storefront + combined balance (admin / purchasing) ---------------- */
const storeReportColumns = [['name', 'รายการ'], ['kind_label', 'ประเภท'], ['unit', 'หน่วย'], ['opening', 'ต้นงวด'], ['transfer_in', 'รับจากคลังหลัก'], ['sold', 'ขาย'], ['sale_cancelled', 'ยกเลิกขาย (คืน)'], ['adjust_in', 'ปรับเพิ่ม'], ['adjust_out', 'ปรับลด'], ['closing', 'คงเหลือ']];
export function StoreReports({api, revision}) {
  // The store tab shows only sets left at the storefront and store movements; main-stock totals live in the Report tab.
  const today = localDay(new Date());
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const report = useStoreRead(() => api.store_report({date_from: from, date_to: to, timezone: 'Asia/Bangkok'}), revision, [from, to]);
  const stock = useStoreRead(() => api.store_list_stock(), revision);
  const items = useMemo(() => (report.data?.items || []).map(r => ({...r, kind_label: r.item_kind === 'model' ? 'ชุดสำเร็จรูป' : 'อะไหล่'})), [report.data]);
  const mainSales = useMemo(() => report.data?.main_sales || [], [report.data]);
  const pendingRows = useMemo(() => (report.data?.pending || []).map(p => ({...p, created_at_label: fmtTime(p.created_at), waiting: daysWaiting(p.created_at), items: linesSummary(p.lines)})), [report.data]);
  const sets = useMemo(() => (stock.data || []).filter(r => r.item_kind === 'model').map(r => ({name: r.name, category: r.category, store_sets: r.qty})), [stock.data]);
  return <section className="store-reports">
    <h2>รายงานหน้าร้าน</h2>
    <h3>ชุดสำเร็จรูปที่ค้างหน้าร้าน</h3>
    <ReadNote state={stock}/>
    {!stock.busy && !stock.error && (sets.length
      ? <ReportTable rows={sets} columns={[['name', 'รุ่น'], ['category', 'หมวด'], ['store_sets', 'จำนวนชุด']]}/>
      : <p className="inv-empty">ไม่มีชุดสำเร็จรูปค้างหน้าร้าน</p>)}
    <h3>ความเคลื่อนไหวหน้าร้านในช่วงที่เลือก</h3>
    <div className="inv-filters">
      <label>ตั้งแต่<input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)}/></label>
      <label>ถึง<input type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)}/></label>
    </div>
    <ReadNote state={report}/>
    {!report.busy && !report.error && <>
      <button type="button" disabled={!items.length} onClick={() => downloadCSV(`store_report_${from}_${to}.csv`, reportCSV(items, storeReportColumns, {from, to, timezone: 'Asia/Bangkok'}))}>ส่งออกรายงานหน้าร้าน CSV</button>
      <ReportTable rows={items} columns={storeReportColumns}/>
      <h3>ขายจากคลังหลัก (อื่นๆ)</h3>
      {mainSales.length ? <ReportTable rows={mainSales} columns={[['name', 'วัตถุดิบ'], ['unit', 'หน่วย'], ['qty', 'จำนวนที่ขาย']]}/> : <p className="inv-empty">ไม่มีการขายจากคลังหลักในช่วงนี้</p>}
      <h3>รอแท็ก</h3>
      {pendingRows.length ? <ReportTable rows={pendingRows} columns={[['created_at_label', 'เวลา'], ['waiting', 'ค้าง (วัน)'], ['seller_name', 'ผู้ขาย'], ['items', 'รายการ']]}/> : <p className="inv-empty">ไม่มีใบที่รอแท็ก</p>}
    </>}
  </section>;
}
