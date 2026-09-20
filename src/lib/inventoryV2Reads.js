export const inventoryV2Enabled = value => value === 'true';
export const v2Tabs = role => role === 'admin' ? ['requests','queue','materials','report','movements']
  : role === 'staff' ? ['requests'] : role === 'purchasing' ? ['materials','report','movements'] : [];
export const manualPendingLines = row => (row.lines ?? []).filter(line => (line.requires_picking ?? true) && !line.picked);

// No mutations or table access accepted by this controller.
export function createInventoryReader(api, tab, params = {}, pageSize = 50) {
  let state = { rows: [], loading: false, error: null, hasMore: false };
  let cursor = {}; let flight = null; let initialized = false;
  const listeners = new Set();
  const set = next => { state = { ...state, ...next }; listeners.forEach(fn => fn()); };
  const load = (more = false) => {
    if (flight) return flight;
    if (more && (!initialized || !state.hasMore)) return Promise.resolve();
    flight = Promise.resolve().then(async () => {
      const paging = more ? cursor : {};
      let result;
      if (tab === 'requests') result = await api.list_my_requests({ ...paging, limit: pageSize });
      else if (tab === 'queue') result = await api.list_pick_queue({ ...paging, limit: pageSize });
      else if (tab === 'materials') result = await api.list_materials({ include_inactive: true });
      else if (tab === 'report') result = await api.balance_report(params);
      else if (tab === 'movements') result = await api.list_movements({ ...paging, limit: pageSize });
      else throw new Error('Unsupported read-only tab');
      const rows = tab === 'report' ? result.materials : tab === 'movements' ? result.rows : result;
      if (!Array.isArray(rows)) throw new Error('Invalid inventory response');
      const last = rows.at(-1);
      if (tab === 'requests' || tab === 'queue') cursor = last ? { after_at: last.created_at, after_id: last.id } : paging;
      if (tab === 'movements') cursor = { after_sequence: last?.sequence_no ?? paging.after_sequence ?? 0,
        cutoff_sequence: result.cutoff_sequence };
      initialized = true;
      const merged = more ? [...state.rows, ...rows] : rows;
      const seen = new Set();
      set({ rows: merged.filter(row => { const key = row.id; if (seen.has(key)) return false; seen.add(key); return true; }),
        loading: false, error: null, hasMore: ['requests','queue','movements'].includes(tab) && rows.length === pageSize });
    }).catch(error => { set({ loading: false, error }); }).finally(() => { flight = null; });
    set({ loading: true, error: null });
    return flight;
  };
  return { load, getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
}
