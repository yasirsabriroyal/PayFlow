/**
 * PERMISSION CATALOG
 * 
 * Centralized permission definitions for Dynamic RBAC system.
 * All permissions must be defined here - never use random strings.
 */

// ============================================
// PERMISSION MODULES
// ============================================

export const PERMISSION_MODULES = {
  PROJECTS: 'projects',
  PAYMENT_CERTIFICATES: 'payment_certificates',
  INVOICES: 'invoices',
  PAYMENTS: 'payments',
  VENDORS: 'vendors',
  CONTRACTS: 'contracts',
  REPORTING: 'reporting',
  ADMINISTRATION: 'administration',
} as const

export type PermissionModule = typeof PERMISSION_MODULES[keyof typeof PERMISSION_MODULES]

// ============================================
// PERMISSION KEYS (Nested for organized imports)
// ============================================

export const PERMISSIONS = {
  PROJECTS: {
    VIEW_PROJECTS: 'view_projects',
    CREATE_PROJECTS: 'create_projects',
    EDIT_PROJECTS: 'edit_projects',
    ARCHIVE_PROJECTS: 'archive_projects',
  },
  PAYMENT_CERTIFICATES: {
    CREATE_PAYMENT_CERTIFICATE: 'create_payment_certificate',
    EDIT_PAYMENT_CERTIFICATE: 'edit_payment_certificate',
    VIEW_PAYMENT_HISTORY: 'view_payment_history',
  },
  INVOICES: {
    VIEW_AP_QUEUE: 'view_ap_queue',
    CREATE_INVOICE: 'create_invoice',
    UPLOAD_INVOICE_ATTACHMENT: 'upload_invoice_attachment',
    APPROVE_INVOICES: 'approve_invoices',
    REJECT_INVOICES: 'reject_invoices',
    DISPUTE_INVOICES: 'dispute_invoices',
  },
  PAYMENTS: {
    PROCESS_PAYMENTS: 'process_payments',
    EXECUTE_EFT_PAYMENTS: 'execute_eft_payments',
    VIEW_PAYMENT_RECORDS: 'view_payment_records',
    CREATE_DIRECT_PAYMENT: 'create_direct_payment',
  },
  VENDORS: {
    VIEW_VENDORS: 'view_vendors',
    CREATE_VENDORS: 'create_vendors',
    EDIT_VENDORS: 'edit_vendors',
    DELETE_VENDORS: 'delete_vendors',
  },
  CONTRACTS: {
    VIEW_CONTRACTS: 'view_contracts',
    UPLOAD_CONTRACTS: 'upload_contracts',
    EDIT_CONTRACTS: 'edit_contracts',
  },
  REPORTING: {
    VIEW_FINANCIAL_REPORTS: 'view_financial_reports',
    EXPORT_REPORTS: 'export_reports',
  },
  ADMINISTRATION: {
    MANAGE_PERMISSIONS: 'manage_permissions',
    MANAGE_USERS: 'manage_users',
    MANAGE_ROLES: 'manage_roles',
    VIEW_SYSTEM_LOGS: 'view_system_logs',
  },
} as const

// Permission type from all nested values
export type Permission = 
  | typeof PERMISSIONS.PROJECTS[keyof typeof PERMISSIONS.PROJECTS]
  | typeof PERMISSIONS.PAYMENT_CERTIFICATES[keyof typeof PERMISSIONS.PAYMENT_CERTIFICATES]
  | typeof PERMISSIONS.INVOICES[keyof typeof PERMISSIONS.INVOICES]
  | typeof PERMISSIONS.PAYMENTS[keyof typeof PERMISSIONS.PAYMENTS]
  | typeof PERMISSIONS.VENDORS[keyof typeof PERMISSIONS.VENDORS]
  | typeof PERMISSIONS.CONTRACTS[keyof typeof PERMISSIONS.CONTRACTS]
  | typeof PERMISSIONS.REPORTING[keyof typeof PERMISSIONS.REPORTING]
  | typeof PERMISSIONS.ADMINISTRATION[keyof typeof PERMISSIONS.ADMINISTRATION]

// Array of all valid permissions for validation
export const ALL_PERMISSIONS: Permission[] = [
  ...Object.values(PERMISSIONS.PROJECTS),
  ...Object.values(PERMISSIONS.PAYMENT_CERTIFICATES),
  ...Object.values(PERMISSIONS.INVOICES),
  ...Object.values(PERMISSIONS.PAYMENTS),
  ...Object.values(PERMISSIONS.VENDORS),
  ...Object.values(PERMISSIONS.CONTRACTS),
  ...Object.values(PERMISSIONS.REPORTING),
  ...Object.values(PERMISSIONS.ADMINISTRATION),
]

