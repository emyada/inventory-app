import React, {useMemo, useState} from 'react';
import {Download} from 'lucide-react';
import {useRefreshRead} from '../hooks/useRefreshRead.js';
import {loadAllRequests, localDay} from '../lib/inventoryReports.js';
import {buildMonthlyReport, currentMonth, lowMaterials, monthLabel, monthRange, shiftMonth} from '../lib/monthlyReport.js';
import {buildMonthlyWorkbook} from '../lib/monthlyWorkbook.js';

function useLoad(load, deps) {
  const [state, setState] = useState({busy: true, error: null, data: null});
  useRefreshRead(() => { setState(s => ({...s, busy: true, error: null})); return load(); },
    data => setState({busy: false, error: null, data}),
    e => setState({busy: false, error: e.message || 'โหลดไม่สำเร็จ', data: null}), deps);
  return state;
}
const fmt = n => Number(n).toLocaleString('th-TH', {maximumFractionDigits: 2});

function saveFile({filename, type, body}) {
  const url = URL.createObjectURL(new Blob([body], {type}));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// Month-end report for the head of production (design B): category cards, materials of the
// chosen category, items to reorder, and one download button for the Excel workbook.
export function MonthlyReport({api, revision}) {
  const [ym, setYm] = useState(currentMonth());
  const [picked, setPicked] = useState('');
  const [message, setMessage] = useState('');
  const {from, to} = monthRange(ym.year, ym.month);
  const requests = useLoad(() => loadAllRequests(api), [api, revision]);
  // Secondary reads: a failure here only removes that part of the page / workbook.
  const combined = useLoad(() => api.combined_balance(), [api, revision]);
  const store = useLoad(() => api.store_report({date_from: from, date_to: to, timezone: 'Asia/Bangkok'}), [api, revision, from, to]);
  const sales = useLoad(() => api.store_list_sales({date_from: from, date_to: to, timezone: 'Asia/Bangkok', limit: 1000}), [api, revision, from, to]);
  const stock = useLoad(() => api.list_materials({include_inactive: false}), [api, revision]);

  const report = useMemo(() => {
    if (!requests.data) return null;
    try { return buildMonthlyReport(requests.data, from, to); } catch (e) { return {error: e.message}; }
  }, [requests.data, from, to]);
  const low = useMemo(() => lowMaterials(combined.data), [combined.data]);

  if (requests.busy) return <section className="mr" aria-label="รายงานสิ้นเดือน"><h2>รายงานสิ้นเดือน</h2><p role="status">กำลังโหลด…</p></section>;
  if (requests.error || report?.error) return <section className="mr"><h2>รายงานสิ้นเดือน</h2><p role="alert">{requests.error || report.error} กรุณาโหลดใหม่</p></section>;

  const shown = report.categories.filter(c => c.pairs > 0);
  const active = shown.find(c => c.name === picked) || shown[0] || null;
  const download = () => {
    setMessage('');
    try {
      saveFile(buildMonthlyWorkbook(report, {stock: stock.data || [], storeItems: store.data?.items || null, mainSales: store.data?.main_sales || null, storeSales: (sales.data || []).filter(x => { const d = localDay(x.created_at); return d >= from && d <= to; })}));
      const missing = [stock.error && 'ลำดับนับสต็อก', (store.error || sales.error) && 'หน้าร้าน'].filter(Boolean);
      if (missing.length) setMessage(`ไฟล์นี้ไม่มีชีต ${missing.join(' และ ')} เพราะโหลดข้อมูลไม่สำเร็จ`);
    } catch (e) { setMessage(e.message || 'สร้างไฟล์ไม่สำเร็จ'); }
  };

  return <section className="mr" aria-label="รายงานสิ้นเดือน">
    <div className="mr-top">
      <h2>รายงานสิ้นเดือน</h2>
      <div className="mr-month" role="group" aria-label="เลือกเดือน">
        <button type="button" aria-label="เดือนก่อนหน้า" onClick={() => setYm(shiftMonth(ym, -1))}>‹</button>
        <span>{monthLabel(ym)}</span>
        <button type="button" aria-label="เดือนถัดไป" onClick={() => setYm(shiftMonth(ym, 1))}>›</button>
      </div>
    </div>
    <div className="mr-cols">
      <div className="mr-left">
        <div className="mr-cats">
          <div className="mr-card mr-total"><small>ผลิตทั้งหมด</small><strong>{fmt(report.totalPairs)}</strong><em>คู่</em><p>ซ่อมและอื่นๆ แยก {report.repairCount} รายการ</p></div>
          {shown.map(c => <button type="button" key={c.name} className="mr-card mr-cat" aria-pressed={active?.name === c.name} onClick={() => setPicked(c.name)}>
            <small>{c.name}</small><strong>{fmt(c.pairs)}</strong><em>คู่</em><p>{c.models.length} รุ่น</p></button>)}
        </div>
        {!shown.length && <p className="inv-empty">เดือนนี้ยังไม่มีงานผลิต</p>}
        {active && <div className="mr-card"><h3>{active.name} — แยกตามรุ่น</h3>
          {active.models.map(m => <div className="mr-row" key={m.model}><span>{m.model}</span><span>{fmt(m.pairs)}</span></div>)}</div>}
      </div>
      <div className="mr-right">
        {active && <div className="mr-card"><h3>{active.name} — วัตถุดิบที่ใช้ตาม BOM</h3>
          {active.materials.slice(0, 8).map(m => <div className="mr-row" key={m.material + m.unit}><span>{m.material}</span><span>{fmt(m.qty)} {m.unit}</span></div>)}
          {active.materials.length > 8 && <details><summary>ดูทั้ง {active.materials.length} รายการ</summary>
            {active.materials.slice(8).map(m => <div className="mr-row" key={m.material + m.unit}><span>{m.material}</span><span>{fmt(m.qty)} {m.unit}</span></div>)}</details>}
        </div>}
        {(report.unfinished.length > 0 || report.waitingPick > 0) && <div className="mr-card mr-unfinished"><h3>ไม่เสร็จ / ยกไปเดือนหน้า</h3>
          {report.unfinished.map(j => <div className="mr-row" key={j.id}><span>{j.order} · {j.model}<small>{j.worker}{j.continued ? ` · ทำต่อแล้ว ${j.continued.date}` : ' · ยังไม่ได้ทำต่อ'}</small></span><span>1 คู่</span></div>)}
          {report.unfinishedLoss.length > 0 && <details><summary>สูญเสียจากงานไม่เสร็จ ({report.unfinishedLoss.length} รายการ)</summary>
            {report.unfinishedLoss.map(m => <div className="mr-row" key={m.material + m.unit}><span>{m.material}</span><span>{fmt(m.qty)} {m.unit}</span></div>)}</details>}
          {report.waitingPick > 0 && <p className="inv-muted">ยื่นแล้วแต่ยังไม่ได้หยิบ {report.waitingPick} ออเดอร์ (ยังไม่ตัดสต็อก ใช้กระทบยอดตอนนับ)</p>}
          <p className="inv-muted">ไม่นับเป็นยอดผลิต และไม่นับในวัตถุดิบที่ใช้ของเดือนนี้</p>
        </div>}
        {(store.data?.main_sales || []).length > 0 && <div className="mr-card"><h3>ขายจากคลังหลัก (หน้าร้าน)</h3>
          {store.data.main_sales.slice(0, 8).map(m => <div className="mr-row" key={m.material_id || m.name}><span>{m.name}</span><span>{fmt(m.qty)} {m.unit}</span></div>)}
          {store.data.main_sales.length > 8 && <details><summary>ดูทั้ง {store.data.main_sales.length} รายการ</summary>
            {store.data.main_sales.slice(8).map(m => <div className="mr-row" key={m.material_id || m.name}><span>{m.name}</span><span>{fmt(m.qty)} {m.unit}</span></div>)}</details>}
          <p className="inv-muted">ของที่ตัดจากคลังหลักตอนขายหน้าร้าน ใช้ประกอบการสั่งซื้อ</p>
        </div>}
        <div className="mr-card mr-warn"><h3>ควรสั่งเพิ่ม</h3>
          {combined.busy && <p role="status">กำลังโหลด…</p>}
          {combined.error && <p role="alert">โหลดยอดรวมไม่สำเร็จ</p>}
          {!combined.busy && !combined.error && !low.length && <p>ไม่มีวัตถุดิบใกล้หมด</p>}
          {low.slice(0, 8).map(m => <div className="mr-row" key={m.name}><span>{m.name}</span><span>เหลือ {fmt(m.total)} {m.unit}</span></div>)}
          {low.length > 8 && <details><summary>ดูทั้ง {low.length} รายการ</summary>
            {low.slice(8).map(m => <div className="mr-row" key={m.name}><span>{m.name}</span><span>เหลือ {fmt(m.total)} {m.unit}</span></div>)}</details>}
          <p className="inv-muted">รวมคลังหลัก + อะไหล่หน้าร้านแล้ว</p>
        </div>
        <div className="mr-card">
          <button type="button" className="inv-primary mr-download" onClick={download}><Download size={18}/> ดาวน์โหลด Excel</button>
          <p className="inv-muted">ไฟล์เดียวมีครบ: สรุปการผลิต · วัตถุดิบแยกหมวด · ซ่อมและอื่นๆ · รายการดิบ (มีชื่อผู้เบิก) · ลำดับนับสต็อก · หน้าร้าน · รายการขายหน้าร้าน (ชื่อผู้ขาย วันเวลา) ยอดรวมเป็นสูตร แก้เลขแล้วคำนวณใหม่</p>
          {message && <p role="status">{message}</p>}
        </div>
      </div>
    </div>
  </section>;
}
