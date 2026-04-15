import { createClient } from '@supabase/supabase-js'

/**
 * Creates a Supabase admin client using the service role key.
 * 
 * WARNING: This client bypasses Row Level Security (RLS).
 * Only use for server-side operations that require elevated privileges,
 * such as:
 * - Background jobs
 * - Cache warming
 * - Admin operations
 * - Operations without user context
 * 
 * Never expose this client or its operations to the browser.
 */
export function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase admin credentials')
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
