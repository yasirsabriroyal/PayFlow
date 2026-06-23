'use client'

import { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  Home, 
  Users, 
  FolderKanban, 
  FileText, 
  Settings,
  ChevronLeft,
  DollarSign,
  RefreshCw,
} from 'lucide-react'
import { Logo } from '@/components/ui/logo'
import { Button } from '@/components/ui/button'
import { MobileNav } from './mobile-nav'

interface AppShellProps {
  children: ReactNode
  title: string
  subtitle?: string
  backHref?: string
  backLabel?: string
  headerActions?: ReactNode
  userInfo?: {
    name: string
    email: string
    role: string
  }
}

export function AppShell({ 
  children, 
  title, 
  subtitle, 
  backHref, 
  backLabel,
  headerActions,
  userInfo 
}: AppShellProps) {
  const pathname = usePathname()

  const getRoleBadgeColor = (role: string) => {
    const colors: Record<string, string> = {
      admin: 'bg-primary/10 text-primary',
      accountant: 'bg-success/10 text-success',
      project_manager: 'bg-warning/10 text-warning',
      contractor: 'bg-accent/10 text-accent',
    }
    return colors[role] || colors.admin
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border md:hidden">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <MobileNav />
            {backHref ? (
              <Link href={backHref} className="flex items-center gap-1 text-muted-foreground">
                <ChevronLeft className="w-5 h-5" />
                <span className="text-sm">{backLabel || 'Back'}</span>
              </Link>
            ) : (
              <Link href="/dashboard" className="flex items-center gap-3">
                <Logo />
              </Link>
            )}
          </div>
          {headerActions && (
            <div className="flex items-center gap-2">
              {headerActions}
            </div>
          )}
        </div>
      </header>

      {/* Desktop Header */}
      <header className="hidden md:block border-b border-border bg-card">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              {backHref && (
                <Link href={backHref}>
                  <Button variant="ghost" size="icon" className="mr-2">
                    <ChevronLeft className="w-5 h-5" />
                  </Button>
                </Link>
              )}
              <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                {subtitle && (
                  <p className="text-muted-foreground mt-0.5">{subtitle}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              {headerActions}
              {userInfo && (
                <>
                  <Link href="/settings">
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                      <Settings className="w-5 h-5" />
                    </Button>
                  </Link>
                  <div className={`px-3 py-1.5 rounded-full text-sm font-medium ${getRoleBadgeColor(userInfo.role)}`}>
                    {userInfo.role.charAt(0).toUpperCase() + userInfo.role.slice(1)}
                  </div>
                  <div className="text-sm text-right">
                    <p className="font-medium">{userInfo.name}</p>
                    <p className="text-muted-foreground text-xs">{userInfo.email}</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Page Title */}
      <div className="md:hidden px-4 py-4 border-b border-border bg-card">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-4 md:px-6 md:py-8">
        {children}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur border-t border-border md:hidden safe-area-pb">
        <div className="flex items-center justify-around h-16">
          <NavItem 
            href="/admin/dashboard" 
            icon={Home} 
            label="Home" 
            active={pathname === '/admin/dashboard'} 
          />
          <NavItem 
            href="/admin/contractors" 
            icon={Users} 
            label="Vendors" 
            active={pathname === '/admin/contractors' || pathname.startsWith('/admin/contractors/')} 
          />
          <NavItem 
            href="/admin/projects" 
            icon={FolderKanban} 
            label="Projects" 
            active={pathname === '/admin/projects' || pathname.startsWith('/admin/projects/')} 
          />
          <NavItem 
            href="/accountant/queue" 
            icon={FileText} 
            label="Invoices" 
            active={pathname.startsWith('/accountant')} 
          />
          <NavItem 
            href="/admin/recurring-expenses" 
            icon={RefreshCw} 
            label="Recurring" 
            active={pathname.startsWith('/admin/recurring-expenses')} 
          />
          <NavItem 
            href="/settings" 
            icon={Settings} 
            label="Settings" 
            active={pathname === '/settings' || pathname.startsWith('/settings/')} 
          />
        </div>
      </nav>
      
      {/* Spacer for bottom nav on mobile */}
      <div className="h-16 md:hidden" />
    </div>
  )
}

interface NavItemProps {
  href: string
  icon: React.ElementType
  label: string
  active?: boolean
}

function NavItem({ href, icon: Icon, label, active }: NavItemProps) {
  return (
    <Link 
      href={href}
      className={`flex flex-col items-center justify-center gap-1 py-2 px-3 rounded-lg transition-colors touch-manipulation ${
        active 
          ? 'text-primary' 
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="w-5 h-5" />
      <span className="text-xs font-medium">{label}</span>
    </Link>
  )
}
