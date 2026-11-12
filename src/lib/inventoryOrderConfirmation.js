// P0 candidate adapter: one existing transaction UUID represents one order.
import {sumAmounts,negative} from './inventoryReports.js';
export function orderRequirements(order, materials) {
  if (!order || order.confirmation_contract !== 'admin-whole-order-v1' || !Array.isArray(order.bom_snapshot)) throw new Error('P0 server contract required');
  const groups=new Map();
  for(const b of order.bom_snapshot.filter(b=>!b.picked)) {
    const q=sumAmounts([b.qty]);if(q==='0'||q.startsWith('-'))throw new Error('Invalid snapshot quantity');
    const g=groups.get(b.material_id)||{id:b.material_id,name:b.material_name,unit:b.unit,required:'0'};
    if(g.unit!==b.unit)throw new Error('Conflicting units');
    g.required=sumAmounts([g.required,q]);groups.set(b.material_id,g);
  }
  return [...groups.values()].map(g=>{const m=materials.find(m=>m.id===g.id);const valid=m&&m.is_active!==false&&m.unit===g.unit;
    return {...g,available:valid?String(m.qty):null,insufficient:!valid||sumAmounts([m.qty,negative(g.required)]).startsWith('-')};});
}
export function prepareOrderConfirmation(api, orders, selectedIds, role) {
  if (role !== 'admin') throw new Error('Admin confirmation required');
  if (!selectedIds.length || new Set(selectedIds).size !== selectedIds.length) throw new Error('Invalid order selection');
  const byId = new Map();
  for (const order of orders) {
    if (!order.id || byId.has(order.id)) throw new Error('Ambiguous order identity');
    byId.set(order.id, order);
  }
  const items = [];
  for (const id of selectedIds) {
    const order = byId.get(id);
    if (!order || !order.order_ref || order.can_pick === false || order.cancelled_at ||
      ['cancelled','completed','production_not_completed','legacy_completed_shipped'].includes(order.workflow_state)) throw new Error('Order not actionable');
    // Must be a complete snapshot, not the legacy queue projection (manual lines only).
    if (!Array.isArray(order.bom_snapshot) || !order.bom_snapshot.length) throw new Error('Complete order snapshot required');
    const seen = new Set();
    for (const line of order.bom_snapshot) {
      if (!line.line_id || seen.has(line.line_id)) throw new Error('Invalid allocation identity');
      seen.add(line.line_id);
      if (!line.picked) items.push({transaction_id:id,line_id:line.line_id});
    }
  }
  if (!items.length) throw new Error('No pending allocation');
  items.sort((a,b)=>`${a.transaction_id}:${a.line_id}`.localeCompare(`${b.transaction_id}:${b.line_id}`));
  // Existing operation API owns the stable UUID and recovery journal.
  return api.confirm_pick({items});
}
