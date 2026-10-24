import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs'
import Link from 'next/link'

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold">TrustVault</h1>
      <p className="mt-3 text-gray-600">
        Document management with per-document sharing and a tamper-evident audit log.
      </p>

      <div className="mt-8 flex items-center gap-4">
        <SignedOut>
          <SignInButton mode="redirect">
            <button className="rounded-md bg-gray-900 px-4 py-2 text-white">Sign in</button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <Link
            href="/documents"
            className="rounded-md bg-gray-900 px-4 py-2 text-white"
          >
            Open documents
          </Link>
          <UserButton />
        </SignedIn>
      </div>
    </main>
  )
}
