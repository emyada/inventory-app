import React, { createContext, useContext, useEffect, useState } from 'react';
import {startSessionLifecycle} from '../lib/sessionLifecycle.js';
import { supabase } from '../lib/supabaseClient';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [{session,profile,loading,error},setState]=useState({session:null,profile:null,loading:true,error:null});
  useEffect(()=>{
    const lifecycle=startSessionLifecycle(supabase,setState);
    const refresh=()=>{if(document.visibilityState==='visible')void lifecycle.refresh();};
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    const timer=setInterval(refresh,60000);
    return()=>{lifecycle.stop();clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[]);

  async function signIn(email, password) {
    return supabase.auth.signInWithPassword({ email, password });
  }
  async function signOut() {
    return supabase.auth.signOut();
  }

  const role = profile?.role || 'staff'; // 'admin' | 'staff' | 'purchasing'

  return (
    <AuthCtx.Provider value={{ session, profile, role, loading, error, signIn, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}
