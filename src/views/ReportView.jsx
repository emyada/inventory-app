import React, { useState } from 'react';
import { Trash2, Download, Send, BarChart2, ListFilter, Package, Layers } from 'lucide-react';
import { C, mono, btnGhost, CATEGORIES, todayStr } from '../theme';
import { DateRangePicker } from '../components/DateRangePicker';
import { toCSV, downloadCSV } from '../utils/csv';
import { sendToGoogleSheet } from '../utils/sheets';

export function ReportView({ transactions, onCancel, sheetsWebhookUrl }) {
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sendingProd, setSendingProd] = useState(false);
  const [sendingMat, setSendingMat] = useState(false);
  const [sendMsg, setSendMsg] = useState('');

  // 1. กรองออเดอร์ตามช่วงวันที่เลือก
  const filtered = transactions.filter(t => {
    const date = t.created_at?.slice(0, 10);
    return date >= from && date <= to;
  });

  // 2. จัดกลุ่มออเดอร์ตามหมวดหมู่และรุ่น
  const byCategory = {};
  filtered.forEach(t => {
    if (!byCategory[t.category]) byCategory[t.category] = { total: 0, models: {}, txs: [] };
    byCategory[t.category].total += 1;
    byCategory[t.category].models[t.model_name] = (byCategory[t.category].models[t.model_name] || 0) + 1;
    byCategory[t.category].txs.push(t);
  });

  // 3. สรุปยอดการใช้วัตถุดิบรวม
  const materialUsage = {};
  filtered.forEach(t => {
    t.bom_snapshot?.forEach(b => {
      if (!materialUsage[b.material_id]) {
        materialUsage[b.material_id] = { name: b.material_name, unit: b.unit, qty: 0 };
      }
      materialUsage[b.material_id].qty += b.qty;
    });
  });
  const materialList = Object.values(materialUsage).sort((a, b) => b.qty - a.qty);

  // 4. โครงสร้างข้อมูลสำหรับ Export / Google Sheet
  const rowsSummaryExport = () => {
    const rows = [];
    CATEGORIES.forEach(cat => {
      if (byCategory[cat]) {
        Object.entries(byCategory[cat].models).forEach(([model, count]) => {
          rows.push({ ช่วงวันที่: `${from} ถึง ${to}`, หมวดหมู่: cat, รุ่นสินค้า: model, จำนวนที่ผลิต: count });
        });
      }
    });
    return rows;
  };

  const rowsMaterialExport = () => materialList.map(m => ({
    ช่วงวันที่: `${from} ถึง ${to}`, ชื่อวัตถุดิบ: m.name, ยอดเบิกรวม: m.qty, หน่วย: m.unit
  }));

  // ส่ง Sheet 1: ProductionReport (สรุปยอดผลิต)
  async function handleSendProdSheet() {
    setSendingProd(true);
    setSendMsg('กำลังส่งสรุปสินค้า...');
    const { error } = await sendToGoogleSheet(sheetsWebhookUrl, 'ProductionReport', rowsSummaryExport());
    setSendMsg(error || 'ส่งสรุปสินค้าเข้า Google Sheet เรียบร้อยแล้ว');
    setSendingProd(false);
  }

  // ส่ง Sheet 2: MaterialsReport (สรุปวัตถุดิบ)
  async function handleSendMatSheet() {
    setSendingMat(true);
    setSendMsg('กำลังส่งสรุปวัตถุดิบ...');
    const { error } = await sendToGoogleSheet(sheetsWebhookUrl, 'MaterialsReport', rowsMaterialExport());
    setSendMsg(error || 'ส่งสรุปวัตถุดิบเข้า Google Sheet เรียบร้อยแล้ว');
    setSendingMat(false);
  }

  return (
    <div style={{ paddingBottom: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>รายงานการผลิตและสรุปสต็อก</div>
      
      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />

      {/* สลับแท็บ */}
      <div style={{ display: 'flex', gap: 6, margin: '12px 0', background: C.panelAlt, padding: 3, borderRadius: 10 }}>
        <button 
          onClick={() => setActiveTab('dashboard')} 
          style={{ flex: 1, padding: '8px 0', border: 'none', borderRadius: 8, background: activeTab === 'dashboard' ? C.panel : 'transparent', color: activeTab === 'dashboard' ? C.amber : C.textDim, fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <BarChart2 size={14} /> Dashboard สรุปยอด
        </button>
        <button 
          onClick={() => setActiveTab('raw')} 
          style={{ flex: 1, padding: '8px 0', border: 'none', borderRadius: 8, background: activeTab === 'raw' ? C.panel : 'transparent', color: activeTab === 'raw' ? C.amber : C.textDim, fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <ListFilter size={14} /> รายการดิบ ({filtered.length})
        </button>
      </div>

      {/* ปุ่ม Export CSV & Google Sheet แยกชัดเจน */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
        <button onClick={() => downloadCSV(`summary_prod_${from}_to_${to}.csv`, toCSV(rowsSummaryExport(), ['ช่วงวันที่', 'หมวดหมู่', 'รุ่นสินค้า', 'จำนวนที่ผลิต']))} style={{ ...btnGhost, justifyContent: 'center', fontSize: 11 }}>
          <Download size={12} style={{ marginRight: 4 }} /> CSV สรุปสินค้า
        </button>
        <button onClick={() => downloadCSV(`summary_mat_${from}_to_${to}.csv`, toCSV(rowsMaterialExport(), ['ช่วงวันที่', 'ชื่อวัตถุดิบ', 'ยอดเบิกรวม', 'หน่วย']))} style={{ ...btnGhost, justifyContent: 'center', fontSize: 11 }}>
          <Package size={12} style={{ marginRight: 4 }} /> CSV สรุปวัตถุดิบ
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 14 }}>
        <button onClick={handleSendProdSheet} disabled={sendingProd} style={{ ...btnGhost, justifyContent: 'center', fontSize: 11, color: C.teal, borderColor: C.teal }}>
          <Send size={12} style={{ marginRight: 4 }} /> {sendingProd ? 'กำลังส่ง...' : 'Sheet สรุปสินค้า'}
        </button>
        <button onClick={handleSendMatSheet} disabled={sendingMat} style={{ ...btnGhost, justifyContent: 'center', fontSize: 11, color: C.teal, borderColor: C.teal }}>
          <Send size={12} style={{ marginRight: 4 }} /> {sendingMat ? 'กำลังส่ง...' : 'Sheet สรุปวัตถุดิบ'}
        </button>
      </div>

      {sendMsg && <div style={{ fontSize: 11.5, color: sendMsg.includes('เรียบร้อย') ? C.teal : C.red, marginBottom: 10, textAlign: 'center' }}>{sendMsg}</div>}

      {/* TAB 1: DASHBOARD */}
      {activeTab === 'dashboard' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 10.5, color: C.textDim }}>ผลิตรวม</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.amber, ...mono }}>{filtered.length}</div>
              <div style={{ fontSize: 9.5, color: C.textDim }}>ชิ้น/คู่</div>
            </div>
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 10.5, color: C.textDim }}>หมวดหมู่</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.teal, ...mono }}>{Object.keys(byCategory).length}</div>
              <div style={{ fontSize: 9.5, color: C.textDim }}>หมวดที่มีการผลิต</div>
            </div>
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 10.5, color: C.textDim }}>วัตถุดิบที่ใช้</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.teal, ...mono }}>{materialList.length}</div>
              <div style={{ fontSize: 9.5, color: C.textDim }}>รายการ</div>
            </div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Layers size={14} color={C.amber} /> สรุปยอดตามหมวดหมู่และรุ่น
          </div>
          {Object.keys(byCategory).length === 0 && (
            <div style={{ fontSize: 12, color: C.textDim, textAlign: 'center', padding: '15px 0' }}>ไม่มีรายการในช่วงวันที่เลือก</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {CATEGORIES.filter(cat => byCategory[cat]).map(cat => {
              const data = byCategory[cat];
              return (
                <div key={cat} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 12.5, color: C.amber }}>{cat}</span>
                    <span style={{ ...mono, fontWeight: 700, fontSize: 12, color: C.text }}>รวม {data.total} ชิ้น</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {Object.entries(data.models).map(([model, count]) => (
                      <div key={model} style={{ background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 6, padding: '4px 8px', fontSize: 11 }}>
                        {model} <span style={{ ...mono, color: C.teal, fontWeight: 700 }}>x{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Package size={14} color={C.teal} /> สรุปการใช้วัตถุดิบรวม
          </div>
          {materialList.length === 0 ? (
            <div style={{ fontSize: 12, color: C.textDim, textAlign: 'center', padding: '15px 0' }}>ไม่มีการเบิกใช้วัตถุดิบในช่วงนี้</div>
          ) : (
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 10 }}>
              {materialList.map((m, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: idx < materialList.length - 1 ? `1px solid ${C.line}` : 'none', fontSize: 11.5 }}>
                  <span style={{ color: C.text }}>{m.name}</span>
                  <span style={{ ...mono, fontWeight: 700, color: C.teal }}>{m.qty} {m.unit}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: รายการดิบ */}
      {activeTab === 'raw' && (
        <div>
          {filtered.length === 0 && <div style={{ fontSize: 13, color: C.textDim, textAlign: 'center', padding: '20px 0' }}>ไม่มีรายการในช่วงนี้</div>}
          {CATEGORIES.filter(cat => byCategory[cat]).map(cat => {
            const txs = byCategory[cat].txs;
            return (
              <div key={cat} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.amber }}>{cat}</div>
                  <div style={{ fontSize: 11.5, color: C.textDim, ...mono }}>{txs.length} ชิ้น</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {txs.map(t => (
                    <div key={t.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 9, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{t.model_name}</div>
                        <div style={{ fontSize: 10.5, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>ออเดอร์ {t.order_ref} · ช่าง {t.staff_name} · {t.created_at.slice(0, 10)}</div>
                        {t.note && <div style={{ fontSize: 10.5, color: C.amber, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>เหตุผล: {t.note}</div>}
                      </div>
                      <button onClick={() => onCancel(t)} style={{ background: 'none', border: `1px solid ${C.line}`, borderRadius: 7, padding: 5, color: C.red, cursor: 'pointer', display: 'flex', flexShrink: 0 }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
