import nextConfig from 'eslint-config-next'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  ...nextConfig,
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Downgrade explicit-any from error to warn (Supabase untyped returns use intentional casts)
      '@typescript-eslint/no-explicit-any': 'warn',
      // React Compiler experimental rules — patterns are valid React; disable until stable
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
    },
  },
]

export default eslintConfig
