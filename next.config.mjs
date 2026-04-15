/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Force cache invalidation
  generateBuildId: async () => {
    return `build-${Date.now()}`
  },
}

export default nextConfig
