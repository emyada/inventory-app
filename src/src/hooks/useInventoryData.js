import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { todayStr } from '../theme';

export function useInventoryData(role) {
  const [materials, setMaterials] = useState([]);
  const [models, setModels] = useState([]); // { id, name, category, bom: [{material_id, qty}] }
  const [transactions, setTransactions] = useState([]);
  const [stockLog, setStockLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  // Realtime: any device's change refreshes everyone else automatically.
  useEffect(() => {
    const channel = supabase
      .channel('inventory-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'models' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'model_bom' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_log' }, loadAll)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [loadAll]);

  const materialsById = Object.fromEntries(materials.map(m => [m.id, m]));

  async function produceUnit(model, orderRef, staffName, userId, note = '') {
    // Duplicate check runs against the LIVE database (not local state) right
    // before inserting, so it catches duplicates against both open orders
    // and full history, and stays correct even if another device just
    // created the same code moments ago.
    const { data: dupes } = await supabase.from('transactions').select('order_ref, created_at').ilike('order_ref', orderRef.trim()).limit(1);
    if (dupes && dupes.length > 0) {
      return { error: `รหัส/ชื่อลูกค้า "${orderRef.trim()}" มีอยู่ในระบบแล้ว (เคยเบิกไว้เมื่อ ${dupes[0].created_at.slice(0, 10)}) — กรุณาใช้รหัสอื่น` };
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
    return { error: null };
  }

  async function pickLine(tx, materialId, userId) {
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
    return { error: null };
  }

  // One tick marks a material picked across EVERY open order that still needs
  // it — instead of ticking the same material once per order. Still writes a
  // separate stock_log line per order underneath, so month-end reconciliation
  // against the master plan stays accurate down to the individual order code.
  async function bulkPickMaterial(materialId, userId, onProgress, reload = true) {
    const affected = transactions.filter(t => t.bom_snapshot.some(b => b.material_id === materialId && !b.picked));
    if (affected.length === 0) return { error: null };
    const lines = affected.map(t => ({ tx: t, line: t.bom_snapshot.find(b => b.material_id === materialId) }));
    const totalQty = lines.reduce((s, { line }) => s + line.qty, 0);
    const m = materialsById[materialId];
    if (!m || m.qty < totalQty) {
      return { error: `${lines[0].line.material_name} ไม่พอในคลัง (มี ${m?.qty ?? 0} ${lines[0].line.unit}, ต้องการรวม ${totalQty})` };
    }
    let done = 0;
    for (const { tx, line } of lines) {
      const nextSnapshot = tx.bom_snapshot.map(b => b.material_id === materialId ? { ...b, picked: true } : b);
      await supabase.from('transactions').update({ bom_snapshot: nextSnapshot }).eq('id', tx.id);
      done++; onProgress?.(done, lines.length);
      void line;
    }
    await supabase.from('materials').update({ qty: m.qty - totalQty }).eq('id', materialId);
    await supabase.from('stock_log').insert(lines.map(({ tx, line }) => ({
      type: 'out', material_id: materialId, material_name: line.material_name, unit: line.unit, amount: line.qty,
      order_ref: tx.order_ref, staff_name: tx.staff_name, created_by: userId,
    })));
    if (reload) await loadAll();
    return { error: null };
  }

  // Batch version: stage many materials in the UI, then confirm ALL of them
  // in one action — only reloads/re-renders ONCE at the end instead of once
  // per tick, so the screen doesn't jump around while ticking things off.
  async function bulkPickMaterials(materialIds, userId, onProgress) {
    const errors = [];
    let done = 0;
    for (const materialId of materialIds) {
      const { error } = await bulkPickMaterial(materialId, userId, null, false);
      if (error) errors.push(error);
      done++; onProgress?.(done, materialIds.length);
    }
    await loadAll();
    return { errors };
  }

  async function unpickLine(tx, materialId, userId) {
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

  // Batch version, same idea as bulkPickMaterials: stage several confirmations
  // in the UI, submit them all in one action, one reload at the end.
  async function confirmReceivedBatch(items, onProgress) {
    const errors = [];
    let done = 0;
    for (const { tx, materialId } of items) {
      const { error } = await confirmReceived(tx, materialId, false);
      if (error) errors.push(error);
      done++; onProgress?.(done, items.length);
    }
    await loadAll();
    return { errors };
  }

  async function cancelTransaction(tx, userId) {
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
    return { error: null };
  }

  async function saveMaterial(m) {
    if (m.id) await supabase.from('materials').update({ name: m.name, unit: m.unit, qty: m.qty }).eq('id', m.id);
    else await supabase.from('materials').insert({ name: m.name, unit: m.unit, qty: m.qty });
    await loadAll();
  }
  async function deleteMaterial(id) {
    await supabase.from('materials').delete().eq('id', id);
    await loadAll();
  }
  async function restock(materialId, amount, userId, staffName) {
    const m = materialsById[materialId];
    await supabase.from('materials').update({ qty: m.qty + amount }).eq('id', materialId);
    await supabase.from('stock_log').insert({
      type: 'in', material_id: materialId, material_name: m.name, unit: m.unit, amount,
      order_ref: 'ซื้อเข้า', staff_name: staffName, created_by: userId,
    });
    await loadAll();
  }

  async function saveModel(model) {
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
    return { error: null };
  }
  async function deleteModel(id) {
    await supabase.from('models').delete().eq('id', id);
    await loadAll();
  }

  const today = todayStr();
  const todaysTx = transactions.filter(t => t.created_at?.slice(0, 10) === today);
  const lowStock = materials.filter(m => m.qty <= 2);

  return {
    loading, error, materials, models, transactions, stockLog, materialsById, todaysTx, lowStock,
    produceUnit, cancelTransaction, pickLine, unpickLine, bulkPickMaterial, bulkPickMaterials, confirmReceived, confirmReceivedBatch, saveMaterial, deleteMaterial, restock, saveModel, deleteModel, reload: loadAll,
  };
}
