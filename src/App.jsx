import React, { useEffect, useRef, useState } from 'react';
import { Package, Settings, ClipboardList, AlertTriangle, LogOut, SlidersHorizontal, Undo2, ListChecks, ClipboardCheck, RefreshCw, PackagePlus } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { useInventoryData } from './hooks/useInventoryData';
import { supabase } from './lib/supabaseClient';
import { C, sans, mono, CATEGORIES, REPAIR_LABEL, btnPrimary } from './theme';
import Login from './components/Login';
import { Modal } from './components/Modal';
import { ProduceForm } from './components/ProduceForm';
import { MaterialForm } from './components/MaterialForm';
import { RestockForm } from './components/RestockForm';
import { ModelForm } from './components/ModelForm';
import { RepairRequestForm } from './components/RepairRequestForm';
import { FloorView } from './views/FloorView';
import { StockView } from './views/StockView';
import { ReportView } from './views/ReportView';
import { PickQueueView } from './views/PickQueueView';
import { RecheckView } from './views/RecheckView';
import { SettingsView } from './views/SettingsView';

export default function App() {
  const { session, profile, role, loading: authLoading, signOut } = useAuth();

  if (authLoading) return <CenteredMsg text="กำลังตรวจสอบการเข้าสู่ระบบ..." />;
  if (!session) return <Login />;
  return <Workspace profile={profile} role={role} signOut={signOut} userId={session.user.id} />;
}

