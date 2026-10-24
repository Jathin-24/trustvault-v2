'use client'

import Link from 'next/link'
import { SignInButton, useAuth, useUser } from '@clerk/nextjs'
import { useEffect, useState } from 'react'
import type { Me } from '@/components/api'

export default function HomePage() {
  const { isLoaded, isSignedIn } = useAuth()
  const { user } = useUser()
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    if (!isSignedIn) return
    let cancelled = false
    fetch('/api/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Me | null) => {
        if (!cancelled) setMe(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isSignedIn])

  const email = me?.email ?? user?.primaryEmailAddress?.emailAddress ?? 'your account'

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold">TrustVault</h1>
      <p className="mt-3 text-gray-600">
        Document management with per-document sharing and a tamper-evident audit log.
      </p>

      <div className="mt-8">
        {!isLoaded && <p className="text-sm text-gray-500">Loading…</p>}

        {isLoaded && !isSignedIn && (
          <SignInButton mode="redirect">
            <button className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700">
              Sign in
            </button>
          </SignInButton>
        )}

        {isLoaded && isSignedIn && (
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <p className="text-sm text-gray-500">Signed in as</p>
            <p className="mt-1 font-medium">{email}</p>
            <div className="mt-2">
              <span className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                {me?.role ?? '…'}
              </span>
            </div>
            <Link
              href="/documents"
              className="mt-5 inline-block rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700"
            >
              Open documents
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
