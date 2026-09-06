import React, { useState } from 'react';
import { Plus, PackagePlus, ChevronRight, ChevronDown, History, ArrowDownCircle, ArrowUpCircle, Download, Send, Search } from 'lucide-react';
import { C, mono, btnGhost, tabBtn, tabBtnActive, monthStartStr, todayStr } from '../theme';
import { DateRangePicker } from '../components/DateRangePicker';
import { toCSV, downloadCSV } from '../utils/csv';
import { sendToGoogleSheet } from '../utils/sheets';

export function StockView({ materials, stockLog, role, onEdit, onAdd, onRestock, sheetsWebhookUrl }) {
  const [sub, setSub] = useState('current');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(monthStartStr());
  const [to, setTo] = useState(todayStr());
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState('');
  const [expanded, setExpanded] = useState(null); // material_id currently expanded, or null

  const filteredLog = stockLog.filter(l => l.created_at?.slice(0, 10) >= from && l.created_at?.slice(0, 10) <= to);
  const totalIn = filteredLog.filter(l => l.type === 'in').reduce((s, l) => s + Number(l.amount), 0);
  const totalOut = filteredLog.filter(l => l.type === 'out').reduce((s, l) => s + Number(l.amount), 0);

  // Group every entry by material — this is the whole point of the redesign:
  // the same material showing up across many dates/orders now collapses into
  // ONE row with running totals, instead of one row per event stretching the
  // page. Tap a row to expand and see the individual dated entries beneath it.
  const byMaterial = {};
  filteredLog.forEach(l => {
    const key = l.material_id || l.material_name;
    if (!byMaterial[key]) byMaterial[key] = { name: l.material_name, unit: l.unit, in: 0, out: 0, entries: [] };
    if (l.type === 'in') byMaterial[key].in += Number(l.amount); else byMaterial[key].out += Number(l.amount);
    byMaterial[key].entries.push(l);
  });
  const materialRows = Object.entries(byMaterial)
    .map(([id, v]) => ({ id, ...v, entries: v.entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));

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
        <div>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <Search size={14} color={C.textDim} style={{ position: 'absolute', left: 10, top: 10 }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาวัตถุดิบ..."
              style={{ width: '100%', background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 8, padding: '8px 10px 8px 32px', color: C.text, fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <div className="grid-list">
            {materials.filter(m => m.name.toLowerCase().includes(search.trim().toLowerCase())).map(m => (
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
            {materials.filter(m => m.name.toLowerCase().includes(search.trim().toLowerCase())).length === 0 && (
              <div style={{ fontSize: 13, color: C.textDim, textAlign: 'center', padding: '20px 0' }}>ไม่พบวัตถุดิบที่ค้นหา</div>
            )}
          </div>
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

          <div style={{ fontSize: 11.5, color: C.textDim, marginBottom: 8 }}>แตะแต่ละรายการเพื่อดูรายละเอียดย่อย</div>

          {materialRows.length === 0 && <div style={{ fontSize: 13, color: C.textDim, textAlign: 'center', padding: '20px 0' }}>ไม่มีรายการในช่วงนี้</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {materialRows.map(r => {
              const isOpen = expanded === r.id;
              return (
                <div key={r.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, overflow: 'hidden' }}>
                  <button onClick={() => setExpanded(isOpen ? null : r.id)}
                    style={{ all: 'unset', display: 'flex', alignItems: 'center', gap: 8, width: '100%', boxSizing: 'border-box', padding: '10px 12px', cursor: 'pointer' }}>
                    <ChevronDown size={14} color={C.textDim} style={{ flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                      <div style={{ fontSize: 10.5, color: C.textDim }}>{r.entries.length} รายการ</div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                      {r.in > 0 && <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: C.teal }}>+{r.in}</span>}
                      {r.out > 0 && <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: C.red }}>-{r.out}</span>}
                      <span style={{ fontSize: 11, color: C.textDim }}>{r.unit}</span>
                    </div>
                  </button>
                  {isOpen && (
                    <div style={{ borderTop: `1px solid ${C.line}`, padding: '4px 12px 8px' }}>
                      {r.entries.map(l => (
                        <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${C.line}` }}>
                          {l.type === 'in' ? <ArrowDownCircle size={13} color={C.teal} /> : <ArrowUpCircle size={13} color={C.red} />}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, color: C.textDim, ...mono }}>{l.created_at.slice(0, 10)}</div>
                            <div style={{ fontSize: 11, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.order_ref}{l.staff_name ? ` · ${l.staff_name}` : ''}</div>
                          </div>
                          <div style={{ ...mono, fontSize: 12, fontWeight: 700, color: l.type === 'in' ? C.teal : C.red, flexShrink: 0 }}>
                            {l.type === 'in' ? '+' : '-'}{l.amount} {l.unit}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
