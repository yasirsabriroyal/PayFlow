import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'
  const type = searchParams.get('type')
  const error_description = searchParams.get('error_description')

  // Handle error from Supabase
  if (error_description) {
    return NextResponse.redirect(`${origin}/auth/error?message=${encodeURIComponent(error_description)}`)
  }

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error && data.session) {
      // Check if this is a password recovery by looking at the session's aal or user metadata
      // Supabase recovery sessions have a specific type
      const isRecovery = type === 'recovery' || 
                         data.session.user?.recovery_sent_at !== undefined ||
                         (data.session.user?.app_metadata?.provider === 'email' && 
                          data.session.user?.email_confirmed_at)
      
      // If this looks like a recovery flow (user just clicked password reset link)
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/auth/update-password`)
      }
      
      return NextResponse.redirect(`${origin}${next}`)
    }
    
    // Log the error for debugging
    console.error('[v0] Auth callback error:', error)
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/error?message=Could not authenticate user`)
}
