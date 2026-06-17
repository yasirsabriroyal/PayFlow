'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ShieldCheck, Lock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import type { EmailOtpType } from '@supabase/supabase-js'

function ConfirmContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isVerifying, setIsVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tokenHash = searchParams.get('token_hash')
  const type = (searchParams.get('type') as EmailOtpType | null) ?? 'recovery'
  const next = searchParams.get('next') || '/auth/update-password'

  // Surface any error params Supabase may append (e.g. otp_expired)
  useEffect(() => {
    const errorDescription = searchParams.get('error_description')
    if (errorDescription) {
      setError(errorDescription)
    }
  }, [searchParams])

  const handleConfirm = async () => {
    if (!tokenHash) {
      setError('This link is missing its verification token. Please request a new reset link.')
      return
    }

    setIsVerifying(true)
    setError(null)

    const supabase = createClient()
    // The token is only consumed here, on an explicit user action — so passive
    // email link scanners (which only issue a GET) cannot burn it ahead of time.
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    })

    if (verifyError) {
      setError('This reset link is invalid or has expired. Please request a new one.')
      setIsVerifying(false)
      return
    }

    // Session is now established — go set the new password.
    router.replace(next)
  }

  const isInvalid = !tokenHash || !!searchParams.get('error_description')

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card border border-border rounded-2xl p-8 shadow-lg text-center space-y-4">
          {isInvalid ? (
            <>
              <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
                <Lock className="w-8 h-8 text-destructive" />
              </div>
              <h1 className="text-2xl font-semibold">Invalid Link</h1>
              <p className="text-muted-foreground">
                {error || 'This password reset link is invalid or has expired.'}
              </p>
              <Link href="/auth/forgot-password">
                <Button variant="outline" className="mt-4">
                  Request New Reset Link
                </Button>
              </Link>
            </>
          ) : (
            <>
              <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto">
                <ShieldCheck className="w-6 h-6 text-primary" />
              </div>
              <h1 className="text-2xl font-semibold">Confirm Password Reset</h1>
              <p className="text-muted-foreground">
                For your security, click the button below to continue resetting your password.
              </p>

              {error && (
                <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button
                onClick={handleConfirm}
                className="w-full h-12 mt-2"
                disabled={isVerifying}
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Confirm Password Reset'
                )}
              </Button>

              <Link
                href="/auth/login"
                className="inline-block text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Back to login
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      }
    >
      <ConfirmContent />
    </Suspense>
  )
}
