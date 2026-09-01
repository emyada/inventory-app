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

  async function produceUnit(model, orderRef, staffName, userId) {
    const shortages = model.bom.filter(b => (materialsById[b.material_id]?.qty ?? 0) < b.qty);
    if (shortages.length) {
      return { error: 'วัตถุดิบไม่พอ: ' + shortages.map(b => materialsById[b.material_id]?.name).join(', ') };
    }
    // Deduct stock
    for (const b of model.bom) {
      const m = materialsById[b.material_id];
      await supabase.from('materials').update({ qty: m.qty - b.qty }).eq('id', b.material_id);
    }
    const bomSnapshot = model.bom.map(b => ({
      material_id: b.material_id,
      material_name: materialsById[b.material_id]?.name || '',
      unit: materialsById[b.material_id]?.unit || '',
      qty: b.qty,
    }));
    await supabase.from('transactions').insert({
      model_id: model.id, model_name: model.name, category: model.category,
      order_ref: orderRef, staff_name: staffName, bom_snapshot: bomSnapshot, created_by: userId,
    });
    await supabase.from('stock_log').insert(bomSnapshot.map(b => ({
      type: 'out', material_id: b.material_id, material_name: b.material_name, unit: b.unit, amount: b.qty,
      order_ref: orderRef, staff_name: staffName, created_by: userId,
    })));
    await loadAll();
    return { error: null };
  }

  async function cancelTransaction(tx, userId) {
    for (const b of tx.bom_snapshot) {
      const m = materialsById[b.material_id];
      if (m) await supabase.from('materials').update({ qty: m.qty + b.qty }).eq('id', b.material_id);
    }
    await supabase.from('stock_log').insert(tx.bom_snapshot.map(b => ({
      type: 'in', material_id: b.material_id, material_name: b.material_name, unit: b.unit, amount: b.qty,
      order_ref: `ยกเลิก: ${tx.order_ref}`, staff_name: tx.staff_name, created_by: userId,
    })));
    await supabase.from('transactions').delete().eq('id', tx.id);
    await loadAll();
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
    produceUnit, cancelTransaction, saveMaterial, deleteMaterial, restock, saveModel, deleteModel, reload: loadAll,
  };
}
