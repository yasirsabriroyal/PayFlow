'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from '@/app/actions/notifications'

const POLL_INTERVAL_MS = 60_000

/** Small colored dot keyed to the notification type. */
function typeAccent(type: string): string {
  if (type.includes('approved') || type.includes('paid')) return 'bg-emerald-500'
  if (type.includes('rejected')) return 'bg-destructive'
  if (type.includes('disputed') || type.includes('revision')) return 'bg-amber-500'
  if (type.includes('expiry') || type.includes('compliance')) return 'bg-amber-500'
  return 'bg-primary'
}

export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    const res = await getNotifications(20)
    if (res.success) {
      setItems(res.notifications)
      setUnread(res.unread)
    }
  }, [])

  // Initial load + polling for the unread badge.
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [refresh])

  // Refresh when the popover opens so the list is current.
  useEffect(() => {
    if (open) {
      setLoading(true)
      refresh().finally(() => setLoading(false))
    }
  }, [open, refresh])

  const handleItemClick = async (item: NotificationItem) => {
    // Optimistic local read.
    if (!item.read) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)))
      setUnread((u) => Math.max(0, u - 1))
      markNotificationRead(item.id).catch(() => refresh())
    }
    setOpen(false)
    if (item.link) router.push(item.link)
  }

  const handleMarkAll = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnread(0)
    const res = await markAllNotificationsRead()
    if (!res.success) refresh()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleMarkAll}
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </Button>
          )}
        </div>

        <ScrollArea className="max-h-96">
          {loading && items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Bell className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">You&apos;re all caught up</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(item)}
                    className={cn(
                      'flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50',
                      !item.read && 'bg-primary/5',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                        item.read ? 'bg-transparent' : typeAccent(item.type),
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {item.title}
                      </span>
                      {item.body && (
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground line-clamp-2">
                          {item.body}
                        </span>
                      )}
                      <span className="mt-1 block text-[11px] text-muted-foreground/70">
                        {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
