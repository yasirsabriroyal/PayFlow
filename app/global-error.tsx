'use client'

// global-error renders outside the root layout (no Providers, no CSS vars).
// It must supply its own <html> and <body> and use inline styles.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f8fafc',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '1rem',
        }}
      >
        <div style={{ maxWidth: '28rem', width: '100%', textAlign: 'center' }}>
          {/* Icon */}
          <div
            style={{
              margin: '0 auto 1.5rem',
              width: '4rem',
              height: '4rem',
              borderRadius: '9999px',
              backgroundColor: '#fef2f2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ef4444"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>

          <p
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: '#94a3b8',
              marginBottom: '0.5rem',
            }}
          >
            500 — Unexpected error
          </p>

          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: '#0f172a',
              marginBottom: '0.75rem',
            }}
          >
            Something went wrong
          </h1>

          <p style={{ color: '#64748b', marginBottom: '2rem' }}>
            An unexpected error occurred. Our team has been notified. You can
            try refreshing the page or contact support if the problem persists.
          </p>

          {/* Error digest for support reference */}
          {error.digest && (
            <p
              style={{
                fontSize: '0.75rem',
                color: '#94a3b8',
                fontFamily: 'monospace',
                marginBottom: '1.5rem',
              }}
            >
              Reference: {error.digest}
            </p>
          )}

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              justifyContent: 'center',
            }}
          >
            <button
              onClick={reset}
              style={{
                padding: '0.625rem 1.25rem',
                borderRadius: '0.375rem',
                backgroundColor: '#1e40af',
                color: '#fff',
                fontWeight: 500,
                fontSize: '0.875rem',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>

            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                padding: '0.625rem 1.25rem',
                borderRadius: '0.375rem',
                border: '1px solid #e2e8f0',
                backgroundColor: '#fff',
                color: '#334155',
                fontWeight: 500,
                fontSize: '0.875rem',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Go to Dashboard
            </a>
          </div>

          {/* Branding */}
          <p
            style={{
              marginTop: '3rem',
              fontSize: '0.75rem',
              color: '#cbd5e1',
            }}
          >
            PayFlow AP — Enterprise Accounts Payable
          </p>
        </div>
      </body>
    </html>
  )
}