// ============================================
// PERMISSION METADATA (for UI display)
// ============================================

export interface PermissionMetadata {
  key: Permission
  label: string
  description: string
  module: PermissionModule
  isCritical?: boolean
}

export const PERMISSION_CATALOG: PermissionMetadata[] = [
  // Projects
  { key: PERMISSIONS.PROJECTS.VIEW_PROJECTS, label: 'View Projects', description: 'Can view project list and details', module: PERMISSION_MODULES.PROJECTS },
  { key: PERMISSIONS.PROJECTS.CREATE_PROJECTS, label: 'Create Projects', description: 'Can create new projects', module: PERMISSION_MODULES.PROJECTS },
  { key: PERMISSIONS.PROJECTS.EDIT_PROJECTS, label: 'Edit Projects', description: 'Can modify project details and budgets', module: PERMISSION_MODULES.PROJECTS },
  { key: PERMISSIONS.PROJECTS.ARCHIVE_PROJECTS, label: 'Archive Projects', description: 'Can archive and deactivate projects', module: PERMISSION_MODULES.PROJECTS },
  // Payment Certificates
  { key: PERMISSIONS.PAYMENT_CERTIFICATES.CREATE_PAYMENT_CERTIFICATE, label: 'Create Payment Certificates', description: 'Can create payment certificates for contractors', module: PERMISSION_MODULES.PAYMENT_CERTIFICATES },
  { key: PERMISSIONS.PAYMENT_CERTIFICATES.EDIT_PAYMENT_CERTIFICATE, label: 'Edit Payment Certificates', description: 'Can modify existing payment certificates', module: PERMISSION_MODULES.PAYMENT_CERTIFICATES },
  { key: PERMISSIONS.PAYMENT_CERTIFICATES.VIEW_PAYMENT_HISTORY, label: 'View Payment History', description: 'Can view historical payment records', module: PERMISSION_MODULES.PAYMENT_CERTIFICATES },
  // Invoices
  { key: PERMISSIONS.INVOICES.VIEW_AP_QUEUE, label: 'View AP Queue', description: 'Can view accounts payable queue', module: PERMISSION_MODULES.INVOICES },
  { key: PERMISSIONS.INVOICES.CREATE_INVOICE, label: 'Create Invoice', description: 'Can create new invoices for contractors', module: PERMISSION_MODULES.INVOICES },
  { key: PERMISSIONS.INVOICES.UPLOAD_INVOICE_ATTACHMENT, label: 'Upload Invoice Attachments', description: 'Can attach documents to invoices', module: PERMISSION_MODULES.INVOICES },
  { key: PERMISSIONS.INVOICES.APPROVE_INVOICES, label: 'Approve Invoices', description: 'Can approve invoices for payment', module: PERMISSION_MODULES.INVOICES, isCritical: true },
  { key: PERMISSIONS.INVOICES.REJECT_INVOICES, label: 'Reject Invoices', description: 'Can reject invoices with reason', module: PERMISSION_MODULES.INVOICES },
  { key: PERMISSIONS.INVOICES.DISPUTE_INVOICES, label: 'Dispute Invoices', description: 'Can flag invoices as disputed and resolve disputes', module: PERMISSION_MODULES.INVOICES },
  // Payments
  { key: PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS, label: 'Process Payments', description: 'Can process approved payments', module: PERMISSION_MODULES.PAYMENTS, isCritical: true },
  { key: PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS, label: 'Execute EFT Payments', description: 'Can generate and execute EFT payment files', module: PERMISSION_MODULES.PAYMENTS, isCritical: true },
  { key: PERMISSIONS.PAYMENTS.VIEW_PAYMENT_RECORDS, label: 'View Payment Records', description: 'Can view completed payment records', module: PERMISSION_MODULES.PAYMENTS },
  { key: PERMISSIONS.PAYMENTS.CREATE_DIRECT_PAYMENT, label: 'Create Direct Payment', description: 'Can create payments without invoice (admin only)', module: PERMISSION_MODULES.PAYMENTS, isCritical: true },
  // Vendors
  { key: PERMISSIONS.VENDORS.VIEW_VENDORS, label: 'View Vendors', description: 'Can view vendor/contractor list', module: PERMISSION_MODULES.VENDORS },
  { key: PERMISSIONS.VENDORS.CREATE_VENDORS, label: 'Create Vendors', description: 'Can add new vendors/contractors', module: PERMISSION_MODULES.VENDORS },
  { key: PERMISSIONS.VENDORS.EDIT_VENDORS, label: 'Edit Vendors', description: 'Can modify vendor information', module: PERMISSION_MODULES.VENDORS },
  { key: PERMISSIONS.VENDORS.DELETE_VENDORS, label: 'Delete Vendors', description: 'Can remove vendors from system', module: PERMISSION_MODULES.VENDORS, isCritical: true },
  // Contracts
  { key: PERMISSIONS.CONTRACTS.VIEW_CONTRACTS, label: 'View Contracts', description: 'Can view contract documents', module: PERMISSION_MODULES.CONTRACTS },
  { key: PERMISSIONS.CONTRACTS.UPLOAD_CONTRACTS, label: 'Upload Contracts', description: 'Can upload new contract documents', module: PERMISSION_MODULES.CONTRACTS },
  { key: PERMISSIONS.CONTRACTS.EDIT_CONTRACTS, label: 'Edit Contracts', description: 'Can modify contract details', module: PERMISSION_MODULES.CONTRACTS },
  // Reporting
  { key: PERMISSIONS.REPORTING.VIEW_FINANCIAL_REPORTS, label: 'View Financial Reports', description: 'Can access financial reporting dashboard', module: PERMISSION_MODULES.REPORTING },
  { key: PERMISSIONS.REPORTING.EXPORT_REPORTS, label: 'Export Reports', description: 'Can export reports to PDF/Excel', module: PERMISSION_MODULES.REPORTING },
  // Administration
  { key: PERMISSIONS.ADMINISTRATION.MANAGE_PERMISSIONS, label: 'Manage Permissions', description: 'Can modify role permissions', module: PERMISSION_MODULES.ADMINISTRATION, isCritical: true },
  { key: PERMISSIONS.ADMINISTRATION.MANAGE_USERS, label: 'Manage Users', description: 'Can add, edit, and deactivate users', module: PERMISSION_MODULES.ADMINISTRATION, isCritical: true },
  { key: PERMISSIONS.ADMINISTRATION.MANAGE_ROLES, label: 'Manage Roles', description: 'Can create and modify roles', module: PERMISSION_MODULES.ADMINISTRATION, isCritical: true },
  { key: PERMISSIONS.ADMINISTRATION.VIEW_SYSTEM_LOGS, label: 'View System Logs', description: 'Can access audit logs and system activity', module: PERMISSION_MODULES.ADMINISTRATION },
]

