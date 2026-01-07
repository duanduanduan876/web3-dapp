// app/api/bridge/transfer/route.ts
import { NextResponse } from 'next/server'
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

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Status = 'queued' | 'inflight' | 'complete' | 'failed'

type TransferRec = {
  transferId: Hex
  status: Status
  progress: number
  sourceTxHash: Hex
  targetTxHash?: Hex | null
  createdAt: number
  error?: string
}

const store = new Map<string, TransferRec>()

/** 只用最小事件 ABI，避免你 SOURCE_BRIDGE_ABI 里 uint32/uint256 不一致导致 decode 失败 */
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

function json(data: any, init?: { status?: number }) {
  return NextResponse.json(data, { status: init?.status ?? 200 })
}

function env(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`缺少环境变量 ${name}`)
  return v
}

function assertHex32(v: any, name: string): asserts v is Hex {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(v)) {
    throw new Error(`${name} 不是合法 bytes32：${String(v)}`)
  }
}

function assertAddress(v: any, name: string): asserts v is `0x${string}` {
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

const SOURCE_BRIDGE_ADDRESS =
  (process.env.SOURCE_BRIDGE_ADDRESS ||
    process.env.NEXT_PUBLIC_BRIDGE_SOURCE_BRIDGE_ADDRESS) as `0x${string}` | undefined

const TARGET_BRIDGE_ADDRESS = process.env.TARGET_BRIDGE_ADDRESS as `0x${string}` | undefined

let _opPublic: any
let _sepoliaPublic: any
let _sepoliaWallet: any

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
  // 用 viem 自带 wait，更靠谱
  return await getOpPublic().waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 180_000,
    pollingInterval: 1500,
  })
}

function findBridgeInitiated(receipt: any) {
  if (!SOURCE_BRIDGE_ADDRESS) {
    throw new Error(
      '缺少 SOURCE_BRIDGE_ADDRESS（后端必须有：SOURCE_BRIDGE_ADDRESS；NEXT_PUBLIC_* 只是给前端用的）',
    )
  }
  assertAddress(SOURCE_BRIDGE_ADDRESS, 'SOURCE_BRIDGE_ADDRESS')

  const wantAddr = SOURCE_BRIDGE_ADDRESS.toLowerCase()
  const wantTopic0 = BRIDGE_INITIATED_TOPIC0.toLowerCase()

  const logs = (receipt?.logs ?? []) as any[]
  for (const log of logs) {
    if (String(log.address).toLowerCase() !== wantAddr) continue

    const t0 = log.topics?.[0]
    if (!isHex(t0)) continue
    if (String(t0).toLowerCase() !== wantTopic0) continue

    // 到这里就是候选 log；必须能 decode，否则就是 ABI/类型不匹配
    if (!isHexTupleTopics(log.topics)) {
      throw new Error('候选 BridgeInitiated log 的 topics 不合法或为空（无法 decode）')
    }
    if (!isHexData(log.data)) {
      throw new Error('候选 BridgeInitiated log 的 data 不是 Hex（无法 decode）')
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

export async function POST(req: Request) {
  try {
    // 1) 读 body：永远返回 JSON（不再给你吐 HTML）
    const raw = await req.text()
    let body: any = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      return json({ success: false, error: `Body 不是合法 JSON: ${raw.slice(0, 200)}` }, { status: 400 })
    }

    const sourceTxHash = body?.sourceTxHash
    if (!sourceTxHash) {
      return json({ success: false, error: `缺少 sourceTxHash，body=${raw.slice(0, 200)}` }, { status: 400 })
    }
    assertHex32(sourceTxHash, 'sourceTxHash')

    // 2) 等 OP receipt
    const receipt = await waitReceiptOnOp(sourceTxHash)

    // 3) 打印关键信息（你要看就看 next dev server 控制台）
    const logs = (receipt?.logs ?? []) as any[]
    const logBrief = logs.slice(0, 30).map((l) => ({
      address: l.address,
      topic0: l.topics?.[0],
      topicsLen: l.topics?.length ?? 0,
    }))
    console.log('[bridge/transfer] receipt.to=', receipt?.to)
    console.log('[bridge/transfer] receipt.status=', receipt?.status)
    console.log('[bridge/transfer] logsBrief=', logBrief)

    // 4) 从 receipt 找事件
    const evt = findBridgeInitiated(receipt)
    if (!evt) {
      return json(
        {
          success: false,
          error:
            '源链 receipt 里没找到 BridgeInitiated（你调用的合约地址/事件签名/链可能不对）',
          debug: {
            SOURCE_BRIDGE_ADDRESS,
            wantTopic0: BRIDGE_INITIATED_TOPIC0,
            receiptTo: receipt?.to,
            receiptStatus: receipt?.status,
            logsBrief: logBrief,
          },
        },
        { status: 500 },
      )
    }

    if (evt.dstChainId !== 11155111) {
      return json(
        { success: false, error: `dstChainId 不对：期望 11155111(Sepolia)，实际 ${evt.dstChainId}` },
        { status: 500 },
      )
    }

    // 5) 入库
    const transferId = evt.transferId
    const rec: TransferRec = {
      transferId,
      status: 'queued',
      progress: 30,
      sourceTxHash,
      targetTxHash: null,
      createdAt: Date.now(),
    }
    store.set(transferId, rec)

    // 6) 目标链 mint
    if (!TARGET_BRIDGE_ADDRESS) throw new Error('缺少 TARGET_BRIDGE_ADDRESS')
    assertAddress(TARGET_BRIDGE_ADDRESS, 'TARGET_BRIDGE_ADDRESS')

    rec.status = 'inflight'
    rec.progress = 70
    store.set(transferId, rec)

    const targetTxHash = await getSepoliaWallet().writeContract({
      address: TARGET_BRIDGE_ADDRESS,
      abi: TARGET_BRIDGE_ABI,
      functionName: 'mintFromSource',
      args: [transferId, evt.recipient, evt.amount],
    })

    rec.targetTxHash = targetTxHash
    store.set(transferId, rec)

    await getSepoliaPublic().waitForTransactionReceipt({
      hash: targetTxHash,
      confirmations: 1,
      timeout: 180_000,
      pollingInterval: 1500,
    })

    rec.status = 'complete'
    rec.progress = 100
    store.set(transferId, rec)

    return json({ success: true, ...rec })
  } catch (e: any) {
    return json(
      {
        success: false,
        error: e?.message || String(e),
        stack: e?.stack || null,
      },
      { status: 500 },
    )
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const transferId = url.searchParams.get('transferId')
    assertHex32(transferId, 'transferId')

    const rec = store.get(transferId)
    if (!rec) {
      return json(
        { success: false, error: '未知 transferId（你重启过 dev server，内存 store 丢了）' },
        { status: 404 },
      )
    }

    // 可选：链上最终一致性校验
    if (rec.status !== 'complete' && TARGET_BRIDGE_ADDRESS) {
      const processed = await getSepoliaPublic().readContract({
        address: TARGET_BRIDGE_ADDRESS,
        abi: TARGET_BRIDGE_ABI,
        functionName: 'processed',
        args: [transferId],
      })
      if (processed) {
        rec.status = 'complete'
        rec.progress = 100
        store.set(transferId, rec)
      }
    }

    return json({ success: true, ...rec })
  } catch (e: any) {
    return json({ success: false, error: e?.message || String(e) }, { status: 400 })
  }
}




