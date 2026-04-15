import { ReactNode } from 'react'
import { requireAdmin } from '@/lib/permissions/protect-route'

/**
 * Admin layout with route protection
 * All pages under /admin require admin role only
 * Project managers and accountants have their own portals
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  // Require admin role only
  await requireAdmin()
  
  return <>{children}</>
}
