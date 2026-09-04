import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // eslint-disable-next-line no-console
  console.error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project values.'
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,      // keep the login saved in the browser
    storage: window.localStorage,
    autoRefreshToken: true,    // silently renew the session before it expires
    detectSessionInUrl: false, // this app has no email-link/OAuth redirect flow
  },
});

// Ask the browser not to auto-clear this site's storage under low-disk-space
// pressure. Mainly helps Android/Chrome; iOS Safari has its own separate
// rules for "Add to Home Screen" apps (see note in App.jsx / README).
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}
