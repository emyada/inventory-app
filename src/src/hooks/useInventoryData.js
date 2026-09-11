import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { todayStr } from '../theme';

export function useInventoryData(role) {
  const [materials, setMaterials] = useState([]);
  const [models, setModels] = useState([]); // { id, name, category, bom: [{material_id, qty}] }
  const [transactions, setTransactions] = useState([]);
  const [stockLog, setStockLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // While true, incoming realtime change events are ignored — set during any
  // local batch of writes (several DB calls in a row for one logical action)
  // so mid-batch realtime pings don't trigger a flurry of reloads/flicker.
  // The batch's own final loadAll() at the end is what actually refreshes.
  const suppressRealtimeRef = useRef(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: mats, error: e1 }, { data: mdls, error: e2 }, { data: boms, error: e3 }, { data: txs, error: e4 }] = await Promise.all([
        supabase.from('materials').select('*').order('name'),
        supabase.from('models').select('*').order('name'),
        supabase.from('model_bom').select('*'),
        supabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(1000),
      ]);
      if (e1 || e2 || e3 || e4) throw (e1 || e2 || e3 || e4);
      const bomByModel = {};
      (boms || []).forEach(b => { (bomByModel[b.model_id] = bomByModel[b.model_id] || []).push({ material_id: b.material_id, qty: b.qty }); });
      setMaterials(mats || []);
      setModels((mdls || []).map(m => ({ ...m, bom: bomByModel[m.id] || [] })));
      setTransactions(txs || []);

      // stock_log is admin-only per RLS — only fetch when the signed-in role can read it
      if (role === 'admin') {
        const { data: logs, error: e5 } = await supabase.from('stock_log').select('*').order('created_at', { ascending: false }).limit(2000);
        if (!e5) setStockLog(logs || []);
      } else {
        setStockLog([]);
      }
      setError(null);
    } catch (err) {
      setError(err.message || 'โหลดข้อมูลไม่สำเร็จ');
    }
    setLoading(false);
  }, [role]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Realtime was removed on purpose: a single reload updates several pieces
  // of state one after another (materials, models, transactions, stockLog),
  // and with realtime also firing its own reload on every intermediate DB
  // write during a batch action, the pick-queue/recheck screens flickered
  // rapidly per material. Manual refresh (the refresh button + pull-to-
  // refresh in the top bar) is what keeps other devices in sync now.

  const materialsById = Object.fromEntries(materials.map(m => [m.id, m]));

  async function produceUnit(model, orderRef, staffName, userId, note = '') {
    suppressRealtimeRef.current = true;
    // Duplicate check runs against the LIVE database (not local state) right
    // before inserting, so it catches duplicates against both open orders
    // and full history, and stays correct even if another device just
    // created the same code moments ago. Skipped entirely for the repair/
    // misc category, where reusing the same customer code is normal and
    // expected (repeat repair visits, R&D test withdrawals, etc). For every
    // other category, the same code is allowed across DIFFERENT models —
    // e.g. one person withdraws drivers under one CIEM model while another
    // withdraws packaging under a different model, same customer code — only
    // an exact repeat of the same code AND same model is blocked.
    const isRepair = /ซ่อม/.test(model.category || '');
    if (!isRepair && model.id) {
      const { data: dupes } = await supabase.from('transactions').select('order_ref, model_name, created_at')
        .ilike('order_ref', orderRef.trim()).eq('model_id', model.id).limit(1);
      if (dupes && dupes.length > 0) {
        return { error: `รหัส/ชื่อลูกค้า "${orderRef.trim()}" เคยเบิกรุ่น "${dupes[0].model_name}" นี้ไปแล้วเมื่อ ${dupes[0].created_at.slice(0, 10)} — ถ้าเป็นออเดอร์เดียวกันแต่คนละรุ่น/ขั้นตอน ใช้รหัสนี้ต่อกับรุ่นอื่นได้ปกติ` };
      }
    }

    // This now only files a REQUEST — nothing is deducted yet. The stock lead
    // picks each material line individually (pickLine) once it's physically
    // handed over, and that's the moment stock actually gets deducted.
    const bomSnapshot = (model.bom || []).map(b => ({
      material_id: b.material_id,
      material_name: materialsById[b.material_id]?.name || '',
      unit: materialsById[b.material_id]?.unit || '',
      qty: b.qty,
      picked: false,
      received: false,
    }));
    const { error } = await supabase.from('transactions').insert({
      model_id: model.id || null, model_name: model.name, category: model.category,
      order_ref: orderRef, staff_name: staffName, bom_snapshot: bomSnapshot, created_by: userId, note,
    });
    if (error) {
      // 23505 = unique_violation — the DB-level safety net catching a race
      // condition (two people submitting the same code at the exact same
      // moment), just in case the pre-check above was juuust missed.
      if (error.code === '23505') return { error: `รหัส/ชื่อลูกค้า "${orderRef.trim()}" เพิ่งถูกใช้ไปแล้วเมื่อครู่นี้ — กรุณาใช้รหัสอื่น` };
      return { error: error.message };
    }
    await loadAll();
    suppressRealtimeRef.current = false;
    return { error: null };
  }

  async function pickLine(tx, materialId, userId) {
    suppressRealtimeRef.current = true;
    const line = tx.bom_snapshot.find(b => b.material_id === materialId);
    if (!line || line.picked) return { error: null };
    const m = materialsById[materialId];
    if (!m || m.qty < line.qty) {
      return { error: `${line.material_name} ไม่พอในคลัง (มี ${m?.qty ?? 0} ${line.unit}, ต้องการ ${line.qty})` };
    }
    const nextSnapshot = tx.bom_snapshot.map(b => b.material_id === materialId ? { ...b, picked: true } : b);
    const { data: updated, error } = await supabase.from('transactions').update({ bom_snapshot: nextSnapshot }).eq('id', tx.id).select();
    if (error || !updated || updated.length === 0) {
      return { error: 'บันทึกไม่สำเร็จ (สิทธิ์ไม่พอ หรือมีปัญหาการเชื่อมต่อ)' };
    }
    await supabase.from('materials').update({ qty: m.qty - line.qty }).eq('id', materialId);
    await supabase.from('stock_log').insert({
      type: 'out', material_id: materialId, material_name: line.material_name, unit: line.unit, amount: line.qty,
      order_ref: tx.order_ref, staff_name: tx.staff_name, created_by: userId,
    });
    await loadAll();
    suppressRealtimeRef.current = false;
    return { error: null };
  }

  // Batch version: stage many materials in the UI, then confirm ALL of them
  // in one action. Rewritten to fix a real bug — writing one material at a
  // time to the same order's bom_snapshot column was overwriting earlier
  // writes to OTHER materials on that same order (each write recomputed the
  // whole column from a stale pre-batch snapshot). Now every staged change
  // is merged in memory FIRST, then each affected order is written to the
  // database exactly once with its fully-combined result.
  async function bulkPickMaterials(materialIds, userId, onProgress) {
    suppressRealtimeRef.current = true;
    const idSet = new Set(materialIds);
    const affectedTx = transactions.filter(t => t.bom_snapshot.some(b => idSet.has(b.material_id) && !b.picked));

    // Check stock is sufficient for the combined total needed per material
    // across every affected order, before writing anything.
    const neededByMaterial = {};
    affectedTx.forEach(t => {
      t.bom_snapshot.forEach(b => {
        if (idSet.has(b.material_id) && !b.picked) neededByMaterial[b.material_id] = (neededByMaterial[b.material_id] || 0) + b.qty;
      });
    });
    const errors = [];
    for (const [materialId, needed] of Object.entries(neededByMaterial)) {
      const m = materialsById[materialId];
      if (!m || m.qty < needed) errors.push(`${m?.name ?? materialId} ไม่พอในคลัง (มี ${m?.qty ?? 0}, ต้องการรวม ${needed})`);
    }
    if (errors.length) { suppressRealtimeRef.current = false; return { errors }; }

    // Merge in memory: one fully-updated bom_snapshot per affected order.
    const updatedSnapshots = {};
    affectedTx.forEach(t => {
      updatedSnapshots[t.id] = t.bom_snapshot.map(b => (idSet.has(b.material_id) && !b.picked) ? { ...b, picked: true } : b);
    });

    let done = 0;
    for (const t of affectedTx) {
      await supabase.from('transactions').update({ bom_snapshot: updatedSnapshots[t.id] }).eq('id', t.id);
      done++; onProgress?.(done, affectedTx.length);
    }
    for (const [materialId, needed] of Object.entries(neededByMaterial)) {
      const m = materialsById[materialId];
      await supabase.from('materials').update({ qty: m.qty - needed }).eq('id', materialId);
    }
    const logRows = [];
    affectedTx.forEach(t => {
      t.bom_snapshot.forEach(b => {
        if (idSet.has(b.material_id) && !b.picked) {
          logRows.push({ type: 'out', material_id: b.material_id, material_name: b.material_name, unit: b.unit, amount: b.qty, order_ref: t.order_ref, staff_name: t.staff_name, created_by: userId });
        }
      });
    });
    if (logRows.length) await supabase.from('stock_log').insert(logRows);

    await loadAll();
    suppressRealtimeRef.current = false;
    return { errors: [] };
  }

  async function unpickLine(tx, materialId, userId) {
    suppressRealtimeRef.current = true;
    const line = tx.bom_snapshot.find(b => b.material_id === materialId);
    if (!line || !line.picked) return { error: null };
    const nextSnapshot = tx.bom_snapshot.map(b => b.material_id === materialId ? { ...b, picked: false } : b);
    const { data: updated, error } = await supabase.from('transactions').update({ bom_snapshot: nextSnapshot }).eq('id', tx.id).select();
    if (error || !updated || updated.length === 0) {
      return { error: 'ยกเลิกไม่สำเร็จ (สิทธิ์ไม่พอ หรือมีปัญหาการเชื่อมต่อ)' };
    }
    const m = materialsById[materialId];
    if (m) await supabase.from('materials').update({ qty: m.qty + line.qty }).eq('id', materialId);
    await supabase.from('stock_log').insert({
      type: 'in', material_id: materialId, material_name: line.material_name, unit: line.unit, amount: line.qty,
      order_ref: `ยกเลิกการหยิบ: ${tx.order_ref}`, staff_name: tx.staff_name, created_by: userId,
    });
    await loadAll();
    suppressRealtimeRef.current = false;
    return { error: null };
  }

  // Staff-side confirmation that they physically received this line — a
  // second, independent checklist from the stock lead's "picked" one. Doesn't
  // touch stock or logs at all; it's purely a cross-check to catch mistakes
  // on either side (wrong item handed over, wrong quantity counted, etc).
  async function confirmReceived(tx, materialId, reload = true) {
    const line = tx.bom_snapshot.find(b => b.material_id === materialId);
    if (!line || line.received) return { error: null };
    const nextSnapshot = tx.bom_snapshot.map(b => b.material_id === materialId ? { ...b, received: true } : b);
    const { data: updated, error } = await supabase.from('transactions').update({ bom_snapshot: nextSnapshot }).eq('id', tx.id).select();
    if (error || !updated || updated.length === 0) {
      return { error: 'ยืนยันไม่สำเร็จ (สิทธิ์ไม่พอ หรือมีปัญหาการเชื่อมต่อ)' };
    }
    if (reload) await loadAll();
    return { error: null };
  }

  // Batch version — same fix as bulkPickMaterials: group the staged items by
  // ORDER first, merge every material being confirmed for that order in
  // memory, then write each order's transaction row exactly once. Writing
  // one material at a time per order was overwriting earlier materials
  // confirmed on that same order.
  async function confirmReceivedBatch(items, onProgress) {
    suppressRealtimeRef.current = true;
    const byTx = {}; // txId -> { tx, materialIds: Set }
    items.forEach(({ tx, materialId }) => {
      if (!byTx[tx.id]) byTx[tx.id] = { tx, materialIds: new Set() };
      byTx[tx.id].materialIds.add(materialId);
    });
    const groups = Object.values(byTx);
    let done = 0;
    for (const { tx, materialIds } of groups) {
      const nextSnapshot = tx.bom_snapshot.map(b => materialIds.has(b.material_id) ? { ...b, received: true } : b);
      await supabase.from('transactions').update({ bom_snapshot: nextSnapshot }).eq('id', tx.id);
      done++; onProgress?.(done, groups.length);
    }
    await loadAll();
    suppressRealtimeRef.current = false;
    return { errors: [] };
  }

  async function cancelTransaction(tx, userId) {
    suppressRealtimeRef.current = true;
    // Delete first and check what actually got removed — RLS silently allows a
    // delete call to "succeed" with zero rows affected if the policy blocks it
    // (e.g. a staff member's 30-minute self-cancel window has expired, or it's
    // not their own order). Only restore stock if the row was truly deleted,
    // otherwise we'd double-count materials while the order stays on record.
    const { data: deleted, error } = await supabase.from('transactions').delete().eq('id', tx.id).select();
    if (error || !deleted || deleted.length === 0) {
      return { error: 'ยกเลิกไม่สำเร็จ — อาจเกิน 30 นาทีแล้ว หรือไม่ใช่ออเดอร์ของคุณ ให้หัวหน้าช่างยกเลิกแทน' };
    }
    // Only lines that were already picked actually deducted stock — only those need restoring.
    const pickedLines = tx.bom_snapshot.filter(b => b.picked);
    for (const b of pickedLines) {
      const m = materialsById[b.material_id];
      if (m) await supabase.from('materials').update({ qty: m.qty + b.qty }).eq('id', b.material_id);
    }
    if (pickedLines.length) {
      await supabase.from('stock_log').insert(pickedLines.map(b => ({
        type: 'in', material_id: b.material_id, material_name: b.material_name, unit: b.unit, amount: b.qty,
        order_ref: `ยกเลิก: ${tx.order_ref}`, staff_name: tx.staff_name, created_by: userId,
      })));
    }
    await loadAll();
    suppressRealtimeRef.current = false;
    return { error: null };
  }

  async function saveMaterial(m) {
    suppressRealtimeRef.current = true;
    const payload = { name: m.name, unit: m.unit, qty: m.qty, low_stock_threshold: m.low_stock_threshold ?? 2 };
    if (m.id) await supabase.from('materials').update(payload).eq('id', m.id);
    else await supabase.from('materials').insert(payload);
    await loadAll();
    suppressRealtimeRef.current = false;
  }
  async function deleteMaterial(id) {
    suppressRealtimeRef.current = true;
    await supabase.from('materials').delete().eq('id', id);
    await loadAll();
    suppressRealtimeRef.current = false;
  }
  async function restock(materialId, amount, userId, staffName) {
    suppressRealtimeRef.current = true;
    const m = materialsById[materialId];
    await supabase.from('materials').update({ qty: m.qty + amount }).eq('id', materialId);
    await supabase.from('stock_log').insert({
      type: 'in', material_id: materialId, material_name: m.name, unit: m.unit, amount,
      order_ref: 'ซื้อเข้า', staff_name: staffName, created_by: userId,
    });
    await loadAll();
    suppressRealtimeRef.current = false;
  }

  async function saveModel(model) {
    suppressRealtimeRef.current = true;
    let modelId = model.id;
    if (modelId) {
      await supabase.from('models').update({ name: model.name, category: model.category }).eq('id', modelId);
      await supabase.from('model_bom').delete().eq('model_id', modelId);
    } else {
      const { data, error } = await supabase.from('models').insert({ name: model.name, category: model.category }).select().single();
      if (error) return { error: error.message };
      modelId = data.id;
    }
    if (model.bom.length) {
      await supabase.from('model_bom').insert(model.bom.map(b => ({ model_id: modelId, material_id: b.material_id, qty: b.qty })));
    }
    await loadAll();
    suppressRealtimeRef.current = false;
    return { error: null };
  }
  async function deleteModel(id) {
    suppressRealtimeRef.current = true;
    await supabase.from('models').delete().eq('id', id);
    await loadAll();
    suppressRealtimeRef.current = false;
  }

  const today = todayStr();
  const todaysTx = transactions.filter(t => t.created_at?.slice(0, 10) === today);
  const lowStock = materials.filter(m => m.qty <= (m.low_stock_threshold ?? 2));

  return {
    loading, error, materials, models, transactions, stockLog, materialsById, todaysTx, lowStock,
    produceUnit, cancelTransaction, pickLine, unpickLine, bulkPickMaterials, confirmReceived, confirmReceivedBatch, saveMaterial, deleteMaterial, restock, saveModel, deleteModel, reload: loadAll,
  };
}
