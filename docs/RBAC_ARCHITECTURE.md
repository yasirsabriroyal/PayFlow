# RBAC Architecture Documentation

## Overview

This document describes the Role-Based Access Control (RBAC) system with Policy-Based Authorization (PBAC) extensions for the construction payment management platform.

## System Components

### 1. Permission Catalog (`/lib/permissions/constants.ts`)

The permission catalog defines all available permissions grouped by module:

```typescript
export const PERMISSIONS = {
  INVOICES: {
    VIEW_AP_QUEUE: 'view_ap_queue',
    APPROVE_INVOICES: 'approve_invoices',
    REJECT_INVOICES: 'reject_invoices',
    // ...
  },
  PAYMENTS: {
    PROCESS_PAYMENTS: 'process_payments',
    EXECUTE_EFT_PAYMENTS: 'execute_eft_payments',
    // ...
  },
  // ... 8 total modules
}

export const ALL_PERMISSIONS = [...] // 27 permissions
export type Permission = typeof ALL_PERMISSIONS[number]
```

### 2. Server Enforcement

#### 2.1 `requirePermission()` (`/lib/permissions/index.ts`)

Throws `PermissionError` if user lacks permission:

```typescript
const user = await requirePermission(PERMISSIONS.INVOICES.APPROVE_INVOICES)
```

#### 2.2 `withPermission()` (`/lib/permissions/index.ts`)

Wrapper that returns typed results:

```typescript
export async function approveInvoice(id: string) {
  return withPermission(PERMISSIONS.INVOICES.APPROVE_INVOICES, async (user) => {
    // Action logic
    return { invoiceId: id }
  })
}
```

#### 2.3 `secureAction()` (`/lib/security/secureAction.ts`)

Enterprise wrapper with telemetry:

```typescript
export const createVendor = secureAction(
  PERMISSIONS.VENDORS.CREATE_VENDORS,
  async (user, input: CreateVendorInput) => {
    return { vendorId: '...' }
  }
)
```

### 3. Route Protection (`/lib/permissions/protect-route.ts`)

Used in layout files:

```typescript
// app/admin/layout.tsx
export default async function AdminLayout({ children }) {
  await protectRoute('manage_role_permissions')
  return <>{children}</>
}
```

### 4. Permission Caching (`/lib/permissions/cache.ts`)

In-memory cache reduces database queries:

- **TTL**: 5 minutes
- **Invalidation**: Automatic on permission changes
- **Cache miss**: Falls back to database

```typescript
import { invalidatePermissionCache, getCacheStats } from '@/lib/permissions/cache'

// After updating permissions
invalidatePermissionCache()

// Monitor cache performance
const stats = getCacheStats() // { hits, misses, size }
```

### 5. Security Telemetry (`/lib/security/telemetry.ts`)

Logs all authorization events:

```typescript
await logSecurityEvent({
  type: SecurityEventType.PERMISSION_DENIED,
  userId: user.id,
  userRole: user.role,
  permission: 'execute_eft_payments',
  actionName: 'executeEFTPayment',
  metadata: { ip, userAgent }
})
```

Events are stored in the `security_events` table.

### 6. Rate Limiting (`/lib/security/rateLimit.ts`)

Protects critical actions:

```typescript
import { RATE_LIMITS, withRateLimit } from '@/lib/security/rateLimit'

const result = await withRateLimit(userId, RATE_LIMITS.EXECUTE_EFT, async () => {
  // Your action
})
```

Default limits:
- `EXECUTE_EFT`: 10/minute
- `APPROVE_INVOICE`: 30/minute
- `MODIFY_PERMISSIONS`: 20/minute

### 7. Policy Engine (`/lib/security/policyEngine.ts`)

Extends RBAC with conditional rules:

```typescript
const result = await authorize(
  user,
  PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS,
  { amount: 75000, projectId: 'P-102' }
)

if (!result.allowed) {
  throw new Error(result.reason)
}
```

## Database Schema

### `role_permissions` Table

```sql
CREATE TABLE role_permissions (
  id UUID PRIMARY KEY,
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE(role, permission)
);
```

### `security_events` Table

```sql
CREATE TABLE security_events (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id UUID,
  user_role TEXT,
  permission TEXT,
  action_name TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ
);
```

## Client-Side Integration

### `usePermissions()` Hook

```typescript
const { hasPermission, hasAnyPermission, permissions, isLoading } = usePermissions()

if (hasPermission('approve_invoices')) {
  // Show approve button
}
```

