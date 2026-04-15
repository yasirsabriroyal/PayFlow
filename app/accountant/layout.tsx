import { ReactNode } from 'react'
import { protectRoute } from '@/lib/permissions/protect-route'
import { PERMISSIONS } from '@/lib/permissions/constants'

/**
 * Accountant layout with route protection
 * All pages under /accountant require view_ap_queue permission
 */
export default async function AccountantLayout({
  children,
}: {
  children: ReactNode
}) {
  // Require AP queue view permission (admin and accountant have this by default)
  await protectRoute({
    anyPermission: [
      PERMISSIONS.INVOICES.VIEW_AP_QUEUE,
      PERMISSIONS.PAYMENTS.VIEW_PAYMENT_RECORDS,
    ],
  })
  
  return <>{children}</>
}
