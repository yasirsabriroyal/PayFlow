import { ReactNode } from 'react'
import { protectRoute } from '@/lib/permissions/protect-route'
import { PERMISSIONS } from '@/lib/permissions/constants'

/**
 * Team management layout - requires manage_users permission
 */
export default async function TeamLayout({
  children,
}: {
  children: ReactNode
}) {
  await protectRoute({
    permission: PERMISSIONS.ADMINISTRATION.MANAGE_USERS,
  })
  
  return <>{children}</>
}
