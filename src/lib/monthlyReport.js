// Month-end report built from the request list (one request = one pair).
// Pure functions: no network, no stock changes. Shapes follow the team's own
// Excel workbook (ProductionReport / MaterialsReport / per-category sheets / repairs).
import {PRODUCT_CATEGORIES, localDay} from './inventoryReports.js';

export const REPAIR_CATEGORY = 'ซ่อมและอื่นๆ';
// Requests in these states never count as produced.
const NOT_PRODUCED = new Set(['cancelled', 'production_not_completed']);

export const monthRange = (year, month) => {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return {from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}`};
};
export const currentMonth = (now = new Date()) => {
  const [y, m] = localDay(now).split('-').map(Number);
  return {year: y, month: m};
};
export const shiftMonth = ({year, month}, delta) => {
  const index = year * 12 + (month - 1) + delta;
  return {year: Math.floor(index / 12), month: (index % 12) + 1};
};
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const monthLabel = ({year, month}) => `${THAI_MONTHS[month - 1]} ${year}`;

export function bangkokTime(value) {
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(value));
  return `${parts.find(p => p.type === 'hour').value}:${parts.find(p => p.type === 'minute').value}`;
}
const round = value => Math.round(value * 1e6) / 1e6;
const num = value => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('จำนวนวัตถุดิบในคำขอไม่ถูกต้อง');
  return n;
};

export function buildMonthlyReport(requests, from, to) {
  const production = [], materials = [], repairs = [];
  const inPeriod = r => { const day = localDay(r.created_at); return day >= from && day <= to; };
  for (const r of requests) {
    if (NOT_PRODUCED.has(r.workflow_state) || !inPeriod(r)) continue;
    const isRepair = r.category === REPAIR_CATEGORY;
    const base = {
      date: localDay(r.created_at), time: bangkokTime(r.created_at), category: r.category, model: r.model_name || '',
      order: r.order_ref || '', worker: r.staff_name || '', request_id: r.id,
    };
    if (isRepair) {
      repairs.push({...base, reason: r.note || ''});
    } else {
      production.push({...base, qty: 1});
    }
    for (const line of r.bom_snapshot || []) {
      materials.push({
        date: base.date, time: base.time, category: r.category, model: base.model, order: base.order, worker: base.worker,
        material: line.material_name, qty: num(line.qty), unit: line.unit || '', reason: isRepair ? (r.note || '') : '',
      });
    }
  }
  const byTime = (a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.order.localeCompare(b.order);
  production.sort(byTime); materials.sort(byTime); repairs.sort(byTime);

  const extra = [...new Set(production.map(p => p.category))].filter(c => !PRODUCT_CATEGORIES.includes(c)).sort();
  const categories = [...PRODUCT_CATEGORIES, ...extra].map(name => {
    const rows = production.filter(p => p.category === name);
    const models = new Map();
    for (const p of rows) models.set(p.model, (models.get(p.model) || 0) + p.qty);
    const usage = new Map();
    for (const m of materials.filter(x => x.category === name)) {
      const k = `${m.material}\u0000${m.unit}`;
      const cur = usage.get(k) || {material: m.material, unit: m.unit, qty: 0};
      cur.qty = round(cur.qty + m.qty); usage.set(k, cur);
    }
    return {
      name, pairs: rows.reduce((a, p) => a + p.qty, 0),
      models: [...models.entries()].map(([model, pairs]) => ({model, pairs})).sort((a, b) => b.pairs - a.pairs || a.model.localeCompare(b.model)),
      materials: [...usage.values()].sort((a, b) => b.qty - a.qty || a.material.localeCompare(b.material)),
    };
  }).filter(c => c.pairs > 0 || PRODUCT_CATEGORIES.slice(0, 4).includes(c.name));
  const usageAll = new Map();
  for (const m of materials) {
    const k = `${m.material}\u0000${m.unit}`;
    const cur = usageAll.get(k) || {material: m.material, unit: m.unit, qty: 0};
    cur.qty = round(cur.qty + m.qty); usageAll.set(k, cur);
  }
  return {
    from, to, production, materials, repairs, categories,
    totalPairs: production.reduce((a, p) => a + p.qty, 0), repairCount: repairs.length,
    materialsAll: [...usageAll.values()].sort((a, b) => a.material.localeCompare(b.material)),
  };
}

// Materials that are low once the storefront balance is included.
export const lowMaterials = combined => (combined?.materials || [])
  .filter(m => Number(m.total_qty) <= Number(m.low_stock_threshold))
  .map(m => ({name: m.name, unit: m.unit, total: Number(m.total_qty), threshold: Number(m.low_stock_threshold)}));
