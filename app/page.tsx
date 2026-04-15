import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    // Get user role from metadata (avoids RLS issues)
    const userRole = user.user_metadata?.role || 'contractor'

    const redirectMap: Record<string, string> = {
      admin: '/admin/dashboard',
      accountant: '/accountant/queue',
      project_manager: '/pm/dashboard',
      contractor: '/vendor/portal',
    }

    redirect(redirectMap[userRole] || '/vendor/portal')
  }

  // Redirect unauthenticated users to login
  redirect('/auth/login')
}
