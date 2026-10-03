export const managementKinds = ['create_material','update_material','set_material_active','receive_purchase','receive_purchase_v21','stocktake','save_model','set_model_active'];
export const canManage = (role, kind) => managementKinds.includes(kind) && (role === 'admin' || (role === 'purchasing' && ['receive_purchase','receive_purchase_v21'].includes(kind)));
const text = (value, label) => { if (typeof value !== 'string' || !value.trim()) throw new Error('กรุณาระบุ'+label); return value.trim(); };
const id = value => { if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value ?? '')) throw new Error('UUID ไม่ถูกต้อง'); return value; };
export function decimal(value, positive = false) {
  const raw = String(value ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error('จำนวนต้องเป็นเลขทศนิยมที่ไม่ติดลบ');
  const [whole, fraction = ''] = raw.split('.');
  const clean = whole.replace(/^0+(?=\d)/,'') + (fraction.replace(/0+$/,'') ? '.'+fraction.replace(/0+$/,'') : '');
  if (positive && clean === '0') throw new Error('จำนวนต้องมากกว่า 0'); return clean;
}
export function version(value) {
  if ((typeof value === 'number' && !Number.isSafeInteger(value)) || !/^\d+$/.test(String(value ?? ''))) throw new Error('qty_version ไม่ถูกต้อง ต้องโหลดข้อมูลใหม่');
  return String(value).replace(/^0+(?=\d)/,'');
}
export const isStaleStock = error => error?.code === 'STALE_QTY_VERSION' || /Stock changed; recount\/review required/i.test(error?.message || '');
export function assertStocktakeVersion(expected, latest) {
  if (!latest || version(latest.qty_version) !== version(expected)) {
    const error = new Error('ยอดเปลี่ยนแล้ว หยุดรายการนี้และตรวจนับ/ทบทวนข้อมูลล่าสุด');
    error.code='STALE_QTY_VERSION';error.latest=latest;error.uncertain=false;throw error;
  }
}
export function managementError(error) {
  let message = error?.message || 'ทำรายการไม่สำเร็จ';
  if (isStaleStock(error)) message = 'ยอดเปลี่ยนแล้ว ระบบหยุดส่งรายการ กรุณาโหลดข้อมูลล่าสุดและทบทวนการตรวจนับ';
  else if (/Material used by pending requests/i.test(message)) message = 'ปิดวัตถุดิบไม่ได้: ยังมีบรรทัดของวัตถุดิบนี้รอหยิบ';
  else if (/inactive|missing material|Material missing/i.test(message)) message = 'ไม่พบวัตถุดิบหรือวัตถุดิบปิดใช้งานแล้ว กรุณาโหลดข้อมูลใหม่';
  else if (/permission|not allowed|role|not authorized/i.test(message)) message = 'ไม่มีสิทธิ์ทำรายการนี้';
  return message+(error?.code ? ' ['+error.code+']' : '');
}
export function managementPayload(kind, input, role, row) {
  if (!canManage(role,kind)) {const e=new Error('ไม่มีสิทธิ์ทำรายการนี้');e.code='UI_FORBIDDEN';throw e;}
  const flag = value => {if(typeof value!=='boolean')throw new Error('กรุณากำหนดสวิตช์');return value;};
  if (kind==='create_material') {
    const initial=decimal(input.initial_qty);
    return {name:text(input.name,'ชื่อ'),unit:text(input.unit,'หน่วย'),initial_qty:initial,
      low_stock_threshold:decimal(input.low_stock_threshold),requires_picking:flag(input.requires_picking),
      reason:initial!=='0'?text(input.reason,'เหตุผลยอดตั้งต้น'):(input.reason||'').trim()};
  }
  if (kind==='update_material') {
    if (input.unit!==undefined && input.unit!==row?.unit) throw new Error('ห้ามเปลี่ยนหน่วยของวัตถุดิบเดิม');
    return {material_id:id(row?.id),name:text(input.name,'ชื่อ'),unit:text(row?.unit,'หน่วยเดิม'),
      low_stock_threshold:decimal(input.low_stock_threshold),requires_picking:flag(input.requires_picking)};
  }
  if (kind==='set_material_active' || kind==='set_model_active') return {
    [kind==='set_material_active'?'material_id':'model_id']:id(row?.id),is_active:flag(input.is_active),reason:text(input.reason,'เหตุผล')};
  if (kind==='receive_purchase') return {material_id:id(row?.id),quantity:decimal(input.quantity,true),reference:(input.reference||'').trim(),note:(input.note||'').trim()};
  if (kind==='receive_purchase_v21') {
    const type=input.document_type;
    if(!['none','po','invoice','both'].includes(type))throw new Error('Invalid receipt document type');
    const optional=(value,max)=>{const s=(value||'').trim();if(s.length>max)throw new Error('Receipt document field too long');return s||null;};
    const required=(value)=>{const s=optional(value,200);if(!s)throw new Error('Document number required');return s;};
    return {material_id:id(row?.id),quantity:decimal(input.quantity,true),
      supplier_source:optional(input.supplier_source,500),document_type:type,
      po_number:['po','both'].includes(type)?required(input.po_number):null,
      invoice_number:['invoice','both'].includes(type)?required(input.invoice_number):null,
      note:(input.note||'').trim()};
  }
  if (kind==='stocktake') {
    const counted=decimal(input.counted_qty);const reason=(input.reason||'').trim();
    if (counted!==decimal(row?.qty)) text(reason,'เหตุผลเมื่อยอดต่าง');
    return {material_id:id(row?.id),counted_qty:counted,expected_version:version(row?.qty_version),reason};
  }
  if (kind==='save_model') {
    if (!Array.isArray(input.bom) || !input.bom.length) throw new Error('BOM ต้องมีวัตถุดิบอย่างน้อย 1 รายการ');
    return {model_id:row?.id?id(row.id):null,name:text(input.name,'ชื่อรุ่น'),category:text(input.category,'หมวด'),
      bom:input.bom.map(b=>({material_id:id(b.material_id),qty:decimal(b.qty,true)}))};
  }
  throw new Error('Unsupported management action');
}
export const needsManagementConfirmation = (kind,row) => ['stocktake','set_material_active','set_model_active'].includes(kind) || (kind==='save_model' && Boolean(row?.id));
// Retain one submission across fresh reads, confirmation and operation execution.
export function createManagementSubmission({api,kind,input,role,row,loadMaterial,confirm,onPrepared=()=>{},onLatest=()=>{}}) {
  const original=structuredClone(input);const observed=structuredClone(row);
  let operation=null;let flight=null;
  function execute() {
    if(flight)return flight;
    flight=Promise.resolve().then(async()=>{
      if(operation)return operation.execute();
      let latest=observed;
      managementPayload(kind,original,role,observed);
      if(['update_material','stocktake'].includes(kind)) {
        latest=await loadMaterial(observed.id);onLatest(latest);
        if(kind==='stocktake')assertStocktakeVersion(observed.qty_version,latest);
      }
      const payload=managementPayload(kind,original,role,latest);
      if(needsManagementConfirmation(kind,observed) && !await confirm({kind,payload,row:latest})) return {cancelled:true};
      operation=api[kind](payload);onPrepared(operation);return operation.execute();
    }).catch(async error=>{
      if(kind==='stocktake' && isStaleStock(error)) {
        try {onLatest(await loadMaterial(observed.id));}catch(reloadError){error.reloadError=reloadError;}
      }
      throw error;
    }).finally(()=>{flight=null;});return flight;
  }
  return {execute,get operation(){return operation;}};
}
