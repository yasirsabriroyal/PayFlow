import { getProjectRolesForManagement } from './role-actions'
import { ProjectRolesClient } from './project-roles-client'

export const dynamic = 'force-dynamic'

export default async function ProjectRolesPage() {
  const result = await getProjectRolesForManagement()
  const roles = result.success ? result.roles : []

  return <ProjectRolesClient initialRoles={roles} />
}
