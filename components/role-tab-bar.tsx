'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ROUTES } from '@/lib/navigation'

type Role = 'admin' | 'accountant' | 'project_manager' | 'contractor'

interface Tab {
  label: string
  href: string
}

const VENDOR_TABS: Tab[] = [
  { label: 'Portal', href: ROUTES.vendor.portal },
  { label: 'Compliance', href: ROUTES.vendor.compliance },
  { label: 'Profile', href: ROUTES.vendor.profile },
]

const TAB_MAP: Record<Role, Tab[]> = {
  admin: [
    { label: 'Dashboard', href: ROUTES.admin.dashboard },
    { label: 'Invoices', href: ROUTES.admin.invoices },
    { label: 'Projects', href: ROUTES.admin.projectsList },
    { label: 'Contractors', href: ROUTES.admin.contractors },
    { label: 'Team', href: ROUTES.admin.team },
    { label: 'Accounting', href: ROUTES.admin.accounting },
    { label: 'Settings', href: ROUTES.admin.settings },
  ],
  accountant: [
    { label: 'Queue', href: ROUTES.accountant.queue },
    { label: 'Payments', href: ROUTES.accountant.payments },
    { label: 'Holdbacks', href: ROUTES.accountant.holdbacks },
    { label: 'Banking Changes', href: ROUTES.accountant.bankingChanges },
  ],
  project_manager: [
    { label: 'Dashboard', href: ROUTES.pm.dashboard },
    { label: 'Invoices', href: ROUTES.pm.invoices },
    { label: 'Certificates', href: ROUTES.pm.certificates },
    { label: 'Approvals', href: ROUTES.pm.approvals },
    { label: 'Projects', href: ROUTES.pm.projects },
    { label: 'Contractors', href: ROUTES.pm.contractors },
  ],
  contractor: VENDOR_TABS,
}

interface RoleTabBarProps {
  role: Role
}

export function RoleTabBar({ role }: RoleTabBarProps) {
  const pathname = usePathname()
  const tabs = TAB_MAP[role]

  if (!tabs) return null

  return (
    <div
      className="w-full bg-muted/30 border-b border-border px-6"
      style={{ overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      <div className="flex flex-row gap-0">
        {tabs.map((tab: Tab) => {
          const isActive = pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={
                'px-4 py-3 text-sm font-medium no-underline transition-colors ' +
                (isActive
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground')
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
