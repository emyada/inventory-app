import { supabase } from './supabaseClient.js';
// Model metadata read only; BOM quantities always resolved by create_request on server.
export async function loadActiveModels() {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.from('models').select('id,name,category').eq('is_active', true).order('id').range(offset, offset + 99);
    if (error) throw error;
    rows.push(...data); if (data.length < 100) return rows;
  }
}

import { createManagementCatalog } from './inventoryManagementCatalog.js';
export const managementCatalog = createManagementCatalog(supabase);
