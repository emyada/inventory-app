import {rpcData} from './inventoryFailure.js';
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

import {createOpeningApi} from './inventoryOpening.js';
export function createUserOpening(userId){
 return createOpeningApi(supabase,{userId,projectRef:inventoryEnvironment.projectRef,assertAccess:controls.assertAccess,currentUserId:async()=>{const {data,error}=await supabase.auth.getSession();if(error)throw error;return data.session?.user?.id;}});
}

export async function setRequestPolicy(input){controls.assertAccess();if(!controls.mutationsEnabled)throw new Error('READ ONLY');const {data,error}=await supabase.rpc('inventory_set_request_policy',input);rpcData({data,error},{mutation:true});if(typeof data?.employee_requests_enabled!=='boolean')throw new Error('Invalid policy');return data;}
