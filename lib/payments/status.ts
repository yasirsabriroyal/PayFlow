// The only statuses meaning "money has actually moved and won't be reversed."
// Schema CHECK: status IN ('pending','sent','cleared','returned','cancelled')
// Used for dollar-sum totals (Total Paid, etc.).
export const PAID_PAYMENT_STATUSES = ['cleared'] as const
export type PaidPaymentStatus = typeof PAID_PAYMENT_STATUSES[number]

// For badge/display purposes: payments whose outcome is settled OR in-flight.
// Used for badge variants only, NOT for dollar totals.
export const SETTLED_OR_SENT_STATUSES = ['cleared', 'sent'] as const
