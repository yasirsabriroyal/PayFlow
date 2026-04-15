import { protectRoute } from '@/lib/permissions/protect-route'
import { PERMISSIONS } from '@/lib/permissions/constants'

export default async function ProjectsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Protect this route - requires view_projects permission
  await protectRoute({ 
    requiredPermission: PERMISSIONS.PROJECTS.VIEW_PROJECTS 
  })

  return <>{children}</>
}
