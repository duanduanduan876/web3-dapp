import { NextRequest, NextResponse } from 'next/server'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  isHex,
  keccak256,
  toBytes,
  type Hex,
} from 'viem'
import { optimismSepolia, sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { TARGET_BRIDGE_ABI } from '@/lib/abis/bridge'
import { requireSession } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Status = 'queued' | 'inflight' | 'complete' | 'failed'

type TransferRec = {
  transferId: Hex
  userId: string
  status: Status
  progress: number
  sourceTxHash: Hex
  targetTxHash?: Hex | null
  createdAt: number
  error?: string
}

// 注意：transfer 记录这里仍然是内存 Map。
// 这次改 Redis，先只把 auth 的 challenge/session 从 Map 换成 Redis。
// transfer 业务记录生产更适合放数据库。
const store = new Map<string, TransferRec>()
const sourceTxIndex = new Map<string, Hex>()

const BRIDGE_INITIATED_EVENT_ABI = [
  {
    type: 'event',
    name: 'BridgeInitiated',
    inputs: [
      { indexed: true, name: 'transferId', type: 'bytes32' },
      { indexed: true, name: 'sender', type: 'address' },
      { indexed: true, name: 'recipient', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'dstChainId', type: 'uint32' },
    ],
    anonymous: false,
  },
] as const

const BRIDGE_INITIATED_TOPIC0 = keccak256(
  toBytes('BridgeInitiated(bytes32,address,address,uint256,uint32)'),
) as Hex

const SOURCE_BRIDGE_ADDRESS = (process.env.SOURCE_BRIDGE_ADDRESS ||
  process.env.NEXT_PUBLIC_BRIDGE_SOURCE_BRIDGE_ADDRESS) as `0x${string}` | undefined

const TARGET_BRIDGE_ADDRESS = process.env.TARGET_BRIDGE_ADDRESS as `0x${string}` | undefined

const DEV_LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i
const CORS_ALLOW_ORIGINS = new Set(
  (process.env.CORS_ALLOW_ORIGINS ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
)

let _opPublic: any
let _sepoliaPublic: any
let _sepoliaWallet: any

function env(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`缺少环境变量 ${name}`)
  return v
}

function assertHex32(v: unknown, name: string): asserts v is Hex {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(v)) {
    throw new Error(`${name} 不是合法 bytes32：${String(v)}`)
  }
}

function assertAddress(v: unknown, name: string): asserts v is `0x${string}` {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(`${name} 不是合法 address：${String(v)}`)
  }
}

function isHexData(v: unknown): v is Hex {
  return isHex(v)
}

function isHexTupleTopics(v: unknown): v is readonly [Hex, ...Hex[]] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => isHex(x))
}

function pickAllowedOrigin(req: NextRequest) {
  const origin = req.headers.get('origin')
  if (!origin) return null
  if (CORS_ALLOW_ORIGINS.has(origin)) return origin
  if (process.env.NODE_ENV !== 'production' && DEV_LOCALHOST_RE.test(origin)) return origin
  return null
}

function applyCors(req: NextRequest, res: NextResponse) {
  const allowedOrigin = pickAllowedOrigin(req)
  const reqAllowHeaders =
    req.headers.get('access-control-request-headers') || 'Content-Type, Authorization'

  res.headers.set('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers')
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', reqAllowHeaders)
  res.headers.set('Access-Control-Max-Age', '600')
  res.headers.set('Cache-Control', 'no-store')

  if (allowedOrigin) {
    res.headers.set('Access-Control-Allow-Origin', allowedOrigin)
    res.headers.set('Access-Control-Allow-Credentials', 'true')
  }

  return res
}

function json(req: NextRequest, data: any, init?: { status?: number }) {
  return applyCors(
    req,
    NextResponse.json(data, {
      status: init?.status ?? 200,
    }),
  )
}

function empty(req: NextRequest, status = 204) {
  return applyCors(req, new NextResponse(null, { status }))
}

function getOpPublic() {
  if (_opPublic) return _opPublic
  _opPublic = createPublicClient({
    chain: optimismSepolia,
    transport: http(env('OP_SEPOLIA_RPC_URL')),
  })
  return _opPublic
}

function getSepoliaPublic() {
  if (_sepoliaPublic) return _sepoliaPublic
  _sepoliaPublic = createPublicClient({
    chain: sepolia,
    transport: http(env('SEPOLIA_RPC_URL')),
  })
  return _sepoliaPublic
}

