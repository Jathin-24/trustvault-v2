import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <main className="flex justify-center py-12">
      <SignIn />
    </main>
  )
}
