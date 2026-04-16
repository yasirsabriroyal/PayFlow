/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: false,
  images: {
    unoptimized: true,
  },
  // Force cache invalidation
  generateBuildId: async () => {
    return `build-${Date.now()}`
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Prevent clickjacking — disallows this app being embedded in any iframe
          { key: 'X-Frame-Options', value: 'DENY' },
          // Prevent MIME-type sniffing
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Enforce HTTPS for 1 year, including subdomains
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          // Only send origin on cross-origin requests, full URL on same-origin
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Disable camera, microphone, geolocation — not needed by this app
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // unsafe-eval needed by Next.js dev mode; unsafe-inline for RSC inline scripts
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://vercel.live",
              // unsafe-inline needed for Tailwind CSS-in-JS; Google Fonts stylesheet
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              // blob: for file previews; https: for avatars/external images
              "img-src 'self' data: blob: https:",
              // Supabase REST + realtime WS; Vercel Analytics
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://vitals.vercel-insights.com https://va.vercel-scripts.com",
              // Vercel preview toolbar
              "frame-src 'self' https://vercel.live",
              // Matches X-Frame-Options: DENY
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

export default nextConfig
