import React, {useCallback, useState} from 'react';
import {useRefreshRead} from '../hooks/useRefreshRead.js';
import {groupByRequester, groupRequirements} from '../lib/pickQueue.js';

async function queueRows(api) {
  const rows = [], seen = new Set(); let cursor = {};
  for (let page = 0; page < 1000; page++) {
    const batch = await api.list_pick_queue({...cursor, limit: 500});
    if (!Array.isArray(batch)) throw new Error('ข้อมูลคิวไม่สมบูรณ์');
    for (const r of batch) { if (seen.has(r.id)) throw new Error('คิวเปลี่ยนระหว่างอ่าน กรุณาโหลดใหม่'); seen.add(r.id); rows.push(r); }
    if (batch.length < 500) return rows;
    const last = batch.at(-1); cursor = {after_at: last.created_at, after_id: last.id};
  }
  throw new Error('คิวมีข้อมูลเกินขอบเขต');
}
const fmt = n => Number(n).toLocaleString('th-TH', {maximumFractionDigits: 3});

function useLoad(load, deps) {
  const [state, setState] = useState({busy: true, error: null, data: null});
  useRefreshRead(() => { setState(s => ({...s, busy: true, error: null})); return load(); },
    data => setState({busy: false, error: null, data}),
    e => setState({busy: false, error: e.message || 'โหลดไม่สำเร็จ', data: null}), deps);
  return state;
}

function PersonCard({group, materials, role, actionBusy, onAction, checked, onToggle}) {
  let need = [], problem = '';
  if (materials) { try { need = groupRequirements(group.rows, materials); } catch (e) { problem = e.message; } }
  const short = need.filter(r => r.insufficient);
  const blocked = role !== 'admin' || actionBusy || !materials || Boolean(problem) || short.length > 0 || !need.length;
  return <article className="inv-card pq-card">
    <header className="pq-head"><h3>{role === 'admin' && <input type="checkbox" className="pq-select" aria-label={`เลือกทุกออเดอร์ของ ${group.name}`} checked={checked} onChange={onToggle}/>} {group.name}</h3><span>{group.rows.length} ออเดอร์</span></header>
    <ul className="pq-models">{group.models.map(m => <li key={m.category + m.model}><span>{m.label}</span><strong>{m.count}</strong></li>)}</ul>
    <details><summary>ดูออเดอร์และวัตถุดิบ</summary>
      <p className="pq-label">ออเดอร์</p>
      <ul className="pq-orders">{group.rows.map(r => <li key={r.id}>{r.order_ref} <small>{r.model_name}</small></li>)}</ul>
      <p className="pq-label">ของชิ้นที่ต้องหยิบ (รวม)</p>
      {!materials && <p role="status">กำลังตรวจยอด…</p>}
      {problem && <p role="alert">{problem}</p>}
      <ul className="pq-mats">{need.map(r => <li key={r.id} className={r.insufficient ? 'short' : ''}><span>{r.name}</span><strong>{fmt(r.required)} {r.unit}</strong></li>)}</ul>
      <p className="inv-muted">ของเหลว เรซิน ลวด ตัดอัตโนมัติตั้งแต่ยื่นคำขอแล้ว</p>
    </details>
    {materials && !problem && (short.length
      ? <p className="pq-warn" role="alert">ของไม่พอ: {short.map(r => `${r.name} ขาด ${fmt(Math.max(0, Number(r.required) - Number(r.available ?? 0)))} ${r.unit}`).join(' · ')}</p>
      : <p className="pq-ok">ของพอ · พร้อมหยิบ</p>)}
    <button type="button" className="inv-primary" disabled={blocked} onClick={() => onAction({kind: 'pick_group', name: group.name, rows: group.rows})}>
      ติ๊กหยิบครบ — {group.name} ({group.rows.length} ออเดอร์)</button>
  </article>;
}

// Admin pick queue: one card per person, with a one-tap whole-person confirmation.
export function PickQueuePanel({api, role, revision, onAction, actionBusy}) {
  const [search, setSearch] = useState('');
  const queue = useLoad(useCallback(() => queueRows(api), [api]), [api, revision]);
  const stock = useLoad(useCallback(() => api.list_materials({include_inactive: true}), [api]), [api, revision]);
  const needle = search.trim().toLowerCase();
  const rows = (queue.data || []).filter(r => !needle || `${r.order_ref || ''} ${r.model_name || ''} ${r.staff_name || ''}`.toLowerCase().includes(needle));
  const groups = groupByRequester(rows);
  const [picked, setPicked] = useState(() => new Set());
  const allIds = groups.flatMap(g => g.rows.map(r => r.id));
  const chosenGroups = groups.filter(g => picked.has(g.key));
  const chosenRows = chosenGroups.flatMap(g => g.rows);
  const toggle = key => setPicked(p => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const allOn = groups.length > 0 && chosenGroups.length === groups.length;
  return <section aria-label="คิวหยิบ" className="pq">
    <div className="inv-toolbar"><h2>คิวหยิบของ</h2></div>
    <p className="inv-muted">{groups.length} คน · {groups.reduce((n, g) => n + g.rows.length, 0)} ออเดอร์ รอหยิบ</p>
    <label className="inv-search"><input aria-label="ค้นหาคิว" placeholder="ค้นหาชื่อ / ออเดอร์ / รุ่น…" value={search} onChange={e => setSearch(e.target.value)}/></label>
    {queue.busy && <p role="status">กำลังโหลด…</p>}
    {queue.error && <p role="alert">{queue.error} กรุณาโหลดใหม่</p>}
    {stock.error && <p role="alert">โหลดยอดคงเหลือไม่สำเร็จ จึงยังติ๊กหยิบไม่ได้ กรุณาโหลดใหม่</p>}
    {!queue.busy && !queue.error && !groups.length && <p className="inv-empty">ไม่มีออเดอร์รอหยิบ</p>}
    {role === 'admin' && groups.length > 1 && <label className="pq-all"><input type="checkbox" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(groups.map(g => g.key)))}/> เลือกทุกคน ({allIds.length} ออเดอร์)</label>}
    <div className="grid-list">{groups.map(g => <PersonCard key={g.key} group={g} materials={stock.data} role={role} actionBusy={actionBusy} onAction={onAction} checked={picked.has(g.key)} onToggle={() => toggle(g.key)}/>)}</div>
    {role === 'admin' && chosenRows.length > 0 && <div className="pq-bulk-bar">
      <span>เลือกแล้ว {chosenGroups.length} คน · {chosenRows.length} ออเดอร์</span>
      <button type="button" onClick={() => setPicked(new Set())}>ล้าง</button>
      <button type="button" className="inv-primary" disabled={actionBusy || !stock.data} onClick={() => onAction({kind: 'pick_group', name: chosenGroups.length === 1 ? chosenGroups[0].name : `${chosenGroups.length} คน`, rows: chosenRows})}>ตรวจและยืนยันหยิบ {chosenRows.length} ออเดอร์</button>
    </div>}
  </section>;
}
