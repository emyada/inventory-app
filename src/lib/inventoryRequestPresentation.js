import {closedRequest} from './inventoryRequestUX.js';

export const UNASSIGNED_WORKER = 'unassigned';

// The current RPC's staff_name is the requester's profile snapshot, not a
// worker assignment. Never present it (or created_by) as responsible worker.
export function pendingWorkerGroups(requests) {
  const seen=new Set();
  const rows=requests.filter(row=>{
    if(!row.id||seen.has(row.id)||closedRequest(row)||row.can_pick===false)return false;
    seen.add(row.id);return true;
  });
  return rows.length?[{key:UNASSIGNED_WORKER,name:'ยังไม่ระบุช่าง',rows}]:[];
}
