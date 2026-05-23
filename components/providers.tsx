'use client'

import { ReactNode, Suspense, createContext, useContext } from 'react'
import { WorkflowNavigationProvider } from '@/lib/workflow-navigation'
import type { BrandingConfig } from '@/lib/branding/get-active-branding'

const BrandingContext = createContext<BrandingConfig>({
  company_name: 'PayFlow AP',
  logo_url: null
})

export function useBranding() {
  return useContext(BrandingContext)
}

interface ProvidersProps {
  children: ReactNode
  branding: BrandingConfig
}

export function Providers({ children, branding }: ProvidersProps) {
  return (
    <Suspense fallback={null}>
      <BrandingContext.Provider value={branding}>
        <WorkflowNavigationProvider>
          {children}
        </WorkflowNavigationProvider>
      </BrandingContext.Provider>
    </Suspense>
  )
}
