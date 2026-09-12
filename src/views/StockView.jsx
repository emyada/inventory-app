import React, { useState } from 'react';
import { Plus, PackagePlus, ChevronRight, ChevronDown, History, ArrowDownCircle, ArrowUpCircle, Download, Send, Search, BookOpen } from 'lucide-react';
import { C, mono, btnGhost, tabBtn, tabBtnActive, todayStr } from '../theme';
import { DateRangePicker } from '../components/DateRangePicker';
import { toCSV, downloadCSV } from '../utils/csv';
import { sendToGoogleSheet } from '../utils/sheets';

export function StockView({ materials = [], stockLog = [], transactions = [], role, onEdit, onAdd, onRestock, sheetsWebhookUrl }) {
  const [sub, setSub] = useState('current');
  const [search, setSearch] = useState('');
  const [balanceSearch, setBalanceSearch] = useState('');
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState('');
  const [balSending, setBalSending] = useState(false);
  const [balSendMsg, setBalSendMsg] = useState('');
  const [expanded, setExpanded] = useState(null);

  const isTypeIn = (l) => l.type === 'in';

  // ใช้ BOM ทุกบรรทัดและวันที่สร้างรายการเช่นเดียวกับหน้ารายงาน
  const txLogs = transactions.flatMap(tx =>
    (tx.bom_snapshot || []).map((b, index) => ({
      id: `tx_${tx.id}_${index}`,
      created_at: tx.created_at,
      type: 'out',
      material_id: b.material_id,
      material_name: b.material_name,
      amount: Number(b.qty || 0),
      unit: b.unit,
      order_ref: tx.order_ref,
      staff_name: tx.staff_name,
    }))
  );

  // รับเฉพาะซื้อเข้า ไม่รวม log เบิกหรือคืนที่ซ้ำกับยอดตามรายงาน
  const purchaseLogs = stockLog.filter(
    l => l.type === 'in' && l.order_ref === 'ซื้อเข้า'
  );
  const combinedLogs = [...purchaseLogs, ...txLogs];
  // กรอง Log ตามช่วงวันที่
  const filteredStockLog = combinedLogs.filter(l => {
    const d = l.created_at?.slice(0, 10);
    return d >= from && d <= to;
  });

  const restockCount = filteredStockLog.filter(l => isTypeIn(l)).length;

  // ------------------ 1. จัดกลุ่มรับเข้า–เบิกตามรายงาน ------------------
  const byMaterial = {};
  filteredStockLog.forEach(l => {
    const key = String(l.material_id);

    if (!byMaterial[key]) {
      byMaterial[key] = { 
        id: key, 
        name: l.material_name || 'ไม่ระบุ', 
        unit: l.unit || '', 
        in: 0, 
        out: 0, 
        entries: [] 
      };
    }
    const amt = Number(l.amount) || 0;
    if (isTypeIn(l)) {
      byMaterial[key].in += amt;
    } else {
      byMaterial[key].out += amt;
    }
    byMaterial[key].entries.push(l);
  });

  const materialRows = Object.values(byMaterial)
    .map(v => ({ ...v, entries: v.entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));

  const rowsForExport = () => filteredStockLog.map(l => ({
    วันที่: l.created_at?.slice(0, 10) || '',
    ประเภท: isTypeIn(l) ? 'รับเข้า' : 'เบิกออก',
    วัตถุดิบ: l.material_name || '',
    จำนวน: l.amount || 0,
    หน่วย: l.unit || '',
    อ้างอิง: l.order_ref || '',
    ผู้ทำรายการ: l.staff_name || '',
  }));

  async function handleSendToSheet() {
    setSending(true); setSendMsg('');
    const { error } = await sendToGoogleSheet(sheetsWebhookUrl, 'StockLog', rowsForExport());
    setSendMsg(error || 'ส่งเข้า Google Sheet แล้ว');
    setSending(false);
  }

// ------------------ 2. ต้นงวด-ปลายงวด (Balance Calculation - Fixed) ------------------
  const balanceRows = materials
    .filter(m => m.name.toLowerCase().includes(balanceSearch.trim().toLowerCase()))
    .map(m => {
      const matId = String(m.id);
      const logsForMat = combinedLogs.filter(
        l => String(l.material_id) === matId
      );

      // แยก Log ก่อนช่วงเวลา, ในช่วงเวลา, และหลังช่วงเวลา
      const before = logsForMat.filter(l => (l.created_at?.slice(0, 10) || '') < from);
      const within = logsForMat.filter(l => {
        const d = l.created_at?.slice(0, 10) || '';
        return d >= from && d <= to;
      });

      // รวมยอดรับเข้าและเบิกตามรายงานในช่วงที่เลือก
      const inWithin = within.filter(l => isTypeIn(l)).reduce((s, l) => s + (Number(l.amount) || 0), 0);
      const outWithin = within.filter(l => !isTypeIn(l)).reduce((s, l) => s + (Number(l.amount) || 0), 0);

      // ยอดเบิกทั้งหมดของวัตถุดิบนี้
      const totalOutForMat = logsForMat.filter(l => !isTypeIn(l)).reduce((s, l) => s + (Number(l.amount) || 0), 0);
      const totalInForMat = logsForMat.filter(l => isTypeIn(l)).reduce((s, l) => s + (Number(l.amount) || 0), 0);

      // รวมการเคลื่อนไหวก่อนช่วงที่เลือก
      const inBefore = before.filter(l => isTypeIn(l)).reduce((s, l) => s + (Number(l.amount) || 0), 0);
      const outBefore = before.filter(l => !isTypeIn(l)).reduce((s, l) => s + (Number(l.amount) || 0), 0);

      // ย้อนฐานจากยอดปัจจุบัน รวมกรณียอดเป็นศูนย์หรือติดลบ
      const currentQty = Number(m.qty ?? 0);
      const baseStock = currentQty + totalOutForMat - totalInForMat;
      
      // ต้นงวด = ยอดตั้งต้น + ยอดรับก่อนหน้า - ยอดเบิกรวมก่อนหน้า
      const opening = baseStock + inBefore - outBefore;
      // ปลายงวด = ต้นงวด + รับเข้า - เบิกออก
      const closing = opening + inWithin - outWithin;

      return { id: m.id, name: m.name, unit: m.unit, opening, inWithin, outWithin, closing };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));

  const balanceRowsForExport = () => balanceRows.map(r => ({
    วัตถุดิบ: r.name, หน่วย: r.unit, ต้นงวด: r.opening, รับเข้า: r.inWithin, เบิกออก: r.outWithin, ปลายงวด: r.closing,
  }));

  async function handleSendBalanceToSheet() {
    setBalSending(true); setBalSendMsg('');
    const { error } = await sendToGoogleSheet(sheetsWebhookUrl, 'StockBalance', balanceRowsForExport());
    setBalSendMsg(error || 'ส่งเข้า Google Sheet แล้ว');
    setBalSending(false);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>
          {sub === 'current' ? `คลังวัตถุดิบ (${materials.length})` : sub === 'history' ? 'รับเข้า–เบิกตามรายงาน' : 'ต้นงวด-ปลายงวด'}
        </div>
        {sub === 'current' && role === 'admin' && <button onClick={onAdd} style={btnGhost}><Plus size={13} style={{ marginRight: 4 }} /> เพิ่มรายการ</button>}
      </div>

      {role === 'admin' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          <button onClick={() => setSub('current')} style={{ ...tabBtn, ...(sub === 'current' ? tabBtnActive : {}) }}>รายการปัจจุบัน</button>
          <button onClick={() => setSub('history')} style={{ ...tabBtn, ...(sub === 'history' ? tabBtnActive : {}) }}><History size={12} style={{ marginRight: 4 }} />รับเข้า–เบิกตามรายงาน</button>
          <button onClick={() => setSub('balance')} style={{ ...tabBtn, ...(sub === 'balance' ? tabBtnActive : {}) }}><BookOpen size={12} style={{ marginRight: 4 }} />ต้นงวด-ปลายงวด</button>
        </div>
      )}

      {sub !== 'current' && role === 'admin' && (
        <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>
          ยอดเบิกอ้างอิงวันที่สร้างรายการ เช่นเดียวกับหน้ารายงาน
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

          <div style={{ marginBottom: 12 }}>
            <div style={{ background: 'rgba(63,167,150,0.1)', border: `1px solid ${C.teal}`, borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: C.textDim }}>รับเข้า (ซื้อเข้าจริง)</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: C.teal, ...mono, marginTop: 2 }}>{restockCount} ครั้ง</div>
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
                      {r.entries.map((l, idx) => {
                        const in_ = isTypeIn(l);
                        return (
                          <div key={l.id || idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${C.line}` }}>
                            {in_ ? <ArrowDownCircle size={13} color={C.teal} /> : <ArrowUpCircle size={13} color={C.red} />}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 11, color: C.textDim, ...mono }}>{l.created_at?.slice(0, 10)}</div>
                              <div style={{ fontSize: 11, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.order_ref}{l.staff_name ? ` · ${l.staff_name}` : ''}</div>
                            </div>
                            <div style={{ ...mono, fontSize: 12, fontWeight: 700, color: in_ ? C.teal : C.red, flexShrink: 0 }}>
                              {in_ ? '+' : '-'}{l.amount} {l.unit}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sub === 'balance' && role === 'admin' && (
        <div>
          <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
          <div style={{ fontSize: 10, color: C.textDim, margin: '8px 0 12px', lineHeight: 1.5 }}>
            ต้นงวด = ยอดคงเหลือก่อนเริ่มช่วงที่เลือก · ปลายงวด = ยอดคงเหลือ ณ สิ้นช่วงที่เลือก
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button onClick={() => downloadCSV(`stock-balance_${from}_to_${to}.csv`, toCSV(balanceRowsForExport(), ['วัตถุดิบ', 'หน่วย', 'ต้นงวด', 'รับเข้า', 'เบิกออก', 'ปลายงวด']))} style={{ ...btnGhost, flex: 1, justifyContent: 'center' }}>
              <Download size={13} style={{ marginRight: 4 }} /> ส่งออก CSV
            </button>
            <button onClick={handleSendBalanceToSheet} disabled={balSending} style={{ ...btnGhost, flex: 1, justifyContent: 'center' }}>
              <Send size={13} style={{ marginRight: 4 }} /> {balSending ? 'กำลังส่ง...' : 'ส่งเข้า Google Sheet'}
            </button>
          </div>
          {balSendMsg && <div style={{ fontSize: 11.5, color: balSendMsg.includes('แล้ว') ? C.teal : C.red, marginBottom: 10 }}>{balSendMsg}</div>}

          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={14} color={C.textDim} style={{ position: 'absolute', left: 10, top: 10 }} />
            <input value={balanceSearch} onChange={e => setBalanceSearch(e.target.value)} placeholder="ค้นหาวัตถุดิบ..."
              style={{ width: '100%', background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 8, padding: '8px 10px 8px 32px', color: C.text, fontSize: 13, boxSizing: 'border-box' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {balanceRows.map(r => (
              <div key={r.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, textAlign: 'center' }}>
                  <div>
                    <div style={{ fontSize: 9.5, color: C.textDim }}>ต้นงวด</div>
                    <div style={{ ...mono, fontSize: 12.5, fontWeight: 700 }}>{r.opening}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9.5, color: C.textDim }}>รับเข้า</div>
                    <div style={{ ...mono, fontSize: 12.5, fontWeight: 700, color: C.teal }}>+{r.inWithin}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9.5, color: C.textDim }}>เบิกออก</div>
                    <div style={{ ...mono, fontSize: 12.5, fontWeight: 700, color: C.red }}>-{r.outWithin}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9.5, color: C.textDim }}>ปลายงวด</div>
                    <div style={{ ...mono, fontSize: 12.5, fontWeight: 700, color: C.amber }}>{r.closing}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 10, color: C.textDim, marginTop: 4 }}>{r.unit}</div>
              </div>
            ))}
            {balanceRows.length === 0 && <div style={{ fontSize: 13, color: C.textDim, textAlign: 'center', padding: '20px 0' }}>ไม่พบวัตถุดิบที่ค้นหา</div>}
          </div>
        </div>
      )}
    </div>
  );
}
