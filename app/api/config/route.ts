// app/api/config/route.ts
import { NextResponse } from 'next/server'
import { getBridgeSubmitEnabled } from '@/lib/feature-flags'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const bridgeSubmitEnabled = await getBridgeSubmitEnabled()

    return NextResponse.json({
      success: true,
      bridgeSubmitEnabled,
    })
  } catch (e: any) {
    return NextResponse.json(
      {
        success: false,
        error: e?.message || String(e),
      },
      { status: 500 },
    )
  }
}