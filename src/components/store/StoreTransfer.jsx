import React, {useEffect, useMemo, useState} from 'react';
import {ModalHeader} from '../InventoryUI.jsx';
import {managementCatalog} from '../../lib/inventoryModelCatalog.js';
import {monthRange, currentMonth, shiftMonth, monthLabel} from '../../lib/monthlyReport.js';
import {addToCart, cartLines, parseQty, storeError} from '../../lib/storeApi.js';
import {fmtTime, fmtQty, useStoreRead, ReadNote, OpResult, useOperation} from './shared.jsx';

/* ---------------- Transfer main → storefront (head of stock) ---------------- */
export function StoreTransferForm({api, onClose, onSuccess, initialDir = 'to_store'}) {
  const [dir, setDir] = useState(initialDir);
  const toMain = dir === 'to_main';
  const [lists, setLists] = useState({busy: true, models: [], materials: [], storeStock: [], error: null});
  const [kind, setKind] = useState('model');
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('1');
  const [rows, setRows] = useState([]);
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const op = useOperation();
  useEffect(() => {
    let alive = true;
    Promise.all([managementCatalog.listModels(), api.list_materials({include_inactive: false}), api.store_list_stock()])
      .then(([models, materials, storeStock]) => { if (alive) setLists({busy: false, error: null, storeStock: storeStock || [], models: models.filter(m => m.is_active).sort((a, b) => a.name.localeCompare(b.name)), materials: materials.filter(m => m.is_active !== false).sort((a, b) => a.name.localeCompare(b.name))}); })
      .catch(e => { if (alive) setLists({busy: false, error: e.message, models: [], materials: [], storeStock: []}); });
    return () => { alive = false; };
  }, [api]);
  const storeOptions = useMemo(() => lists.storeStock.filter(r => r.item_kind === kind && Number(r.qty) > 0).map(r => ({id: r.item_id, name: r.name, unit: r.unit, qty: r.qty, category: r.category})).sort((a, b) => a.name.localeCompare(b.name, 'th')), [lists.storeStock, kind]);
  const options = toMain ? storeOptions : kind === 'model' ? lists.models : lists.materials;
  function switchDir(next) { setDir(next); setRows([]); setItemId(''); setConfirmed(false); op.setError(null); }
  function add() {
    try {
      const item = options.find(o => o.id === itemId);
      if (!item) throw new Error('เลือกรายการก่อน');
      const wanted = parseQty(qty, kind);
      const already = rows.filter(r => r.kind === kind && r.id === item.id).reduce((n, r) => n + r.qty, 0);
      if (toMain && already + wanted > Number(item.qty)) throw new Error(`หน้าร้านมี ${item.name} แค่ ${fmtQty(item.qty)} ${item.unit}`);
      setRows(addToCart(rows, {kind, id: item.id, name: item.name, unit: kind === 'model' ? 'ชุด' : item.unit}, wanted));
      setItemId(''); setQty('1'); op.setError(null);
    } catch (e) { op.setError(e.message); }
  }
  function submit(e) {
    e.preventDefault();
    op.run(() => {
      if (!rows.length) throw new Error('เพิ่มรายการที่จะโอนอย่างน้อย 1 รายการ');
      if (!confirmed) throw new Error('กรุณายืนยันก่อนโอน');
      const args = {lines: cartLines(rows), note: note.trim() || undefined};
      return toMain ? api.store_return(args) : api.store_transfer(args);
    });
  }
  return <section className="inv-form">
    <ModalHeader title={toMain ? 'โอนคืนไปคลังหลัก' : 'โอนของไปหน้าร้าน'} onClose={onClose} busy={op.busy}/>
    <div className="inv-subnav"><button type="button" aria-pressed={!toMain} onClick={() => switchDir('to_store')}>คลังหลัก → หน้าร้าน</button>
      <button type="button" aria-pressed={toMain} onClick={() => switchDir('to_main')}>หน้าร้าน → คลังหลัก (คืน)</button></div>
    {toMain ? <p className="inv-muted">คืนของที่หน้าร้านกลับคลังหลัก: หน้าร้านถูกหักก่อน แล้วคลังหลักได้เพิ่ม · ชุดสำเร็จรูป: ระบบคืนวัตถุดิบเข้าคลังหลักตาม BOM ปัจจุบัน × จำนวนชุด · อะไหล่: คืนจำนวนตรงๆ</p> : <p className="inv-muted">ชุดสำเร็จรูป: ระบบตัดวัตถุดิบออกจากคลังหลักตาม BOM × จำนวนชุด ทันที แล้วนับเป็นของหน้าร้าน · อะไหล่: ย้ายจำนวนจากคลังหลักไปหน้าร้านตรงๆ</p>}
    {lists.error && <p role="alert">{lists.error}</p>}
    <form onSubmit={submit}><fieldset disabled={op.busy || lists.busy}>
      <div className="inv-subnav"><button type="button" aria-pressed={kind === 'model'} onClick={() => { setKind('model'); setItemId(''); }}>ชุดสำเร็จรูป (ตามรุ่น)</button>
        <button type="button" aria-pressed={kind === 'material'} onClick={() => { setKind('material'); setItemId(''); }}>อะไหล่แยกขาย</button></div>
      <div className="inv-bom-entry">
        <label>{kind === 'model' ? 'รุ่น' : 'อะไหล่'}<select value={itemId} onChange={e => setItemId(e.target.value)}>
          <option value="">เลือก…</option>{options.map(o => <option key={o.id} value={o.id}>{o.name}{toMain ? ` — หน้าร้านมี ${fmtQty(o.qty)} ${kind === 'model' ? 'ชุด' : o.unit}` : kind === 'model' ? ` (${o.category})` : ` — คลังหลัก ${fmtQty(o.qty)} ${o.unit}`}</option>)}</select></label>
        <label>จำนวน<input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)}/></label>
        <button type="button" className="inv-icon" aria-label="เพิ่มรายการ" onClick={add}>＋</button>
      </div>
      <ul className="inv-bom-rows">{rows.map(r => <li key={`${r.kind}:${r.id}`}><span>{r.name}<small>{r.kind === 'model' ? 'ชุดสำเร็จรูป' : 'อะไหล่'}</small></span><strong>×{fmtQty(r.qty)} {r.unit}</strong>
        <button type="button" className="inv-icon" aria-label={`เอา ${r.name} ออก`} onClick={() => setRows(rows.filter(x => x !== r))}>✕</button></li>)}</ul>
      <label>หมายเหตุ (ไม่บังคับ)<input value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น ล็อตเดือน พ.ย."/></label>
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>{toMain ? 'ยืนยัน: หักของจากหน้าร้านและคืนเข้าคลังหลักตามรายการนี้' : 'ยืนยัน: ตัดวัตถุดิบจากคลังหลักและย้ายไปหน้าร้านตามรายการนี้'}</label>
      {op.error && <p role="alert">{op.error}</p>}
      <button type="submit" className="inv-primary" disabled={!rows.length || !confirmed}>{toMain ? 'โอนคืนไปคลังหลัก' : 'โอนไปหน้าร้าน'}</button>
    </fieldset></form>
    {op.operation && <OpResult operation={op.operation} onSuccess={() => { op.reset(); onSuccess(); onClose(); }} onFailure={e => { op.setError(storeError(e)); op.reset(); }}/>}
  </section>;
}

