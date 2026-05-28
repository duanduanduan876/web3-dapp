// app/api/auth/me/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) {
    return NextResponse.json(
      { success: false, error: '未登录' },
      { status: 401 },
    )
  }

  return NextResponse.json({
    success: true,
    user: {
      id: session.userId,
      address: session.address,
    },
  })
}