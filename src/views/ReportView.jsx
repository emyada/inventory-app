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

  // แปลงฟอร์แมต YYYY-MM-DD -> DD/MM/YYYY
  const formatDateTH = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  };

  // กรองตามวันที่เลือก + เรียงจากต้นเดือนไปสิ้นเดือน (เก่า -> ใหม่)
  const filtered = transactions
    .filter(t => {
      const date = t.created_at?.slice(0, 10);
      return date >= from && date <= to;
    })
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

  // จัดกลุ่มออเดอร์ตามหมวดหมู่
  const byCategory = {};
  filtered.forEach(t => {
    if (!byCategory[t.category]) byCategory[t.category] = { total: 0, models: {}, txs: [] };
    byCategory[t.category].total += 1;
    byCategory[t.category].models[t.model_name] = (byCategory[t.category].models[t.model_name] || 0) + 1;
    byCategory[t.category].txs.push(t);
  });

  // เตรียมข้อมูล Export
  const rowsSummaryExport = () => {
    return filtered.map(t => ({
      วันที่: formatDateTH(t.created_at?.slice(0, 10)),
      เวลา: t.created_at?.slice(11, 16) || '',
      หมวดหมู่: t.category,
      รุ่นสินค้า: t.model_name,
      ออเดอร์: t.order_ref || '',
      ช่างผู้ผลิต: t.staff_name || '',
      จำนวน: 1
    }));
  };

  const rowsMaterialExport = () => {
    const matRows = [];
    filtered.forEach(t => {
      const dateFormatted = formatDateTH(t.created_at?.slice(0, 10));
      t.bom_snapshot?.forEach(b => {
        matRows.push({
          วันที่: dateFormatted,
          ชื่อวัตถุดิบ: b.material_name,
          จำนวนที่ใช้: b.qty,
          หน่วย: b.unit,
          รุ่นสินค้า: t.model_name,
          ออเดอร์: t.order_ref || ''
        });
      });
    });
    return matRows;
  };

  async function handleSendProdSheet() {
    setSendingProd(true);
    setSendMsg('กำลังส่งข้อมูลสินค้า...');
    const { error } = await sendToGoogleSheet(sheetsWebhookUrl, 'ProductionReport', rowsSummaryExport());
    setSendMsg(error || 'ส่งข้อมูลสินค้าเข้า Google Sheet เรียบร้อยแล้ว');
    setSendingProd(false);
  }

  async function handleSendMatSheet() {
    setSendingMat(true);
    setSendMsg('กำลังส่งข้อมูลวัตถุดิบ...');
    const { error } = await sendToGoogleSheet(sheetsWebhookUrl, 'MaterialsReport', rowsMaterialExport());
    setSendMsg(error || 'ส่งข้อมูลวัตถุดิบเข้า Google Sheet เรียบร้อยแล้ว');
    setSendingMat(false);
  }

  // สรุปยอดวัตถุดิบ
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

  return (
    <div style={{ paddingBottom: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>รายงานการผลิตและสรุปสต็อก</div>
      
      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />

      {/* แท็บสลับหน้า */}
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

      {/* ปุ่ม Export */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
        <button onClick={() => downloadCSV(`prod_${from}_to_${to}.csv`, toCSV(rowsSummaryExport(), ['วันที่', 'เวลา', 'หมวดหมู่', 'รุ่นสินค้า', 'ออเดอร์', 'ช่างผู้ผลิต', 'จำนวน']))} style={{ ...btnGhost, justifyContent: 'center', fontSize: 11 }}>
          <Download size={12} style={{ marginRight: 4 }} /> CSV สินค้า
        </button>
        <button onClick={() => downloadCSV(`mat_${from}_to_${to}.csv`, toCSV(rowsMaterialExport(), ['วันที่', 'ชื่อวัตถุดิบ', 'จำนวนที่ใช้', 'หน่วย', 'รุ่นสินค้า', 'ออเดอร์']))} style={{ ...btnGhost, justifyContent: 'center', fontSize: 11 }}>
          <Package size={12} style={{ marginRight: 4 }} /> CSV วัตถุดิบ
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
          {/* การ์ดสรุปแยกตามหมวดหมู่ (โทนสีธีมเดิม) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 8, marginBottom: 16 }}>
            {CATEGORIES.map(cat => {
              const count = byCategory[cat]?.total || 0;
              return (
                <div key={cat} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 6px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: C.textDim, fontWeight: 600, marginBottom: 4 }}>{cat}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: count > 0 ? C.amber : C.text, ...mono }}>{count}</div>
                </div>
              );
            })}
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
                        <div style={{ fontSize: 10.5, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>ออเดอร์ {t.order_ref} · ช่าง {t.staff_name} · {formatDateTH(t.created_at.slice(0, 10))}</div>
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
