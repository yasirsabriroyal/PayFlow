import { protectRoute } from '@/lib/permissions/protect-route'
import { PERMISSIONS } from '@/lib/permissions/constants'

export default async function NewContractorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Require create_vendors permission to access this page
  await protectRoute({ requiredPermission: PERMISSIONS.VENDORS.CREATE_VENDORS })
  
  return <>{children}</>
}
