'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface ResponsiveTableProps {
  children: React.ReactNode
  className?: string
}

export function ResponsiveTable({ children, className }: ResponsiveTableProps) {
  return (
    <div className={cn("w-full overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0", className)}>
      <div className="min-w-[800px] md:min-w-0">
        {children}
      </div>
    </div>
  )
}

interface MobileCardViewProps<T> {
  items: T[]
  renderCard: (item: T, index: number) => React.ReactNode
  renderTable: () => React.ReactNode
  className?: string
}

export function ResponsiveDataView<T>({ 
  items, 
  renderCard, 
  renderTable,
  className 
}: MobileCardViewProps<T>) {
  return (
    <div className={className}>
      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {items.map((item, index) => (
          <React.Fragment key={index}>
            {renderCard(item, index)}
          </React.Fragment>
        ))}
      </div>
      
      {/* Desktop Table View */}
      <div className="hidden md:block">
        {renderTable()}
      </div>
    </div>
  )
}

// Mobile-friendly data card component
interface DataCardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}

export function DataCard({ children, className, onClick }: DataCardProps) {
  return (
    <div 
      className={cn(
        "bg-card border border-border rounded-lg p-4 space-y-3",
        onClick && "cursor-pointer hover:border-primary/30 active:bg-muted/50 transition-colors touch-manipulation",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

interface DataCardRowProps {
  label: string
  value: React.ReactNode
  className?: string
}

export function DataCardRow({ label, value, className }: DataCardRowProps) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <span className="text-sm text-muted-foreground flex-shrink-0">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  )
}

interface DataCardHeaderProps {
  title: string
  subtitle?: string
  badge?: React.ReactNode
  actions?: React.ReactNode
}

export function DataCardHeader({ title, subtitle, badge, actions }: DataCardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-medium truncate">{title}</h3>
          {badge}
        </div>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex-shrink-0">
          {actions}
        </div>
      )}
    </div>
  )
}
