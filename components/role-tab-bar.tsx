'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ROUTES } from '@/lib/navigation'
import { getUnreadFeedbackCount } from '@/lib/actions/feedback'

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
    { label: 'Dashboard',   href: ROUTES.admin.dashboard },
    { label: 'Invoices',    href: ROUTES.admin.invoices },
    { label: 'Projects',    href: ROUTES.admin.projectsList },
    { label: 'Contractors', href: ROUTES.admin.contractors },
    { label: 'Team',        href: ROUTES.admin.team },
    { label: 'Accounting',  href: ROUTES.admin.accounting },
    { label: 'Feedback',    href: ROUTES.admin.feedbackInbox },
    { label: 'Settings',    href: ROUTES.admin.settings },
  ],
  accountant: [
    { label: 'Queue',           href: ROUTES.accountant.queue },
    { label: 'Payments',        href: ROUTES.accountant.payments },
    { label: 'Holdbacks',       href: ROUTES.accountant.holdbacks },
    { label: 'Banking Changes', href: ROUTES.accountant.bankingChanges },
    { label: 'Compliance',      href: ROUTES.accountant.compliance },
    { label: 'Feedback',        href: ROUTES.shared.feedback },
  ],
  project_manager: [
    { label: 'Dashboard',   href: ROUTES.pm.dashboard },
    { label: 'Invoices',    href: ROUTES.pm.invoices },
    { label: 'Certificates', href: ROUTES.pm.certificates },
    { label: 'Approvals',   href: ROUTES.pm.approvals },
    { label: 'Projects',    href: ROUTES.pm.projects },
    { label: 'Contractors', href: ROUTES.pm.contractors },
    { label: 'Feedback',    href: ROUTES.shared.feedback },
  ],
  contractor: [
    ...VENDOR_TABS,
    { label: 'Feedback', href: ROUTES.shared.feedback },
  ],
}

interface RoleTabBarProps {
  role: Role
}

export function RoleTabBar({ role }: RoleTabBarProps) {
  const pathname = usePathname()
  const tabs = TAB_MAP[role]
  const [unreadFeedback, setUnreadFeedback] = useState(0)

  // Fetch unread feedback count for admin only
  useEffect(() => {
    if (role !== 'admin') return
    getUnreadFeedbackCount().then(setUnreadFeedback).catch(() => {})
  }, [role])

  if (!tabs) return null

  return (
    <div
      className="w-full bg-muted/30 border-b border-border px-6"
      style={{ overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      <div className="flex flex-row gap-0" style={{ width: 'max-content', minWidth: '100%' }}>
        {tabs.map((tab: Tab) => {
          const isActive = pathname.startsWith(tab.href)
          const isFeedbackAdmin = role === 'admin' && tab.href === ROUTES.admin.feedbackInbox
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={
                'relative px-4 py-3 text-sm font-medium no-underline transition-colors whitespace-nowrap ' +
                (isActive
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              {tab.label}
              {isFeedbackAdmin && unreadFeedback > 0 && (
                <span className="absolute top-2 right-1 min-w-[16px] h-4 px-1 bg-primary text-primary-foreground text-[10px] font-semibold rounded-full flex items-center justify-center leading-none">
                  {unreadFeedback > 99 ? '99+' : unreadFeedback}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
