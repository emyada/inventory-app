import {localDay,validatePeriod} from './inventoryReports.js';
export const receivingType=row=>row.reason==='purchase'?'Purchased':row.reason==='cancellation_return'?'Returned to Stock':row.reason==='stocktake_adjustment_in'?'Counted Up':null;
// Thai names shown to people; the English keys above stay as internal filter values.
export const receivingLabels=Object.freeze({All:'ทั้งหมด',Purchased:'ซื้อเข้า','Returned to Stock':'คืนจากการยกเลิก','Counted Up':'เพิ่มจากการนับสต็อก'});
export function receivingRows(rows,{search='',type='All',from='',to=''}={}) {
 if(from||to)validatePeriod(from||'0001-01-01',to||'9999-12-31');
 const term=search.trim().toLocaleLowerCase();
 return rows.filter(r=>receivingType(r)&&Number(r.delta)>0).filter(r=>{
  const day=localDay(r.occurred_at);
  return (type==='All'||receivingType(r)===type)&&(!from||day>=from)&&(!to||day<=to)&&
   [r.material_name,r.reference,r.actor_name,r.actor_id,r.receipt_document?.invoice_number,r.receipt_document?.po_number].some(v=>String(v??'').toLocaleLowerCase().includes(term));
 }).sort((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at)||b.sequence_no-a.sequence_no);
}
