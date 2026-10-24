// Test-only stand-in for the `server-only` package.
// The real package throws when resolved outside a React Server bundle,
// which is exactly what a plain node test runner is. The alias lives in
// vitest.config.ts.
export {}
