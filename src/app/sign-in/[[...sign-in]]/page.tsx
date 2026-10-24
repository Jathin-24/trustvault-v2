import { SignIn } from '@clerk/nextjs'
import { Suspense } from 'react'

/**
 * Clerk's <SignIn /> reads URL state that is only known at request time, so
 * under Cache Components it needs a Suspense boundary to prerender.
 */
export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <div className="h-96 w-96 animate-pulse rounded-lg bg-gray-100" />
        </div>
      }
    >
      <div className="flex justify-center py-12">
        <SignIn />
      </div>
    </Suspense>
  )
}
