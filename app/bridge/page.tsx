'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAccount, useChainId, useReadContract, useSwitchChain, useWriteContract } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, isAddress, parseUnits, type Address, type Hex } from 'viem'
import { optimismSepolia } from 'viem/chains'

// --- 1. 常量与类型定义 ---

const OP_SEPOLIA_CHAIN_ID = 11155420
const SEPOLIA_CHAIN_ID = 11155111
const DECIMALS = 18
const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

const tokenA = process.env.NEXT_PUBLIC_BRIDGE_TOKEN_A_ADDRESS as Address | undefined
const sourceBridge = process.env.NEXT_PUBLIC_BRIDGE_SOURCE_BRIDGE_ADDRESS as Address | undefined

const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
] as const

const SOURCE_BRIDGE_ABI = [
  {
    type: 'function',
    name: 'bridge',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'dstChainId', type: 'uint32' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
] as const

type Status = 'queued' | 'inflight' | 'complete' | 'failed'

type TransferItem = {
  transferId: `0x${string}`
  status: Status
  progress: number
  sourceTxHash: `0x${string}`
  targetTxHash?: `0x${string}` | null
  createdAt: number
  error?: string
}

// --- 2. 增强版 LocalStorage 工具 ---

const LS_IDS_KEY = 'bridge:recentTransferIds'
const LS_MAP_KEY = 'bridge:transfers:v1'
const LS_MAX = 20

type StoredTransfer = Pick<
  TransferItem,
  'transferId' | 'status' | 'progress' | 'sourceTxHash' | 'targetTxHash' | 'createdAt' | 'error'
>

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function lsReadIds(): string[] {
  const arr = safeParseJson<unknown>(typeof window !== 'undefined' ? localStorage.getItem(LS_IDS_KEY) : null)
  if (!Array.isArray(arr)) return []
  return arr.filter((x) => typeof x === 'string')
}

function lsWriteIds(ids: string[]) {
  try {
    localStorage.setItem(LS_IDS_KEY, JSON.stringify(ids))
  } catch { /* ignore */ }
}

function lsReadMap(): Record<string, StoredTransfer> {
  const obj = safeParseJson<unknown>(typeof window !== 'undefined' ? localStorage.getItem(LS_MAP_KEY) : null)
  if (!obj || typeof obj !== 'object') return {}
  return obj as Record<string, StoredTransfer>
}

function lsWriteMap(map: Record<string, StoredTransfer>) {
  try {
    localStorage.setItem(LS_MAP_KEY, JSON.stringify(map))
  } catch { /* ignore */ }
}

function lsUpsertTransfer(item: TransferItem) {
  const ids = lsReadIds()
  const map = lsReadMap()

  const stored: StoredTransfer = {
    transferId: item.transferId,
    status: item.status,
    progress: item.progress,
    sourceTxHash: item.sourceTxHash,
    targetTxHash: item.targetTxHash ?? null,
    createdAt: item.createdAt,
    error: item.error,
  }

  map[item.transferId] = stored
  const nextIds = [item.transferId, ...ids.filter((x) => x !== item.transferId)].slice(0, LS_MAX)
  
  for (const id of ids) {
    if (!nextIds.includes(id)) delete map[id]
  }

  lsWriteMap(map)
  lsWriteIds(nextIds)
}

function lsPatchTransfer(id: string, patchObj: Partial<TransferItem>) {
  const map = lsReadMap()
  const cur = map[id]
  if (!cur) return

  map[id] = {
    ...cur,
    status: patchObj.status ?? cur.status,
    progress: patchObj.progress ?? cur.progress,
    sourceTxHash: (patchObj.sourceTxHash as any) ?? cur.sourceTxHash,
    targetTxHash: (patchObj.targetTxHash as any) ?? cur.targetTxHash,
    error: patchObj.error ?? cur.error,
  }
  lsWriteMap(map)
}

function lsLoadTransfers(): TransferItem[] {
  const ids = lsReadIds()
  const map = lsReadMap()
  const out: TransferItem[] = []

  for (const id of ids) {
    const it = map[id]
    if (!it) continue
    out.push({
      transferId: it.transferId as `0x${string}`,
      status: it.status,
      progress: it.progress,
      sourceTxHash: it.sourceTxHash as `0x${string}`,
      targetTxHash: (it.targetTxHash ?? undefined) as any,
      createdAt: it.createdAt,
      error: it.error,
    })
  }
  return out
}

// --- 3. 错误分类与 API 助手 ---

class ApiError extends Error {
  code?: string
  status?: number
  constructor(message: string, opts?: { code?: string; status?: number }) {
    super(message)
    this.name = 'ApiError'
    this.code = opts?.code
    this.status = opts?.status
  }
}

function isUserRejected(err: any): boolean {
  const code = err?.code
  const name = err?.name
  const msg = String(err?.shortMessage || err?.message || '')
  return code === 4001 || name === 'UserRejectedRequestError' || msg.includes('rejected')
}

function toUiErrorMessage(err: any): string {
  if (!err) return '未知错误'
  if (typeof err === 'string') return err
  return String(err?.shortMessage || err?.message || '未知错误')
}

async function fetchJsonOrThrow(res: Response) {
  const raw = await res.text()
  let data: any
  try {
    data = JSON.parse(raw)
  } catch {
    throw new ApiError(`API 没返回 JSON（HTTP ${res.status}）：${raw.slice(0, 200)}`, { status: res.status })
  }
  if (!res.ok || !data?.success) {
    throw new ApiError(data?.error || `API failed (HTTP ${res.status})`, {
      status: res.status,
      code: data?.code,
    })
  }
  return data
}

// --- 4. 子组件：单条记录卡片 ---

function TransferRecord({
  item,
  onUpdate,
}: {
  item: TransferItem
  onUpdate: (id: string, patch: Partial<TransferItem>) => void
}) {
  useEffect(() => {
    if (item.status === 'complete' || item.status === 'failed') return

    let inFlight = false
    let stopped = false
    let controller: AbortController | null = null

    const t = setInterval(async () => {
      if (stopped || inFlight) return
      inFlight = true
      controller = new AbortController()

      try {
        const res = await fetch(`/api/bridge/transfer?transferId=${item.transferId}`, {
          signal: controller.signal,
        })
        const data = await res.json()
        if (data?.success) {
          onUpdate(item.transferId, {
            status: data.status,
            progress: data.progress,
            targetTxHash: data.targetTxHash ?? null,
          })
        }
      } catch (e) { /* ignore */ } 
      finally {
        inFlight = false
        controller = null
      }
    }, 3000)

    return () => {
      stopped = true
      clearInterval(t)
      controller?.abort()
    }
  }, [item.transferId, item.status, onUpdate])

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-3 border-l-4 border-blue-500">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm">
          ID: <span className="font-mono text-xs text-gray-500">{item.transferId.slice(0, 18)}...</span>
        </div>
        <div className={`text-xs px-2 py-1 rounded uppercase font-bold ${
          item.status === 'complete' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'
        }`}>
          {item.status} ({item.progress}%)
        </div>
      </div>
      <div className="text-[10px] text-gray-400 font-mono truncate">Source: {item.sourceTxHash}</div>
      {item.targetTxHash && (
        <div className="text-[10px] text-blue-400 font-mono truncate">Target: {item.targetTxHash}</div>
      )}
      <div className="w-full bg-gray-100 rounded-full h-1.5 mt-3">
        <div className={`h-1.5 transition-all duration-500 ${item.status === 'complete' ? 'bg-green-500' : 'bg-blue-600'}`} 
             style={{ width: `${item.progress}%` }} />
      </div>
    </div>
  )
}

