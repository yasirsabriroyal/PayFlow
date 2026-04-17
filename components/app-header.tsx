'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { 
  Building2, 
  Home, 
  LogOut, 
  Settings, 
  User,
  ChevronDown,
  Shield,
  ClipboardList,
  Calculator,
  Hammer,
  ArrowLeft,
  ChevronRight
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useWorkflowNavigation, useContextualBack } from '@/lib/workflow-navigation'

type UserRole = 'admin' | 'project_manager' | 'accountant' | 'contractor'

interface Breadcrumb {
  label: string
  href?: string
}

interface AppHeaderProps {
  pageTitle?: string
  pageDescription?: string
  breadcrumbs?: Breadcrumb[]
}

const roleConfig: Record<UserRole, { label: string; icon: typeof Shield; color: string; bgColor: string; dashboardPath: string }> = {
  admin: { 
    label: 'Administrator', 
    icon: Shield, 
    color: 'text-purple-600', 
    bgColor: 'bg-purple-500/10',
    dashboardPath: '/admin/dashboard'
  },
  project_manager: { 
    label: 'Project Manager', 
    icon: ClipboardList, 
    color: 'text-blue-600', 
    bgColor: 'bg-blue-500/10',
    dashboardPath: '/pm/dashboard'
  },
  accountant: { 
    label: 'Accountant', 
    icon: Calculator, 
    color: 'text-emerald-600', 
    bgColor: 'bg-emerald-500/10',
    dashboardPath: '/accountant/dashboard'
  },
  contractor: {
    label: 'Contractor',
    icon: Hammer,
    color: 'text-orange-600',
    bgColor: 'bg-orange-500/10',
    dashboardPath: '/vendor/portal'
  },
}

export function AppHeader({ pageTitle, pageDescription, breadcrumbs }: AppHeaderProps) {
  const pathname = usePathname()
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [userRole, setUserRole] = useState<UserRole>('project_manager')
  const [mounted, setMounted] = useState(false)
  
  // Workflow navigation - only use after mount to avoid hydration issues
  const { goBack, canGoBack } = useContextualBack()
  const { goHome } = useWorkflowNavigation()

  // Set mounted after hydration
  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const loadUser = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user) {
        setUserEmail(user.email || '')
        
        // Get user data from users table (using auth_user_id)
        const { data: userData } = await supabase
          .from('users')
          .select('first_name, last_name, role')
          .eq('auth_user_id', user.id)
          .single()
        
        if (userData) {
          // Use name from users table
          const fullName = [userData.first_name, userData.last_name].filter(Boolean).join(' ')
          setUserName(fullName || user.email?.split('@')[0] || 'User')
          
          // Use role from users table
          if (userData.role) {
            setUserRole(userData.role as UserRole)
          }
        } else {
          // Fallback to user metadata if no users record
          const name = user.user_metadata?.full_name || 
                       user.user_metadata?.name || 
                       user.email?.split('@')[0] || 
                       'User'
          setUserName(name)
          
          // Fallback role from metadata
          const metadataRole = user.user_metadata?.role as UserRole
          if (metadataRole) {
            setUserRole(metadataRole)
          }
        }
      }
    }
    loadUser()
  }, [])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/auth/login'
  }

  const roleInfo = roleConfig[userRole]
  const RoleIcon = roleInfo.icon
  const dashboardPath = roleInfo.dashboardPath

  // Determine if we're on the home dashboard
  const isOnDashboard = pathname === dashboardPath

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Left side - Back, Logo, Home, Page Title */}
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Back Button - shows when not on dashboard and can go back (only after mount to avoid hydration issues) */}
            {mounted && !isOnDashboard && canGoBack && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={goBack}
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            
            {/* Logo */}
            <Link href={dashboardPath} className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center transition-transform group-hover:scale-105">
                <Building2 className="w-4.5 h-4.5 text-primary-foreground" />
              </div>
              <span className="font-semibold text-foreground hidden sm:inline">PayFlow AP</span>
            </Link>

            {/* Separator */}
            <div className="h-6 w-px bg-border hidden sm:block" />

            {/* Home Button - always shows when not on dashboard */}
            {!isOnDashboard && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="gap-2 text-muted-foreground hover:text-foreground"
                onClick={() => goHome()}
              >
                <Home className="w-4 h-4" />
                <span className="hidden md:inline">Home</span>
              </Button>
            )}

            {/* Breadcrumbs or Page Title */}
            {breadcrumbs && breadcrumbs.length > 0 ? (
              <nav className="hidden md:flex items-center gap-1.5 text-sm">
                {breadcrumbs.map((crumb, index) => (
                  <span key={index} className="flex items-center gap-1.5">
                    {index > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                    {crumb.href ? (
                      <Link 
                        href={crumb.href} 
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">{crumb.label}</span>
                    )}
                  </span>
                ))}
              </nav>
            ) : pageTitle && (
              <>
                {!isOnDashboard && <ChevronRight className="w-4 h-4 text-muted-foreground hidden md:block" />}
                <div className="hidden md:block">
                  <h1 className="text-sm font-medium text-foreground">{pageTitle}</h1>
                  {pageDescription && (
                    <p className="text-xs text-muted-foreground">{pageDescription}</p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Right side - Role, User, Actions */}
          <div className="flex items-center gap-3">
            {/* Role Badge */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${roleInfo.bgColor}`}>
              <RoleIcon className={`w-3.5 h-3.5 ${roleInfo.color}`} />
              <span className={`text-xs font-medium ${roleInfo.color} hidden sm:inline`}>
                {roleInfo.label}
              </span>
            </div>

            {/* Settings */}
            <Link href="/settings">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                <Settings className="w-4 h-4" />
              </Button>
            </Link>

            {/* User Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 gap-2 px-2">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <span className="text-sm font-medium hidden sm:inline max-w-[100px] truncate">
                    {userName}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{userName}</p>
                  <p className="text-xs text-muted-foreground">{userEmail}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="cursor-pointer">
                    <Settings className="w-4 h-4 mr-2" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive cursor-pointer">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  )
}
