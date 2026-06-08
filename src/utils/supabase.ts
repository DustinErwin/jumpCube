import { createClient } from "@supabase/supabase-js";

/*
 * Shared Supabase browser client.
 *
 * Required Vite env vars:
 * - VITE_SUPABASE_URL: project URL
 * - VITE_SUPABASE_PUBLISHABLE_KEY: anon/publishable browser key
 *
 * Do not put the service role key in src; browser code is public.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Import this singleton anywhere client-side database/auth access is needed.
export const supabase = createClient(supabaseUrl, supabaseKey);