// --- 5. 主页面组件 ---

export default function BridgePage() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { openConnectModal } = useConnectModal()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<TransferItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [sourceTxHash, setSourceTxHash] = useState<Hex | null>(null)

  // 恢复历史记录
  useEffect(() => {
    const restored = lsLoadTransfers()
    if (restored.length > 0) setItems(restored)
  }, [])

  useEffect(() => {
    if (address && !recipient) setRecipient(address)
  }, [address, recipient])

  // 同步修正逻辑
  const patch = useCallback((id: string, patchObj: Partial<TransferItem>) => {
    setItems((prev) => prev.map((x) => (x.transferId === id ? { ...x, ...patchObj } : x)))
    lsPatchTransfer(id, patchObj)
  }, [])

  const ensureConnectedAndChain = async () => {
    if (!isConnected) {
      openConnectModal?.()
      throw new Error('请先连接钱包')
    }
    if (chainId !== OP_SEPOLIA_CHAIN_ID) {
      await switchChainAsync({ chainId: OP_SEPOLIA_CHAIN_ID })
    }
  }

  // 无限授权逻辑
  const handleApproveIfNeeded = async (amountWei: bigint) => {
    if (!address || !tokenA || !sourceBridge || !isAddress(tokenA) || !isAddress(sourceBridge)) return

    const current = (allowance as bigint | undefined) ?? 0n
    if (current >= amountWei) return

    return await writeContractAsync({
      account: address as Address,
      chain: optimismSepolia,
      address: tokenA as Address,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [sourceBridge as Address, (1n << 256n) - 1n],
    })
  }

  // 核心跨链函数
  const handleBridge = async () => {
    setError(null)
    setIsSuccess(false)
    setIsLoading(false)
    setSourceTxHash(null)
    setBusy(true)

    try {
      if (!tokenA || !sourceBridge || !isAddress(tokenA) || !isAddress(sourceBridge)) throw new Error('合约地址未配置')
      if (!recipient || !isAddress(recipient)) throw new Error('接收地址无效')
      if (!amount || Number(amount) <= 0) throw new Error('请输入有效金额')

      await ensureConnectedAndChain()
      if (!address) throw new Error('未连接钱包')

      const amountWei = parseUnits(amount, DECIMALS)

      // 1. 授权（采用无限授权模式）
      await handleApproveIfNeeded(amountWei)

      // 2. 发起跨链调用
      const txHash = await writeContractAsync({
        account: address as Address,
        chain: optimismSepolia,
        address: sourceBridge as Address,
        abi: SOURCE_BRIDGE_ABI,
        functionName: 'bridge',
        args: [amountWei, recipient as Address, SEPOLIA_CHAIN_ID],
      })

      if (!txHash) throw new Error('交易未发出或取消')
      setSourceTxHash(txHash)
      setBusy(false)

      // 3. 提交至后端入库
      setIsLoading(true)
      const res = await fetch('/api/bridge/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceTxHash: txHash }),
      })
      const data = await fetchJsonOrThrow(res)

      // 4. 入库并同步本地存储
      const newItem = data as TransferItem
      lsUpsertTransfer(newItem)
      setItems((prev) => [newItem, ...prev.filter((x) => x.transferId !== newItem.transferId)])
      
      setIsSuccess(true)
    } catch (err: any) {
      if (isUserRejected(err)) {
        setError('你取消了钱包请求')
      } else {
        setError(toUiErrorMessage(err))
      }
    } finally {
      setIsLoading(false)
      setBusy(false)
    }
  }

  // --- 合约读取 Hook ---
  const { data: bal } = useReadContract({
    chainId: OP_SEPOLIA_CHAIN_ID,
    address: (tokenA ?? ZERO_ADDRESS) as Address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && isAddress(tokenA || '') },
  })

  const { data: allowance } = useReadContract({
    chainId: OP_SEPOLIA_CHAIN_ID,
    address: (tokenA ?? ZERO_ADDRESS) as Address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && sourceBridge ? [address, sourceBridge as Address] : undefined,
    query: { enabled: !!address && isAddress(tokenA || '') && isAddress(sourceBridge || '') },
  })

  const balanceText = bal ? formatUnits(bal as bigint, DECIMALS) : '0'
  const allowanceText = allowance ? formatUnits(allowance as bigint, DECIMALS) : '0'

  return (
    <div className="container py-10 min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">跨链桥 (OP Sepolia → Sepolia)</h1>
        <p className="text-gray-500 mb-8 text-sm">安全转移你的 Sepolia TKA 代币</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="mb-6 grid grid-cols-2 gap-4">
                <div className="p-3 bg-blue-50 rounded-lg">
                  <div className="text-[10px] text-blue-600 font-bold uppercase">余额 (TKA)</div>
                  <div className="text-lg font-mono font-bold text-blue-900">{balanceText}</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <div className="text-[10px] text-gray-500 font-bold uppercase">已授权额度</div>
                  <div className="text-lg font-mono font-bold text-gray-700">{allowanceText}</div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">转账数量</label>
                  <input className="w-full border rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">接收地址 (Sepolia)</label>
                  <input className="w-full border rounded-lg px-4 py-3 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500" value={recipient} onChange={(e) => setRecipient(e.target.value)} disabled={busy} />
                </div>

                {error && <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
                
                <button onClick={handleBridge} disabled={busy || isLoading} className="w-full bg-blue-600 text-white py-4 rounded-lg font-bold hover:bg-blue-700 disabled:bg-gray-300">
                  {isLoading ? '后端入库中...' : busy ? '处理中...' : '发起跨链'}
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-1">
            <h2 className="text-xl font-bold mb-4">历史记录</h2>
            <div className="space-y-3 max-h-[700px] overflow-y-auto pr-2">
              {items.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-xl border border-dashed text-gray-400">暂无记录</div>
              ) : (
                items.map((it) => (
                  <TransferRecord key={it.transferId} item={it} onUpdate={patch} />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}