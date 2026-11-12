// Phase 4C.1: pure projections of an atomic, Admin-authorized ledger read.
// Never reads current BOMs, calls mutation RPCs, or changes inventory.
import {sumAmounts, negative, validatePeriod} from './inventoryReports.js';

const key = (...parts) => JSON.stringify(parts);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function requireValue(ok, message) { if (!ok) throw new Error(message); }
function decimal(value) {
  requireValue(typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value), 'Decimal must be an exact string');
  return sumAmounts([value]);
}
export function bangkokBounds(from, to) {
  validatePeriod(from, to);
  const start = Date.parse(`${from}T00:00:00+07:00`);
  return {from: new Date(start).toISOString(), to_exclusive: new Date(Date.parse(`${to}T00:00:00+07:00`) + 86400000).toISOString()};
}
function timestamp(value) {
  requireValue(typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), 'Invalid timestamp');
  return Date.parse(value);
}
function unique(rows, field) {
  const result = new Map();
  for (const row of rows) { requireValue(row[field] && !result.has(row[field]), `Duplicate/missing ${field}`); result.set(row[field], row); }
  return result;
}
export function buildReportingDataset(input, {from, to}) {
  requireValue(input.contract === 'reporting-evidence-v1' && input.complete === true, 'Incomplete evidence');
  const bounds = bangkokBounds(from, to), start = timestamp(bounds.from), end = timestamp(bounds.to_exclusive);
  requireValue(typeof input.cutoff_sequence === 'string' && /^\d+$/.test(input.cutoff_sequence), 'Invalid cutoff');
  const cutoff = BigInt(input.cutoff_sequence);
  requireValue(cutoff >= 0n && input.mapping?.revision_id, 'Missing cutoff or mapping revision');
  const requests = unique(input.requests, 'id'), movements = unique(input.movements, 'id');
  const mappings = unique(input.mapping.entries, 'model_id');
  for (const m of mappings.values()) requireValue(['primary','supplemental'].includes(m.work_kind) && typeof m.report_category === 'string' && m.report_category.trim(), 'Invalid mapping');
  // Exact historical repair contract from inventory_create_request; never invent IDs.
  // Unknown/null-model categories or subtypes remain explicitly unmapped.
  const classification = r => r.model_id === null
    ? (r.category === 'ซ่อมและอื่นๆ' && ['CIEM','Tactical','Lifestyle','Sleepplug','อื่นๆ'].includes(r.model_name)
      ? {work_kind:'primary',report_category:'Repair & Others'} : undefined)
    : mappings.get(r.model_id);
  const warnings = [], first = new Map(), lines = [], seen = new Set(), sequences = new Set();
  for (const movement of movements.values()) {
    requireValue(typeof movement.sequence_no === 'string' && /^[1-9]\d*$/.test(movement.sequence_no), 'Invalid sequence');
    requireValue(!sequences.has(movement.sequence_no), 'Duplicate sequence'); sequences.add(movement.sequence_no);
    requireValue(BigInt(movement.sequence_no) <= cutoff, 'Movement exceeds cutoff');
    const at = timestamp(movement.occurred_at), delta = decimal(movement.delta);
    requireValue(['production_issue','cancellation_return'].includes(movement.reason), 'Unexpected movement reason');
    requireValue(movement.reason === 'production_issue' ? delta.startsWith('-') && delta !== '-0' : !delta.startsWith('-') && delta !== '0', 'Invalid movement sign');
    requireValue(movement.material_id && movement.unit, 'Missing material or unit');
    requireValue(sumAmounts(movement.allocations.map(a => decimal(a.delta))) === delta, 'Allocation reconciliation failed');
    for (const allocation of movement.allocations) {
      const id = key(movement.id, allocation.transaction_id, allocation.line_id);
      requireValue(!seen.has(id), 'Duplicate allocation'); seen.add(id);
      const request = requests.get(allocation.transaction_id), amount = decimal(allocation.delta);
      requireValue(request && amount !== '0' && amount.startsWith('-') === delta.startsWith('-'), 'Invalid allocation');
      const snapshot = request.bom_snapshot.filter(s => s.line_id === allocation.line_id);
      requireValue(snapshot.length === 1 && snapshot[0].material_id === movement.material_id && snapshot[0].unit === movement.unit, 'Snapshot line/unit mismatch');
      requireValue(allocation.order_ref === request.order_ref, 'Allocation reference mismatch');
      if (movement.reason === 'production_issue' && (!first.has(request.id) || at < first.get(request.id))) first.set(request.id, at);
      lines.push({movement, request, allocation, at, amount});
    }
  }
  const issued = [...requests.values()].filter(r => first.has(r.id));
  const primary = issued.filter(r => classification(r)?.work_kind === 'primary');
  const ambiguous = new Set();
  // Normalization detects ambiguity only; it NEVER merges orders or links Packages.
  const refs = new Map();
  for (const r of primary) {
    if (!r.order_ref?.trim()) { ambiguous.add(r.id); continue; }
    const k = key(r.category, r.order_ref.trim().toLowerCase());
    const group = refs.get(k) || []; group.push(r); refs.set(k, group);
  }
  for (const group of refs.values()) if (group.length > 1) group.forEach(r => ambiguous.add(r.id));
  for (const id of ambiguous) warnings.push({code:'AMBIGUOUS_BUSINESS_IDENTITY', request_id:id});
  const attribution = new Map();
  for (const r of requests.values()) {
    const map = classification(r);
    let target = r, bucket = null;
    if (!map) { bucket = 'Unmapped Model'; warnings.push({code:'UNMAPPED_MODEL', request_id:r.id}); }
    if (map?.work_kind === 'supplemental') {
      const candidates = primary.filter(p => p.category === r.category && p.order_ref === r.order_ref && r.order_ref?.trim() && classification(p).report_category === map.report_category);
      if (candidates.length === 1 && !ambiguous.has(candidates[0].id)) target = candidates[0];
      else { bucket = 'Unmapped Package'; warnings.push({code:'UNMAPPED_PACKAGE', request_id:r.id}); }
    }
    attribution.set(r.id, {report_category:map?.report_category || 'Unmapped', model_id:bucket ? null : target.model_id, model_name:bucket || target.model_name, primary_request_id:bucket ? null : target.id});
  }
  const orders = primary.filter(r => first.get(r.id) >= start && first.get(r.id) < end).map(r => ({request_id:r.id, order_ref:r.order_ref, source_category:r.category, ...attribution.get(r.id), first_issue_at:new Date(first.get(r.id)).toISOString(), count:1, identity_ambiguous:ambiguous.has(r.id)}));
  const evidence = lines.filter(l => l.at >= start && l.at < end).map(l => ({movement_id:l.movement.id, sequence_no:l.movement.sequence_no, request_id:l.request.id, line_id:l.allocation.line_id, order_ref:l.request.order_ref, source_model_id:l.request.model_id, source_category:l.request.category, ...attribution.get(l.request.id), material_id:l.movement.material_id, material_name:l.movement.material_name, unit:l.movement.unit, occurred_at:l.movement.occurred_at, reason:l.movement.reason, gross_issued:l.movement.reason === 'production_issue' ? negative(l.amount) : '0', returned:l.movement.reason === 'cancellation_return' ? l.amount : '0'}));
  function totals(fields) {
    const groups = new Map();
    for (const line of evidence) {
      const k = key(...fields.map(f => line[f]));
      const g = groups.get(k) || {...Object.fromEntries(fields.map(f => [f,line[f]])), gross_issued:'0', returned:'0'};
      g.gross_issued = sumAmounts([g.gross_issued,line.gross_issued]); g.returned = sumAmounts([g.returned,line.returned]);
      g.net_consumption = sumAmounts([g.gross_issued,negative(g.returned)]); groups.set(k,g);
    }
    return [...groups.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([,g]) => g);
  }
  const units = new Map();
  for (const line of evidence) { const set = units.get(line.material_id) || new Set(); set.add(line.unit); units.set(line.material_id,set); }
  for (const [id, set] of units) if (set.size > 1) warnings.push({code:'MULTIPLE_RECORDED_UNITS',material_id:id});
  const products = new Map();
  for (const o of orders) { const k = key(o.report_category,o.model_id,o.model_name), g = products.get(k) || {report_category:o.report_category,model_id:o.model_id,model_name:o.model_name,request_count:0,ambiguous_count:0}; g.request_count++; g.ambiguous_count += Number(o.identity_ambiguous); products.set(k,g); }
  return freeze({contract:'reporting-dataset-v1', calculation_version:1, timezone:'Asia/Bangkok', date_from:from,date_to:to,...bounds,cutoff_sequence:String(cutoff),mapping_revision:input.mapping.revision_id,
    classification_complete:!warnings.some(w=>w.code==='UNMAPPED_MODEL'),business_identities_unambiguous:ambiguous.size===0,
    order_count:orders.length,orders:orders.sort((a,b)=>a.request_id.localeCompare(b.request_id)), products:[...products.values()],
    materials:totals(['material_id','unit']), model_materials:totals(['report_category','model_id','model_name','material_id','unit']), evidence,warnings});
}

export async function loadReportingDataset(client, {from,to,cutoffSequence=null,mappingRevision}) {
  bangkokBounds(from,to);
  const {data,error} = await client.rpc('reporting_read_evidence_v1', {p_cutoff_sequence:cutoffSequence,p_mapping_revision:mappingRevision});
  if (error) throw new Error('Reporting read denied or unavailable');
  return buildReportingDataset(data,{from,to});
}
