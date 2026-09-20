export const STAGING_READ_ONLY_BANNER = 'STAGING — READ ONLY';
export function inventoryEnvironmentPolicy(env = {}) {
  const v2Enabled=env.VITE_INVENTORY_V2_ENABLED==='true';
  const mutationsEnabled=env.VITE_INVENTORY_MUTATIONS_ENABLED==='true';
  let projectRef=null,error=null;
  if(!env.VITE_SUPABASE_URL?.trim() || !env.VITE_SUPABASE_ANON_KEY?.trim()) error='Supabase configuration missing; application blocked';
  if(v2Enabled){
    try{
      const url=new URL(env.VITE_SUPABASE_URL);
      const match=/^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
      if(url.protocol!=='https:' || url.username || url.password || url.port || url.pathname!=='/' || url.search || url.hash || !match) throw new Error('Unsupported project URL');
      projectRef=match[1];
      if(!/^[a-z0-9]{20}$/.test(env.VITE_SUPABASE_EXPECTED_PROJECT_REF||'') || projectRef!==env.VITE_SUPABASE_EXPECTED_PROJECT_REF) throw new Error('Supabase project ref mismatch');
    }catch{error='Inventory V2 blocked: project URL/ref configuration does not match';}
  }
  return Object.freeze({v2Enabled,mutationsEnabled,projectRef,error,
    banner:v2Enabled&&!mutationsEnabled?STAGING_READ_ONLY_BANNER:null});
}
export function assertInventoryEnvironment(policy) {
  if(policy.error || !policy.v2Enabled){
    const error=new Error(policy.error || 'Inventory V2 is disabled');
    error.code='INVENTORY_ENV_BLOCKED';throw error;
  }
}
export function assertInventoryMutation(enabled) {
  if(enabled!==true){const error=new Error('STAGING — READ ONLY: inventory mutations disabled');error.code='INVENTORY_MUTATIONS_DISABLED';throw error;}
}
export async function bootstrapInventory(policy, {load,render,blocked}) {
  if(policy.error){blocked(policy.error);return false;}
  render(await load());return true;
}
export const inventoryEnvironment=inventoryEnvironmentPolicy(import.meta.env || {});
