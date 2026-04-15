import { ReactNode } from 'react'
import { protectRoute } from '@/lib/permissions/protect-route'
import { PERMISSIONS } from '@/lib/permissions/constants'

/**
 * Invoice Hub layout with route protection
 * This is a shared route accessible by PM, Accountant, and Admin roles
 * who have permission to view invoices or the AP queue
 */
export default async function InvoicesLayout({
  children,
}: {
  children: ReactNode
}) {
  // Require invoice viewing permissions
  await protectRoute({
    anyPermission: [
      PERMISSIONS.INVOICES.VIEW_AP_QUEUE,
      PERMISSIONS.PAYMENT_CERTIFICATES.VIEW_PAYMENT_HISTORY,
    ],
  })
  
  return <>{children}</>
}
