import React, { useState } from 'react';
import { Trash2, Download, Send } from 'lucide-react';
import { C, mono, btnGhost, CATEGORIES, monthStartStr, todayStr } from '../theme';
import { DateRangePicker } from '../components/DateRangePicker';
import { toCSV, downloadCSV } from '../utils/csv';
import { sendToGoogleSheet } from '../utils/sheets';

export function ReportView({ transactions, onCancel, sheetsWebhookUrl }) {
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState('');

  const filtered = transactions.filter(t => t.created_at?.slice(0, 10) >= from && t.created_at?.slice(0, 10) <= to);
  const byCategory = {};
  filtered.forEach(t => { (byCategory[t.category] = byCategory[t.category] || []).push(t); });
  const orderedCats = CATEGORIES.filter(c => byCategory[c]);

  const rowsForExport = () => filtered.map(t => ({
    วันที่: t.created_at.slice(0, 10), หมวด: t.category, รุ่น: t.model_name, ออเดอร์: t.order_ref, ช่างผู้ผลิต: t.staff_name,
  }));

  async function handleSendToSheet() {
    setSending(true); setSendMsg('');
    const { error } = await sendToGoogleSheet(sheetsWebhookUrl, 'ProductionReport', rowsForExport());
    setSendMsg(error || 'ส่งเข้า Google Sheet แล้ว');
    setSending(false);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>รายงานการผลิต</div>
      </div>
      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
        <button onClick={() => downloadCSV(`production-report_${from}_to_${to}.csv`, toCSV(rowsForExport(), ['วันที่', 'หมวด', 'รุ่น', 'ออเดอร์', 'ช่างผู้ผลิต']))} style={{ ...btnGhost, flex: 1, justifyContent: 'center' }}>
          <Download size={13} style={{ marginRight: 4 }} /> ส่งออก CSV
        </button>
        <button onClick={handleSendToSheet} disabled={sending} style={{ ...btnGhost, flex: 1, justifyContent: 'center' }}>
          <Send size={13} style={{ marginRight: 4 }} /> {sending ? 'กำลังส่ง...' : 'ส่งเข้า Google Sheet'}
        </button>
      </div>
      {sendMsg && <div style={{ fontSize: 11.5, color: sendMsg.includes('แล้ว') ? C.teal : C.red, marginBottom: 10 }}>{sendMsg}</div>}

      <div style={{ fontSize: 24, fontWeight: 800, color: C.amber, ...mono, margin: '14px 0' }}>{filtered.length} ชิ้น <span style={{ fontSize: 12, color: C.textDim, fontWeight: 400 }}>ในช่วงที่เลือก</span></div>

      {orderedCats.length === 0 && <div style={{ fontSize: 13, color: C.textDim, textAlign: 'center', padding: '20px 0' }}>ไม่มีรายการในช่วงนี้</div>}

      {orderedCats.map(cat => {
        const txs = byCategory[cat];
        const byModel = {};
        txs.forEach(t => { byModel[t.model_name] = (byModel[t.model_name] || 0) + 1; });
        return (
          <div key={cat} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.amber }}>{cat}</div>
              <div style={{ fontSize: 11.5, color: C.textDim, ...mono }}>{txs.length} ชิ้น</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {Object.entries(byModel).map(([name, count]) => (
                <div key={name} style={{ background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 8, padding: '5px 10px', fontSize: 11.5 }}>
                  {name} <span style={{ ...mono, color: C.teal, fontWeight: 700 }}>x{count}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {txs.map(t => (
                <div key={t.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 9, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{t.model_name}</div>
                    <div style={{ fontSize: 10.5, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>ออเดอร์ {t.order_ref} · ช่าง {t.staff_name} · {t.created_at.slice(0, 10)}</div>
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
  );
}
