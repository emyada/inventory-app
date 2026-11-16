// Pick queue grouped by the person who filed the request (profile name of the logged-in account).
import {PRODUCT_CATEGORIES, sumAmounts, negative} from './inventoryReports.js';
import {closedRequest} from './inventoryRequestUX.js';
import {orderRequirements} from './inventoryOrderConfirmation.js';

export const requesterKey = row => String(row.staff_name || '').trim().toLowerCase() || 'unknown';
const REPAIR = 'ซ่อมและอื่นๆ';

// One request = one pair (or one repair job). Lines: model, category, count.
export function modelCounts(rows) {
  const counts = new Map();
  for (const r of rows) {
    const key = `${r.category}\u0000${r.model_name}`;
    const cur = counts.get(key) || {category: r.category, model: r.model_name || '-', label: r.category === REPAIR ? `ซ่อม/อื่นๆ · ${r.model_name || '-'}` : (r.model_name || '-'), count: 0};
    cur.count += 1; counts.set(key, cur);
  }
  const rank = c => { const i = PRODUCT_CATEGORIES.indexOf(c); return i < 0 ? 99 : i; };
  return [...counts.values()].sort((a, b) => rank(a.category) - rank(b.category) || b.count - a.count || a.label.localeCompare(b.label));
}

export function groupByRequester(rows) {
  const seen = new Set(), groups = new Map();
  for (const r of rows) {
    if (!r.id || seen.has(r.id) || closedRequest(r) || r.can_pick === false) continue;
    seen.add(r.id);
    const key = requesterKey(r);
    const g = groups.get(key) || {key, name: String(r.staff_name || '').trim() || 'ไม่ระบุชื่อ', rows: []};
    g.rows.push(r); groups.set(key, g);
  }
  return [...groups.values()].map(g => ({...g, models: modelCounts(g.rows)})).sort((a, b) => a.name.localeCompare(b.name));
}

// Total of every not-yet-picked line across the rows (these are the piece items; automatic
// materials were already deducted when the request was filed) against current stock.
export function groupRequirements(rows, materials) {
  const total = new Map();
  for (const row of rows) {
    for (const r of orderRequirements(row, materials)) {
      const cur = total.get(r.id) || {id: r.id, name: r.name, unit: r.unit, required: '0'};
      if (cur.unit !== r.unit) throw new Error('Conflicting units');
      cur.required = sumAmounts([cur.required, r.required]); total.set(r.id, cur);
    }
  }
  return [...total.values()].map(g => {
    const m = materials.find(x => x.id === g.id);
    const valid = m && m.is_active !== false && m.unit === g.unit;
    return {...g, available: valid ? String(m.qty) : null, insufficient: !valid || sumAmounts([m.qty, negative(g.required)]).startsWith('-')};
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// Which orders fit current stock? Oldest order first; an order that would push any material below zero
// (given the orders already accepted) is "short" and listed with what it lacks. Orders whose
// requirements cannot be computed are never accepted.
export function splitByStock(rows, materials) {
  const sorted = [...rows].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)));
  const fit = [], short = [];
  for (const row of sorted) {
    try {
      const lacking = groupRequirements([...fit, row], materials).filter(r => r.insufficient).map(r => r.name);
      if (lacking.length) short.push({row, lacking}); else fit.push(row);
    } catch (e) { short.push({row, lacking: [e.message]}); }
  }
  return {fit, short};
}
