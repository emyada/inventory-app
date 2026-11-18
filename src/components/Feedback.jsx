import React, {useCallback, useState} from 'react';
import {MessageSquare} from 'lucide-react';
import {ModalHeader} from './InventoryUI.jsx';
import {OpResult, ReadNote, fmtTime, useOperation, useStoreRead} from './store/shared.jsx';
import {storeError} from '../lib/storeApi.js';

export const FEEDBACK_CATEGORIES = Object.freeze({problem: 'ปัญหา / ใช้งานไม่ได้', idea: 'ข้อเสนอแนะ', question: 'คำถาม'});
const STATUS_LABEL = {new: 'ใหม่', done: 'จัดการแล้ว'};

// Compact context sent with every report so the admin can reproduce it (no personal data beyond the account).
export function feedbackContext(win = globalThis) {
  try {
    return {
      ua: String(win.navigator?.userAgent || '').slice(0, 200),
      screen: win.innerWidth && win.innerHeight ? `${win.innerWidth}x${win.innerHeight}` : undefined,
      standalone: Boolean(win.matchMedia?.('(display-mode: standalone)')?.matches),
    };
  } catch { return {}; }
}

function SendForm({api, page, onClose}) {
  const [category, setCategory] = useState('problem');
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  const op = useOperation();
  const submit = e => {
    e.preventDefault();
    op.run(() => {
      if (message.trim().length < 3) throw new Error('FEEDBACK_MESSAGE_REQUIRED');
      return api.submit_feedback({message: message.trim(), category, page, context: feedbackContext()});
    });
  };
  if (done) return <div><p role="status">ส่งแล้ว ขอบคุณที่แจ้ง 🙏</p><div className="inv-actions"><button type="button" className="inv-primary" onClick={onClose}>ปิด</button></div></div>;
  return <form className="inv-form" onSubmit={submit}>
    <label>เรื่องที่แจ้ง<select value={category} onChange={e => setCategory(e.target.value)}>{Object.entries(FEEDBACK_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label>รายละเอียด<textarea required rows={5} maxLength={1000} value={message} onChange={e => setMessage(e.target.value)} placeholder="เกิดอะไรขึ้น ตอนทำอะไรอยู่ เห็นข้อความอะไร"/></label>
    <p className="inv-muted">ระบบแนบชื่อผู้ส่ง หน้าที่เปิดอยู่ และรุ่นมือถือ/เบราว์เซอร์ไปให้อัตโนมัติ</p>
    {op.error && <p role="alert">{op.error}</p>}
    <div className="inv-actions"><button type="submit" className="inv-primary" disabled={op.busy}>ส่ง</button><button type="button" disabled={op.busy} onClick={onClose}>ยกเลิก</button></div>
    {op.operation && <OpResult operation={op.operation} onSuccess={() => setDone(true)} onFailure={e => { op.setError(storeError(e)); op.reset(); }}/>}
  </form>;
}

function Row({api, item, onChanged}) {
  const op = useOperation();
  const toggle = () => op.run(() => api.resolve_feedback({feedback_id: item.id, done: item.status !== 'done'}));
  const ctx = item.context || {};
  return <li className={`feedback-item ${item.status}`}>
    <div className="feedback-head"><strong>{FEEDBACK_CATEGORIES[item.category] || item.category}</strong><span className="inv-muted">{fmtTime(item.created_at)} · {item.user_name || '-'} ({item.role}){item.page ? ` · หน้า ${item.page}` : ''}</span></div>
    <p className="feedback-msg">{item.message}</p>
    {(ctx.ua || ctx.screen) && <details><summary className="inv-muted">รายละเอียดเครื่อง</summary><p className="inv-muted">{ctx.screen}{ctx.standalone ? ' · ติดตั้งเป็นแอพ' : ''}<br/>{ctx.ua}</p></details>}
    <div className="inv-actions"><span className={`feedback-status ${item.status}`}>{STATUS_LABEL[item.status]}</span><button type="button" disabled={op.busy} onClick={toggle}>{item.status === 'done' ? 'เปิดใหม่' : 'ทำเครื่องหมายว่าจัดการแล้ว'}</button></div>
    {op.error && <p role="alert">{op.error}</p>}
    {op.operation && <OpResult operation={op.operation} onSuccess={() => { op.reset(); onChanged(); }} onFailure={e => { op.setError(storeError(e)); op.reset(); }}/>}
  </li>;
}

function Inbox({api, revision, onChanged}) {
  const [filter, setFilter] = useState('new');
  const state = useStoreRead(() => api.list_feedback({status: filter === 'all' ? undefined : filter, limit: 200}), revision, [filter]);
  const items = state.data?.items || [];
  return <div>
    <div className="inv-subnav">{[['new', 'ใหม่'], ['done', 'จัดการแล้ว'], ['all', 'ทั้งหมด']].map(([k, v]) => <button type="button" key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{v}</button>)}</div>
    <ReadNote state={state}/>
    {!state.busy && !state.error && !items.length && <p className="inv-empty">ไม่มีรายการ</p>}
    <ul className="feedback-list">{items.map(i => <Row key={i.id} api={api} item={i} onChanged={onChanged}/>)}</ul>
  </div>;
}

// Header button: everyone can send a report; the admin also gets the inbox with a "new" badge.
export function FeedbackButton({api, role, page, revision, disabled}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('send');
  const [local, setLocal] = useState(0);
  const bump = useCallback(() => setLocal(v => v + 1), []);
  const isAdmin = role === 'admin';
  const badge = useStoreRead(() => isAdmin ? api.list_feedback({status: 'new', limit: 1}) : Promise.resolve(null), revision, [local, isAdmin, open]);
  const newCount = Number(badge.data?.new_count || 0);
  const close = () => { setOpen(false); setView('send'); };
  return <>
    <button type="button" className="feedback-btn" aria-label="แจ้งปัญหา / เสนอแนะ" title="แจ้งปัญหา / เสนอแนะ" disabled={disabled} onClick={() => setOpen(true)}><MessageSquare size={18}/>{newCount > 0 && <span className="feedback-badge">{newCount}</span>}</button>
    {open && <div className="inv-modal-backdrop"><div className="inv-modal" role="dialog" aria-modal="true" aria-label="แจ้งปัญหา / เสนอแนะ">
      <ModalHeader title="แจ้งปัญหา / เสนอแนะ" onClose={close}/>
      {isAdmin && <div className="inv-subnav"><button type="button" aria-pressed={view === 'send'} onClick={() => setView('send')}>ส่งเรื่องใหม่</button><button type="button" aria-pressed={view === 'inbox'} onClick={() => setView('inbox')}>ที่ส่งมา{newCount > 0 ? ` (${newCount})` : ''}</button></div>}
      {view === 'send' ? <SendForm api={api} page={page} onClose={close}/> : <Inbox api={api} revision={revision + local} onChanged={bump}/>}
    </div></div>}
  </>;
}
