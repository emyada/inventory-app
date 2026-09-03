import React, { useState } from 'react';
import { Plus, PackagePlus, ChevronRight, History, ArrowDownCircle, ArrowUpCircle, Download, Send } from 'lucide-react';
import { C, mono, btnGhost, tabBtn, tabBtnActive, monthStartStr, todayStr } from '../theme';
import { DateRangePicker } from '../components/DateRangePicker';
import { toCSV, downloadCSV } from '../utils/csv';
import { sendToGoogleSheet } from '../utils/sheets';

export function StockView({ materials, stockLog, role, onEdit, onAdd, onRestock, sheetsWebhookUrl }) {
  const [sub, setSub] = useState('current');
  const [from, setFrom] = useState(monthStartStr());
  const [to, setTo] = useState(todayStr());
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState('');

  const filteredLog = stockLog.filter(l => l.created_at?.slice(0, 10) >= from && l.created_at?.slice(0, 10) <= to);
  const totalIn = filteredLog.filter(l => l.type === 'in').reduce((s, l) => s + Number(l.amount), 0);
  const totalOut = filteredLog.filter(l => l.type === 'out').reduce((s, l) => s + Number(l.amount), 0);

  const byDate = {};
  filteredLog.forEach(l => { const d = l.created_at.slice(0, 10); (byDate[d] = byDate[d] || []).push(l); });
  const dates = Object.keys(byDate).sort().reverse();

  const rowsForExport = () => filteredLog.map(l => ({
    วันที่: l.created_at.slice(0, 10), ประเภท: l.type === 'in' ? 'รับเข้า' : 'เบิกออก',
    วัตถุดิบ: l.material_name, จำนวน: l.amount, หน่วย: l.unit, อ้างอิง: l.order_ref, ผู้ทำรายการ: l.staff_name,
  }));

  async function handleSendToSheet() {
    setSending(true); setSendMsg('');
    const { error } = await sendToGoogleSheet(sheetsWebhookUrl, 'StockLog', rowsForExport());
    setSendMsg(error || 'ส่งเข้า Google Sheet แล้ว');
    setSending(false);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{sub === 'current' ? `คลังวัตถุดิบ (${materials.length})` : 'ประวัติเข้า-ออก'}</div>
        {sub === 'current' && role === 'admin' && <button onClick={onAdd} style={btnGhost}><Plus size={13} style={{ marginRight: 4 }} /> เพิ่มรายการ</button>}
      </div>

      {role === 'admin' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <button onClick={() => setSub('current')} style={{ ...tabBtn, ...(sub === 'current' ? tabBtnActive : {}) }}>รายการปัจจุบัน</button>
          <button onClick={() => setSub('history')} style={{ ...tabBtn, ...(sub === 'history' ? tabBtnActive : {}) }}><History size={12} style={{ marginRight: 4 }} />ประวัติ / รายงานบัญชี</button>
        </div>
      )}

      {sub === 'current' && (
        <div className="grid-list">
          {materials.map(m => (
            <div key={m.id} style={{ background: m.qty <= 2 ? 'rgba(217,119,87,0.08)' : C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                <div style={{ fontSize: 11, marginTop: 2, ...mono, color: m.qty <= 2 ? C.red : C.teal, fontWeight: 700 }}>{m.qty} {m.unit}</div>
              </div>
              <button onClick={() => onRestock(m)} title="รับของเข้าคลัง"
                style={{ background: 'rgba(63,167,150,0.14)', border: `1px solid ${C.teal}`, borderRadius: 8, padding: '6px 9px', cursor: 'pointer', color: C.teal, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                <PackagePlus size={14} />
              </button>
              {role === 'admin' && (
                <button onClick={() => onEdit(m)} style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', flexShrink: 0 }}><ChevronRight size={16} /></button>
              )}
            </div>
          ))}
        </div>
      )}

      {sub === 'history' && role === 'admin' && (
        <div>
          <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
          <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
            <button onClick={() => downloadCSV(`stock-report_${from}_to_${to}.csv`, toCSV(rowsForExport(), ['วันที่', 'ประเภท', 'วัตถุดิบ', 'จำนวน', 'หน่วย', 'อ้างอิง', 'ผู้ทำรายการ']))} style={{ ...btnGhost, flex: 1, justifyContent: 'center' }}>
              <Download size={13} style={{ marginRight: 4 }} /> ส่งออก CSV
            </button>
            <button onClick={handleSendToSheet} disabled={sending} style={{ ...btnGhost, flex: 1, justifyContent: 'center' }}>
              <Send size={13} style={{ marginRight: 4 }} /> {sending ? 'กำลังส่ง...' : 'ส่งเข้า Google Sheet'}
            </button>
          </div>
          {sendMsg && <div style={{ fontSize: 11.5, color: sendMsg.includes('แล้ว') ? C.teal : C.red, marginBottom: 10 }}>{sendMsg}</div>}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div style={{ flex: 1, background: 'rgba(63,167,150,0.1)', border: `1px solid ${C.teal}`, borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 10.5, color: C.textDim }}>รับเข้ารวม</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.teal, ...mono }}>+{totalIn}</div>
            </div>
            <div style={{ flex: 1, background: 'rgba(217,119,87,0.1)', border: `1px solid ${C.red}`, borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 10.5, color: C.textDim }}>เบิกออกรวม</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.red, ...mono }}>-{totalOut}</div>
            </div>
          </div>
          {dates.length === 0 && <div style={{ fontSize: 13, color: C.textDim, textAlign: 'center', padding: '20px 0' }}>ไม่มีรายการในช่วงนี้</div>}
          {dates.map(date => (
            <div key={date} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11.5, color: C.textDim, fontWeight: 700, marginBottom: 6, ...mono }}>{date}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {byDate[date].map(l => (
                  <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: '7px 10px' }}>
                    {l.type === 'in' ? <ArrowDownCircle size={14} color={C.teal} /> : <ArrowUpCircle size={14} color={C.red} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.material_name}</div>
                      <div style={{ fontSize: 10.5, color: C.textDim }}>{l.order_ref}{l.staff_name ? ` · ${l.staff_name}` : ''}</div>
                    </div>
                    <div style={{ ...mono, fontSize: 12.5, fontWeight: 700, color: l.type === 'in' ? C.teal : C.red, flexShrink: 0 }}>
                      {l.type === 'in' ? '+' : '-'}{l.amount} {l.unit}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
