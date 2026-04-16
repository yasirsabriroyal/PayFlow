import { protectRoute } from '@/lib/permissions/protect-route'
import { PERMISSIONS } from '@/lib/permissions/constants'

export default async function ProjectHubLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await protectRoute({ anyPermission: [PERMISSIONS.PROJECTS.VIEW_PROJECTS] })
  return children
}
