function decimal(value,positive) {
 const text=String(value??'').trim();
 if(text.length>100||!/^\d+(\.\d+)?$/.test(text)||(positive&&!/[1-9]/.test(text)))throw new Error('กรอกจำนวนบวก / ราคาที่ไม่ติดลบ ด้วยเลขทศนิยม');
 return text;
}
function optional(value,max){const s=String(value??'').trim();if(s.length>max)throw new Error('ข้อความยาวเกินกำหนด');return s||null;}
export function bulkPayload(role,lines,fields,materials){
 if(role!=='admin')throw new Error('เฉพาะ Admin เท่านั้น');
 if(!lines.length||lines.length>100)throw new Error('เลือกวัตถุดิบ 1–100 รายการ');
 const seen=new Set();
 const rows=lines.map(l=>{
  if(seen.has(l.material_id))throw new Error('วัตถุดิบซ้ำ');seen.add(l.material_id);
  if(!materials.some(m=>m.id===l.material_id&&m.is_active))throw new Error('วัตถุดิบไม่มีหรือปิดใช้งาน');
  return {material_id:l.material_id,quantity:decimal(l.quantity,true),unit_purchase_price:String(l.unit_purchase_price??'').trim()===''?null:decimal(l.unit_purchase_price,false)};
 }).sort((a,b)=>a.material_id.localeCompare(b.material_id));
 if(new TextEncoder().encode(JSON.stringify(rows)).length>262144)throw new Error('รายการใหญ่เกินกำหนด');
 const type=fields.document_type;
 if(!['none','po','invoice','both'].includes(type))throw new Error('ประเภทเอกสารไม่ถูกต้อง');
 const date=optional(fields.document_date,10);
 if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date.startsWith('0000')||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw new Error('วันที่เอกสารไม่ถูกต้อง');
 return {lines:rows,supplier_source:optional(fields.supplier_source,500),document_type:type,
 po_number:['po','both'].includes(type)?optional(fields.po_number,200):null,
 invoice_number:['invoice','both'].includes(type)?optional(fields.invoice_number,200):null,
 document_date:date,note:optional(fields.note,4000)};
}
