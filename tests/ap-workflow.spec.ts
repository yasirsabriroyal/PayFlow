import { test, expect, Page } from '@playwright/test'

/**
 * PayFlow AP - End-to-End Accounts Payable Workflow Test
 * 
 * This test suite verifies the complete invoice lifecycle:
 * 1. Contractor submits invoice
 * 2. Project Manager approves invoice  
 * 3. Accountant processes payment
 * 4. Holdback ledger entry is created
 */

// Test data
const TEST_DATA = {
  contractor: {
    email: 'contractor@test.payflow.ca',
    password: 'TestPassword123!',
    company: 'Test Electrical Ltd.',
  },
  projectManager: {
    email: 'pm@test.payflow.ca',
    password: 'TestPassword123!',
  },
  accountant: {
    email: 'accountant@test.payflow.ca',
    password: 'TestPassword123!',
  },
  invoice: {
    invoiceNumber: `INV-TEST-${Date.now()}`,
    amount: 10000.00,
    description: 'E2E Test Invoice - Electrical work Phase 1',
    project: 'Oakwood Towers',
    expectedHoldback: 1000.00, // 10% of amount
    expectedNetPayable: 9000.00, // amount - holdback
  },
}

// Helper functions
async function login(page: Page, email: string, password: string) {
  await page.goto('/auth/login')
  
  // Wait for page to load
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
  
  // Fill credentials
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(password)
  
  // Submit login
  await page.getByRole('button', { name: /sign in/i }).click()
  
  // Wait for navigation away from login page
  await expect(page).not.toHaveURL(/\/auth\/login/)
}

async function logout(page: Page) {
  // Look for user menu or sign out button
  const userMenu = page.getByRole('button', { name: /account|profile|menu/i })
  
  if (await userMenu.isVisible()) {
    await userMenu.click()
    await page.getByRole('menuitem', { name: /sign out|log out/i }).click()
  } else {
    // Try direct sign out link/button
    await page.getByRole('link', { name: /sign out|log out/i }).click()
  }
  
  // Confirm logout by checking we're on login or home page
  await expect(page).toHaveURL(/\/(auth\/login)?$/)
}

async function waitForToast(page: Page, text: string | RegExp) {
  const toast = page.getByRole('status').filter({ hasText: text })
  await expect(toast).toBeVisible({ timeout: 10000 })
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(amount)
}

