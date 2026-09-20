import './InventoryV2.css';
import { InventoryModeBanner } from '../components/InventoryModeBanner.js';
import { inventoryEnvironment } from '../lib/inventoryEnvironment.js';
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createUserInventory } from '../lib/inventoryRpcClient.js';
import { createInventoryReader, manualPendingLines, v2Tabs } from '../lib/inventoryV2Reads.js';
import { InventoryRecoveryPanel } from '../components/InventoryRecoveryPanel.jsx';
import { InventoryManagementForm } from '../components/InventoryManagementForm.jsx';
import { InventoryModelsPanel } from '../components/InventoryModelsPanel.jsx';
import { managementKinds } from '../lib/inventoryManagement.js';
import { InventoryWorkflowForm } from '../components/InventoryWorkflowForm.jsx';
import { cancelEligibility } from '../lib/inventoryWorkflow.js';
import { getDefaultOperationStore } from '../lib/inventoryOperation.js';

const labels = { requests: 'คำขอของฉัน', queue: 'คิวหัวหน้า', materials: 'คลังสินค้า', report: 'รายงาน', movements: 'ประวัติการเคลื่อนไหว' };
const states = { pending: 'รอหยิบ', partially_picked: 'หยิบบางส่วน', completed: 'เสร็จแล้ว', cancelled: 'ยกเลิกแล้ว' };
const display = value => value == null ? 'ไม่พร้อมใช้งาน' : String(value);
const panel = { padding: 16, border: '1px solid var(--inv-line)', background: 'var(--inv-panel)', borderRadius: 8, marginTop: 12 };
const fields = [['opening','ต้นงวด'],['opening_additions','ยอดเปิดใหม่'],['purchase','รับเข้า'],
  ['issue','เบิกทั้งหมด'],['production_issue','เบิกผลิต'],['repair_issue','เบิกซ่อม'],
  ['returned','คืนทั้งหมด'],['production_returned','คืนผลิต'],['repair_returned','คืนซ่อม'],
  ['adjustment_in','ปรับเพิ่ม'],['adjustment_out','ปรับลด'],['closing','ปลายงวด']];

