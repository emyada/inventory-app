import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useRefreshRead} from '../../hooks/useRefreshRead.js';
import {useInventoryOperation} from '../../hooks/useInventoryOperation.js';
import {storeError, tagChannelState, TAG_MISMATCH_TEXT} from '../../lib/storeApi.js';

export const fmtTime = value => new Date(value).toLocaleString('th-TH', {timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short'});
export const fmtQty = n => Number(n).toLocaleString('th-TH', {maximumFractionDigits: 3});

export function useStoreRead(load, revision, deps = []) {
  const [state, setState] = useState({busy: true, error: null, data: null});
  useRefreshRead(() => { setState(s => ({...s, busy: true, error: null})); return load(); },
    data => setState({busy: false, error: null, data}),
    e => setState({busy: false, error: e.message, data: null}),
    [revision, ...deps]);
  return state;
}
export function ReadNote({state}) {
  return <>{state.busy && <p role="status">กำลังโหลด…</p>}{state.error && <p role="alert">{state.error} กรุณาโหลดใหม่</p>}</>;
}

// Shows progress/result of one prepared (idempotent) operation.
export function OpResult({operation, onSuccess, onFailure}) {
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
export function useOperation() {
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


// Channel badge (TikTok / Shipnity / ...) — colour comes from the channel setting.
export function ChannelBadge({name, color}) {
  if (!name) return null;
  return <span className={`store-channel store-channel-${color || 'gray'}`}>{name}</span>;
}

// Sale-tag box: shows the channel badge when the number matches a rule; otherwise asks to tick อื่นๆ.
export function TagField({channels, tag, onTag, other, onOther, required, placeholder, label = 'รหัสแท็กการขาย', describedBy}) {
  const {state, channel} = tagChannelState(tag, channels, other);
  const known = (channels || []).length > 0;
  const other_ = (channels || []).find(c => c.code === 'other');
  return <div className="store-tag-field">
    <div className="store-tag-top">
      <span className="store-tag-label">แท็กการขาย</span>
      {state === 'match' && <ChannelBadge name={channel.name} color={channel.color}/>}
      {state === 'other' && <ChannelBadge name={other_?.name || 'อื่นๆ'} color={other_?.color || 'amber'}/>}
    </div>
    <input aria-label={label} required={required} value={tag} onChange={e => onTag(e.target.value)} placeholder={placeholder} aria-describedby={describedBy} autoComplete="off" aria-invalid={known && state === 'mismatch'}/>
    {known && state === 'mismatch' && <p role="alert" className="store-tag-bad">{TAG_MISMATCH_TEXT}</p>}
    {known && (state === 'mismatch' || state === 'other') && <label className="store-tag-other"><input type="checkbox" checked={Boolean(other)} onChange={e => onOther(e.target.checked)}/> {other_?.name || 'อื่นๆ'}</label>}
  </div>;
}
