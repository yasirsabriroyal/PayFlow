'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  Menu, 
  X, 
  Home, 
  Users, 
  FolderKanban, 
  FileText, 
  Calculator,
  DollarSign,
  Timer,
  Settings,
  Shield,
  Briefcase,
  PenTool,
  Database,
  LogOut,
  ChevronRight
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { createClient } from '@/lib/supabase/client'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  roles?: string[]
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/admin/dashboard', icon: Home, roles: ['admin'] },
  { label: 'PM Dashboard', href: '/pm/dashboard', icon: Home, roles: ['project_manager'] },
  { label: 'Contractors', href: '/admin/contractors', icon: Users, roles: ['admin', 'accountant'] },
  { label: 'Projects', href: '/admin/projects', icon: FolderKanban, roles: ['admin', 'project_manager'] },
  { label: 'AP Inbox', href: '/accountant/queue', icon: FileText, roles: ['admin', 'accountant'] },
  { label: 'Payments', href: '/accountant/payments', icon: DollarSign, roles: ['admin', 'accountant'] },
  { label: 'Holdbacks', href: '/accountant/holdbacks', icon: Timer, roles: ['admin', 'accountant'] },
  { label: 'PM Approvals', href: '/pm/approvals', icon: Calculator, roles: ['admin', 'project_manager'] },
  { label: 'Accounting Sync', href: '/admin/accounting', icon: Database, roles: ['admin'] },
  { label: 'Permissions', href: '/admin/settings/permissions', icon: Shield, roles: ['admin'] },
  { label: 'Vendor Portal', href: '/vendor/portal', icon: Briefcase, roles: ['contractor'] },
  { label: 'Submit Invoice', href: '/vendor/invoices/new', icon: FileText, roles: ['contractor'] },
  { label: 'Lien Waivers', href: '/vendor/compliance', icon: PenTool, roles: ['contractor'] },
  { label: 'Settings', href: '/settings', icon: Settings },
]

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const [userRole, setUserRole] = useState<string>('admin')
  const pathname = usePathname()

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (open) {
      // Save current scroll position and lock body
      const scrollY = window.scrollY
      document.body.style.position = 'fixed'
      document.body.style.top = `-${scrollY}px`
      document.body.style.left = '0'
      document.body.style.right = '0'
      document.body.style.overflow = 'hidden'
      
      return () => {
        // Restore scroll position when menu closes
        document.body.style.position = ''
        document.body.style.top = ''
        document.body.style.left = ''
        document.body.style.right = ''
        document.body.style.overflow = ''
        window.scrollTo(0, scrollY)
      }
    }
  }, [open])

  useEffect(() => {
    const getUser = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.user_metadata?.role) {
        setUserRole(user.user_metadata.role)
      }
    }
    getUser()
  }, [])

  const filteredNavItems = navItems.filter(item => {
    if (!item.roles) return true
    return item.roles.includes(userRole)
  })

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/auth/login'
  }

  const getRoleBadge = () => {
    const roleConfig: Record<string, { label: string; color: string }> = {
      admin: { label: 'Admin', color: 'bg-primary/10 text-primary' },
      accountant: { label: 'Accountant', color: 'bg-success/10 text-success' },
      project_manager: { label: 'PM', color: 'bg-warning/10 text-warning' },
      contractor: { label: 'Vendor', color: 'bg-accent/10 text-accent' },
    }
    return roleConfig[userRole] || roleConfig.admin
  }

  const roleBadge = getRoleBadge()

  return (
    <div className="md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu className="h-6 w-6" />
            <span className="sr-only">Open menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="p-4 border-b border-border">
            <SheetTitle className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-semibold">PayFlow AP</span>
            </SheetTitle>
          </SheetHeader>
          
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className={`px-3 py-1 rounded-full text-xs font-medium ${roleBadge.color}`}>
                <Shield className="w-3 h-3 inline mr-1" />
                {roleBadge.label}
              </div>
            </div>
          </div>

          <nav className="flex-1 p-2 space-y-1 overflow-y-auto max-h-[calc(100vh-200px)]">
            {filteredNavItems.map((item) => {
              // Strict matching for exact paths, wildcard matching for nested routes
              // Dashboard should only match exactly, not for all /admin routes
              const isDashboard = item.href === '/admin/dashboard'
              const isActive = isDashboard 
                ? pathname === item.href 
                : pathname === item.href || pathname.startsWith(item.href + '/')
              const Icon = item.icon
              
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors touch-manipulation ${
                    isActive 
                      ? 'bg-primary/10 text-primary font-semibold' 
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-primary' : ''}`} />
                  <span className="flex-1">{item.label}</span>
                  {isActive && <ChevronRight className="w-4 h-4 text-primary" />}
                </Link>
              )
            })}
          </nav>

          <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border bg-background">
            <Button 
              variant="ghost" 
              className="w-full justify-start gap-3 text-muted-foreground hover:text-destructive"
              onClick={handleSignOut}
            >
              <LogOut className="w-5 h-5" />
              Sign Out
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
