'use server'

import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/lib/permissions/constants'

// ============================================
// SECURITY EVENT TYPES
// ============================================

export enum SecurityEventType {
  /** User successfully passed permission check */
  PERMISSION_GRANTED = 'permission_granted',
  /** User was denied access due to missing permission */
  PERMISSION_DENIED = 'permission_denied',
  /** User failed authentication */
  AUTH_FAILURE = 'auth_failure',
  /** Error occurred during action execution */
  ACTION_ERROR = 'action_error',
  /** Permission matrix was modified */
  PERMISSIONS_MODIFIED = 'permissions_modified',
  /** Suspicious activity detected */
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  /** Admin lockout protection triggered */
  LOCKOUT_PROTECTION = 'lockout_protection',
  /** Rate limit exceeded */
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
}

// ============================================
// SECURITY EVENT INTERFACE
// ============================================

export interface SecurityEvent {
  type: SecurityEventType
  userId?: string
  userRole?: string
  permission?: string
  actionName?: string
  metadata?: Record<string, unknown>
}

export interface SecurityEventRecord extends SecurityEvent {
  id: string
  created_at: string
}

// ============================================
// LOGGING FUNCTIONS
// ============================================

/**
 * Log a security event to the database
 * This is the primary telemetry function for all authorization events
 */
export async function logSecurityEvent(event: SecurityEvent): Promise<void> {
  try {
    const supabase = await createClient()
    
    const { error } = await supabase.from('security_events').insert({
      event_type: event.type,
      user_id: event.userId || null,
      user_role: event.userRole || null,
      permission: event.permission || null,
      action_name: event.actionName || null,
      metadata: event.metadata || {},
      created_at: new Date().toISOString(),
    })
    
    if (error) {
      // Log to console as fallback - never fail silently on security events
      console.error('[SecurityTelemetry] Failed to log event:', error)
      console.warn('[SecurityTelemetry] Event data:', JSON.stringify(event))
    }
  } catch (err) {
    // Ensure telemetry failures don't break the application
    console.error('[SecurityTelemetry] Exception logging event:', err)
    console.warn('[SecurityTelemetry] Event data:', JSON.stringify(event))
  }
}

/**
 * Log a permission denial event
 * Convenience wrapper for the most common security event
 */
export async function logPermissionDenied(params: {
  userId?: string
  userRole?: UserRole
  permission: string
  actionName: string
  ip?: string
  userAgent?: string
  additionalMetadata?: Record<string, unknown>
}): Promise<void> {
  await logSecurityEvent({
    type: SecurityEventType.PERMISSION_DENIED,
    userId: params.userId,
    userRole: params.userRole,
    permission: params.permission,
    actionName: params.actionName,
    metadata: {
      ip: params.ip,
      userAgent: params.userAgent,
      timestamp: new Date().toISOString(),
      ...params.additionalMetadata,
    },
  })
}

/**
 * Log permission matrix modification
 */
export async function logPermissionsModified(params: {
  userId: string
  userRole: UserRole
  changes: {
    previous: Record<string, string[]>
    new: Record<string, string[]>
  }
}): Promise<void> {
  await logSecurityEvent({
    type: SecurityEventType.PERMISSIONS_MODIFIED,
    userId: params.userId,
    userRole: params.userRole,
    actionName: 'update_permissions_matrix',
    metadata: {
      timestamp: new Date().toISOString(),
      changes: params.changes,
    },
  })
}

/**
 * Log admin lockout protection trigger
 */
export async function logLockoutProtection(params: {
  userId: string
  attemptedAction: string
  protectedPermissions: string[]
}): Promise<void> {
  await logSecurityEvent({
    type: SecurityEventType.LOCKOUT_PROTECTION,
    userId: params.userId,
    actionName: params.attemptedAction,
    metadata: {
      timestamp: new Date().toISOString(),
      protectedPermissions: params.protectedPermissions,
      message: 'Attempted to remove protected admin permissions',
    },
  })
}

/**
 * Log suspicious activity
 */
export async function logSuspiciousActivity(params: {
  userId?: string
  description: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  await logSecurityEvent({
    type: SecurityEventType.SUSPICIOUS_ACTIVITY,
    userId: params.userId,
    metadata: {
      timestamp: new Date().toISOString(),
      description: params.description,
      ...params.metadata,
    },
  })
}

// ============================================
// QUERY FUNCTIONS
// ============================================

/**
 * Get recent security events for monitoring
 */
export async function getRecentSecurityEvents(options?: {
  limit?: number
  type?: SecurityEventType
  userId?: string
  since?: Date
}): Promise<{ success: boolean; events: SecurityEventRecord[]; error?: string }> {
  try {
    const supabase = await createClient()
    
    let query = supabase
      .from('security_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(options?.limit || 100)
    
    if (options?.type) {
      query = query.eq('event_type', options.type)
    }
    
    if (options?.userId) {
      query = query.eq('user_id', options.userId)
    }
    
    if (options?.since) {
      query = query.gte('created_at', options.since.toISOString())
    }
    
    const { data, error } = await query
    
    if (error) {
      console.error('[SecurityTelemetry] Failed to fetch events:', error)
      return { success: false, events: [], error: error.message }
    }
    
    return { 
      success: true, 
      events: (data || []).map(row => ({
        id: row.id,
        type: row.event_type as SecurityEventType,
        userId: row.user_id,
        userRole: row.user_role,
        permission: row.permission,
        actionName: row.action_name,
        metadata: row.metadata,
        created_at: row.created_at,
      })),
    }
  } catch (err) {
    console.error('[SecurityTelemetry] Exception fetching events:', err)
    return { success: false, events: [], error: 'Failed to fetch security events' }
  }
}

/**
 * Get count of permission denials in a time window
 * Useful for detecting potential attacks
 */
export async function getPermissionDenialCount(params: {
  userId?: string
  windowMinutes?: number
}): Promise<{ count: number; error?: string }> {
  try {
    const supabase = await createClient()
    const windowMs = (params.windowMinutes || 60) * 60 * 1000
    const since = new Date(Date.now() - windowMs).toISOString()
    
    let query = supabase
      .from('security_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', SecurityEventType.PERMISSION_DENIED)
      .gte('created_at', since)
    
    if (params.userId) {
      query = query.eq('user_id', params.userId)
    }
    
    const { count, error } = await query
    
    if (error) {
      return { count: 0, error: error.message }
    }
    
    return { count: count || 0 }
  } catch (err) {
    return { count: 0, error: 'Failed to count events' }
  }
}
