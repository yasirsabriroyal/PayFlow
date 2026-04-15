import { protectRoute } from '@/lib/permissions/protect-route'
import { PERMISSIONS } from '@/lib/permissions/constants'

export default async function ContractorsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Protect this route - requires view_vendors permission
  await protectRoute({ 
    requiredPermission: PERMISSIONS.VENDORS.VIEW_VENDORS 
  })

  return <>{children}</>
}
