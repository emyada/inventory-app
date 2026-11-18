import React, {useCallback, useMemo, useState} from 'react';
import {addToCart, cartLines, parseDuplicateSale, optionalSaleTag, parseQty, storeError, validateSaleTag} from '../../lib/storeApi.js';
import {fmtTime, fmtQty, useStoreRead, ReadNote, OpResult, useOperation} from './shared.jsx';

/* ---------------- Sell (storefront stock, or "อื่นๆ" = main warehouse stock) ---------------- */
const normalizeStoreItem = i => ({key: `${i.item_kind}:${i.item_id}`, kind: i.item_kind, id: i.item_id, name: i.name, unit: i.unit, qty: Number(i.qty), category: i.category, source: 'store'});
const normalizeMainItem = i => ({key: `material:${i.material_id}`, kind: 'material', id: i.material_id, name: i.name, unit: i.unit, qty: i.qty == null ? null : Number(i.qty), inStock: Boolean(i.in_stock), pinned: Boolean(i.pinned), source: 'main'});

export function StoreSell({api, role, source = 'store', revision, onChanged, actionBusy}) {
  const isMain = source === 'main';
  const stock = useStoreRead(() => (isMain ? api.store_list_main_items() : api.store_list_stock()), revision, [source]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [tag, setTag] = useState('');
  const [reason, setReason] = useState('');
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
      if (isMain && !reason.trim()) throw new Error('ต้องใส่เหตุผลการขายอื่นๆ ก่อนบันทึก');
      return api.store_create_sale({...(clean ? {tag: clean} : {}), lines: cartLines(cart), ...(isMain ? {reason: reason.trim()} : {})});
    });
  }
  function addToExisting() {
    op.reset();
    op.run(() => {
      if (isMain && !reason.trim()) throw new Error('ต้องใส่เหตุผลการขายอื่นๆ ก่อนบันทึก');
      return api.store_add_sale_lines({sale_id: duplicate.sale_id, lines: cartLines(cart), ...(isMain ? {reason: reason.trim()} : {})}, {intentKey: `add:${duplicate.sale_id}`});
    });
  }
  const done = useCallback(result => {
    setMessage(result?.tag ? `บันทึกการขาย ${result.tag} แล้ว` : 'บันทึกแล้ว — ตัดสต็อกแล้ว รอกรอกแท็กทีหลัง (ดูที่ รายการขาย)');
    setCart([]); setTag(''); setReason(''); setDuplicate(null); op.reset(); onChanged();
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
      {isMain && <label className="store-reason">เหตุผลที่ขายอื่นๆ (จำเป็น)<input aria-label="เหตุผลการขายอื่นๆ" required value={reason} maxLength={200} onChange={e => setReason(e.target.value)} placeholder="เช่น ลูกค้าขอซื้อเพิ่ม / ของเสียเปลี่ยนให้"/></label>}
      <div className="store-tag-row">
        <input aria-label="รหัสแท็กการขาย" required={!isMain} value={tag} onChange={e => { setTag(e.target.value); setDuplicate(null); }} placeholder={isMain ? 'แท็กการขาย (ใส่ทีหลังได้)' : 'แท็กการขาย (เลข Shipnity) *'} aria-describedby="tag-help" autoComplete="off"/>
        <button type="submit" className="inv-primary" disabled={disabled || !cart.length || (!isMain && !tag.trim()) || (isMain && !reason.trim())}>{tag.trim() ? 'บันทึกการขาย' : 'บันทึก (รอแท็ก)'}</button>
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

