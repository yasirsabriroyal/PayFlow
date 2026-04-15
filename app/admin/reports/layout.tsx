import { protectRoute } from '@/lib/permissions/protect-route'
import { PERMISSIONS } from '@/lib/permissions/constants'

export default async function ReportsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Protect this route - requires view_financial_reports permission
  await protectRoute({ 
    requiredPermission: PERMISSIONS.REPORTING.VIEW_FINANCIAL_REPORTS 
  })

  return <>{children}</>
}
