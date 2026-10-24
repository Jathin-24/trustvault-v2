'use client'

import Link from 'next/link'
import { SignInButton, UserButton, useAuth } from '@clerk/nextjs'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

function navLinkClass(active: boolean) {
  return active
    ? 'font-medium text-gray-900'
    : 'text-gray-500 hover:text-gray-900'
}

/**
 * App header. The Admin link is shown only when /api/me reports role=admin.
 * Hiding the link is convenience only — the /api/admin/* API enforces the
 * role server-side (and returns 404 to non-admins).
 */
export function SiteHeader() {
  const { isLoaded, isSignedIn } = useAuth()
  const pathname = usePathname()
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    if (!isSignedIn) return
    let cancelled = false
    fetch('/api/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => {
        // Always derive from the response so a stale admin flag from a
        // previous session can't survive a re-sign-in as a different user.
        if (!cancelled) setIsAdmin(me?.role === 'admin')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isSignedIn])

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-sm font-semibold tracking-wide">
            TrustVault
          </Link>
          {isLoaded && isSignedIn && (
            <nav className="flex items-center gap-4 text-sm">
              <Link
                href="/documents"
                className={navLinkClass(pathname === '/documents' || pathname.startsWith('/documents/'))}
              >
                Documents
              </Link>
              {isAdmin && (
                <Link
                  href="/admin"
                  className={navLinkClass(pathname === '/admin' || pathname.startsWith('/admin/'))}
                >
                  Admin
                </Link>
              )}
            </nav>
          )}
        </div>
        <div className="flex items-center">
          {!isLoaded ? null : isSignedIn ? (
            <UserButton />
          ) : (
            <SignInButton mode="redirect">
              <button className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700">
                Sign in
              </button>
            </SignInButton>
          )}
        </div>
      </div>
    </header>
  )
}
