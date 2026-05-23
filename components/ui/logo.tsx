'use client'

import { useBranding } from '@/components/providers'
import { Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LogoProps {
  className?: string
  hideText?: boolean
}

export function Logo({ className, hideText = false }: LogoProps) {
  const { company_name, logo_url } = useBranding()

  if (logo_url) {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        <img 
          src={logo_url} 
          alt={company_name} 
          className="h-8 w-auto max-w-[200px] object-contain shrink-0" 
        />
        {!hideText && (
          <span className="font-semibold">{company_name}</span>
        )}
      </div>
    )
  }

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
        <Building2 className="w-6 h-6 text-primary" />
      </div>
      {!hideText && (
        <span className="font-semibold">{company_name}</span>
      )}
    </div>
  )
}
