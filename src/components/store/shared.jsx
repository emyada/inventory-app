import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useRefreshRead} from '../../hooks/useRefreshRead.js';
import {useInventoryOperation} from '../../hooks/useInventoryOperation.js';
import {storeError} from '../../lib/storeApi.js';

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