function getSepoliaWallet() {
  if (_sepoliaWallet) return _sepoliaWallet
  const relayer = privateKeyToAccount(env('RELAYER_PRIVATE_KEY') as `0x${string}`)
  _sepoliaWallet = createWalletClient({
    account: relayer,
    chain: sepolia,
    transport: http(env('SEPOLIA_RPC_URL')),
  })
  return _sepoliaWallet
}

async function waitReceiptOnOp(hash: Hex) {
  return await getOpPublic().waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 180_000,
    pollingInterval: 1_500,
  })
}

function findBridgeInitiated(receipt: any) {
  if (!SOURCE_BRIDGE_ADDRESS) {
    throw new Error('缺少 SOURCE_BRIDGE_ADDRESS')
  }

  assertAddress(SOURCE_BRIDGE_ADDRESS, 'SOURCE_BRIDGE_ADDRESS')

  const wantAddr = SOURCE_BRIDGE_ADDRESS.toLowerCase()
  const wantTopic0 = BRIDGE_INITIATED_TOPIC0.toLowerCase()
  const logs = (receipt?.logs ?? []) as any[]

  for (const log of logs) {
    if (String(log.address).toLowerCase() !== wantAddr) continue

    const topic0 = log.topics?.[0]
    if (!isHex(topic0)) continue
    if (String(topic0).toLowerCase() !== wantTopic0) continue

    if (!isHexTupleTopics(log.topics)) {
      throw new Error('候选 BridgeInitiated log 的 topics 不合法')
    }
    if (!isHexData(log.data)) {
      throw new Error('候选 BridgeInitiated log 的 data 不是 Hex')
    }

    const decoded = decodeEventLog({
      abi: BRIDGE_INITIATED_EVENT_ABI,
      eventName: 'BridgeInitiated',
      data: log.data,
      topics: log.topics,
    })

    const { transferId, recipient, amount, dstChainId } = decoded.args
    return {
      transferId: transferId as Hex,
      recipient: recipient as `0x${string}`,
      amount: amount as bigint,
      dstChainId: Number(dstChainId),
    }
  }

  return null
}

async function readSessionOr401(req: NextRequest) {
  try {
    return await requireSession(req)
  } catch {
    return null
  }
}

function returnExistingAcceptedTask(req: NextRequest, rec: TransferRec, userId: string) {
  if (rec.userId !== userId) {
    return json(req, { success: false, error: '无权访问该源链交易对应的任务' }, { status: 403 })
  }

  return json(req, {
    success: true,
    ...rec,
    message: 'Existing request returned. Processing was not restarted.',
  })
}

export async function OPTIONS(req: NextRequest) {
  return empty(req)
}

export async function POST(req: NextRequest) {
  const session = await readSessionOr401(req)
  if (!session) {
    return json(req, { success: false, error: '未登录站点' }, { status: 401 })
  }

  try {
    const raw = await req.text()
    let body: any = {}

    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      return json(
        req,
        { success: false, error: `Body 不是合法 JSON` },
        { status: 400 },
      )
    }

    const sourceTxHash = body?.sourceTxHash
    if (!sourceTxHash) {
      return json(
        req,
        { success: false, error: `缺少 sourceTxHash` },
        { status: 400 },
      )
    }

    assertHex32(sourceTxHash, 'sourceTxHash')

    const sourceTxHashKey = sourceTxHash.toLowerCase()
    const existingTransferId = sourceTxIndex.get(sourceTxHashKey)
    if (existingTransferId) {
      const existingRec = store.get(existingTransferId)
      if (existingRec) return returnExistingAcceptedTask(req, existingRec, session.userId)
      sourceTxIndex.delete(sourceTxHashKey)
    }

    const receipt = await waitReceiptOnOp(sourceTxHash)

    const evt = findBridgeInitiated(receipt)
    if (!evt) {
      return json(
        req,
        {
          success: false,
          error: '源链没找到 BridgeInitiated 事件',
        },
        { status: 500 },
      )
    }

    if (evt.dstChainId !== 11155111) {
      return json(
        req,
        {
          success: false,
          error: `dstChainId 不对：期望 11155111，实际 ${evt.dstChainId}`,
        },
        { status: 500 },
      )
    }

    const transferId = evt.transferId

    if (!TARGET_BRIDGE_ADDRESS) throw new Error('缺少 TARGET_BRIDGE_ADDRESS')
    assertAddress(TARGET_BRIDGE_ADDRESS, 'TARGET_BRIDGE_ADDRESS')

    const acceptedDuringVerification = sourceTxIndex.get(sourceTxHashKey)
    if (acceptedDuringVerification) {
      const existingRec = store.get(acceptedDuringVerification)
      if (existingRec) return returnExistingAcceptedTask(req, existingRec, session.userId)
    }

    const existingByTransferId = store.get(transferId)
    if (existingByTransferId) {
      sourceTxIndex.set(sourceTxHashKey, transferId)
      return returnExistingAcceptedTask(req, existingByTransferId, session.userId)
    }

    let rec: TransferRec = {
      transferId,
      userId: session.userId,
      status: 'queued',
      progress: 30,
      sourceTxHash,
      targetTxHash: null,
      createdAt: Date.now(),
    }

    sourceTxIndex.set(sourceTxHashKey, transferId)
    store.set(transferId, rec)

    ;(async () => {
      try {
        rec = { ...rec, status: 'inflight', progress: 70, error: undefined }
        store.set(transferId, rec)

        const targetTxHash = await getSepoliaWallet().writeContract({
          address: TARGET_BRIDGE_ADDRESS,
          abi: TARGET_BRIDGE_ABI,
          functionName: 'mintFromSource',
          args: [transferId, evt.recipient, evt.amount],
        })

        rec = { ...rec, targetTxHash, error: undefined }
        store.set(transferId, rec)

        const targetReceipt = await getSepoliaPublic().waitForTransactionReceipt({
          hash: targetTxHash,
          confirmations: 1,
          timeout: 180_000,
          pollingInterval: 3_000,
        })

        if (targetReceipt.status === 'reverted') {
          rec = { ...rec, status: 'failed', error: '目标链交易执行失败' }
        } else {
          rec = { ...rec, status: 'complete', progress: 100, error: undefined }
        }
        store.set(transferId, rec)
      } catch {
        rec = {
          ...rec,
          status: 'inflight',
          progress: 70,
          error: '目标链处理结果暂未确认，将继续查询链上状态',
        }
        store.set(transferId, rec)
      }
    })()

    return json(req, {
      success: true,
      ...rec,
      message: 'Request accepted. Processing in background.',
    })
  } catch (e: any) {
    return json(
      req,
      {
        success: false,
        error: e?.message || String(e),
      },
      { status: 500 },
    )
  }
}

