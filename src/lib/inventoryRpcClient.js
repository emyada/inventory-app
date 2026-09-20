import { inventoryEnvironment, assertInventoryEnvironment } from './inventoryEnvironment.js';
// New path only; existing useInventoryData remains untouched until workflow integration.
import { supabase } from './supabaseClient.js';
import { createInventoryApi } from './inventoryApi.js';
const controls={mutationsEnabled:inventoryEnvironment.mutationsEnabled,assertAccess:()=>assertInventoryEnvironment(inventoryEnvironment)};
export const inventoryApi = createInventoryApi(supabase,controls);

import { createRecoveryInventory } from './inventoryRecovery.js';
export function createUserInventory(userId) {
  assertInventoryEnvironment(inventoryEnvironment);
  return createRecoveryInventory(supabase, { ...controls, userId, currentUserId: async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session?.user?.id;
  } });
}
