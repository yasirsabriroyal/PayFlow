import { ReactNode } from 'react'
import { protectRoute } from '@/lib/permissions/protect-route'
import { PERMISSIONS } from '@/lib/permissions/constants'

/**
 * Project Manager layout with route protection
 * All pages under /pm require project or payment certificate permissions
 */
export default async function PMLayout({
  children,
}: {
  children: ReactNode
}) {
  // Require project-related permissions
  await protectRoute({
    anyPermission: [
      PERMISSIONS.PROJECTS.VIEW_PROJECTS,
      PERMISSIONS.PAYMENT_CERTIFICATES.CREATE_PAYMENT_CERTIFICATE,
    ],
  })
  
  return <>{children}</>
}