// Main test suite
test.describe('Accounts Payable Workflow', () => {
  // Store invoice ID between test steps
  let invoiceId: string | null = null

  test.describe.configure({ mode: 'serial' }) // Run tests in order

  test('Step 1: Contractor submits a new invoice', async ({ page }) => {
    // Login as contractor
    await login(page, TEST_DATA.contractor.email, TEST_DATA.contractor.password)

    // Navigate to new invoice page
    await page.goto('/vendor/invoices/new')
    await expect(page.getByRole('heading', { name: /submit.*invoice|new invoice/i })).toBeVisible()

    // Fill invoice form
    // Invoice number
    await page.getByLabel(/invoice number/i).fill(TEST_DATA.invoice.invoiceNumber)

    // Select project (dropdown or combobox)
    const projectSelect = page.getByRole('combobox', { name: /project/i })
    if (await projectSelect.isVisible()) {
      await projectSelect.click()
      await page.getByRole('option', { name: new RegExp(TEST_DATA.invoice.project, 'i') }).click()
    } else {
      // Try input field if not a combobox
      await page.getByLabel(/project/i).fill(TEST_DATA.invoice.project)
    }

    // Amount
    await page.getByLabel(/amount|total/i).fill(TEST_DATA.invoice.amount.toString())

    // Description
    await page.getByLabel(/description|details|notes/i).fill(TEST_DATA.invoice.description)

    // Verify holdback calculation is displayed
    const holdbackDisplay = page.getByText(/holdback|retention/i).locator('..').getByText(/\$1,000|\$1000|10%/i)
    await expect(holdbackDisplay).toBeVisible()

    // Verify net payable calculation
    const netPayableDisplay = page.getByText(/net payable|payable amount/i).locator('..').getByText(/\$9,000|\$9000/i)
    await expect(netPayableDisplay).toBeVisible()

    // Submit invoice
    await page.getByRole('button', { name: /submit|send|create/i }).click()

    // Verify success
    await waitForToast(page, /submitted|success|created/i)

    // Store invoice ID from URL or confirmation
    const url = page.url()
    const match = url.match(/invoices\/([a-zA-Z0-9-]+)/)
    if (match) {
      invoiceId = match[1]
    }

    // Verify invoice appears in list
    await page.goto('/vendor/invoices')
    await expect(page.getByText(TEST_DATA.invoice.invoiceNumber)).toBeVisible()
    await expect(page.getByText(/pending|submitted|awaiting/i).first()).toBeVisible()

    // Logout
    await logout(page)
  })

  test('Step 2: Project Manager approves the invoice', async ({ page }) => {
    // Login as PM
    await login(page, TEST_DATA.projectManager.email, TEST_DATA.projectManager.password)

    // Navigate to approvals queue
    await page.goto('/pm/approvals')
    await expect(page.getByRole('heading', { name: /approval|review/i })).toBeVisible()

    // Find the test invoice
    const invoiceRow = page.getByRole('row').filter({ hasText: TEST_DATA.invoice.invoiceNumber })
    await expect(invoiceRow).toBeVisible()

    // Verify invoice details
    await expect(invoiceRow.getByText(TEST_DATA.contractor.company)).toBeVisible()
    await expect(invoiceRow.getByText(formatCurrency(TEST_DATA.invoice.amount))).toBeVisible()

    // Click to view details or approve directly
    const approveButton = invoiceRow.getByRole('button', { name: /approve|review/i })
    if (await approveButton.isVisible()) {
      await approveButton.click()
    } else {
      // Click row to open detail view
      await invoiceRow.click()
    }

    // If detail modal/page opened, approve from there
    const detailApproveButton = page.getByRole('button', { name: /approve invoice|confirm approval/i })
    if (await detailApproveButton.isVisible({ timeout: 3000 })) {
      // Verify holdback in detail view
      await expect(page.getByText(/holdback|retention/i)).toBeVisible()
      await expect(page.getByText(formatCurrency(TEST_DATA.invoice.expectedHoldback))).toBeVisible()

      await detailApproveButton.click()
    }

    // Verify approval success
    await waitForToast(page, /approved|success/i)

    // Verify status changed
    await page.goto('/pm/approvals')
    const approvedInvoice = page.getByRole('row').filter({ hasText: TEST_DATA.invoice.invoiceNumber })
    
    // Invoice should either be gone from pending queue or show approved status
    const isGone = await approvedInvoice.isHidden({ timeout: 3000 }).catch(() => false)
    if (!isGone) {
      await expect(approvedInvoice.getByText(/approved/i)).toBeVisible()
    }

    // Logout
    await logout(page)
  })

  test('Step 3: Accountant processes payment and generates EFT batch', async ({ page }) => {
    // Login as accountant
    await login(page, TEST_DATA.accountant.email, TEST_DATA.accountant.password)

    // Navigate to payments queue
    await page.goto('/accountant/payments')
    await expect(page.getByRole('heading', { name: /payment|eft|batch/i })).toBeVisible()

    // Find the approved invoice ready for payment
    const invoiceRow = page.getByRole('row').filter({ hasText: TEST_DATA.invoice.invoiceNumber })
    await expect(invoiceRow).toBeVisible()

    // Verify invoice is compliant (no blocking warnings)
    const blockingWarning = invoiceRow.locator('[data-testid="compliance-warning"], .text-destructive')
    const isBlocked = await blockingWarning.isVisible({ timeout: 2000 }).catch(() => false)
    expect(isBlocked).toBeFalsy()

    // Verify net payable amount
    await expect(invoiceRow.getByText(formatCurrency(TEST_DATA.invoice.expectedNetPayable))).toBeVisible()

    // Select the invoice checkbox
    const checkbox = invoiceRow.getByRole('checkbox')
    await expect(checkbox).toBeEnabled()
    await checkbox.check()
    await expect(checkbox).toBeChecked()

    // Verify selection is reflected in summary
    const selectionSummary = page.getByText(/1 invoice|selected/i)
    await expect(selectionSummary).toBeVisible()

    // Generate EFT batch
    const generateButton = page.getByRole('button', { name: /generate eft|create batch|process payment/i })
    await expect(generateButton).toBeEnabled()
    await generateButton.click()

    // Confirm if dialog appears
    const confirmButton = page.getByRole('button', { name: /confirm|proceed|yes/i })
    if (await confirmButton.isVisible({ timeout: 2000 })) {
      await confirmButton.click()
    }

    // Verify success
    await waitForToast(page, /eft|batch|generated|success/i)

    // Verify batch ID is displayed
    const batchId = page.getByText(/batch.*id|eft.*\d+/i)
    await expect(batchId).toBeVisible()

    // Invoice should be removed from queue or marked as paid
    await page.goto('/accountant/payments')
    const processedInvoice = page.getByRole('row').filter({ hasText: TEST_DATA.invoice.invoiceNumber })
    const isProcessed = await processedInvoice.isHidden({ timeout: 3000 }).catch(() => false)
    
    if (!isProcessed) {
      await expect(processedInvoice.getByText(/paid|processed|complete/i)).toBeVisible()
    }
  })

  test('Step 4: Verify holdback ledger entry was created', async ({ page }) => {
    // Continue as accountant (already logged in from previous test)
    // Or re-login if tests run independently
    try {
      await page.goto('/accountant/holdbacks')
    } catch {
      await login(page, TEST_DATA.accountant.email, TEST_DATA.accountant.password)
      await page.goto('/accountant/holdbacks')
    }

    // Verify holdback ledger page loaded
    await expect(page.getByRole('heading', { name: /holdback|retention|ledger/i })).toBeVisible()

    // Find the holdback entry for our test invoice
    const holdbackEntry = page.getByRole('row').filter({ 
      hasText: new RegExp(`${TEST_DATA.invoice.invoiceNumber}|${TEST_DATA.contractor.company}`, 'i') 
    })
    await expect(holdbackEntry).toBeVisible()

    // Verify holdback amount (10% = $1,000)
    await expect(holdbackEntry.getByText(formatCurrency(TEST_DATA.invoice.expectedHoldback))).toBeVisible()

    // Verify holdback status
    await expect(holdbackEntry.getByText(/held|retained|active|pending release/i)).toBeVisible()

    // Verify project association
    await expect(holdbackEntry.getByText(new RegExp(TEST_DATA.invoice.project, 'i'))).toBeVisible()

    // Optional: Verify holdback date
    const today = new Date().toISOString().split('T')[0]
    const holdbackDate = holdbackEntry.getByText(new RegExp(today.replace(/-/g, '[-/]'), 'i'))
    // Date might be formatted differently, so this is optional
    if (await holdbackDate.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(holdbackDate).toBeVisible()
    }

    // Verify total holdbacks include our entry
    const totalHoldbacks = page.getByText(/total.*holdback|total.*retained/i)
    await expect(totalHoldbacks).toBeVisible()

    // Logout to complete the workflow
    await logout(page)
  })
})

