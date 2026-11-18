import React, {useMemo, useState} from 'react';
import {ReportTable} from '../InventoryReports.jsx';
import {localDay, reportCSV} from '../../lib/inventoryReports.js';
import {downloadCSV} from '../../utils/csv.js';
import {linesSummary, daysWaiting} from '../../lib/storeApi.js';
import {fmtTime, useStoreRead, ReadNote} from './shared.jsx';

/* ---------------- Reports: storefront + combined balance (admin / purchasing) ---------------- */
const storeReportColumns = [['name', 'รายการ'], ['kind_label', 'ประเภท'], ['unit', 'หน่วย'], ['opening', 'ต้นงวด'], ['transfer_in', 'รับจากคลังหลัก'], ['transfer_out', 'โอนคืนคลังหลัก'], ['sold', 'ขาย'], ['sale_cancelled', 'ยกเลิกขาย (คืน)'], ['adjust_in', 'ปรับเพิ่ม'], ['adjust_out', 'ปรับลด'], ['closing', 'คงเหลือ']];
export function StoreReports({api, revision}) {
  // The store tab shows only sets left at the storefront and store movements; main-stock totals live in the Report tab.
  const today = localDay(new Date());
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const report = useStoreRead(() => api.store_report({date_from: from, date_to: to, timezone: 'Asia/Bangkok'}), revision, [from, to]);
  const stock = useStoreRead(() => api.store_list_stock(), revision);
  const items = useMemo(() => (report.data?.items || []).map(r => ({...r, kind_label: r.item_kind === 'model' ? 'ชุดสำเร็จรูป' : 'อะไหล่'})), [report.data]);
  const mainSales = useMemo(() => report.data?.main_sales || [], [report.data]);
  const pendingRows = useMemo(() => (report.data?.pending || []).map(p => ({...p, created_at_label: fmtTime(p.created_at), waiting: daysWaiting(p.created_at), items: linesSummary(p.lines)})), [report.data]);
  const sets = useMemo(() => (stock.data || []).filter(r => r.item_kind === 'model').map(r => ({name: r.name, category: r.category, store_sets: r.qty})), [stock.data]);
  return <section className="store-reports">
    <h2>รายงานหน้าร้าน</h2>
    <h3>ชุดสำเร็จรูปที่ค้างหน้าร้าน</h3>
    <ReadNote state={stock}/>
    {!stock.busy && !stock.error && (sets.length
      ? <ReportTable rows={sets} columns={[['name', 'รุ่น'], ['category', 'หมวด'], ['store_sets', 'จำนวนชุด']]}/>
      : <p className="inv-empty">ไม่มีชุดสำเร็จรูปค้างหน้าร้าน</p>)}
    <h3>ความเคลื่อนไหวหน้าร้านในช่วงที่เลือก</h3>
    <div className="inv-filters">
      <label>ตั้งแต่<input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)}/></label>
      <label>ถึง<input type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)}/></label>
    </div>
    <ReadNote state={report}/>
    {!report.busy && !report.error && <>
      <button type="button" disabled={!items.length} onClick={() => downloadCSV(`store_report_${from}_${to}.csv`, reportCSV(items, storeReportColumns, {from, to, timezone: 'Asia/Bangkok'}))}>ส่งออกรายงานหน้าร้าน CSV</button>
      <ReportTable rows={items} columns={storeReportColumns}/>
      <h3>ขายจากคลังหลัก (อื่นๆ)</h3>
      {mainSales.length ? <ReportTable rows={mainSales} columns={[['name', 'วัตถุดิบ'], ['unit', 'หน่วย'], ['qty', 'จำนวนที่ขาย']]}/> : <p className="inv-empty">ไม่มีการขายจากคลังหลักในช่วงนี้</p>}
      <h3>รอแท็ก</h3>
      {pendingRows.length ? <ReportTable rows={pendingRows} columns={[['created_at_label', 'เวลา'], ['waiting', 'ค้าง (วัน)'], ['seller_name', 'ผู้ขาย'], ['items', 'รายการ']]}/> : <p className="inv-empty">ไม่มีใบที่รอแท็ก</p>}
    </>}
  </section>;
}

