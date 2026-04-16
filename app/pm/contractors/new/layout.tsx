import { ReactNode } from 'react'
import { protectRoute } from '@/lib/permissions/protect-route'
import { PERMISSIONS } from '@/lib/permissions/constants'

export default async function PMAddContractorLayout({
  children,
}: {
  children: ReactNode
}) {
  // Require create_vendors permission
  await protectRoute({ anyPermission: [PERMISSIONS.VENDORS.CREATE_VENDORS] })
  
  return <>{children}</>
}
