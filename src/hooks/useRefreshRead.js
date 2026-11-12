import {createContext,useContext,useEffect} from 'react';
export const RefreshContext=createContext(null);
export const RefreshActionContext=createContext(null);
// Reuse each screen's real reader; no synthetic totals, remount, or page reload.
export function useRefreshRead(load,success,failure,deps) {
  const group=useContext(RefreshContext);
  // Callers supply explicit query keys; callbacks are captured for that subscription.
  useEffect(()=>{
    let alive=true,serial=0;
    const run=async()=>{const ticket=++serial;try{const value=await load();if(alive&&ticket===serial)success(value);}catch(e){if(alive&&ticket===serial)failure(e);throw e;}};
    const unregister=group?.register(run);
    void run().catch(()=>{});
    return()=>{alive=false;serial++;unregister?.();};
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- custom effect forwards caller query keys
  },[group,...deps]);
}
