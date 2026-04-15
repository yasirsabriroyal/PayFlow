'use client'

import { Button } from '@/components/ui/button'
import { AlertTriangle, Building2 } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function AuthErrorContent() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')

  const errorMessages: Record<string, { title: string; description: string }> = {
    default: {
      title: 'Authentication Error',
      description: 'An unexpected error occurred during authentication. Please try again.',
    },
    access_denied: {
      title: 'Access Denied',
      description: 'You do not have permission to access this resource.',
    },
    invalid_request: {
      title: 'Invalid Request',
      description: 'The authentication request was invalid. Please try signing in again.',
    },
    session_expired: {
      title: 'Session Expired',
      description: 'Your session has expired. Please sign in again to continue.',
    },
  }

  const { title, description } = errorMessages[error || 'default'] || errorMessages.default

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background">
      <div className="w-full max-w-md space-y-8 text-center">
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground">{description}</p>
        </div>

        <div className="space-y-3">
          <Button asChild className="w-full h-11">
            <Link href="/auth/login">Return to Login</Link>
          </Button>
          <p className="text-sm text-muted-foreground">
            Need help?{' '}
            <Link href="/support" className="text-primary hover:text-primary/80 transition-colors">
              Contact Support
            </Link>
          </p>
        </div>

        {/* Logo */}
        <div className="flex items-center justify-center gap-2 pt-8 text-muted-foreground">
          <Building2 className="w-5 h-5" />
          <span className="text-sm font-medium">PayFlow AP</span>
        </div>
      </div>
    </div>
  )
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    }>
      <AuthErrorContent />
    </Suspense>
  )
}
