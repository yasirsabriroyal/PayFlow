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
    // During static prerendering (build time) credentials are not available.
    // Return a no-op proxy so module imports don't crash; any actual DB call
    // made at request time will correctly fail when invoked without credentials.
    if (process.env.NODE_ENV === 'production' && !supabaseUrl) {
      throw new Error('Missing Supabase admin credentials')
    }
    // Development / build-time: surface a clear error only when a query is attempted
    const handler: ProxyHandler<object> = {
      get: (_t, prop) => {
        if (prop === 'then') return undefined // not a Promise
        return () => {
          throw new Error(
            `getSupabaseAdmin(): called without credentials (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set). This call occurred at build/prerender time.`
          )
        }
      },
    }
    return new Proxy({}, handler) as ReturnType<typeof createClient>
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
