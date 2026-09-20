import React, { useEffect, useRef, useState } from 'react';
import { useInventoryOperation } from '../hooks/useInventoryOperation.js';
import { prepareWorkflow, workflowError } from '../lib/inventoryWorkflow.js';
import { manualPendingLines } from '../lib/inventoryV2Reads.js';
import { loadActiveModels } from '../lib/inventoryModelCatalog.js';

function OperationResult({ operation, onSuccess, onFailure }) {
  const state = useInventoryOperation(operation);
  const notified = useRef(false);
  useEffect(() => {
    if (state.status === 'succeeded' && !notified.current) { notified.current = true; onSuccess(); }
    if (state.status === 'failed' && !notified.current) { notified.current = true; onFailure(state.error); }
  }, [state.status, state.error, onSuccess, onFailure]);
  return <div>
    {state.loading && <p role="status">กำลังส่ง…</p>}
    {state.status === 'succeeded' && <p role="status">RPC ยืนยันสำเร็จแล้ว{state.data?.completed ? ' — งานเสร็จแล้ว' : ''}</p>}
    {state.error && <p role="alert">{workflowError(state.error)}</p>}
    {state.storageError && <p role="alert">{state.storageError.message}</p>}
    {!['succeeded','failed'].includes(state.status) && <><p>ลองใหม่ด้วย intent และ UUID เดิม: {state.operationId || 'กำลังเตรียม'}</p>
      <button disabled={state.loading} onClick={() => operation.retry().catch(() => {})}>ลองรายการเดิมอีกครั้ง</button></>}
  </div>;
}
export function InventoryWorkflowForm({ task, api, role, userId, onClose, onSuccess }) {
  const [models, setModels] = useState([]); const [materials, setMaterials] = useState([]);
  const [catalogError, setCatalogError] = useState(null); const [catalogLoading, setCatalogLoading] = useState(task.kind === 'create');
  const [modelId, setModelId] = useState(''); const [orderRef, setOrderRef] = useState('');
  const [repair, setRepair] = useState(false); const [note, setNote] = useState('');
  const [subtype, setSubtype] = useState('อื่นๆ'); const [bom, setBom] = useState([{ material_id: '', qty: '1' }]);
  const [selected, setSelected] = useState([]); const [verified, setVerified] = useState(false);
  const [operation, setOperation] = useState(null); const operationRef = useRef(null);
  const [error, setError] = useState(null); const [done, setDone] = useState(false);
  useEffect(() => {
    if (task.kind !== 'create') return;
    let active = true;
    Promise.all([loadActiveModels(), api.list_materials()]).then(([mats, supplies]) => {
      if (active) { setModels(mats); setMaterials(supplies); }
    }).catch(e => { if (active) setCatalogError(e.message); }).finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [task.kind, api]);
  function submit(e) {
    e.preventDefault();
    if (operationRef.current) { operationRef.current.execute().catch(() => {}); return; }
    try {
      const input = task.kind === 'create' ? { model_id: modelId, order_ref: orderRef,
        repair_spec: repair ? { subtype, note, bom: bom.map(b => ({ material_id: b.material_id, qty: b.qty })) } : null }
        : task.kind === 'pick' ? { items: selected.map(line_id => ({ transaction_id: task.row.id, line_id })) }
        : { reason: note, legacy_return_verified: verified };
      const prepared = prepareWorkflow(api, task.kind, input, { role, userId, row: task.row });
      operationRef.current = prepared; setOperation(prepared); setError(null);
      prepared.execute().catch(() => {});
    } catch (e) { setError(workflowError(e)); }
  }
  return <section role="region" aria-label="ทำรายการ" style={{ border: '2px solid #888', padding: 16 }}>
    <h2>{task.kind === 'create' ? 'สร้างคำขอเบิก' : task.kind === 'pick' ? 'ยืนยันบรรทัดที่หยิบ' : 'ยกเลิกคำขอ'}</h2>
    {catalogLoading && <p role="status">กำลังโหลดรุ่นและวัตถุดิบ…</p>}
    {catalogError && <p role="alert">{catalogError} — ปิดแล้วเปิดแบบฟอร์มเพื่อลองโหลดใหม่</p>}
    <form onSubmit={submit}><fieldset disabled={Boolean(operation) || catalogLoading || Boolean(catalogError)}>
      {task.kind === 'create' && <>
        <label><input type="checkbox" checked={repair} onChange={e => setRepair(e.target.checked)} />งานซ่อมและอื่นๆ</label>
        <label>เลขออเดอร์<input required value={orderRef} onChange={e => setOrderRef(e.target.value)} /></label>
        {!repair ? <label>รุ่น<select required value={modelId} onChange={e => setModelId(e.target.value)}><option value="">เลือกรุ่น</option>
          {models.map(m => <option key={m.id} value={m.id}>{m.name} — {m.category}</option>)}</select></label>
          : <><label>ประเภทงานซ่อม<select value={subtype} onChange={e => setSubtype(e.target.value)}>{['CIEM','Lifestyle','Sleepplug','Tactical','อื่นๆ'].map(s => <option key={s}>{s}</option>)}</select></label>
            <label>หมายเหตุ<textarea required value={note} onChange={e => setNote(e.target.value)} /></label>
            {bom.map((b,i) => <div key={i}><select aria-label="วัตถุดิบซ่อม" required value={b.material_id} onChange={e => setBom(rows => rows.map((r,j) => i===j ? {...r,material_id:e.target.value} : r))}>
              <option value="">เลือกวัตถุดิบ</option>{materials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}</select>
              <input aria-label="จำนวนที่ขอซ่อม" type="number" step="any" min="0.000001" required value={b.qty} onChange={e => setBom(rows => rows.map((r,j) => i===j ? {...r,qty:e.target.value} : r))} /></div>)}
            <button type="button" onClick={() => setBom(rows => [...rows,{material_id:'',qty:'1'}])}>เพิ่มวัตถุดิบ</button></>}
      </>}
      {task.kind === 'pick' && manualPendingLines(task.row).map(line => <label key={line.line_id} style={{ display:'block' }}><input type="checkbox" checked={selected.includes(line.line_id)}
        onChange={e => setSelected(ids => e.target.checked ? [...ids,line.line_id] : ids.filter(id => id!==line.line_id))} />{line.material_name} {line.qty} {line.unit}</label>)}
      {task.kind === 'cancel' && <><p>ยกเลิก {task.row.order_ref} — server จะตรวจสิทธิ์และคืนยอดที่เกี่ยวข้องในรายการเดียว</p>
        <label>เหตุผล<textarea required value={note} onChange={e => setNote(e.target.value)} /></label>
        {role==='admin' && task.row.inventory_version===0 && Number(task.row.picked_lines)>0 && <label><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />ตรวจรับของคืนจริงสำหรับงานเก่าแล้ว (server ต้องอนุมัติโหมดนี้ด้วย)</label>}</>}
      <button type="submit">ยืนยัน</button>
    </fieldset></form>
    {error && <p role="alert">{error}</p>}
    {operation && <OperationResult operation={operation} onFailure={e => { operationRef.current=null;setOperation(null);setError(workflowError(e)+(e.code?' ['+e.code+']':'')); }} onSuccess={() => { setDone(true); onSuccess(); }} />}
    <button disabled={Boolean(operation) && !done} onClick={onClose}>{done ? 'ปิดรายการที่สำเร็จแล้ว' : 'ปิดแบบฟอร์ม'}</button>
    {operation && !done && <p>ยังไม่ยืนยันผล: ห้ามเปลี่ยน payload หรือสร้าง UUID ใหม่ ให้ลองรายการเดิมอีกครั้ง</p>}
  </section>;
}
