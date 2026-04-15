import { protectRoute } from '@/lib/permissions/protect-route'
import { PERMISSIONS } from '@/lib/permissions/constants'

export default async function QueueLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Protect this route - requires view_ap_queue permission
  await protectRoute({ 
    requiredPermission: PERMISSIONS.INVOICES.VIEW_AP_QUEUE 
  })

  return <>{children}</>
}