function CenteredMsg({ text }) {
  return (
    <div style={{ ...sans, background: C.bg, color: C.textDim, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{text}</div>
  );
}

function Workspace({ profile, role, signOut, userId }) {
  const inv = useInventoryData(role);
  const [activeCat, setActiveCat] = useState('CIEM');
  const [view, setView] = useState('floor'); // floor | stock | report | settings
  const [toast, setToast] = useState(null);
  const [produceModel, setProduceModel] = useState(null);
  const [cancelTx, setCancelTx] = useState(null);
  const [editingMaterial, setEditingMaterial] = useState(null);
  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [restockMaterial, setRestockMaterial] = useState(null);
  const [editingModel, setEditingModel] = useState(null);
  const [showRepairForm, setShowRepairForm] = useState(false);
  const [showLowStock, setShowLowStock] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [pullDist, setPullDist] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef(null);
  const touchStartY = useRef(null);
  const PULL_THRESHOLD = 60;
  const PULL_MAX = 90;

  const showToast = (msg, tone = 'ok') => { setToast({ msg, tone }); setTimeout(() => setToast(null), 3500); };

  // --------------------------------------------------------------------------
  // 🟢 เพิ่ม: ฟังก์ชันเช็กชื่อออเดอร์/รหัสลูกค้าซ้ำสดๆ จาก Supabase
  // --------------------------------------------------------------------------
  async function checkDuplicateOrder(orderRef) {
    if (!orderRef) return null;
    const cleanRef = orderRef.trim();
    
    // ค้นหาในฐานข้อมูลว่ามี order_ref นี้หรือยัง
    const { data } = await supabase
      .from('transactions')
      .select('order_ref, created_at')
      .eq('order_ref', cleanRef)
      .maybeSingle();

    if (data) {
      const dateStr = data.created_at ? new Date(data.created_at).toLocaleDateString('th-TH') : '';
      return `รหัส/ชื่อลูกค้า "${cleanRef}" ซ้ำ! (เคยเบิกไปแล้วเมื่อ ${dateStr})`;
    }
    return null;
  }

  async function handleManualRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    await inv.reload();
    setRefreshing(false);
    showToast('อัปเดตข้อมูลแล้ว', 'ok');
  }
  function handleTouchStart(e) {
    if (scrollRef.current && scrollRef.current.scrollTop === 0) touchStartY.current = e.touches[0].clientY;
  }
  function handleTouchMove(e) {
    if (touchStartY.current === null) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0 && scrollRef.current && scrollRef.current.scrollTop === 0) {
      setPullDist(Math.min(delta * 0.5, PULL_MAX));
    }
  }
  async function handleTouchEnd() {
    if (touchStartY.current === null) return;
    touchStartY.current = null;
    if (pullDist >= PULL_THRESHOLD) {
      setRefreshing(true);
      await inv.reload();
      setRefreshing(false);
    }
    setPullDist(0);
  }

  useEffect(() => {
    supabase.from('app_settings').select('*').eq('key', 'sheets_webhook_url').maybeSingle()
      .then(({ data }) => { if (data) setWebhookUrl(data.value); });
  }, []);

  async function saveWebhook(url) {
    setWebhookUrl(url);
    await supabase.from('app_settings').upsert({ key: 'sheets_webhook_url', value: url });
  }

  useEffect(() => { if (role !== 'admin' && view === 'report') setView('floor'); }, [role, view]);
  useEffect(() => { if (role !== 'admin' && view === 'settings') setView('floor'); }, [role, view]);
  useEffect(() => { if (role === 'staff' && view === 'stock') setView('floor'); }, [role, view]);
  useEffect(() => { if (role !== 'staff' && view === 'recheck') setView('floor'); }, [role, view]);
  useEffect(() => { if (role !== 'admin' && view === 'pick') setView('floor'); }, [role, view]);

  // --------------------------------------------------------------------------
  // 🟢 ปรับปรุง: เพิ่มระบบดักซ้ำตรง handleProduce, handleProduceBatch และ handleRepairRequest
  // --------------------------------------------------------------------------
  async function handleProduce(model, orderRef, staffName) {
    const dupError = await checkDuplicateOrder(orderRef);
    if (dupError) {
      showToast(dupError, 'warn');
      return;
    }

    const { error } = await inv.produceUnit(model, orderRef, staffName, userId);
    if (error) showToast(error, 'warn');
    else { showToast(`บันทึกผลิต ${model.name} — ออเดอร์ ${orderRef} แล้ว`, 'ok'); setProduceModel(null); }
  }

  async function handleProduceBatch(model, codes, staffName, onProgress) {
    const failed = [];
    for (let i = 0; i < codes.length; i++) {
      const dupError = await checkDuplicateOrder(codes[i]);
      if (dupError) {
        failed.push(`${codes[i]} (ชื่อซ้ำ)`);
        onProgress?.(i + 1);
        continue;
      }

      const { error } = await inv.produceUnit(model, codes[i], staffName, userId);
      if (error) failed.push(codes[i]);
      onProgress?.(i + 1);
    }
    if (failed.length === 0) {
      showToast(`ส่งคำขอ ${codes.length} ออเดอร์เรียบร้อยแล้ว`, 'ok');
    } else {
      showToast(`สำเร็จ ${codes.length - failed.length}/${codes.length} — ล้มเหลว: ${failed.join(', ')}`, 'warn');
    }
    setProduceModel(null);
  }

  async function handleRepairRequest({ orderRef, subType, note, staffName, bom }) {
    const dupError = await checkDuplicateOrder(orderRef);
    if (dupError) {
      showToast(dupError, 'warn');
      return;
    }

    const pseudoModel = { id: null, name: subType, category: REPAIR_LABEL, bom };
    const { error } = await inv.produceUnit(pseudoModel, orderRef, staffName, userId, note);
    if (error) showToast(error, 'warn');
    else { showToast(`ส่งคำขอเบิก (ซ่อม) — ${orderRef} แล้ว`, 'ok'); setShowRepairForm(false); }
  }

  async function handleCancel(tx) {
    const { error } = await inv.cancelTransaction(tx, userId);
    if (error) showToast(error, 'warn');
    else showToast(`ยกเลิกออเดอร์ ${tx.order_ref} แล้ว — คืนวัตถุดิบเข้าคลัง`, 'ok');
    setCancelTx(null);
  }
  async function handleBulkPickBatch(materialIds) {
    return inv.bulkPickMaterials(materialIds, userId);
  }
  async function handleConfirmReceivedBatch(items) {
    return inv.confirmReceivedBatch(items);
  }
  async function handleSaveMaterial(m) {
    await inv.saveMaterial(m);
    setEditingMaterial(null); setShowAddMaterial(false);
    showToast(m.id ? 'บันทึกการแก้ไขแล้ว' : `เพิ่ม ${m.name} เข้าคลังแล้ว`, 'ok');
  }
  async function handleRestock(materialId, amount, staffName) {
    await inv.restock(materialId, amount, userId, staffName);
    setRestockMaterial(null);
    showToast(`รับเข้าคลังแล้ว +${amount}`, 'ok');
  }
  async function handleSaveModel(model) {
    const { error } = await inv.saveModel(model);
    if (error) { showToast(error, 'warn'); return; }
    setEditingModel(null);
    showToast(model.id ? `บันทึกการแก้ไข ${model.name} แล้ว` : `เพิ่มรุ่น ${model.name} แล้ว`, 'ok');
  }
  async function handleDeleteModel(id) {
    await inv.deleteModel(id);
    setEditingModel(null);
    showToast('ลบรุ่นแล้ว', 'ok');
  }

  if (inv.loading) return <CenteredMsg text="กำลังโหลดข้อมูลสต๊อก..." />;

  const navItems = role === 'admin'
    ? [{ key: 'floor', label: 'ผลิต', icon: Package }, { key: 'pick', label: 'คิวเบิก', icon: ListChecks }, { key: 'stock', label: 'คลัง', icon: Settings }, { key: 'report', label: 'รายงาน', icon: ClipboardList }]
    : role === 'purchasing'
      ? [{ key: 'stock', label: 'คลัง', icon: Settings }]
      : [{ key: 'floor', label: 'ผลิต', icon: Package }, { key: 'recheck', label: 'เช็ครับของ', icon: ClipboardCheck }]; // staff: no stock tab

  const modelsInCat = inv.models.filter(m => m.category === activeCat);

  return (
    <div style={{ ...sans, background: C.bg, color: C.text, minHeight: '100vh', display: 'flex', justifyContent: 'center' }}>
      <div className="app-shell" style={{ display: 'flex', flexDirection: 'column', position: 'relative', boxSizing: 'border-box', overflow: 'hidden' }}>
        {/* Top bar */}
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.line}`, background: C.panel, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: C.amber, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Package size={14} color={C.bg} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>ห้องคลัง — IEM Workshop</div>
              <div style={{ fontSize: 10.5, color: C.textDim, ...mono }}>{profile?.full_name} · {role === 'admin' ? 'หัวหน้าช่าง' : role === 'purchasing' ? 'จัดซื้อ' : 'ทีมผลิต'}</div>
            </div>
            {role === 'admin' && (
              <button onClick={() => setView('settings')} style={{ background: 'none', border: `1px solid ${C.line}`, borderRadius: 8, padding: 6, color: C.textDim, cursor: 'pointer' }}>
                <SlidersHorizontal size={14} />
              </button>
            )}
            <button onClick={handleManualRefresh} disabled={refreshing} title="รีเฟรชข้อมูล"
              style={{ background: 'none', border: `1px solid ${C.line}`, borderRadius: 8, padding: 6, color: C.textDim, cursor: 'pointer' }}>
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <button onClick={signOut} style={{ background: 'none', border: `1px solid ${C.line}`, borderRadius: 8, padding: 6, color: C.textDim, cursor: 'pointer' }}>
              <LogOut size={14} />
            </button>
          </div>
          {inv.lowStock.length > 0 && (
            <button onClick={() => setShowLowStock(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.red, background: 'rgba(217,119,87,0.12)', padding: '5px 9px', borderRadius: 20, marginTop: 8, width: 'fit-content', border: 'none', cursor: 'pointer' }}>
              <AlertTriangle size={12} /> ของใกล้หมด {inv.lowStock.length} รายการ
            </button>
          )}
          {view === 'floor' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {CATEGORIES.map(cat => (
                <button key={cat} onClick={() => setActiveCat(cat)}
                  style={{ padding: '6px 12px', borderRadius: 20, border: `1px solid ${activeCat === cat ? C.amber : C.line}`, cursor: 'pointer', fontSize: 12, fontWeight: activeCat === cat ? 700 : 500, background: activeCat === cat ? 'rgba(232,163,61,0.14)' : 'transparent', color: activeCat === cat ? C.amber : C.textDim }}>
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main content */}
        <div ref={scrollRef} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
          style={{ flex: 1, overflowY: 'auto', padding: 14, boxSizing: 'border-box', position: 'relative' }}>
          {(pullDist > 0 || refreshing) && (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', justifyContent: 'center', paddingTop: 4, height: refreshing ? 36 : pullDist, overflow: 'hidden', transition: refreshing ? 'height 0.15s' : 'none' }}>
              <RefreshCw size={18} color={C.textDim} className={refreshing ? 'animate-spin' : ''}
                style={{ transform: refreshing ? 'none' : `rotate(${Math.min(pullDist / PULL_THRESHOLD, 1) * 360}deg)`, opacity: Math.min(pullDist / PULL_THRESHOLD, 1) }} />
            </div>
          )}
          {view === 'floor' && (
            <FloorView category={activeCat} models={modelsInCat} materialsById={inv.materialsById}
              onProduce={setProduceModel} role={role} onAddModel={() => setEditingModel('new')} onEditModel={setEditingModel}
              onRepairRequest={() => setShowRepairForm(true)} />
          )}
          {view === 'pick' && role === 'admin' && (
            <PickQueueView transactions={inv.transactions} materialsById={inv.materialsById} onBulkPickBatch={handleBulkPickBatch} />
          )}
          {view === 'recheck' && role === 'staff' && (
            <RecheckView transactions={inv.transactions} userId={userId} onConfirmBatch={handleConfirmReceivedBatch} onCancel={setCancelTx} />
          )}
          {view === 'stock' && (
            <StockView materials={inv.materials} stockLog={inv.stockLog} transactions={inv.transactions} role={role}
              onEdit={setEditingMaterial} onAdd={() => setShowAddMaterial(true)} onRestock={setRestockMaterial} sheetsWebhookUrl={webhookUrl} />
          )}
          {view === 'report' && role === 'admin' && (
            <ReportView transactions={inv.transactions} onCancel={setCancelTx} sheetsWebhookUrl={webhookUrl} />
          )}
          {view === 'settings' && role === 'admin' && (
            <SettingsView webhookUrl={webhookUrl} onSaveWebhook={saveWebhook} />
          )}
        </div>

        {/* Bottom nav */}
        <div style={{ display: 'flex', borderTop: `1px solid ${C.line}`, background: C.panel, flexShrink: 0 }}>
          {navItems.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setView(key)}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '9px 4px', background: 'none', border: 'none', cursor: 'pointer', color: view === key ? C.amber : C.textDim, fontWeight: view === key ? 700 : 500 }}>
              <Icon size={17} /><span style={{ fontSize: 10.5 }}>{label}</span>
            </button>
          ))}
        </div>

        {/* Modals */}
        {produceModel && <ProduceForm model={produceModel} materialsById={inv.materialsById} onConfirm={handleProduce} onConfirmBatch={handleProduceBatch} onClose={() => setProduceModel(null)} />}

        {showRepairForm && (
          <RepairRequestForm materials={inv.materials} onConfirm={handleRepairRequest} onClose={() => setShowRepairForm(false)} />
        )}

        {showLowStock && (
          <Modal onClose={() => setShowLowStock(false)} title={`ของใกล้หมด (${inv.lowStock.length} รายการ)`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
              {inv.lowStock.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 9, padding: '9px 10px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                    <div style={{ ...mono, fontSize: 12, color: C.red, fontWeight: 700, marginTop: 2 }}>
                      เหลือ {m.qty} {m.unit} <span style={{ color: C.textDim, fontWeight: 400 }}>(เกณฑ์ ≤ {m.low_stock_threshold ?? 2})</span>
                    </div>
                  </div>
                  <button onClick={() => { setShowLowStock(false); setRestockMaterial(m); }}
                    style={{ background: 'rgba(63,167,150,0.14)', border: `1px solid ${C.teal}`, borderRadius: 8, padding: '7px 10px', cursor: 'pointer', color: C.teal, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <PackagePlus size={14} />
                  </button>
                </div>
              ))}
            </div>
          </Modal>
        )}

        {cancelTx && (
          <Modal onClose={() => setCancelTx(null)} title={`ยกเลิกออเดอร์ — ${cancelTx.order_ref}`}>
            <div style={{ fontSize: 12.5, color: C.textDim, marginBottom: 10 }}>
              รุ่น <b style={{ color: C.text }}>{cancelTx.model_name}</b> · ผู้กดผลิต <b style={{ color: C.text }}>{cancelTx.staff_name}</b>
            </div>
            <div style={{ fontSize: 12.5, marginBottom: 10 }}>
              {cancelTx.bom_snapshot.some(b => b.picked)
                ? 'ระบบจะคืนวัตถุดิบที่หยิบไปแล้วต่อไปนี้เข้าคลัง (ส่วนที่ยังไม่ได้หยิบไม่ต้องคืน เพราะยังไม่เคยหักออกไป):'
                : 'ออเดอร์นี้ยังไม่ได้หยิบวัตถุดิบเลย ยกเลิกได้โดยไม่ต้องคืนสต๊อกอะไร'}
            </div>
            <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 14 }}>
              {cancelTx.bom_snapshot.filter(b => b.picked).map(b => (
                <div key={b.material_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12, borderBottom: `1px solid ${C.line}` }}>
                  <span>{b.material_name}</span>
                  <span style={{ ...mono, color: C.teal }}>+{b.qty} {b.unit}</span>
                </div>
              ))}
            </div>
            <button onClick={() => handleCancel(cancelTx)} style={{ ...btnPrimary, width: '100%', background: C.red }}>
              <Undo2 size={14} style={{ marginRight: 6 }} /> ยืนยันยกเลิกออเดอร์นี้
            </button>
          </Modal>
        )}

        {(editingMaterial || showAddMaterial) && (
          <MaterialForm material={editingMaterial || { name: '', unit: 'pcs', qty: 0 }} isNew={!editingMaterial}
            onSave={handleSaveMaterial}
            onDelete={editingMaterial ? async () => { await inv.deleteMaterial(editingMaterial.id); setEditingMaterial(null); } : null}
            onClose={() => { setEditingMaterial(null); setShowAddMaterial(false); }} />
        )}

        {restockMaterial && <RestockForm material={restockMaterial} onConfirm={handleRestock} onClose={() => setRestockMaterial(null)} />}

        {editingModel && (
          <ModelForm
            model={editingModel === 'new' ? { name: '', category: activeCat, bom: [] } : editingModel}
            isNew={editingModel === 'new'} materials={inv.materials}
            onSave={handleSaveModel}
            onDelete={editingModel !== 'new' ? () => handleDeleteModel(editingModel.id) : null}
            onClose={() => setEditingModel(null)} />
        )}

        {toast && (
          <div style={{ position: 'fixed', bottom: 70, left: '50%', transform: 'translateX(-50%)', background: toast.tone === 'ok' ? C.teal : C.red, color: C.bg, padding: '9px 16px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, boxShadow: '0 6px 20px rgba(0,0,0,0.4)', maxWidth: '85%', textAlign: 'center', zIndex: 40 }}>
            {toast.msg}
          </div>
        )}
      </div>
    </div>
  );
}