/* ---------------- Transfer history (both directions) ---------------- */
export function StoreTransferHistory({api, revision, onClose}) {
  const [month, setMonth] = useState(currentMonth());
  const {from, to} = monthRange(month.year, month.month);
  const state = useStoreRead(() => api.store_list_transfers({date_from: from, date_to: to, timezone: 'Asia/Bangkok', limit: 300}), revision, [from, to]);
  const rows = state.data || [];
  return <section className="inv-form">
    <ModalHeader title="ประวัติการโอนหน้าร้าน ↔ คลังหลัก" onClose={onClose}/>
    <div className="mr-month"><button type="button" aria-label="เดือนก่อน" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button><span>{monthLabel(month)}</span><button type="button" aria-label="เดือนถัดไป" onClick={() => setMonth(shiftMonth(month, 1))}>›</button></div>
    <ReadNote state={state}/>
    {!state.busy && !state.error && !rows.length && <p className="inv-empty">เดือนนี้ยังไม่มีการโอน</p>}
    <ul className="store-transfer-list">{rows.map(t => <li key={t.operation_id} className={t.kind === 'transfer_out' ? 'back' : 'fwd'}>
      <div className="store-transfer-head"><strong>{t.kind === 'transfer_out' ? '↩ คืนคลังหลัก (หน้าร้าน → คลังหลัก)' : '➜ ไปหน้าร้าน (คลังหลัก → หน้าร้าน)'}</strong>
        <span className="inv-muted">{fmtTime(t.occurred_at)} · {t.actor_name || '-'}</span></div>
      <div>{(t.lines || []).map(l => `${l.name} ×${fmtQty(l.qty)} ${l.item_kind === 'model' ? 'ชุด' : l.unit || ''}`.trim()).join(', ')}</div>
      {t.note && <div className="inv-muted">หมายเหตุ: {t.note}</div>}
    </li>)}</ul>
  </section>;
}

