import { ReactNode } from 'react'
import { protectRoute } from '@/lib/permissions/protect-route'
import { PERMISSIONS } from '@/lib/permissions/constants'

/**
 * Project-roles settings layout - requires manage_roles permission.
 */
export default async function ProjectRolesSettingsLayout({
  children,
}: {
  children: ReactNode
}) {
  await protectRoute({
    permission: PERMISSIONS.ADMINISTRATION.MANAGE_ROLES,
  })

  return <>{children}</>
}
