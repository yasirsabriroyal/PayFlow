'use client'

import { useEffect } from 'react'
import { AlertCircle, RefreshCw, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { useBranding } from '@/components/providers'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { company_name } = useBranding()

  useEffect(() => {
    console.error('[Admin] Unhandled error:', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-6">
          <AlertCircle className="w-8 h-8 text-destructive" />
        </div>

        <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest mb-2">
          Admin — Unexpected error
        </p>

        <h1 className="text-2xl font-bold text-foreground mb-3">
          Something went wrong
        </h1>

        <p className="text-muted-foreground mb-4">
          An error occurred in the admin portal. You can try again or return to
          the dashboard.
        </p>

        {error.digest && (
          <p className="text-xs text-muted-foreground/60 font-mono mb-6">
            Reference: {error.digest}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={reset}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Try again
          </Button>

          <Button variant="outline" asChild>
            <Link href="/admin/dashboard">
              <Home className="w-4 h-4 mr-2" />
              Admin Dashboard
            </Link>
          </Button>
        </div>

        <p className="mt-12 text-xs text-muted-foreground/50">
          {company_name}
        </p>
      </div>
    </div>
  )
}
