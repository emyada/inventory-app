import React, {useMemo, useState} from 'react';
import {localDay} from '../lib/inventoryReports.js';
import {pendingSummary, PENDING_TAG_WARN_DAYS} from '../lib/storeApi.js';
import {StoreSell} from './store/StoreSell.jsx';
import {StoreStock} from './store/StoreStock.jsx';
import {StoreTransferForm, StoreTransferHistory} from './store/StoreTransfer.jsx';
import {StoreSales} from './store/StoreSales.jsx';
import {StoreReports} from './store/StoreReports.jsx';
import {useStoreRead} from './store/shared.jsx';

export {StoreSell, StoreStock, StoreTransferForm, StoreTransferHistory, StoreSales, StoreReports};

/* ---------------- Workspace shell ---------------- */
export function StoreWorkspace({api, role, userId, revision, onChanged, actionBusy}) {
  const modes = role === 'store' ? [['sell', 'ขาย'], ['other', 'อื่นๆ'], ['stock', 'ยอดหน้าร้าน'], ['sales', 'รายการขาย'], ['report', 'รายงาน']] : [['stock', 'ยอดหน้าร้าน'], ['sales', 'รายการขาย'], ['sell', 'ขาย'], ['other', 'อื่นๆ'], ['report', 'รายงาน']];
  const [mode, setMode] = useState(modes[0][0]);
  const [transfer, setTransfer] = useState(false); // false | 'to_store' | 'to_main'
  const [history, setHistory] = useState(false);
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
    {mode === 'stock' && <StoreStock api={api} role={role} revision={revision} onChanged={onChanged} actionBusy={actionBusy} onTransfer={dir => setTransfer(dir || 'to_store')} onHistory={() => setHistory(true)}/>}
    {mode === 'sales' && <StoreSales api={api} role={role} userId={userId} revision={revision} onChanged={onChanged} actionBusy={actionBusy}/>}
    {mode === 'report' && <StoreReports api={api} revision={revision}/>}
    {transfer && <div className="inv-modal-backdrop"><div className="inv-modal" role="dialog" aria-modal="true" aria-label="โอนของระหว่างคลังหลักกับหน้าร้าน">
      <StoreTransferForm api={api} initialDir={transfer} onClose={() => setTransfer(false)} onSuccess={onChanged}/></div></div>}
    {history && <div className="inv-modal-backdrop"><div className="inv-modal" role="dialog" aria-modal="true" aria-label="ประวัติการโอน">
      <StoreTransferHistory api={api} revision={revision} onClose={() => setHistory(false)}/></div></div>}
  </>;
}

