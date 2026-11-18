import React, {useMemo, useState} from 'react';
import {stockLevel, lowStockCount, sortLowFirst, parseMinQty, storeError} from '../../lib/storeApi.js';
import {fmtQty, useStoreRead, ReadNote, OpResult, useOperation} from './shared.jsx';

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
function MinRow({api, item, onChanged}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const op = useOperation();
  const has = item.min_qty !== null && item.min_qty !== undefined;
  function submit(e) {
    e.preventDefault();
    op.run(() => api.store_set_min({item_kind: item.item_kind, item_id: item.item_id, min_qty: parseMinQty(value)}));
  }
  if (!open) return <button type="button" className="store-min-btn" aria-label={`ตั้งจุดเตือน ${item.name}`} title="ตั้งจุดเตือนใกล้หมด" onClick={() => { setValue(has ? String(item.min_qty) : ''); setOpen(true); }}>🔔{has ? ` ${fmtQty(item.min_qty)}` : ''}</button>;
  return <form className="store-min-form" onSubmit={submit}>
    <label>เตือนเมื่อเหลือ ≤ ({item.unit})<input inputMode="decimal" autoFocus value={value} onChange={e => setValue(e.target.value)} placeholder="เว้นว่าง = ไม่เตือน"/></label>
    {op.error && <p role="alert">{op.error}</p>}
    <button type="submit" disabled={op.busy}>บันทึก</button>
    <button type="button" disabled={op.busy} onClick={() => { setOpen(false); op.reset(); op.setError(null); }}>ปิด</button>
    {op.operation && <OpResult operation={op.operation} onSuccess={() => { setOpen(false); op.reset(); onChanged(); }} onFailure={e => { op.setError(storeError(e)); op.reset(); }}/>}
  </form>;
}
export function StoreStock({api, role, revision, onChanged, actionBusy, onTransfer, onHistory}) {
  const stock = useStoreRead(() => api.store_list_stock(), revision);
  const rows = useMemo(() => sortLowFirst(stock.data || []), [stock.data]);
  const warn = lowStockCount(rows);
  return <section>
    <div className="inv-toolbar"><h2>ยอดคงเหลือหน้าร้าน</h2>
      <button type="button" onClick={onHistory}>ประวัติการโอน</button>
      {role === 'admin' && <button type="button" className="inv-primary" disabled={actionBusy} onClick={() => onTransfer('to_store')}>โอนของไปหน้าร้าน</button>}
      {role === 'admin' && <button type="button" disabled={actionBusy} onClick={() => onTransfer('to_main')}>โอนคืนคลังหลัก</button>}</div>
    <ReadNote state={stock}/>
    {warn > 0 && <div role="status" className="store-low-banner">⚠️ ใกล้หมด/หมด {warn} รายการ (เรียงไว้บนสุด)</div>}
    {!stock.busy && !stock.error && !rows.length && <p className="inv-empty">หน้าร้านยังไม่มีของ</p>}
    <div className="grid-list store-stock-grid">{rows.map(i => {
      const level = stockLevel(i);
      return <article className={`inv-card store-stock-card${level !== 'ok' ? ` is-${level}` : ''}`} key={`${i.item_kind}:${i.item_id}`}>
        <div className="store-card-top"><h3>{i.name}</h3>{role === 'admin' && <MinRow api={api} item={i} onChanged={onChanged}/>}</div>
        <p className="inv-muted">{i.item_kind === 'model' ? 'ชุดสำเร็จรูป' : 'อะไหล่'}{i.category ? ` · ${i.category}` : ''}</p>
        <p><strong className="inv-balance">{fmtQty(i.qty)}</strong> <span className="inv-muted">{i.unit}</span>
          {level === 'out' && <span className="store-level out">หมด</span>}{level === 'low' && <span className="store-level low">ใกล้หมด</span>}</p>
        {role !== 'admin' && i.min_qty !== null && i.min_qty !== undefined && level !== 'ok' && <p className="inv-muted">จุดเตือน {fmtQty(i.min_qty)}</p>}
        {role === 'admin' && <AdjustRow api={api} item={i} onChanged={onChanged}/>}
      </article>;
    })}</div>
  </section>;
}