function PendingBanner() {
  const [summary, setSummary] = useState(() => getDefaultOperationStore().getPendingSummary());
  useEffect(() => {
    const refresh = () => setSummary(getDefaultOperationStore().getPendingSummary());
    const timer = setInterval(refresh, 30000);
    window.addEventListener('storage', refresh); window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('storage', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  if (!summary.pending && !summary.corrupt && !summary.error) return null;
  return <aside role="status" style={panel}>มีรายการในเครื่องที่ต้องตรวจสอบ/ลองใหม่: {summary.pending} รายการ
    {summary.stale > 0 && ` (เกิน 7 วัน ${summary.stale} รายการ)`}
    {summary.corrupt > 0 && ' พบข้อมูล pending ไม่สมบูรณ์'}
    <p>พบ metadata รุ่นเก่าที่ไม่มีเจ้าของหรือ replay payload ต้องตรวจสอบกับผู้ดูแล ห้ามเดาเจ้าของหรือส่งรายการเดิมด้วย UUID ใหม่</p>
    {summary.error && <p>{summary.error.message}</p>}
  </aside>;
}
function Request({ row, queue, role, userId, onAction, actionBusy }) {
  return <article style={panel}>
    <h3>{row.model_name} — {row.category}</h3>
    <p>ออเดอร์: {row.order_ref} · ผู้ขอ: {row.staff_name}</p>
    <p>หมายเหตุ: {row.note || '—'}</p>
    <p>สถานะ: {states[row.workflow_state] ?? row.workflow_state ?? 'ไม่ทราบสถานะ'}</p>
    <p>ทั้งหมด {display(row.total_lines)} · หยิบแล้ว {display(row.picked_lines)} · รอหยิบ {display(row.pending_lines)}</p>
    {queue && <><p>รอหัวหน้าจัด {display(row.pending_picking_lines)} บรรทัด</p>
      <ul>{manualPendingLines(row).map(line => <li key={line.line_id}>{line.material_name}: {display(line.qty)} {line.unit}</li>)}</ul></>}
    {queue && role === 'admin' && <button disabled={actionBusy} onClick={() => onAction({ kind: 'pick', row })}>เลือกบรรทัดเพื่อยืนยันหยิบ</button>}
    {!queue && (cancelEligibility(row, role, userId) ? <p>{cancelEligibility(row, role, userId)}</p> : <button disabled={actionBusy} onClick={() => onAction({ kind: 'cancel', row })}>ยกเลิกคำขอ</button>)}
  </article>;
}
function ReadPanel({ tab, from, to, api, role, userId, onAction, actionBusy }) {
  const reader = useMemo(() => createInventoryReader(api, tab,
    { date_from: from, date_to: to, timezone: 'Asia/Bangkok' }), [api, tab, from, to]);
  const { rows, loading, error, hasMore } = useSyncExternalStore(reader.subscribe, reader.getSnapshot, reader.getSnapshot);
  const [page, setPage] = useState(0);
  useEffect(() => { reader.load(); }, [reader]);
  const localPaging = tab === 'materials' || tab === 'report';
  const visible = localPaging ? rows.slice(page * 25, (page + 1) * 25) : rows;
  return <section aria-busy={loading}>
    <button type="button" disabled={loading} onClick={() => { setPage(0); reader.load(); }}>โหลดใหม่</button>
    {loading && <p role="status">กำลังโหลด…</p>}
    {error && <p role="alert">{error.message} — ลองโหลดข้อมูลอีกครั้ง (ข้อมูลที่แสดงอาจยังไม่ล่าสุด)</p>}
    {!loading && !error && rows.length === 0 && <p>ไม่พบข้อมูล</p>}
    {visible.map(row => tab === 'requests' || tab === 'queue' ? <Request key={row.id} row={row} queue={tab === 'queue'} role={role} userId={userId} onAction={onAction} actionBusy={actionBusy} />
      : tab === 'materials' ? <article key={row.id} style={panel}><h3>{row.name}</h3>
        <p>คงเหลือ {display(row.qty)} {row.unit} · {row.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}</p>
        {role==='admin' && <><button disabled={actionBusy||loading||Boolean(error)} onClick={()=>onAction({kind:'update_material',row})}>แก้ไขวัตถุดิบ</button>
          <button disabled={actionBusy||loading||Boolean(error)} onClick={()=>onAction({kind:'set_material_active',row})}>{row.is_active?'ปิด':'เปิด'}ใช้งาน</button>
          <button disabled={actionBusy||loading||Boolean(error)} onClick={()=>onAction({kind:'stocktake',row})}>ตรวจนับ</button></>}
        {['admin','purchasing'].includes(role) && <button disabled={actionBusy||loading||Boolean(error)||!row.is_active} onClick={()=>onAction({kind:'receive_purchase',row})}>รับของเข้า</button>}</article>
      : tab === 'report' ? <article key={row.id} style={panel}><h3>{row.name} ({row.unit})</h3>
        <p>ความครบถ้วน: {row.coverage}</p><dl>{fields.map(([key,label]) => <div key={key}><dt>{label}</dt><dd>{display(row[key])}</dd></div>)}</dl></article>
      : <article key={row.id} style={panel}><h3>{row.material_name}</h3><p>{row.occurred_at} · {row.reason}</p>
        <p>{display(row.delta)} {row.unit} · ก่อน {display(row.qty_before)} → หลัง {display(row.qty_after)}</p>
        <p>{row.reference || '—'} · {row.note || '—'}</p></article>)}
    {localPaging && rows.length > 25 && <nav aria-label="หน้า"><button disabled={page === 0 || loading} onClick={() => setPage(p => p - 1)}>ก่อนหน้า</button>
      <span> หน้า {page + 1} / {Math.ceil(rows.length / 25)} </span><button disabled={(page + 1) * 25 >= rows.length || loading} onClick={() => setPage(p => p + 1)}>ถัดไป</button></nav>}
    {hasMore && <button disabled={loading} onClick={() => reader.load(true)}>โหลดเพิ่ม</button>}
  </section>;
}
export default function InventoryV2({ role, profile, signOut, api: injectedApi }) {
  const recovery = useMemo(() => injectedApi ? null : createUserInventory(profile.id), [injectedApi, profile.id]);
  const api = injectedApi || recovery.api;
  const mutationsEnabled=inventoryEnvironment.mutationsEnabled;
  const [recoveryBlocked, setRecoveryBlocked] = useState(!injectedApi);
  const [showModels,setShowModels] = useState(false);
  const [task, setTask] = useState(null); const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  const tabs = v2Tabs(role);
  const [tab, setTab] = useState(tabs[0]);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [from, setFrom] = useState(today); const [to, setTo] = useState(today);
  return <main className="inventory-v2">
    <h1>Inventory V2</h1><InventoryModeBanner policy={inventoryEnvironment}/><p>{profile?.full_name}</p><button onClick={signOut}>ออกจากระบบ</button>
    <PendingBanner key={revision} />
    {recovery && !task && <InventoryRecoveryPanel mutationsEnabled={mutationsEnabled} recovery={recovery} onCompleted={refresh} onBlocked={setRecoveryBlocked} />}
    {['admin','staff'].includes(role) && <button disabled={!mutationsEnabled || Boolean(task) || recoveryBlocked} onClick={() => setTask({ kind: 'create' })}>สร้างคำขอเบิก</button>}
    {role==='admin' && <><button disabled={!mutationsEnabled||Boolean(task)||recoveryBlocked} onClick={()=>setTask({kind:'create_material'})}>เพิ่มวัตถุดิบ</button>
      <button onClick={()=>setShowModels(v=>!v)}>จัดการรุ่นและ BOM</button></>}
    {task && mutationsEnabled && (managementKinds.includes(task.kind)
      ? <InventoryManagementForm task={task} api={api} role={role} onClose={()=>{setRecoveryBlocked(Boolean(recovery));setTask(null);}} onSuccess={refresh}/>
      : <InventoryWorkflowForm task={task} api={api} role={role} userId={profile.id} onClose={() => {setRecoveryBlocked(Boolean(recovery));setTask(null);}} onSuccess={refresh} />)}
    {showModels && <InventoryModelsPanel role={role} revision={revision} onAction={setTask} actionBusy={!mutationsEnabled||Boolean(task)||recoveryBlocked}/>}
    <nav>{tabs.map(key => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{labels[key]}</button>)}</nav>
    {!tabs.includes(tab) ? <p role="alert">ไม่มีสิทธิ์เข้าถึงหน้านี้</p> : <>
      <h2>{labels[tab]}</h2>
      {(tab === 'requests' || tab === 'queue') && <p>แสดงจากเก่าไปใหม่ · โหลดเพิ่มเพื่อดูรายการถัดไป</p>}
      {tab === 'report' && <><label>จาก <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>ถึง <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <p>ยอดผลิต/ซ่อมเป็นส่วนแยกของยอดทั้งหมด ไม่บวกซ้ำ ยอดก่อน cutover อาจไม่พร้อมใช้งาน</p></>}
      <ReadPanel key={`${tab}:${from}:${to}:${revision}`} role={role} userId={profile.id} onAction={setTask} actionBusy={!mutationsEnabled || Boolean(task) || recoveryBlocked} tab={tab} from={from} to={to} api={api} />
    </>}
  </main>;
}
