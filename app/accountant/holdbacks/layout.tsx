import { protectRoute } from '@/lib/permissions/protect-route'
import { PERMISSIONS } from '@/lib/permissions/constants'

export default async function HoldbacksLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Protect this route - requires view_payment_records permission
  await protectRoute({ 
    requiredPermission: PERMISSIONS.PAYMENTS.VIEW_PAYMENT_RECORDS 
  })

  return <>{children}</>
}