async function refreshTransferRecord(rec: TransferRec): Promise<TransferRec> {
  if (rec.status === 'complete' || rec.status === 'failed') return rec

  const bridgeAddress = TARGET_BRIDGE_ADDRESS
  if (!bridgeAddress) return rec

  assertAddress(bridgeAddress, 'TARGET_BRIDGE_ADDRESS')

  const processed = await getSepoliaPublic().readContract({
    address: bridgeAddress,
    abi: TARGET_BRIDGE_ABI,
    functionName: 'processed',
    args: [rec.transferId],
  })

  if (!processed) return rec

  const next: TransferRec = {
    ...rec,
    status: 'complete',
    progress: 100,
    error: undefined,
  }

  store.set(next.transferId, next)
  return next
}

export async function GET(req: NextRequest) {
  const session = await readSessionOr401(req)
  if (!session) {
    return json(req, { success: false, error: '未登录站点' }, { status: 401 })
  }

  try {
    const url = new URL(req.url)
    const transferIdsParam = url.searchParams.get('transferIds')

    if (transferIdsParam !== null) {
      const rawIds = [...new Set(transferIdsParam.split(',').filter(Boolean))]

      if (rawIds.length === 0) {
        return json(req, { success: false, error: '缺少 transferIds' }, { status: 400 })
      }

      if (rawIds.length > 20) {
        return json(req, { success: false, error: '一次最多查询 20 条转账记录' }, { status: 400 })
      }

      const transferIds = rawIds.map((id, index) => {
        assertHex32(id, `transferIds[${index}]`)
        return id
      })

      const records = await Promise.all(
        transferIds.map(async (transferId) => {
          const rec = store.get(transferId)

          if (!rec || rec.userId !== session.userId) return null

          return refreshTransferRecord(rec)
        }),
      )

      return json(req, {
        success: true,
        records: records.filter((rec): rec is TransferRec => rec !== null),
      })
    }

    const transferId = url.searchParams.get('transferId')
    if (!transferId || !isHex(transferId)) {
      throw new Error('无效的 transferId')
    }
    assertHex32(transferId, 'transferId')

    const rec = store.get(transferId)
    if (!rec) {
      return json(
        req,
        { success: false, error: '未知 transferId 或记录已过期' },
        { status: 404 },
      )
    }

    if (rec.userId !== session.userId) {
      return json(req, { success: false, error: '无权访问' }, { status: 403 })
    }

    const next = await refreshTransferRecord(rec)
    return json(req, { success: true, ...next })
  } catch (e: any) {
    return json(req, { success: false, error: e?.message || String(e) }, { status: 400 })
  }
}