### `<PermissionGate>` Component

```typescript
<PermissionGate permission="execute_eft_payments">
  <EFTButton />
</PermissionGate>

<PermissionGate permission="approve_invoices" fallback={<Locked />}>
  <ApproveButton />
</PermissionGate>
```

## Adding New Permissions

### Step 1: Add to Constants

```typescript
// /lib/permissions/constants.ts
export const PERMISSIONS = {
  // ...existing
  NEW_MODULE: {
    NEW_PERMISSION: 'new_permission',
  },
}

// Add to ALL_PERMISSIONS array
export const ALL_PERMISSIONS = [
  // ...existing
  'new_permission',
] as const
```

### Step 2: Add Default Role Assignments

```typescript
// /lib/permissions/constants.ts
export const DEFAULT_ROLE_PERMISSIONS = {
  admin: [...existing, 'new_permission'],
  // ...
}
```

### Step 3: Protect Server Action

```typescript
// /app/module/actions.ts
export async function newAction(input: Input) {
  return withPermission(PERMISSIONS.NEW_MODULE.NEW_PERMISSION, async (user) => {
    // Implementation
  })
}
```

### Step 4: Protect Route (if needed)

```typescript
// /app/module/layout.tsx
export default async function Layout({ children }) {
  await protectRoute('new_permission')
  return <>{children}</>
}
```

### Step 5: Run Coverage Scanner

```bash
npx ts-node scripts/verify-permission-coverage.ts
```

## Security Best Practices

1. **Always use `withPermission()` or `secureAction()`** for server actions
2. **Never check permissions client-side only** - always enforce server-side
3. **Use rate limiting** for financial operations
4. **Monitor security events** regularly
5. **Run coverage scanner** before deployments
6. **Test permission changes** with the confirmation dialog

## Testing

### Automated Tests

```bash
npm test -- __tests__/rbac/security.test.ts
npm test -- tests/security/policy.spec.ts
```

### Manual Testing

1. Log in as each role type
2. Verify correct permissions are shown/hidden
3. Attempt unauthorized actions
4. Check security_events table for logged denials

## Monitoring

### Cache Statistics

```typescript
import { getCacheStats } from '@/lib/permissions/cache'
const stats = getCacheStats()
console.log(`Cache hit rate: ${(stats.hits / (stats.hits + stats.misses)) * 100}%`)
```

### Security Events Query

```sql
SELECT event_type, COUNT(*) 
FROM security_events 
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY event_type;
```

### Rate Limit Statistics

```typescript
import { getRateLimitStats } from '@/lib/security/rateLimit'
const stats = getRateLimitStats()
console.log(`Active rate limit entries: ${stats.totalEntries}`)
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT SIDE                                  │
├─────────────────────────────────────────────────────────────────────┤
│  usePermissions()    <PermissionGate>    PermissionChangeConfirm    │
│         │                   │                       │                │
│         └───────────────────┴───────────────────────┘                │
│                             │                                        │
│                    [Permission Check API]                            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SERVER SIDE                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐  │
│  │ protectRoute│    │withPermission│    │      secureAction      │  │
│  │   (routes)  │    │  (actions)   │    │   (enterprise wrapper) │  │
│  └──────┬──────┘    └──────┬───────┘    └───────────┬─────────────┘  │
│         │                  │                        │                │
│         └──────────────────┼────────────────────────┘                │
│                            │                                         │
│                   ┌────────▼────────┐                               │
│                   │ requirePermission│                               │
│                   └────────┬────────┘                               │
│                            │                                         │
│         ┌──────────────────┼──────────────────┐                     │
│         │                  │                  │                      │
│  ┌──────▼──────┐   ┌───────▼───────┐   ┌─────▼─────┐               │
│  │ Policy Engine│   │Permission Cache│   │ Telemetry │               │
│  │   (PBAC)     │   │   (5min TTL)  │   │ (logging) │               │
│  └──────────────┘   └───────┬───────┘   └───────────┘               │
│                             │                                        │
│                    ┌────────▼────────┐                              │
│                    │    Database     │                               │
│                    │ role_permissions│                               │
│                    │ security_events │                               │
│                    └─────────────────┘                              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Changelog

- **v1.0**: Initial RBAC implementation (27 permissions, 3 roles)
- **v1.1**: Added enterprise security (telemetry, caching, rate limiting)
- **v1.2**: Added PBAC policy engine for conditional authorization
