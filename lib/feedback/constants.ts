/**
 * Feedback Portal — Shared constants and types.
 *
 * This file is intentionally free of server-only imports so it can be safely
 * used by client components, server actions, and the status-flow engine alike.
 */

// ============================================================
// Types
// ============================================================

export type FeedbackStatus =
  | 'submitted'
  | 'under_review'
  | 'planned'
  | 'in_progress'
  | 'resolved'
  | 'released'
  | 'declined'
  | 'archived'

export type FeedbackType =
  | 'bug_report'
  | 'feature_request'
  | 'suggestion'
  | 'general'

// ============================================================
// Labels
// ============================================================

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  submitted:    'Submitted',
  under_review: 'Under Review',
  planned:      'Planned',
  in_progress:  'In Progress',
  resolved:     'Resolved',
  released:     'Released',
  declined:     'Declined',
  archived:     'Archived',
}

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  bug_report:      'Bug Report',
  feature_request: 'Feature Request',
  suggestion:      'Suggestion',
  general:         'General Feedback',
}

// ============================================================
// Allowed transition map (also used by UI to gate controls)
// ============================================================

export const FEEDBACK_ALLOWED_TRANSITIONS: Record<FeedbackStatus, FeedbackStatus[]> = {
  submitted:    ['under_review', 'declined', 'archived'],
  under_review: ['planned', 'declined', 'resolved', 'archived', 'submitted'],
  planned:      ['in_progress', 'declined', 'archived'],
  in_progress:  ['resolved', 'archived'],
  resolved:     ['released', 'archived'],
  released:     ['archived'],
  declined:     ['under_review', 'archived'],
  archived:     [],
}

export function isTransitionAllowed(from: FeedbackStatus, to: FeedbackStatus): boolean {
  return FEEDBACK_ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}
