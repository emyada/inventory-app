import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { todayStr } from '../theme';

export function useInventoryData(role) {
  const [materials, setMaterials] = useState([]);
  const [models, setModels] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [stockLog, setStockLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  useEffect(() => {
    const handleRealtimeChange = () => { if (!suppressRealtimeRef.current) loadAll(); };
    const channel = supabase
      .channel('inventory-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'models' }, handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'model_bom' }, handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_log' }, handleRealtimeChange)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [loadAll]);

  const materialsById = Object.fromEntries(materials.map(m => [m.id, m]));

  async function produceUnit(model, orderRef, staffName, userId, note = '') {
    suppressRealtimeRef.current = true;
    const isRepair = /ซ่อม/.test(model.category || '');
    if (!isRepair && model.id) {
      const { data: dupes } = await supabase.from('transactions').select('order_ref, model_name, created_at')
        .ilike('order_ref', orderRef.trim()).eq('model_id', model.id).limit(1);
      if (dupes && dupes.length > 0) {
        return { error: `รหัส/ชื่อลูกค้า "${orderRef.trim()}" เคยเบิกรุ่น "${dupes[0].model_name}" นี้ไปแล้วเมื่อ ${dupes[0].created_at.slice(0, 10)} — ถ้าเป็นออเดอร์เดียวกันแต่คนละรุ่น/ขั้นตอน ใช้รหัสนี้ต่อกับรุ่นอื่นได้ปกติ` };
      }
    }

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

  async function bulkPickMaterial(materialId, userId, onProgress, reload = true) {
    return await bulkPickMaterials([materialId], userId, onProgress);
  }

  // ✅ ปรับปรุง bulkPickMaterials: ตัดการ query ซ้ำ หายกริ๊บ หยุดกระพริบ 100%
  async function bulkPickMaterials(materialIds, userId, onProgress) {
    suppressRealtimeRef.current = true;
    const errors = [];
    try {
      if (!materialIds || materialIds.length === 0) {
        suppressRealtimeRef.current = false;
        return { errors: [] };
      }

      // ใช้ข้อมูลที่มีอยู่ใน state ปัจจุบันโดยไม่ยิง query ซ้ำ
      const affectedTxs = transactions.filter(t => 
        t.bom_snapshot.some(b => materialIds.includes(b.material_id) && !b.picked)
      );

      if (affectedTxs.length === 0) {
        suppressRealtimeRef.current = false;
        return { errors: [] };
      }

      const totalQtyToDeduct = {};
      const stockLogsToInsert = [];

      affectedTxs.forEach(tx => {
        tx.bom_snapshot.forEach(b => {
          if (materialIds.includes(b.material_id) && !b.picked) {
            totalQtyToDeduct[b.material_id] = (totalQtyToDeduct[b.material_id] || 0) + b.qty;
            stockLogsToInsert.push({
              type: 'out',
              material_id: b.material_id,
              material_name: b.material_name,
              unit: b.unit,
              amount: b.qty,
              order_ref: tx.order_ref,
              staff_name: tx.staff_name,
              created_by: userId,
            });
          }
        });
      });

      for (const mId of Object.keys(totalQtyToDeduct)) {
        const m = materialsById[mId];
        const needed = totalQtyToDeduct[mId];
        if (!m || m.qty < needed) {
          suppressRealtimeRef.current = false;
          return { errors: [`${m?.name || 'วัตถุดิบ'} ไม่พอในคลัง (มี ${m?.qty ?? 0}, ต้องการ ${needed})`] };
        }
      }

      // อัปเดต DB แบบยิงส่งคู่ขนานไปเลย
      const updatePromises = affectedTxs.map(tx => {
        const nextSnapshot = tx.bom_snapshot.map(b => 
          materialIds.includes(b.material_id) ? { ...b, picked: true } : b
        );
        return supabase.from('transactions').update({ bom_snapshot: nextSnapshot }).eq('id', tx.id);
      });

      await Promise.all(updatePromises);

      // ตัดสต็อกวัตถุดิบ
      for (const mId of Object.keys(totalQtyToDeduct)) {
        const m = materialsById[mId];
        const qtyToDeduct = totalQtyToDeduct[mId];
        await supabase.from('materials').update({ qty: m.qty - qtyToDeduct }).eq('id', mId);
      }

      if (stockLogsToInsert.length > 0) {
        await supabase.from('stock_log').insert(stockLogsToInsert);
      }

    } catch (err) {
      errors.push(err.message || 'เกิดข้อผิดพลาดในการเบิกวัตถุดิบ');
    }

    await loadAll();
    suppressRealtimeRef.current = false;
    return { errors };
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

  async function confirmReceivedBatch(items, onProgress) {
    suppressRealtimeRef.current = true;
    const errors = [];
    try {
      if (!items || items.length === 0) return { errors: [] };

      const itemsByTx = {};
      items.forEach(({ tx, materialId }) => {
        if (!itemsByTx[tx.id]) {
          itemsByTx[tx.id] = { tx, materialIds: [] };
        }
        itemsByTx[tx.id].materialIds.push(materialId);
      });

      const updatePromises = Object.keys(itemsByTx).map(txId => {
        const { tx, materialIds } = itemsByTx[txId];
        const nextSnapshot = tx.bom_snapshot.map(b => 
          materialIds.includes(b.material_id) ? { ...b, received: true } : b
        );
        return supabase.from('transactions').update({ bom_snapshot: nextSnapshot }).eq('id', txId);
      });

      await Promise.all(updatePromises);
    } catch (err) {
      errors.push(err.message || 'เกิดข้อผิดพลาดในการยืนยัน');
    }

    await loadAll();
    suppressRealtimeRef.current = false;
    return { errors };
  }

  async function cancelTransaction(tx, userId) {
    suppressRealtimeRef.current = true;
    const { data: deleted, error } = await supabase.from('transactions').delete().eq('id', tx.id).select();
    if (error || !deleted || deleted.length === 0) {
      return { error: 'ยกเลิกไม่สำเร็จ — อาจเกิน 30 นาทีแล้ว หรือไม่ใช่ออเดอร์ของคุณ ให้หัวหน้าช่างยกเลิกแทน' };
    }
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
    if (m.id) await supabase.from('materials').update({ name: m.name, unit: m.unit, qty: m.qty }).eq('id', m.id);
    else await supabase.from('materials').insert({ name: m.name, unit: m.unit, qty: m.qty });
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
  const lowStock = materials.filter(m => m.qty <= 2);

  return {
    loading, error, materials, models, transactions, stockLog, materialsById, todaysTx, lowStock,
    produceUnit, cancelTransaction, pickLine, unpickLine, bulkPickMaterial, bulkPickMaterials, confirmReceived, confirmReceivedBatch, saveMaterial, deleteMaterial, restock, saveModel, deleteModel, reload: loadAll,
  };
}
