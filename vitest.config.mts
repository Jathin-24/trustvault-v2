import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const stub = fileURLToPath(new URL('tests/helpers/server-only-stub.ts', import.meta.url))
const src = fileURLToPath(new URL('src', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws outside a React Server bundle by design;
      // in node tests it must be a no-op.
      'server-only': stub,
      '@': src,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // integration tests hit a (possibly cold) dev server
    testTimeout: 60000,
    hookTimeout: 120000,
  },
})
