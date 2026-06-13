// app/api/auth/verify/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { isAddress, verifyMessage } from 'viem'
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSession,
  deleteChallenge,
  getChallenge,
  getOrCreateUserId,
} from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const address = body?.address
    const message = body?.message
    const signature = body?.signature

    if (!isAddress(address)) {
      return NextResponse.json(
        { success: false, error: 'address 不合法' },
        { status: 400 },
      )
    }

    if (typeof message !== 'string' || !message) {
      return NextResponse.json(
        { success: false, error: 'message 缺失' },
        { status: 400 },
      )
    }

    if (typeof signature !== 'string' || !signature.startsWith('0x')) {
      return NextResponse.json(
        { success: false, error: 'signature 缺失或不合法' },
        { status: 400 },
      )
    }

    const challenge = await getChallenge(address)
    if (!challenge) {
      return NextResponse.json(
        { success: false, error: 'challenge 不存在或已过期' },
        { status: 400 },
      )
    }

    if (challenge.message !== message) {
      return NextResponse.json(
        { success: false, error: 'message 不匹配' },
        { status: 400 },
      )
    }

    const ok = await verifyMessage({
      address,
      message,
      signature: signature as `0x${string}`,
    })

    if (!ok) {
      return NextResponse.json(
        { success: false, error: '签名验证失败' },
        { status: 401 },
      )
    }

    await deleteChallenge(address)

    const userId = await getOrCreateUserId(address)
    const session = await createSession(userId, address)

    const res = NextResponse.json({
      success: true,
      user: {
        id: userId,
        address,
      },
    })

    res.cookies.set(SESSION_COOKIE_NAME, session.sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    })

    return res
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message || String(e) },
      { status: 500 },
    )
  }
}