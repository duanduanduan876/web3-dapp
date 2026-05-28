// app/api/auth/nonce/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { isAddress } from 'viem'
import { createChallenge } from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const address = body?.address

    if (!isAddress(address)) {
      return NextResponse.json(
        { success: false, error: 'address 不合法' },
        { status: 400 },
      )
    }

    const host = req.headers.get('host') || 'localhost:3000'
    const rec = createChallenge(address, host)

    return NextResponse.json({
      success: true,
      nonce: rec.nonce,
      message: rec.message,
    })
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message || String(e) },
      { status: 500 },
    )
  }
}