// Group permissions by module (flat)
export const PERMISSIONS_BY_MODULE = PERMISSION_CATALOG.reduce((acc, permission) => {
  if (!acc[permission.module]) {
    acc[permission.module] = []
  }
  acc[permission.module].push(permission)
  return acc
}, {} as Record<PermissionModule, PermissionMetadata[]>)

// Module display names (defined before PERMISSION_GROUPS which uses it)
export const MODULE_LABELS: Record<PermissionModule, string> = {
  [PERMISSION_MODULES.PROJECTS]: 'Projects',
  [PERMISSION_MODULES.PAYMENT_CERTIFICATES]: 'Payment Certificates',
  [PERMISSION_MODULES.INVOICES]: 'Invoices / AP',
  [PERMISSION_MODULES.PAYMENTS]: 'Payments',
  [PERMISSION_MODULES.VENDORS]: 'Vendors',
  [PERMISSION_MODULES.CONTRACTS]: 'Contracts',
  [PERMISSION_MODULES.REPORTING]: 'Reporting',
  [PERMISSION_MODULES.ADMINISTRATION]: 'Administration',
}

// Structured permission groups for UI display
export interface PermissionGroup {
  label: string
  permissions: PermissionMetadata[]
}

export const PERMISSION_GROUPS: Record<string, PermissionGroup> = Object.entries(PERMISSIONS_BY_MODULE).reduce(
  (acc, [moduleKey, permissions]) => {
    acc[moduleKey] = {
      label: MODULE_LABELS[moduleKey as PermissionModule] || moduleKey,
      permissions,
    }
    return acc
  },
  {} as Record<string, PermissionGroup>
)

// ============================================
// ROLES
// ============================================

export const ROLES = ['admin', 'project_manager', 'accountant', 'contractor'] as const
export type UserRole = typeof ROLES[number]

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  project_manager: 'Project Manager',
  accountant: 'Accountant',
  contractor: 'Contractor',
}

