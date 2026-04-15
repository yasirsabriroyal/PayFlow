import { protectRoute } from '@/lib/permissions/protect-route'
import { PERMISSIONS } from '@/lib/permissions/constants'

export default async function PaymentsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Protect this route - requires process_payments permission
  await protectRoute({ 
    requiredPermission: PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS 
  })

  return <>{children}</>
}
