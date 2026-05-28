// app/api/auth/logout/route.ts
import { NextRequest, NextResponse } from 'next/server'
import {
  SESSION_COOKIE_NAME,
  deleteSession,
} from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value
  deleteSession(sessionId)

  const res = NextResponse.json({ success: true })
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
  return res
}