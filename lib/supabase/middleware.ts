import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Role-based redirect mapping
const ROLE_REDIRECTS: Record<string, string> = {
  admin: '/admin/dashboard',
  accountant: '/accountant/queue',
  project_manager: '/pm/dashboard',
  contractor: '/vendor/portal',
}

// Protected route patterns by role
const PROTECTED_ROUTES: Record<string, string[]> = {
  admin: ['/admin', '/accountant', '/pm', '/vendor'],  // Admin has access to all routes
  accountant: ['/accountant'],
  project_manager: ['/pm'],
  contractor: ['/vendor'],
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  let user = null
  try {
    const { data, error } = await supabase.auth.getUser()
    if (!error) user = data.user
  } catch {
    // Auth check failed — treat as unauthenticated
  }

  const pathname = request.nextUrl.pathname

  // Public routes that don't require authentication
  const publicRoutes = ['/auth/login', '/auth/sign-up', '/auth/error', '/auth/sign-up-success', '/auth/forgot-password', '/auth/update-password', '/terms', '/privacy', '/support', '/']
  const isPublicRoute = publicRoutes.some(route => pathname === route || pathname.startsWith('/auth/'))

  // If user is not logged in and trying to access protected routes
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  // If user is logged in
  if (user) {
    // Fetch role from database profiles table (not user_metadata, which is user-controlled)
    let userRole = 'contractor'
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      if (profile?.role) userRole = profile.role
    } catch {
      // Fall back to default role if profile fetch fails
    }

    // If user is on login page and already authenticated, redirect to their dashboard
    if (pathname === '/auth/login' || pathname === '/') {
      const redirectPath = ROLE_REDIRECTS[userRole] || '/vendor/portal'
      const url = request.nextUrl.clone()
      url.pathname = redirectPath
      return NextResponse.redirect(url)
    }

    // Check if user has access to the current route
    const allowedRoutes = PROTECTED_ROUTES[userRole] || []
    const isAccessingProtectedRoute = ['/admin', '/accountant', '/pm', '/vendor'].some(route =>
      pathname.startsWith(route)
    )

    if (isAccessingProtectedRoute) {
      const hasAccess = allowedRoutes.some(route => pathname.startsWith(route))
      if (!hasAccess) {
        // Redirect to their appropriate dashboard
        const redirectPath = ROLE_REDIRECTS[userRole] || '/vendor/portal'
        const url = request.nextUrl.clone()
        url.pathname = redirectPath
        return NextResponse.redirect(url)
      }
    }
  }

  return supabaseResponse
}

export { ROLE_REDIRECTS, PROTECTED_ROUTES }
