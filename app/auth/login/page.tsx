'use client'

import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Shield, Lock, Building2, AlertCircle } from 'lucide-react'
import Link from 'next/link'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()
    setIsLoading(true)
    setError(null)

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      
      if (authError) throw authError

      // Determine redirect based on user metadata (avoids RLS timing issues)
      if (authData.user) {
        const userRole = authData.user.user_metadata?.role || 'contractor'
        
        const redirectMap: Record<string, string> = {
          admin: '/admin/dashboard',
          accountant: '/accountant/queue',
          project_manager: '/pm/dashboard',
          contractor: '/vendor/portal',
        }
        const destination = redirectMap[userRole] || '/vendor/portal'
        
        // Use window.location for a full page navigation to ensure cookies are sent
        window.location.href = destination
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Invalid email or password')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-sidebar text-sidebar-foreground flex-col justify-between p-12">
        <div>
          <div className="flex items-center gap-3 mb-16">
            <div className="w-10 h-10 bg-sidebar-primary rounded-lg flex items-center justify-center">
              <Building2 className="w-6 h-6 text-sidebar-primary-foreground" />
            </div>
            <span className="text-xl font-semibold tracking-tight">PayFlow AP</span>
          </div>
          
          <div className="space-y-8">
            <h1 className="text-4xl font-light leading-tight text-balance">
              Enterprise Accounts Payable & Finance Management
            </h1>
            <p className="text-lg text-sidebar-foreground/70 leading-relaxed max-w-md">
              Streamline your contractor payments, compliance tracking, and financial workflows with our comprehensive Canadian construction finance platform.
            </p>
          </div>
        </div>

        <div className="space-y-8">
          <div className="grid grid-cols-3 gap-6">
            <FeatureCard 
              icon={<Shield className="w-5 h-5" />}
              title="Secure"
              description="2FA & audit trails"
            />
            <FeatureCard 
              icon={<Lock className="w-5 h-5" />}
              title="Compliant"
              description="Canadian tax ready"
            />
            <FeatureCard 
              icon={<Building2 className="w-5 h-5" />}
              title="Enterprise"
              description="Multi-tier approvals"
            />
          </div>
          
          <p className="text-sm text-sidebar-foreground/50">
            Trusted by construction and trade companies across Canada
          </p>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md space-y-8">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <Building2 className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="text-xl font-semibold tracking-tight">PayFlow AP</span>
          </div>

          <div className="space-y-2 text-center lg:text-left">
            <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
            <p className="text-muted-foreground">
              Enter your credentials to access your account
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@company.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11"
                  autoComplete="email"
                  suppressHydrationWarning
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link 
                    href="/auth/forgot-password" 
                    className="text-sm text-primary hover:text-primary/80 transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11"
                  autoComplete="current-password"
                  suppressHydrationWarning
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button 
              type="submit" 
              className="w-full h-11 font-medium" 
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Contractor Portal
              </span>
            </div>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            New contractor?{' '}
            <Link 
              href="/auth/sign-up" 
              className="text-primary font-medium hover:text-primary/80 transition-colors"
            >
              Register your company
            </Link>
          </p>

          <p className="text-center text-xs text-muted-foreground pt-4">
            By signing in, you agree to our{' '}
            <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
              Privacy Policy
            </Link>
          </p>

          </div>
      </div>
    </div>
  )
}

function FeatureCard({ 
  icon, 
  title, 
  description 
}: { 
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="space-y-2">
      <div className="w-10 h-10 bg-sidebar-accent rounded-lg flex items-center justify-center text-sidebar-primary">
        {icon}
      </div>
      <h3 className="font-medium">{title}</h3>
      <p className="text-sm text-sidebar-foreground/60">{description}</p>
    </div>
  )
}
