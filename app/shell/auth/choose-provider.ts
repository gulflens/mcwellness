import { devAuth } from './dev-auth';
import { supabaseAuth } from './supabase-auth';
import type { AuthProvider } from './types';

/** Supabase whenever it is configured; otherwise the development door, which only a laptop's API opens. */
export function chooseProvider(env: {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}): AuthProvider {
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
    return supabaseAuth(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
  }
  return devAuth();
}
