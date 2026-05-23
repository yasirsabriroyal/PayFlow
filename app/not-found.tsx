import Link from 'next/link'
import { FileQuestion, ArrowLeft, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getActiveBranding } from '@/lib/branding/get-active-branding'

export default async function NotFound() {
  const { company_name } = await getActiveBranding()

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center">
        {/* Icon */}
        <div className="mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-6">
          <FileQuestion className="w-8 h-8 text-muted-foreground" />
        </div>

        {/* Error code */}
        <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest mb-2">
          404 — Page not found
        </p>

        <h1 className="text-2xl font-bold text-foreground mb-3">
          This page doesn&apos;t exist
        </h1>

        <p className="text-muted-foreground mb-8">
          The page you&apos;re looking for may have been moved, deleted, or never
          existed. Double-check the URL or head back to your dashboard.
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
          <Button variant="outline" asChild>
            <Link href="javascript:history.back()">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Go Back
            </Link>
          </Button>

          <Button asChild>
            <Link href="/">
              <Home className="w-4 h-4 mr-2" />
              Go to Dashboard
            </Link>
          </Button>
        </div>

        {/* Branding footer */}
        <div className="text-center pt-8 border-t border-muted">
          <span className="text-sm text-muted-foreground font-medium tracking-wide">
            {company_name}
          </span>
        </div>
      </div>
    </div>
  )
}
