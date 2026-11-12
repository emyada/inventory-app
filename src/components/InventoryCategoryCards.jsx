import React, {useState} from 'react';
import {reportProjection, REPAIR_CATEGORY} from '../lib/inventoryReportFilters.js';
import {PRODUCT_CATEGORIES, modelSummary} from '../lib/inventoryReports.js';
import './InventoryReportTools.css';

export function InventoryCategoryCards({data, role, from, to, Table}) {
  const [selected,setSelected]=useState('');
  const names=[...new Set([...PRODUCT_CATEGORIES,REPAIR_CATEGORY,...(role==='admin'?data.requests:data.categoryUsage||[]).map(r=>r.category)])].filter(Boolean);
  const groups=names.map(category=>{
    const view=reportProjection(data,from,to,{category});
    const models=role==='admin'?modelSummary(view.rows):[...new Map(view.allocations.map(a=>[JSON.stringify([a.model_id,a.model_name]),{model_id:a.model_id,model_name:a.model_name}])).values()];
    return {category,view,models};
  });
  const detail=groups.find(g=>g.category===selected);
  return <section aria-label="สรุปหมวดและรายละเอียด">
    <h3>สำรวจตามหมวด</h3><p className="inv-muted">{role==='admin'?'รุ่น/ออเดอร์นับตามวันสร้างคำขอ':'รุ่นที่มีการเบิก/คืนในงวด · ไม่เปิดเผยออเดอร์/ลูกค้า'} · วัตถุดิบตามการเบิก/คืนจริงในงวด · ใช้ช่วงวันที่ด้านบน ไม่ใช้ตัวกรองอื่นของตาราง</p>
    <div className="report-category-cards">{groups.map(g=><button key={g.category} type="button" aria-pressed={selected===g.category} onClick={()=>setSelected(selected===g.category?'':g.category)}><strong>{g.category}</strong><span>{g.models.length} รุ่น · {g.view.balances.length} วัตถุดิบ</span>{role==='admin'&&<small>{g.view.rows.length} คำขอ</small>}</button>)}</div>
    {detail&&<div className="report-drilldown"><h4>{detail.category}</h4>
      <details open><summary>รุ่นสินค้า</summary><Table rows={detail.models} columns={role==='admin'?[['model_name','รุ่นย้อนหลัง'],['requests','จำนวนคำขอ']]:[['model_name','รุ่นย้อนหลัง']]}/></details>
      <details><summary>วัตถุดิบ — การใช้จริง ไม่ใช่ BOM จำลอง</summary><Table rows={detail.view.balances} columns={[["name","วัตถุดิบ"],["unit","หน่วย"],["issue","เบิก"],["returned","คืน"]]}/></details>
      {role==='admin'&&<details><summary>ออเดอร์</summary><Table rows={detail.view.rows} columns={[["order_ref","อ้างอิง"],["model_name","รุ่นย้อนหลัง"],["created_at","สร้างเมื่อ"],["status","สถานะ"]]}/></details>}
    </div>}
  </section>;
}
