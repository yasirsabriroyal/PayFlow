import { ReactNode } from 'react'
import { protectRoute } from '@/lib/permissions/protect-route'
import { PERMISSIONS } from '@/lib/permissions/constants'

/**
 * Permissions settings layout - requires manage_permissions permission
 */
export default async function PermissionsSettingsLayout({
  children,
}: {
  children: ReactNode
}) {
  await protectRoute({
    permission: PERMISSIONS.ADMINISTRATION.MANAGE_PERMISSIONS,
  })
  
  return <>{children}</>
}
