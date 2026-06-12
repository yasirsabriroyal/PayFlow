/**
 * Returns a normalized site base URL that is always absolute (includes a scheme)
 * and never has a trailing slash.
 *
 * This protects against misconfigured NEXT_PUBLIC_APP_URL values such as
 * "payflow.royaldevelopment.ca" (no scheme), which would otherwise produce
 * relative links in emails that don't navigate to the intended page.
 */
export function getSiteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.payflow.com').trim()

  // Strip trailing slashes
  let url = raw.replace(/\/+$/, '')

  // Ensure an absolute URL with a scheme. If the value already starts with
  // http:// or https:// keep it; otherwise default to https://.
  if (!/^https?:\/\//i.test(url)) {
    // Drop any accidental leading "//" before prefixing the scheme
    url = `https://${url.replace(/^\/+/, '')}`
  }

  return url
}
