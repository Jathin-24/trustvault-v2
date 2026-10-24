import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { Geist, Geist_Mono } from 'next/font/google'
import { Suspense } from 'react'
import { SiteHeader } from '@/components/site-header'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'TrustVault',
  description: 'Secure document management with per-document sharing and tamper-evident audit',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900">
        <ClerkProvider>
          {/* The header reads auth + URL state that only exist at request
              time; under Cache Components that must sit behind a Suspense
              boundary so the static shell can prerender without it. */}
          <Suspense
            fallback={
              <header className="border-b border-gray-200 bg-white">
                <div className="mx-auto h-14 max-w-5xl px-6" />
              </header>
            }
          >
            <SiteHeader />
          </Suspense>
          <main className="flex-1">{children}</main>
        </ClerkProvider>
      </body>
    </html>
  )
}