// Additional test: Verify compliance guardrails block non-compliant invoices
test.describe('Compliance Guardrails', () => {
  test('Blocked invoices cannot be selected for payment', async ({ page }) => {
    await login(page, TEST_DATA.accountant.email, TEST_DATA.accountant.password)
    await page.goto('/accountant/payments')

    // Look for any invoice with compliance warning
    const blockedRow = page.getByRole('row').filter({
      has: page.locator('.text-destructive, [data-blocked="true"]')
    }).first()

    const hasBlockedInvoices = await blockedRow.isVisible({ timeout: 3000 }).catch(() => false)

    if (hasBlockedInvoices) {
      // Verify checkbox is disabled
      const checkbox = blockedRow.getByRole('checkbox')
      await expect(checkbox).toBeDisabled()

      // Verify warning icon is visible
      const warningIcon = blockedRow.locator('svg.text-destructive, [data-testid="warning-icon"]')
      await expect(warningIcon).toBeVisible()

      // Try clicking the row - should not select
      await blockedRow.click()
      await expect(checkbox).not.toBeChecked()

      // Verify compliance warning banner is shown
      const warningBanner = page.getByText(/blocked.*compliance|compliance.*issue/i)
      await expect(warningBanner).toBeVisible()
    }

    await logout(page)
  })
})

// Data cleanup test (optional - run after all tests)
test.describe('Cleanup', () => {
  test.skip('Remove test data', async ({ page }) => {
    // This test is skipped by default
    // Enable when you need to clean up test data from the database
    
    // Would typically:
    // 1. Login as admin
    // 2. Delete test invoice
    // 3. Delete test holdback entry
    // 4. Delete any test payment records
  })
})
