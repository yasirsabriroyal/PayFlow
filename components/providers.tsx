'use client'

import { ReactNode, Suspense } from 'react'
import { WorkflowNavigationProvider } from '@/lib/workflow-navigation'

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return (
    <Suspense fallback={null}>
      <WorkflowNavigationProvider>
        {children}
      </WorkflowNavigationProvider>
    </Suspense>
  )
}
