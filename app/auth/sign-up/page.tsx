
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { completeContractorRegistration } from './actions'
import { useBranding } from '@/components/providers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle, Building2, HardHat, AlertCircle } from 'lucide-react'

export default function SignUpPage() {
  const { company_name } = useBranding()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    // Validate password match
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setIsLoading(false)
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      setIsLoading(false)
      return
    }

    const supabase = createClient()

    try {
      // Split contact name into first/last
      const nameParts = contactName.trim().split(' ')
      const firstName = nameParts[0] || ''
      const lastName = nameParts.slice(1).join(' ') || ''

      // Create contractor user with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            company_name: companyName,
          },
        },
      })

      if (authError) throw authError

      if (authData.user) {
        // Complete registration server-side: DB inserts run in a server action
        // so the browser never touches contractors/users/profiles directly.
        // Role is hardcoded to 'contractor' inside the action — not user-supplied.
        const result = await completeContractorRegistration({
          userId: authData.user.id,
          email,
          firstName,
          lastName,
          companyName,
          contactName,
        })

        if (!result.success) {
          // Auth user was created; DB records will be reconciled by admin if needed
          console.log('[signup] Registration note:', result.error)
        }

        setSuccess(true)

        // Auto-redirect to login after success message
        setTimeout(() => {
          router.push('/auth/login')
        }, 3000)
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Failed to create account')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center">
              <HardHat className="w-6 h-6 text-accent-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl">Contractor Registration</CardTitle>
          <CardDescription>
            Register your company to submit invoices and receive payments through PayFlow AP
          </CardDescription>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="text-center space-y-4 py-4">
              <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8 text-success" />
              </div>
              <h3 className="text-lg font-medium text-foreground">Registration Submitted!</h3>
              <p className="text-sm text-muted-foreground">
                Your contractor account has been created. Please check your email to verify your account, then sign in to complete your company profile.
              </p>
              <p className="text-xs text-muted-foreground">
                Redirecting to login...
              </p>
            </div>
          ) : (
            <form onSubmit={handleSignUp} className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 bg-destructive/10 text-destructive text-sm p-3 rounded-md border border-destructive/20">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="companyName">Company Name</Label>
                <Input
                  id="companyName"
                  placeholder="ABC Electrical Ltd."
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contactName">Primary Contact Name</Label>
                <Input
                  id="contactName"
                  placeholder="John Smith"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Business Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="accounts@abcelectrical.ca"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Creating Account...
                  </span>
                ) : (
                  'Register Company'
                )}
              </Button>

              <p className="text-center text-sm text-muted-foreground pt-2">
                Already registered?{' '}
                <Link href="/auth/login" className="text-primary hover:underline font-medium">
                  Sign in to your account
                </Link>
              </p>

              <div className="pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground text-center">
                  By registering, you agree to our{' '}
                  <Link href="/terms" className="underline hover:text-foreground">
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link href="/privacy" className="underline hover:text-foreground">
                    Privacy Policy
                  </Link>
                </p>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Internal team link - subtle footer */}
      <div className="fixed bottom-4 right-4">
        <Link 
          href="/admin/setup" 
          className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          Internal team setup
        </Link>
      </div>
    </div>
  )
}
