'use client'

import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { logout } from '@/app/auth/actions'

export function LogoutButton({ 
  variant = 'ghost',
  showLabel = false 
}: { 
  variant?: 'ghost' | 'outline' | 'default'
  showLabel?: boolean
}) {
  return (
    <form action={logout}>
      <Button 
        type="submit" 
        variant={variant} 
        size={showLabel ? 'sm' : 'icon'}
        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        title="Log out"
      >
        <LogOut className="w-5 h-5" />
        {showLabel && <span className="ml-2">Log out</span>}
      </Button>
    </form>
  )
}
