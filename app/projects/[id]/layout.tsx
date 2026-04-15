import { protectRoute } from '@/lib/permissions/protect-route'
import { PERMISSIONS } from '@/lib/permissions/constants'

export default async function ProjectHubLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await protectRoute([PERMISSIONS.PROJECTS.VIEW_PROJECTS])
  return children
}
