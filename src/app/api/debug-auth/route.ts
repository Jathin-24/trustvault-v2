import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

export async function GET() {
  const a = await auth()
  return NextResponse.json({
    userId: a.userId,
    sessionId: a.sessionId,
    hasClaims: !!a.sessionClaims,
  })
}
