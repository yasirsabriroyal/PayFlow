'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface Tab {
  label: string
  href: string
}

const TAB_MAP: Record<string, Tab[]> = {
  admin: [
    { label: 'Dashboard', href: '/admin/dashboard' },
    { label: 'Invoices', href: '/admin/invoices' },
    { label: 'Team', href: '/admin/team' },
    { label: 'Projects', href: '/admin/projects' },
    { label: 'Contractors', href: '/admin/contractors' },
    { label: 'Accounting', href: '/admin/accounting' },
  ],
  accountant: [
    { label: 'Queue', href: '/accountant/queue' },
    { label: 'Payments', href: '/accountant/payments' },
    { label: 'Holdbacks', href: '/accountant/holdbacks' },
  ],
  project_manager: [
    { label: 'Dashboard', href: '/pm/dashboard' },
    { label: 'Invoices', href: '/pm/dashboard' },
    { label: 'Certificates', href: '/pm/certificates' },
    { label: 'Approvals', href: '/pm/approvals' },
    { label: 'Projects', href: '/pm/projects' },
    { label: 'Contractors', href: '/pm/contractors' },
  ],
  contractor: [
    { label: 'Portal', href: '/vendor/portal' },
    { label: 'Compliance', href: '/vendor/compliance' },
  ],
}

interface RoleTabBarProps {
  role: string
}

export function RoleTabBar({ role }: RoleTabBarProps) {
  const pathname = usePathname()
  const tabs = TAB_MAP[role]

  if (!tabs) return null

  return (
    <div className="w-full bg-white border-b border-gray-200 px-6">
      <div className="flex flex-row gap-0">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={
                'px-4 py-3 text-sm font-medium no-underline ' +
                (isActive
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700')
              }
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
