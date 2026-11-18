import React, {useCallback, useMemo, useState} from 'react';
import {localDay, reportCSV} from '../../lib/inventoryReports.js';
import {monthRange, currentMonth, shiftMonth, monthLabel} from '../../lib/monthlyReport.js';
import {downloadCSV} from '../../utils/csv.js';
import {soldBoard, linesSummary, parseDuplicateSale, storeError, storeSaleStatusLabel, daysWaiting, PENDING_TAG_WARN_DAYS, validateSaleTag} from '../../lib/storeApi.js';
import {fmtTime, fmtQty, useStoreRead, ReadNote, OpResult, useOperation} from './shared.jsx';

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
    <label>กรอกแท็ก (เลข Shipnity)<input required value={tag} onChange={e => { setTag(e.target.value); op.setError(null); }} autoComplete="off"/></label>
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
    <ul className="store-lines">{s.lines.map((l, i) => <li key={i}>{l.name} <strong>×{fmtQty(l.qty)}</strong> <span className="inv-muted">{l.item_kind === 'model' ? 'ชุด' : l.unit}{l.source === 'main' ? ' · คลังหลัก' : ''}</span>{l.reason && <small className="inv-muted"> · เหตุผล: {l.reason}</small>}</li>)}</ul>
    {s.status === 'cancelled' && <p className="inv-muted">ยกเลิก: {s.cancel_reason}</p>}
    {s.pending && (role === 'admin' || s.seller_id === userId) && <SetTagForm api={api} sale={s} onDone={onChanged}/>}
    {s.status === 'active' && role === 'admin' && (cancelling === s.sale_id
      ? <CancelSale api={api} sale={s} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); onChanged(); }}/>
      : <button type="button" disabled={actionBusy} onClick={() => setCancelling(s.sale_id)}>ยกเลิกการขายนี้</button>)}
  </article>;
}

function StoreSoldBoard({api, revision}) {
  const [month, setMonth] = useState(currentMonth());
  const {from, to} = monthRange(month.year, month.month);
  const state = useStoreRead(() => api.store_report({date_from: from, date_to: to, timezone: 'Asia/Bangkok'}), revision, [from, to]);
  const items = useMemo(() => soldBoard(state.data?.items, state.data?.main_sales), [state.data]);
  return <div className="store-sold-board">
    <div className="store-sold-head"><h3>ขายอะไรไปบ้าง</h3>
      <div className="mr-month"><button type="button" aria-label="เดือนก่อน" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button><span>{monthLabel(month)}</span><button type="button" aria-label="เดือนถัดไป" onClick={() => setMonth(shiftMonth(month, 1))}>›</button></div></div>
    <ReadNote state={state}/>
    {!state.busy && !state.error && !items.length && <p className="inv-empty">เดือนนี้ยังไม่มีการขาย</p>}
    <div className="store-sold-grid">{items.map(i => <div key={i.key} className="store-sold-chip"><span>{i.name}{i.kind === 'main' ? <small> (คลังหลัก)</small> : null}</span><strong>{fmtQty(i.qty)} <small>{i.kind === 'model' ? 'ชุด' : i.unit}</small></strong></div>)}</div>
  </div>;
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
    <StoreSoldBoard api={api} revision={revision}/>
    <div className="inv-filters">
      <label>ตั้งแต่<input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)}/></label>
      <label>ถึง<input type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)}/></label>
      <label>ค้นหาแท็ก<input value={search} onChange={e => setSearch(e.target.value)} placeholder="แท็กการขาย"/></label>
    </div>
    <ReadNote state={state}/>
    {pending.length > 0 && <div className="store-pending-group">
      <h3>รอแท็ก ({pending.length} ใบ)</h3>
      <p className="inv-muted">ตัดสต็อกแล้ว แต่ยังไม่ได้กรอกเลข Shipnity — แสดงเสมอไม่ว่าเลือกวันไหน</p>
      <div className="store-sales-list">{pending.map(card)}</div>
    </div>}
    {!state.busy && !state.error && !rest.length && !pending.length && <p className="inv-empty">ไม่มีรายการขายในช่วงที่เลือก</p>}
    <div className="store-sales-list">{rest.map(card)}</div>
  </section>;
}

