import './InventoryV2.css';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Package, ListChecks, ClipboardList, Settings, LogOut, RefreshCw} from 'lucide-react';
import {InventoryModeBanner} from '../components/InventoryModeBanner.js';
import {inventoryEnvironment} from '../lib/inventoryEnvironment.js';
import {createUserInventory,createUserOpening} from '../lib/inventoryRpcClient.js';
import {InventoryRecoveryPanel} from '../components/InventoryRecoveryPanel.jsx';
import {InventoryManagementForm} from '../components/InventoryManagementForm.jsx';
import {InventoryWorkflowForm} from '../components/InventoryWorkflowForm.jsx';
import {ModelsFloor, MaterialsPanel, RequestsPanel, SupervisorRequests} from '../components/InventoryWorkspacePanels.jsx';
import {InventoryExtensionForm} from '../components/InventoryExtensionForm.jsx';
import {InventoryOpeningBalance} from '../components/InventoryOpeningBalance.jsx';
import {normalInventoryEnabled} from '../lib/inventoryOpening.js';
import {InventoryReports} from '../components/InventoryReports.jsx';
import {managementKinds} from '../lib/inventoryManagement.js';
import {workspaceTabs} from '../lib/inventoryReports.js';
const labels={floor:'ผลิต',queue:'คิวหยิบ',materials:'คลัง',requests:'คำขอ',report:'รายงาน'};
const icons={floor:Package,queue:ListChecks,materials:Settings,requests:ClipboardList,report:ClipboardList};
export default function InventoryV2({role,profile,signOut,api:injectedApi}) {
  const recovery=useMemo(()=>injectedApi?null:createUserInventory(profile.id),[injectedApi,profile.id]);
  const api=injectedApi||recovery.api;
  const opening=useMemo(()=>createUserOpening(profile.id),[profile.id]);
  const [setupBusy,setSetupBusy]=useState(false);
  const [setup,setSetup]=useState(null),[setupError,setSetupError]=useState('');
  const mutationsEnabled=normalInventoryEnabled(inventoryEnvironment,setup);
  const [recoveryBlocked,setRecoveryBlocked]=useState(!injectedApi);const [task,setTask]=useState(null);const [revision,setRevision]=useState(0);
  const tabs=workspaceTabs(role);const [tab,setTab]=useState(tabs[0]);
  const refresh=useCallback(()=>setRevision(v=>v+1),[]);
  useEffect(()=>{let alive=true;opening.status().then(value=>{if(alive){setSetup(value);setSetupError('');}}).catch(()=>{if(alive){setSetup(null);setSetupError('ไม่สามารถตรวจสถานะคลังได้ ปิดการทำรายการไว้ก่อน');}});return()=>{alive=false;};},[opening,revision]);
  const close=()=>{setTask(null);setRecoveryBlocked(Boolean(recovery));};
  const actionBusy=!mutationsEnabled||Boolean(task)||recoveryBlocked;
  return <main className="inventory-v2"><div className="inv-shell">
    <header className="inv-header"><div className="inv-brand"><Package size={22}/><div><h1>คลังสินค้า — IEM Workshop</h1><p title={profile?.full_name}><span className="inv-user-name">{profile?.full_name} · </span>{role==='admin'?'หัวหน้าฝ่ายผลิต':role==='purchasing'?'จัดซื้อ':'พนักงาน'}</p></div></div><div className="inv-actions"><button aria-label="โหลดข้อมูลใหม่" disabled={Boolean(task)||setupBusy} onClick={refresh}><RefreshCw size={18}/></button><button aria-label="ออกจากระบบ" disabled={Boolean(task)||setupBusy} onClick={signOut}><LogOut size={18}/></button></div></header>
    <InventoryModeBanner policy={inventoryEnvironment}/>
    {setupError&&<p role="alert">{setupError}</p>}
    {setup&&!setup.active&&<aside className="inv-environment">คลังยังไม่เปิดใช้งาน — รอการตรวจนับยอดตั้งต้นและอนุมัติเปิดใช้งาน</aside>}
    {role==='admin'&&<div className="inv-actions"><button disabled={Boolean(task)||setupBusy} onClick={()=>setTab(tab==='opening'?tabs[0]:'opening')}>{tab==='opening'?'กลับหน้าคลัง':'ยอดตั้งต้น / เปิดใช้งาน'}</button></div>}
    {inventoryEnvironment.environmentName==='staging'&&mutationsEnabled&&<aside className="inv-environment">STAGING — สภาพแวดล้อมทดสอบ</aside>}
    <div className="inv-content">
      {recovery&&!task&&<InventoryRecoveryPanel mutationsEnabled={mutationsEnabled} recovery={recovery} onCompleted={refresh} onBlocked={setRecoveryBlocked}/>}
      {tab==='floor'&&['admin','staff'].includes(role)&&<ModelsFloor role={role} revision={revision} onAction={setTask} actionBusy={!mutationsEnabled||Boolean(task)||recoveryBlocked}/>}
      {tab==='materials'&&['admin','purchasing'].includes(role)&&<><MaterialsPanel api={api} role={role} revision={revision} onAction={setTask} actionBusy={actionBusy}/></>}
      {tab==='requests'&&role==='staff'&&<RequestsPanel api={api} role={role} userId={profile.id} revision={revision} onAction={setTask} actionBusy={actionBusy}/>}
      {tab==='requests'&&role==='admin'&&<SupervisorRequests api={api} role={role} userId={profile.id} revision={revision} onAction={setTask} actionBusy={actionBusy}/>}
      {tab==='report'&&['admin','purchasing'].includes(role)&&<InventoryReports api={api} role={role} revision={revision}/>}
      {tab==='opening'&&role==='admin'&&<InventoryOpeningBalance api={opening} onChanged={refresh} onBusyChange={setSetupBusy}/>}
      {!tabs.includes(tab)&&!(tab==='opening'&&role==='admin')&&<p role="alert">ไม่มีสิทธิ์เปิดหน้านี้</p>}
    </div>
    <nav className="inv-bottom" aria-label="เมนูหลัก">{tabs.map(key=>{const Icon=icons[key];return <button key={key} aria-current={tab===key?'page':undefined} disabled={Boolean(task)||setupBusy} onClick={()=>setTab(key)}><Icon size={20}/><span>{key==='requests'?(role==='staff'?'คำขอของฉัน':'จัดการคำขอ'):labels[key]}</span></button>;})}</nav>
    {task && mutationsEnabled && <div className="inv-modal-backdrop"><div className="inv-modal" role="dialog" aria-modal="true" aria-label="ทำรายการคลังสินค้า">
      {task.kind==='close_not_completed'?<InventoryExtensionForm key={task.kind+String(task.row?.id||task.row?.request_id)} task={task} api={api} role={role} onClose={close} onSuccess={refresh}/>:managementKinds.includes(task.kind)?<InventoryManagementForm key={task.kind+String(task.row?.id)} task={task} api={api} role={role} onClose={close} onSuccess={refresh}/>:<InventoryWorkflowForm key={task.kind+String(task.row?.id)} task={task} api={api} role={role} userId={profile.id} profile={profile} onClose={close} onSuccess={refresh}/>}</div></div>}
  </div></main>;
}