// ============================================
// DEFAULT PERMISSIONS BY ROLE
// ============================================

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: ALL_PERMISSIONS,
  
  project_manager: [
    PERMISSIONS.PROJECTS.VIEW_PROJECTS,
    PERMISSIONS.PROJECTS.CREATE_PROJECTS,
    PERMISSIONS.PROJECTS.EDIT_PROJECTS,
    PERMISSIONS.PAYMENT_CERTIFICATES.CREATE_PAYMENT_CERTIFICATE,
    PERMISSIONS.PAYMENT_CERTIFICATES.VIEW_PAYMENT_HISTORY,
    PERMISSIONS.INVOICES.VIEW_AP_QUEUE,
    PERMISSIONS.INVOICES.CREATE_INVOICE,
    PERMISSIONS.INVOICES.APPROVE_INVOICES,
    PERMISSIONS.INVOICES.REJECT_INVOICES,
    PERMISSIONS.INVOICES.DISPUTE_INVOICES,
    PERMISSIONS.PAYMENTS.VIEW_PAYMENT_RECORDS,
    PERMISSIONS.VENDORS.VIEW_VENDORS,
    PERMISSIONS.VENDORS.CREATE_VENDORS,
    PERMISSIONS.VENDORS.EDIT_VENDORS,
    PERMISSIONS.CONTRACTS.VIEW_CONTRACTS,
    PERMISSIONS.CONTRACTS.UPLOAD_CONTRACTS,
    PERMISSIONS.REPORTING.VIEW_FINANCIAL_REPORTS,
  ],
  
  accountant: [
    PERMISSIONS.PROJECTS.VIEW_PROJECTS,
    PERMISSIONS.PAYMENT_CERTIFICATES.VIEW_PAYMENT_HISTORY,
    PERMISSIONS.INVOICES.VIEW_AP_QUEUE,
    PERMISSIONS.INVOICES.UPLOAD_INVOICE_ATTACHMENT,
    PERMISSIONS.INVOICES.DISPUTE_INVOICES,
    PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS,
    PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS,
    PERMISSIONS.PAYMENTS.VIEW_PAYMENT_RECORDS,
    PERMISSIONS.PAYMENTS.CREATE_DIRECT_PAYMENT,
    PERMISSIONS.VENDORS.VIEW_VENDORS,
    PERMISSIONS.VENDORS.CREATE_VENDORS,
    PERMISSIONS.VENDORS.EDIT_VENDORS,
    PERMISSIONS.CONTRACTS.VIEW_CONTRACTS,
    PERMISSIONS.REPORTING.VIEW_FINANCIAL_REPORTS,
    PERMISSIONS.REPORTING.EXPORT_REPORTS,
  ],
  
  contractor: [
    PERMISSIONS.VENDORS.VIEW_VENDORS,
    PERMISSIONS.CONTRACTS.VIEW_CONTRACTS,
    PERMISSIONS.INVOICES.UPLOAD_INVOICE_ATTACHMENT,
  ],
}

// ============================================
// PROTECTED ADMIN PERMISSIONS (cannot be removed)
// ============================================

export const PROTECTED_ADMIN_PERMISSIONS: Permission[] = [
  PERMISSIONS.ADMINISTRATION.MANAGE_PERMISSIONS,
  PERMISSIONS.ADMINISTRATION.MANAGE_USERS,
  PERMISSIONS.ADMINISTRATION.MANAGE_ROLES,
]

// ============================================
// PERMISSIONS MATRIX TYPE
// ============================================

export type PermissionsMatrix = Record<UserRole, Permission[]>

// ============================================
// VALIDATION HELPERS
// ============================================

export function isValidPermission(permission: string): permission is Permission {
  return ALL_PERMISSIONS.includes(permission as Permission)
}

export function isValidRole(role: string): role is UserRole {
  return ROLES.includes(role as UserRole)
}

/**
 * Validate an entire permissions matrix
 */
export function validatePermissionsMatrix(matrix: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  
  if (!matrix || typeof matrix !== 'object') {
    return { valid: false, errors: ['Matrix must be an object'] }
  }
  
  const m = matrix as Record<string, unknown>
  
  // Check for invalid role keys
  for (const role of Object.keys(m)) {
    if (!isValidRole(role)) {
      errors.push(`Invalid role: ${role}`)
    }
  }
  
  // Check each role's permissions
  for (const role of ROLES) {
    const permissions = m[role]
    if (permissions !== undefined) {
      if (!Array.isArray(permissions)) {
        errors.push(`Permissions for ${role} must be an array`)
        continue
      }
      
      for (const permission of permissions) {
        if (typeof permission !== 'string') {
          errors.push(`Permission values must be strings`)
          continue
        }
        if (!isValidPermission(permission)) {
          errors.push(`Invalid permission: ${permission}`)
        }
      }
    }
  }
  
  return { valid: errors.length === 0, errors }
}

/**
 * Deduplicate permissions in a matrix
 */
export function deduplicateMatrix(matrix: PermissionsMatrix): PermissionsMatrix {
  const result: PermissionsMatrix = {
    admin: [],
    project_manager: [],
    accountant: [],
    contractor: [],
  }
  
  for (const role of ROLES) {
    result[role] = [...new Set(matrix[role] || [])]
  }
  
  return result
}

// NOTE: enforceProtectedPermissions was removed - permissions are now enforced inline
// in getPermissionsMatrix() to avoid bundler issues
