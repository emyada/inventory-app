import {sumAmounts} from './inventoryReports.js';

// Pure decimal arithmetic: never round quantities or infer pair/side/unit conversions.
function decimal(value, positive = false) {
  if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value)>Number.MAX_SAFE_INTEGER)) throw new Error('จำนวนเกินความแม่นยำที่อ่านได้');
  const text = typeof value === 'number' ? sumAmounts([value]) : String(value ?? '');
  if (!/^\d{1,18}(\.\d{1,12})?$/.test(text)) throw new Error('จำนวนต้องเป็นเลขฐานสิบไม่ติดลบ (ทศนิยมไม่เกิน 12 ตำแหน่ง)');
  const [whole, fraction = ''] = text.split('.');
  const n = BigInt(whole + fraction);
  if (positive && n === 0n) throw new Error('จำนวนและ BOM ต้องมากกว่า 0');
  return {n, scale: fraction.length};
}
function multiply(a, b) {
  const x = decimal(a, true), y = decimal(b, true);
  const scale = x.scale + y.scale;
  const digits = (x.n * y.n).toString().padStart(scale + 1, '0');
  return sumAmounts([scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits]);
}
function index(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`ไม่มีข้อมูล ${label}`);
  const map = new Map();
  for (const row of rows) {
    if (!row.id || map.has(row.id)) throw new Error(`${label}: รหัสขาดหรือซ้ำ`);
    map.set(row.id, row);
  }
  return map;
}
export function simulateInventory({entries, models, materials, boms}) {
  const modelIndex = index(models, 'รุ่น'), materialIndex = index(materials, 'วัตถุดิบ');
  if (!Array.isArray(entries)) throw new Error('ไม่มีรายการจำลอง');
  const totals = new Map();
  for (const entry of entries) {
    const model = modelIndex.get(entry.model_id);
    if (!model || !model.name || !model.category || model.category !== entry.category) throw new Error('รุ่น/หมวดไม่ตรงกับข้อมูลที่อ่าน');
    if (!['Using', 'Used'].includes(entry.mode)) throw new Error('เลือก Using หรือ Used');
    decimal(entry.quantity, true);
    const bom = boms[model.id];
    if (!Array.isArray(bom) || !bom.length) throw new Error(`ไม่มี BOM: ${model.name}`);
    const seen = new Set(), lineIds = new Set();
    for (const line of bom) {
      if (line.id && lineIds.has(line.id)) throw new Error(`รหัสบรรทัด BOM ซ้ำ: ${model.name}`);
      if (line.id) lineIds.add(line.id);
      if (!line.material_id || seen.has(line.material_id)) throw new Error(`BOM ซ้ำ/กำกวม: ${model.name}`);
      seen.add(line.material_id);
      const material = materialIndex.get(line.material_id);
      if (!material?.name || !material.unit?.trim()) throw new Error('BOM ไม่มีวัตถุดิบหรือหน่วยที่ยืนยันได้');
      if (line.unit != null && line.unit !== material.unit) throw new Error('หน่วย BOM ขัดแย้งกับหน่วยวัตถุดิบ');
      decimal(material.qty);
      const qty = multiply(line.qty, entry.quantity);
      const row = totals.get(material.id) || {material_id: material.id, material_name: material.name, unit: material.unit, total_bom: '0', simulated_unused: '0', current_stock: sumAmounts([material.qty])};
      row.total_bom = sumAmounts([row.total_bom, qty]);
      if (entry.mode === 'Using') row.simulated_unused = sumAmounts([row.simulated_unused, qty]);
      row.simulated_combined_total = sumAmounts([row.current_stock, row.simulated_unused]);
      totals.set(material.id, row);
    }
  }
  return [...totals.values()].sort((a,b) => a.material_id.localeCompare(b.material_id));
}

// Only the existing read capabilities are accepted; no operation IDs or writes.
export async function loadSimulationCatalog({listMaterials, listModels}, role) {
  if (!['admin','purchasing'].includes(role)) throw new Error('ไม่มีสิทธิ์อ่านรายงาน');
  const [materials, models] = await Promise.all([listMaterials(), listModels()]);
  index(materials, 'วัตถุดิบ'); index(models, 'รุ่น');
  return {materials, models, capturedAt: new Date().toISOString()};
}
export async function calculateSimulation(catalog, entries, loadBom) {
  const boms = Object.fromEntries(await Promise.all([...new Set(entries.map(e=>e.model_id))].map(async id=>[id, await loadBom(id)])));
  return {rows: simulateInventory({...catalog, entries, boms}), boms};
}

// Categories come from every authorized model, including models without a BOM.
export function simulationCategories(models) {
  return [...new Set(models.map(model=>model.category).filter(category=>typeof category==='string'&&category.trim()))];
}
export async function loadSimulationAvailability(catalog, loadBom) {
  const availability = {};
  for (const model of catalog.models) {
    let bom;
    try { bom = await loadBom(model.id); }
    catch { availability[model.id]={valid:false,reason:'อ่าน BOM ไม่สำเร็จ กรุณาอ่านข้อมูลใหม่'}; continue; }
    try {
      simulateInventory({...catalog,entries:[{model_id:model.id,category:model.category,quantity:'1',mode:'Using'}],boms:{[model.id]:bom}});
      availability[model.id]={valid:true,reason:''};
    } catch (error) { availability[model.id]={valid:false,reason:error.message}; }
  }
  return {...catalog, availability};
}
export function simulationSelectionReady(catalog, entries) {
  return Boolean(catalog&&entries.length&&entries.every(entry=>
    catalog.models.some(model=>model.id===entry.model_id&&model.category===entry.category)&&catalog.availability?.[entry.model_id]?.valid));
}
