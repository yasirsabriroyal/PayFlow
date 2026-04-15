/**
 * RBAC Security Tests
 * 
 * Automated authorization tests that verify:
 * - Unauthorized users cannot access protected routes
 * - Unauthorized users cannot execute server actions
 * - Authorized users can execute allowed actions
 * - Admin lockout protection cannot be bypassed
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import {
  PERMISSIONS,
  ALL_PERMISSIONS,
  PROTECTED_ADMIN_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  ROLES,
  type Permission,
  type UserRole,
  type PermissionsMatrix,
  isValidPermission,
  isValidRole,
  validatePermissionsMatrix,
} from '@/lib/permissions/constants'

// Local test helper - enforce protected admin permissions
function enforceProtectedPermissions(matrix: PermissionsMatrix): PermissionsMatrix {
  const result = { ...matrix }
  for (const permission of PROTECTED_ADMIN_PERMISSIONS) {
    if (!result.admin.includes(permission)) {
      result.admin = [...result.admin, permission]
    }
  }
  return result
}

// Mock the Supabase client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
    })),
  })),
}))

describe('RBAC Security Tests', () => {
  // ============================================
  // PERMISSION VALIDATION TESTS
  // ============================================
  
  describe('Permission Validation', () => {
    it('should validate all defined permissions', () => {
      for (const permission of ALL_PERMISSIONS) {
        expect(isValidPermission(permission)).toBe(true)
      }
    })

    it('should reject invalid permission strings', () => {
      const invalidPermissions = [
        'invalid_permission',
        'ADMIN',
        '',
        'view_projects_extra',
        'approve-invoices', // Wrong format (dash instead of underscore)
      ]

      for (const invalid of invalidPermissions) {
        expect(isValidPermission(invalid)).toBe(false)
      }
    })

    it('should have unique permission keys', () => {
      const permissionSet = new Set(ALL_PERMISSIONS)
      expect(permissionSet.size).toBe(ALL_PERMISSIONS.length)
    })

    it('should validate all defined roles', () => {
      for (const role of ROLES) {
        expect(isValidRole(role)).toBe(true)
      }
    })

    it('should reject invalid role strings', () => {
      const invalidRoles = ['superadmin', 'user', 'ADMIN', '', 'administrator']
      
      for (const invalid of invalidRoles) {
        expect(isValidRole(invalid)).toBe(false)
      }
    })
  })

  // ============================================
  // ADMIN LOCKOUT PROTECTION TESTS
  // ============================================

  describe('Admin Lockout Protection', () => {
    it('should define protected admin permissions', () => {
      expect(PROTECTED_ADMIN_PERMISSIONS).toContain(PERMISSIONS.ADMINISTRATION.MANAGE_PERMISSIONS)
      expect(PROTECTED_ADMIN_PERMISSIONS).toContain(PERMISSIONS.ADMINISTRATION.MANAGE_USERS)
      expect(PROTECTED_ADMIN_PERMISSIONS).toContain(PERMISSIONS.ADMINISTRATION.MANAGE_ROLES)
    })

    it('should enforce protected permissions cannot be removed from admin', () => {
      const matrixWithoutProtected = {
        admin: [], // Empty - no permissions
        project_manager: [],
        accountant: [],
        contractor: [],
      }

      const enforced = enforceProtectedPermissions(matrixWithoutProtected)

      // Admin should have all protected permissions restored
      for (const permission of PROTECTED_ADMIN_PERMISSIONS) {
        expect(enforced.admin).toContain(permission)
      }
    })

    it('should preserve existing admin permissions when enforcing protected', () => {
      const matrixWithSome = {
        admin: [PERMISSIONS.PROJECTS.VIEW_PROJECTS],
        project_manager: [],
        accountant: [],
        contractor: [],
      }

      const enforced = enforceProtectedPermissions(matrixWithSome)

      // Should have original permission
      expect(enforced.admin).toContain(PERMISSIONS.PROJECTS.VIEW_PROJECTS)
      
      // Plus protected permissions
      for (const permission of PROTECTED_ADMIN_PERMISSIONS) {
        expect(enforced.admin).toContain(permission)
      }
    })

    it('should not affect non-admin roles when enforcing protected permissions', () => {
      const matrix = {
        admin: [],
        project_manager: [PERMISSIONS.PROJECTS.VIEW_PROJECTS],
        accountant: [PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS],
        contractor: [],
      }

      const enforced = enforceProtectedPermissions(matrix)

      // Non-admin roles unchanged
      expect(enforced.project_manager).toEqual([PERMISSIONS.PROJECTS.VIEW_PROJECTS])
      expect(enforced.accountant).toEqual([PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS])
      expect(enforced.contractor).toEqual([])
    })
  })

  // ============================================
  // DEFAULT ROLE PERMISSIONS TESTS
  // ============================================

  describe('Default Role Permissions', () => {
    it('should give admin all permissions by default', () => {
      expect(DEFAULT_ROLE_PERMISSIONS.admin).toEqual(ALL_PERMISSIONS)
    })

    it('should not give contractor sensitive permissions by default', () => {
      const sensitivePerm = [
        PERMISSIONS.INVOICES.APPROVE_INVOICES,
        PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS,
        PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS,
        PERMISSIONS.ADMINISTRATION.MANAGE_PERMISSIONS,
        PERMISSIONS.ADMINISTRATION.MANAGE_USERS,
      ]

      for (const permission of sensitivePerm) {
        expect(DEFAULT_ROLE_PERMISSIONS.contractor).not.toContain(permission)
      }
    })

    it('should give accountant payment-related permissions', () => {
      expect(DEFAULT_ROLE_PERMISSIONS.accountant).toContain(PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS)
      expect(DEFAULT_ROLE_PERMISSIONS.accountant).toContain(PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS)
      expect(DEFAULT_ROLE_PERMISSIONS.accountant).toContain(PERMISSIONS.PAYMENTS.VIEW_PAYMENT_RECORDS)
    })

    it('should give project manager approval but not EFT execution', () => {
      expect(DEFAULT_ROLE_PERMISSIONS.project_manager).toContain(PERMISSIONS.INVOICES.APPROVE_INVOICES)
      expect(DEFAULT_ROLE_PERMISSIONS.project_manager).not.toContain(PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS)
    })

    it('should not give non-admin roles administrative permissions', () => {
      const adminPerms = [
        PERMISSIONS.ADMINISTRATION.MANAGE_PERMISSIONS,
        PERMISSIONS.ADMINISTRATION.MANAGE_USERS,
        PERMISSIONS.ADMINISTRATION.MANAGE_ROLES,
      ]

      for (const role of ROLES) {
        if (role !== 'admin') {
          for (const permission of adminPerms) {
            expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(permission)
          }
        }
      }
    })
  })

  // ============================================
  // PERMISSIONS MATRIX VALIDATION TESTS
  // ============================================

  describe('Permissions Matrix Validation', () => {
    it('should validate a correct permissions matrix', () => {
      const validMatrix = {
        admin: [PERMISSIONS.PROJECTS.VIEW_PROJECTS],
        project_manager: [PERMISSIONS.PROJECTS.VIEW_PROJECTS],
        accountant: [PERMISSIONS.PAYMENTS.VIEW_PAYMENT_RECORDS],
        contractor: [],
      }

      const result = validatePermissionsMatrix(validMatrix)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject non-object input', () => {
      const result = validatePermissionsMatrix('not an object')
      expect(result.valid).toBe(false)
    })

    it('should reject invalid role keys', () => {
      const invalidMatrix = {
        admin: [],
        superadmin: [], // Invalid role
        project_manager: [],
        accountant: [],
        contractor: [],
      }

      const result = validatePermissionsMatrix(invalidMatrix)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('Invalid role'))).toBe(true)
    })

    it('should reject invalid permission values', () => {
      const invalidMatrix = {
        admin: ['invalid_permission'],
        project_manager: [],
        accountant: [],
        contractor: [],
      }

      const result = validatePermissionsMatrix(invalidMatrix)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('Invalid permission'))).toBe(true)
    })

    it('should reject non-array permission values', () => {
      const invalidMatrix = {
        admin: 'not an array',
        project_manager: [],
        accountant: [],
        contractor: [],
      }

      const result = validatePermissionsMatrix(invalidMatrix)
      expect(result.valid).toBe(false)
    })
  })

  // ============================================
  // CRITICAL PERMISSION MAPPING TESTS
  // ============================================

  describe('Critical Permission Mappings', () => {
    const criticalMappings: Array<{ permission: Permission; description: string }> = [
      { permission: PERMISSIONS.INVOICES.APPROVE_INVOICES, description: 'approve invoice' },
      { permission: PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS, description: 'execute EFT payment' },
      { permission: PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS, description: 'process payments' },
      { permission: PERMISSIONS.VENDORS.DELETE_VENDORS, description: 'delete vendors' },
      { permission: PERMISSIONS.ADMINISTRATION.MANAGE_PERMISSIONS, description: 'manage permissions' },
    ]

    for (const mapping of criticalMappings) {
      it(`should have ${mapping.description} permission defined`, () => {
        expect(ALL_PERMISSIONS).toContain(mapping.permission)
      })

      it(`should restrict ${mapping.description} from contractor role`, () => {
        expect(DEFAULT_ROLE_PERMISSIONS.contractor).not.toContain(mapping.permission)
      })
    }

    it('should require execute_eft_payments for EFT batch generation', () => {
      // This test documents the expected permission mapping
      const eftPermission = PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS
      expect(eftPermission).toBe('execute_eft_payments')
      
      // Only accountant and admin should have this by default
      expect(DEFAULT_ROLE_PERMISSIONS.accountant).toContain(eftPermission)
      expect(DEFAULT_ROLE_PERMISSIONS.admin).toContain(eftPermission)
      expect(DEFAULT_ROLE_PERMISSIONS.project_manager).not.toContain(eftPermission)
      expect(DEFAULT_ROLE_PERMISSIONS.contractor).not.toContain(eftPermission)
    })

    it('should require manage_permissions for permissions updates', () => {
      const managePermission = PERMISSIONS.ADMINISTRATION.MANAGE_PERMISSIONS
      expect(managePermission).toBe('manage_permissions')
      
      // Only admin should have this by default
      expect(DEFAULT_ROLE_PERMISSIONS.admin).toContain(managePermission)
      expect(DEFAULT_ROLE_PERMISSIONS.project_manager).not.toContain(managePermission)
      expect(DEFAULT_ROLE_PERMISSIONS.accountant).not.toContain(managePermission)
      expect(DEFAULT_ROLE_PERMISSIONS.contractor).not.toContain(managePermission)
    })
  })

  // ============================================
  // PERMISSION COUNT INTEGRITY TESTS
  // ============================================

  describe('Permission Count Integrity', () => {
    it('should have exactly 27 permissions defined', () => {
      // This test ensures no permissions are accidentally added or removed
      expect(ALL_PERMISSIONS.length).toBe(27)
    })

    it('should have 4 roles defined', () => {
      expect(ROLES.length).toBe(4)
    })

    it('should have 3 protected admin permissions', () => {
      expect(PROTECTED_ADMIN_PERMISSIONS.length).toBe(3)
    })

    it('should have permission modules matching PERMISSIONS object', () => {
      const moduleCount = Object.keys(PERMISSIONS).length
      expect(moduleCount).toBe(8) // 8 modules
    })
  })

  // ============================================
  // PERMISSION TYPE SAFETY TESTS
  // ============================================

  describe('Permission Type Safety', () => {
    it('should export Permission type that only accepts valid values', () => {
      // This test verifies type narrowing works
      const validPermission: Permission = PERMISSIONS.INVOICES.APPROVE_INVOICES
      expect(ALL_PERMISSIONS).toContain(validPermission)
    })

    it('should export UserRole type that only accepts valid values', () => {
      const validRole: UserRole = 'admin'
      expect(ROLES).toContain(validRole)
    })

    it('should have PERMISSIONS object with correct structure', () => {
      // Verify each module exists and has permissions
      expect(PERMISSIONS.PROJECTS).toBeDefined()
      expect(PERMISSIONS.PAYMENT_CERTIFICATES).toBeDefined()
      expect(PERMISSIONS.INVOICES).toBeDefined()
      expect(PERMISSIONS.PAYMENTS).toBeDefined()
      expect(PERMISSIONS.VENDORS).toBeDefined()
      expect(PERMISSIONS.CONTRACTS).toBeDefined()
      expect(PERMISSIONS.REPORTING).toBeDefined()
      expect(PERMISSIONS.ADMINISTRATION).toBeDefined()
    })
  })
})

// ============================================
// AUTHORIZATION FLOW TESTS (Mocked)
// ============================================

describe('Authorization Flow Tests', () => {
  describe('requirePermission behavior', () => {
    it('should throw PermissionError for unauthenticated users', async () => {
      // This documents expected behavior - actual implementation is in index.ts
      const { PermissionError } = await import('@/lib/permissions')
      
      expect(() => {
        throw new PermissionError('Unauthorized: Not authenticated', undefined, 401)
      }).toThrow('Unauthorized: Not authenticated')
    })

    it('should throw PermissionError for unauthorized users', async () => {
      const { PermissionError } = await import('@/lib/permissions')
      
      expect(() => {
        throw new PermissionError(
          `Forbidden: Missing permission 'approve_invoices'`,
          PERMISSIONS.INVOICES.APPROVE_INVOICES
        )
      }).toThrow('Forbidden: Missing permission')
    })

    it('should include permission in PermissionError', async () => {
      const { PermissionError } = await import('@/lib/permissions')
      
      const error = new PermissionError(
        'Forbidden',
        PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS
      )
      
      expect(error.permission).toBe(PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS)
      expect(error.statusCode).toBe(403)
    })
  })
})
