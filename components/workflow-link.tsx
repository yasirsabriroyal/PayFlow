'use client'

import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import Link from 'next/link'
import { useWorkflowNavigation } from '@/lib/workflow-navigation'

interface WorkflowLinkProps extends ComponentPropsWithoutRef<typeof Link> {
  /**
   * Title to display in breadcrumbs/history for the destination page
   */
  contextTitle?: string
  /**
   * Additional params to pass to the destination page
   */
  contextParams?: Record<string, string | number>
  /**
   * If true, starts a new workflow (clears history)
   */
  startNewWorkflow?: boolean
}

/**
 * A workflow-aware Link component that tracks navigation context.
 * Use this instead of Next.js Link when you want proper back navigation support.
 * 
 * Example:
 * <WorkflowLink href="/pm/projects/123" contextTitle="Project ABC">
 *   View Project
 * </WorkflowLink>
 */
export const WorkflowLink = forwardRef<HTMLAnchorElement, WorkflowLinkProps>(
  function WorkflowLink(
    { href, contextTitle, contextParams, startNewWorkflow, onClick, children, ...props },
    ref
  ) {
    const { navigateTo, startWorkflow } = useWorkflowNavigation()

    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Get the destination URL as string
      const destination = typeof href === 'string' ? href : href.pathname || ''
      
      // Track the navigation in workflow context
      if (startNewWorkflow) {
        startWorkflow(destination, contextTitle)
      } else {
        navigateTo(destination, contextTitle, contextParams)
      }
      
      // Call any existing onClick handler
      onClick?.(e)
    }

    return (
      <Link
        ref={ref}
        href={href}
        onClick={handleClick}
        {...props}
      >
        {children}
      </Link>
    )
  }
)

/**
 * A button that navigates with workflow context tracking.
 * Use when you need button styling but workflow-aware navigation.
 */
export function WorkflowButton({
  href,
  contextTitle,
  contextParams,
  startNewWorkflow,
  onClick,
  children,
  className,
  ...props
}: WorkflowLinkProps & { className?: string }) {
  const { navigateTo, startWorkflow } = useWorkflowNavigation()

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const destination = typeof href === 'string' ? href : href.pathname || ''
    
    if (startNewWorkflow) {
      startWorkflow(destination, contextTitle)
    } else {
      navigateTo(destination, contextTitle, contextParams)
    }
    
    onClick?.(e)
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      className={className}
      {...props}
    >
      {children}
    </Link>
  )
}
