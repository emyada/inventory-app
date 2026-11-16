// Jobs that were closed as "production not completed" at month end, and who picked them up again.
// A continuation is an ordinary new request for the same model and order number, so the link is
// derived (same model + same order key, filed after the original) rather than stored separately.
import {numericOrderKey} from './duplicateOrderPolicy.js';
import {localDay} from './inventoryReports.js';

export const orderKey = ref => numericOrderKey(ref || '') ?? `text:${String(ref || '').trim().toLowerCase()}`;
export const isUnfinished = r => r.workflow_state === 'production_not_completed' || r.closure_kind === 'production_not_completed';
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function unfinishedJobs(requests) {
  const jobs = [];
  for (const r of requests) {
    if (!isUnfinished(r)) continue;
    const key = orderKey(r.order_ref);
    const next = r.model_id ? requests
      .filter(x => x.id !== r.id && x.model_id === r.model_id && orderKey(x.order_ref) === key && x.workflow_state !== 'cancelled' && x.created_at > r.created_at)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0] : null;
    const lines = (r.return_summary || []).map(s => {
      const b = (r.bom_snapshot || []).find(x => x.line_id === s.line_id) || {};
      return {material: b.material_name || '-', unit: b.unit || '', planned: num(b.qty), returned: num(s.returned_qty), consumed: num(s.consumed_qty)};
    });
    jobs.push({
      id: r.id, date: localDay(r.created_at), closed: r.cancelled_at ? localDay(r.cancelled_at) : '',
      category: r.category, model: r.model_name || '', model_id: r.model_id || null, order: r.order_ref || '', worker: r.staff_name || '',
      lines, continued: next ? {id: next.id, date: localDay(next.created_at), order: next.order_ref || ''} : null,
    });
  }
  return jobs.sort((a, b) => (a.date + a.order).localeCompare(b.date + b.order));
}

// Order number to pre-fill when starting the job again (digits only when a prefix would be added).
export const continuationOrder = ref => String(ref || '').replace(/^[A-Za-z]+(?=\d+$)/, '');
