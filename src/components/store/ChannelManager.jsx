import React, {useCallback, useMemo, useState} from 'react';
import {ModalHeader} from '../InventoryUI.jsx';
import {buildChannelPattern, describeChannelRule, CHANNEL_COLORS, storeError} from '../../lib/storeApi.js';
import {useStoreRead, ReadNote, OpResult, useOperation, ChannelBadge} from './shared.jsx';

/* ---------------- Admin: add / edit / disable / delete sales channels ---------------- */
const emptyForm = {code: null, name: '', color: 'gray', mode: 'digits', prefix: '', digits: '15', with_seq: true};
const formFromChannel = c => ({code: c.code, name: c.name, color: c.color, mode: c.spec?.with_date ? 'date' : 'digits', prefix: c.spec?.prefix || '', digits: String(c.spec?.digits || 15), with_seq: c.spec ? Boolean(c.spec.with_seq) : true});
const specOf = f => ({prefix: f.prefix, digits: Number(f.digits), with_date: f.mode === 'date', with_seq: f.mode === 'date' && f.with_seq});

function ChannelForm({api, initial, onClose, onSaved}) {
  const [f, setF] = useState(initial);
  const [sample, setSample] = useState('');
  const op = useOperation();
  const pattern = useMemo(() => buildChannelPattern(specOf(f)), [f]);
  const sampleOk = useMemo(() => {
    if (!pattern || !sample.trim()) return null;
    try { return new RegExp(pattern).test(sample.trim().toUpperCase()); } catch { return null; }
  }, [pattern, sample]);
  const done = useCallback(() => { op.reset(); onSaved(); onClose(); }, [onSaved, onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  const failed = useCallback(error => { op.setError(storeError(error)); op.reset(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = patch => { setF({...f, ...patch}); op.setError(null); };
  function submit(e) {
    e.preventDefault();
    op.run(() => {
      if (!f.name.trim()) throw new Error('CHANNEL_NAME_INVALID');
      if (!pattern) throw new Error('CHANNEL_RULE_INVALID');
      return api.store_save_channel({...(f.code ? {code: f.code} : {}), name: f.name.trim(), color: f.color, ...specOf(f)});
    });
  }
  return <form className="store-adjust store-channel-form" onSubmit={submit}>
    <h3>{f.code ? 'แก้ไขช่องทาง' : 'เพิ่มช่องทางขาย'}</h3>
    <label>ชื่อช่องทาง<input required maxLength={30} value={f.name} onChange={e => set({name: e.target.value})} placeholder="เช่น Lazada"/></label>
    <label>สีป้าย<select value={f.color} onChange={e => set({color: e.target.value})}>{CHANNEL_COLORS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
    <fieldset className="store-channel-rule"><legend>กฎของเลขแท็ก</legend>
      <label><input type="radio" name="chmode" checked={f.mode === 'digits'} onChange={() => set({mode: 'digits'})}/> ตัวเลขล้วนจำนวนหลักคงที่</label>
      <label><input type="radio" name="chmode" checked={f.mode === 'date'} onChange={() => set({mode: 'date'})}/> มีวันที่ 6 หลัก (ปีเดือนวัน)</label>
      <label>ขึ้นต้นด้วย (ไม่ใส่ก็ได้)<input value={f.prefix} maxLength={8} onChange={e => set({prefix: e.target.value.toUpperCase()})} placeholder={f.mode === 'date' ? 'เช่น RE (เว้นว่าง = อักษร 1–3 ตัวอะไรก็ได้)' : 'เช่น LZ'}/></label>
      {f.mode === 'digits'
        ? <label>จำนวนหลักของตัวเลข<input inputMode="numeric" value={f.digits} onChange={e => set({digits: e.target.value.replace(/\D/g, '').slice(0, 2)})}/></label>
        : <label><input type="checkbox" checked={f.with_seq} onChange={e => set({with_seq: e.target.checked})}/> มีขีดแล้วตามด้วยลำดับ 1–4 หลัก</label>}
      <p className="inv-muted">{pattern ? describeChannelRule({spec: specOf(f)}) : 'กฎยังไม่ถูกต้อง ตรวจคำขึ้นต้นและจำนวนหลัก'}</p>
    </fieldset>
    <label>ลองพิมพ์เลขทดสอบ<input value={sample} onChange={e => setSample(e.target.value)} autoComplete="off"/></label>
    {sampleOk !== null && <p className={sampleOk ? 'inv-success' : 'store-tag-bad'}>{sampleOk ? 'ผ่านกฎ' : 'ไม่ผ่านกฎ'}</p>}
    {op.error && <p role="alert">{op.error}</p>}
    <button type="submit" className="inv-primary" disabled={op.busy || !pattern || !f.name.trim()}>บันทึกช่องทาง</button>
    <button type="button" disabled={op.busy} onClick={onClose}>ยกเลิก</button>
    {op.operation && <OpResult operation={op.operation} onSuccess={done} onFailure={failed}/>}
  </form>;
}

function ChannelRow({api, c, onEdit, onChanged}) {
  const op = useOperation();
  const act = action => op.run(() => api.store_channel_action({code: c.code, action}, {intentKey: `chan:${c.code}:${action}`}));
  const done = useCallback(() => { op.reset(); onChanged(); }, [onChanged]); // eslint-disable-line react-hooks/exhaustive-deps
  const failed = useCallback(error => { op.setError(storeError(error)); op.reset(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <li className="inv-card store-channel-row">
    <div className="store-channel-head"><ChannelBadge name={c.name} color={c.color}/>
      <span className="inv-muted">{c.is_system ? 'ของระบบ' : c.active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'} · ใช้แล้ว {c.used} ออเดอร์</span></div>
    <p>{describeChannelRule(c)}</p>
    {c.example && !c.is_system && <p className="inv-muted">ตัวอย่าง: {c.example}</p>}
    {!c.is_system && <div className="store-channel-actions">
      <button type="button" disabled={op.busy} onClick={() => onEdit(c)}>แก้ไข</button>
      <button type="button" disabled={op.busy} onClick={() => act(c.active ? 'disable' : 'enable')}>{c.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
      <button type="button" disabled={op.busy || c.used > 0} title={c.used > 0 ? 'เคยมียอดขายแล้ว ลบไม่ได้' : ''} onClick={() => act('delete')}>ลบ</button>
    </div>}
    {op.error && <p role="alert">{op.error}</p>}
    {op.operation && <OpResult operation={op.operation} onSuccess={done} onFailure={failed}/>}
  </li>;
}

export function ChannelManager({api, revision, onClose, onChanged}) {
  const [editing, setEditing] = useState(null);
  const state = useStoreRead(() => api.store_list_channels(), revision);
  return <section className="inv-form">
    <ModalHeader title="ตั้งค่าช่องทางขาย" onClose={onClose}/>
    <p className="inv-muted">แอดมินเท่านั้น · กำหนดว่าแต่ละช่องทางใช้เลขแท็กหน้าตาแบบไหน เลขที่ไม่ตรงกฎจะบันทึกไม่ได้ ยกเว้นติ๊ก “อื่นๆ” ปิดใช้งานแล้วยอดเก่าและรายงานยังอยู่ครบ</p>
    <ReadNote state={state}/>
    {editing
      ? <ChannelForm api={api} initial={editing} onClose={() => setEditing(null)} onSaved={onChanged}/>
      : <>
        <button type="button" className="inv-primary" onClick={() => setEditing(emptyForm)}>+ เพิ่มช่องทาง</button>
        <ul className="store-channel-list">{(state.data || []).map(c => <ChannelRow key={c.code} api={api} c={c} onEdit={x => setEditing(formFromChannel(x))} onChanged={onChanged}/>)}</ul>
      </>}
  </section>;
}
