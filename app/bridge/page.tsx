'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  useAccount,
  useChainId,
  useReadContract,
  useSignMessage,
  useSwitchChain,
  useWriteContract,
} from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, isAddress, parseUnits, type Address } from 'viem'
import { optimismSepolia } from 'viem/chains'

const OP_SEPOLIA_CHAIN_ID = 11155420
const SEPOLIA_CHAIN_ID = 11155111
const DECIMALS = 18
const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '')
const tokenA = process.env.NEXT_PUBLIC_BRIDGE_TOKEN_A_ADDRESS as Address | undefined
const sourceBridge = process.env.NEXT_PUBLIC_BRIDGE_SOURCE_BRIDGE_ADDRESS as Address | undefined

// 功能开关：设置 NEXT_PUBLIC_BRIDGE_SUBMIT_ENABLED=false 时，只暂停发起新跨链任务。
// 历史任务恢复与状态查询逻辑继续保留。
const BRIDGE_SUBMIT_ENABLED =
  process.env.NEXT_PUBLIC_BRIDGE_SUBMIT_ENABLED !== 'false'

// 本地演示可配置成 10 秒；生产环境应按正常任务耗时配置更合理的阈值。
const configuredStuckThreshold = Number(process.env.NEXT_PUBLIC_BRIDGE_STUCK_THRESHOLD_MS)
const STUCK_THRESHOLD_MS =
  Number.isFinite(configuredStuckThreshold) && configuredStuckThreshold > 0
    ? configuredStuckThreshold
    : 10_000

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'o', type: 'address' },
      { name: 's', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 's', type: 'address' },
      { name: 'v', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
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

// 源链交易已经发出，但后端还没有返回正式 transferId 的本地待恢复记录。
type PendingSourceTx = {
  sourceTxHash: `0x${string}`
  status: 'waiting_backend'
  createdAt: number
  error?: string
}

type SiteUser = {
  id: string
  address: `0x${string}`
}

const LS_IDS_KEY = 'bridge:recentTransferIds'
const LS_MAP_KEY = 'bridge:transfers:v1'
const LS_PENDING_SOURCE_TXS_KEY = 'bridge:pendingSourceTxs:v1'
const LS_MAX = 20

// 实验时保持 true：让现有历史卡片也进入一条批量轮询请求，便于在 Network 观察。
// 实验完成后改成 false：真实业务中只轮询 queued / inflight 记录。
const POLL_ALL_RECORDS_FOR_EXPERIMENT = false

type StoredTransfer = Pick<
  TransferItem,
  'transferId' | 'status' | 'progress' | 'sourceTxHash' | 'targetTxHash' | 'createdAt' | 'error'
>

function apiUrl(path: string) {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path
}

function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    cache: init?.cache ?? 'no-store',
  })
}

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
  } catch {}
}

function lsReadMap(): Record<string, StoredTransfer> {
  const obj = safeParseJson<unknown>(typeof window !== 'undefined' ? localStorage.getItem(LS_MAP_KEY) : null)
  if (!obj || typeof obj !== 'object') return {}
  return obj as Record<string, StoredTransfer>
}

function lsWriteMap(map: Record<string, StoredTransfer>) {
  try {
    localStorage.setItem(LS_MAP_KEY, JSON.stringify(map))
  } catch {}
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

function lsLoadPendingSourceTxs(): PendingSourceTx[] {
  const raw = typeof window !== 'undefined' ? localStorage.getItem(LS_PENDING_SOURCE_TXS_KEY) : null
  const arr = safeParseJson<unknown>(raw)
  if (!Array.isArray(arr)) return []

  return arr
    .filter((item): item is PendingSourceTx => {
      if (!item || typeof item !== 'object') return false
      const value = item as Record<string, unknown>
      return (
        typeof value.sourceTxHash === 'string' &&
        /^0x[0-9a-fA-F]{64}$/.test(value.sourceTxHash) &&
        value.status === 'waiting_backend' &&
        typeof value.createdAt === 'number'
      )
    })
    .slice(0, LS_MAX)
}

function lsWritePendingSourceTxs(items: PendingSourceTx[]) {
  try {
    localStorage.setItem(LS_PENDING_SOURCE_TXS_KEY, JSON.stringify(items.slice(0, LS_MAX)))
  } catch {}
}

function lsUpsertPendingSourceTx(item: PendingSourceTx) {
  const current = lsLoadPendingSourceTxs()
  const next = [item, ...current.filter((x) => x.sourceTxHash !== item.sourceTxHash)].slice(0, LS_MAX)
  lsWritePendingSourceTxs(next)
}

function lsPatchPendingSourceTx(sourceTxHash: string, patch: Partial<PendingSourceTx>) {
  const current = lsLoadPendingSourceTxs()
  const next = current.map((item) =>
    item.sourceTxHash === sourceTxHash ? { ...item, ...patch } : item,
  )
  lsWritePendingSourceTxs(next)
}

function lsRemovePendingSourceTx(sourceTxHash: string) {
  const current = lsLoadPendingSourceTxs()
  lsWritePendingSourceTxs(current.filter((item) => item.sourceTxHash !== sourceTxHash))
}

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
    throw new ApiError(`API 没返回 JSON（HTTP ${res.status}）：${raw.slice(0, 200)}`, {
      status: res.status,
    })
  }

  if (!res.ok || !data?.success) {
    throw new ApiError(data?.error || `API failed (HTTP ${res.status})`, {
      status: res.status,
      code: data?.code,
    })
  }

  return data
}

async function apiFetchJsonOrThrow(path: string, init?: RequestInit) {
  const res = await apiFetch(path, init)
  return fetchJsonOrThrow(res)
}

const PendingSourceRecord = memo(function PendingSourceRecord({
  item,
  isRetrying,
  onRetry,
}: {
  item: PendingSourceTx
  isRetrying: boolean
  onRetry: (sourceTxHash: `0x${string}`) => void
}) {
  return (
    <div className="bg-white rounded-lg shadow p-4 mb-3 border-l-4 border-amber-500">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm">待后台接管</div>
        <div className="text-xs px-2 py-1 rounded uppercase font-bold bg-amber-100 text-amber-700">
          waiting
        </div>
      </div>

      <div className="text-[10px] text-gray-400 font-mono truncate">Source: {item.sourceTxHash}</div>

      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] text-amber-800">
        源链交易已发出，后台处理暂未确认。请勿重新发起跨链，请重试处理这笔已有交易。
      </div>

      {item.error && <div className="mt-2 text-[11px] text-red-600">{item.error}</div>}

      <button
        type="button"
        onClick={() => onRetry(item.sourceTxHash)}
        disabled={isRetrying}
        className="mt-3 w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-gray-300"
      >
        {isRetrying ? '重试处理中...' : '重试处理'}
      </button>
    </div>
  )
})

const TransferRecord = memo(function TransferRecord({
  item,
}: {
  item: TransferItem
}) {
  const [isStuck, setIsStuck] = useState(() => {
    const isTerminal = item.status === 'complete' || item.status === 'failed'
    return !isTerminal && Date.now() - item.createdAt >= STUCK_THRESHOLD_MS
  })

  useEffect(() => {
    if (item.status === 'complete' || item.status === 'failed') {
      setIsStuck(false)
      return
    }

    const remaining = item.createdAt + STUCK_THRESHOLD_MS - Date.now()

    if (remaining <= 0) {
      setIsStuck(true)
      return
    }

    setIsStuck(false)

    const timerId = window.setTimeout(() => {
      setIsStuck(true)
    }, remaining)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [item.status, item.createdAt])

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-3 border-l-4 border-blue-500">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm">
          ID: <span className="font-mono text-xs text-gray-500">{item.transferId.slice(0, 18)}...</span>
        </div>
        <div
          className={`text-xs px-2 py-1 rounded uppercase font-bold ${
            item.status === 'complete' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {item.status} ({item.progress}%)
        </div>
      </div>

      <div className="text-[10px] text-gray-400 font-mono truncate">Source: {item.sourceTxHash}</div>
      {item.targetTxHash && (
        <div className="text-[10px] text-blue-400 font-mono truncate">Target: {item.targetTxHash}</div>
      )}

      {isStuck && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          处理时间较长，请稍后核对状态
        </div>
      )}

      <div className="w-full bg-gray-100 rounded-full h-1.5 mt-3">
        <div
          className={`h-1.5 transition-all duration-500 ${
            item.status === 'complete' ? 'bg-green-500' : 'bg-blue-600'
          }`}
          style={{ width: `${item.progress}%` }}
        />
      </div>
    </div>
  )
})

export default function BridgePage() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { openConnectModal } = useConnectModal()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const { signMessageAsync } = useSignMessage()

  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  // 只表示“最近一次任务状态刷新失败”，不代表跨链任务本身失败。
  const [pollingError, setPollingError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [items, setItems] = useState<TransferItem[]>([])
  const [pendingSourceTxs, setPendingSourceTxs] = useState<PendingSourceTx[]>([])
  const [registeringSourceTxHash, setRegisteringSourceTxHash] = useState<`0x${string}` | null>(null)
  const [siteUser, setSiteUser] = useState<SiteUser | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [bridgeSubmitEnabled, setBridgeSubmitEnabled] = useState(BRIDGE_SUBMIT_ENABLED)

  const loadSiteUser = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth/me')
      const data = await res.json()
      if (res.ok && data?.success) {
        setSiteUser(data.user)
      } else {
        setSiteUser(null)
      }
    } catch {
      setSiteUser(null)
    }
  }, [])

  useEffect(() => {
    const restored = lsLoadTransfers()
    if (restored.length > 0) setItems(restored)

    const pending = lsLoadPendingSourceTxs()
    if (pending.length > 0) setPendingSourceTxs(pending)
  }, [])

  useEffect(() => {
    loadSiteUser()
  }, [loadSiteUser])

  useEffect(() => {
  let stopped = false

  const loadConfig = async () => {
    try {
      const data = await apiFetchJsonOrThrow('/api/config')

      if (!stopped && typeof data.bridgeSubmitEnabled === 'boolean') {
        setBridgeSubmitEnabled(data.bridgeSubmitEnabled)
      }
    } catch {
      // 配置接口失败时，保留构建时默认值，避免页面直接崩掉
    }
  }

  void loadConfig()

  return () => {
    stopped = true
  }
}, [])

  useEffect(() => {
    if (address && !recipient) setRecipient(address)
  }, [address, recipient])

  const pollingTransferIdsKey = useMemo(() => {
    return items
      .filter((item) => {
        if (POLL_ALL_RECORDS_FOR_EXPERIMENT) return true
        return item.status !== 'complete' && item.status !== 'failed'
      })
      .map((item) => item.transferId)
      .join(',')
  }, [items])

  useEffect(() => {
    if (!pollingTransferIdsKey) {
      setPollingError(null)
      return
    }

    let stopped = false
    let inFlight = false
    let controller: AbortController | null = null

    const poll = async () => {
      if (stopped || inFlight) return

      inFlight = true
      controller = new AbortController()

      try {
        const params = new URLSearchParams({
          transferIds: pollingTransferIdsKey,
        })

        const data = await apiFetchJsonOrThrow(`/api/bridge/transfer?${params.toString()}`, {
          signal: controller.signal,
        })

        // 本轮状态查询成功，清除之前的临时刷新失败提示。
        setPollingError(null)

        const records: TransferItem[] = Array.isArray(data.records) ? data.records : []
        if (stopped || records.length === 0) return

        for (const rec of records) {
          lsPatchTransfer(rec.transferId, {
            status: rec.status,
            progress: rec.progress,
            targetTxHash: rec.targetTxHash ?? null,
            error: rec.error,
          })
        }

        const recordsById = new Map(records.map((rec) => [rec.transferId, rec]))

        setItems((prev) => {
          let changed = false

          const next = prev.map((item) => {
            const updated = recordsById.get(item.transferId)
            if (!updated) return item

            const same =
              item.status === updated.status &&
              item.progress === updated.progress &&
              (item.targetTxHash ?? null) === (updated.targetTxHash ?? null) &&
              item.error === updated.error

            if (same) return item

            changed = true
            return {
              ...item,
              status: updated.status,
              progress: updated.progress,
              targetTxHash: updated.targetTxHash ?? null,
              error: updated.error,
            }
          })

          return changed ? next : prev
        })
      } catch (err: any) {
        // cleanup 主动取消请求时，不向用户显示错误提示。
        if (stopped || err?.name === 'AbortError') return

        // 查询失败只说明本轮拿不到最新状态，保留已有卡片状态并等待下一轮重试。
        setPollingError('状态刷新暂时失败，将自动重试')
      } finally {
        inFlight = false
        controller = null
      }
    }

    void poll()

    const timerId = setInterval(() => {
      void poll()
    }, 3000)

    return () => {
      stopped = true
      clearInterval(timerId)
      controller?.abort()
    }
  }, [pollingTransferIdsKey])

  const ensureConnectedAndChain = async () => {
    if (!isConnected) {
      openConnectModal?.()
      throw new Error('请先连接钱包')
    }

    if (chainId !== OP_SEPOLIA_CHAIN_ID) {
      await switchChainAsync({ chainId: OP_SEPOLIA_CHAIN_ID })
    }
  }

  const loginSite = async () => {
    if (!isConnected || !address) {
      openConnectModal?.()
      throw new Error('请先连接钱包')
    }

    setAuthBusy(true)

    try {
      const nonceData = await apiFetchJsonOrThrow('/api/auth/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      })

      const signature = await signMessageAsync({
  account: address as Address,
  message: String(nonceData.message),
})

      const verifyData = await apiFetchJsonOrThrow('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          message: nonceData.message,
          signature,
        }),
      })

      setSiteUser(verifyData.user)
    } finally {
      setAuthBusy(false)
    }
  }

  const ensureSiteLogin = async () => {
    if (!address) throw new Error('未连接钱包')

    const currentSiteAddress = siteUser?.address?.toLowerCase()
    const currentWalletAddress = address.toLowerCase()

    if (currentSiteAddress === currentWalletAddress) return

    await loginSite()
  }

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

  const registerSubmittedSourceTx = async (sourceTxHash: `0x${string}`) => {
    setIsLoading(true)
    setRegisteringSourceTxHash(sourceTxHash)

    try {
      const data = await apiFetchJsonOrThrow('/api/bridge/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceTxHash }),
      })

      const newItem: TransferItem = {
        transferId: data.transferId,
        status: data.status,
        progress: data.progress,
        sourceTxHash: data.sourceTxHash,
        targetTxHash: data.targetTxHash ?? null,
        createdAt: data.createdAt,
        error: data.error,
      }

      lsUpsertTransfer(newItem)
      setItems((prev) => [newItem, ...prev.filter((x) => x.transferId !== newItem.transferId)])

      lsRemovePendingSourceTx(sourceTxHash)
      setPendingSourceTxs((prev) => prev.filter((x) => x.sourceTxHash !== sourceTxHash))
    } catch (err: any) {
      const message = toUiErrorMessage(err)
      lsPatchPendingSourceTx(sourceTxHash, { error: message })
      setPendingSourceTxs((prev) =>
        prev.map((item) => (item.sourceTxHash === sourceTxHash ? { ...item, error: message } : item)),
      )
      setError('源链交易已发出，但后台处理暂未确认。请在历史记录中点击“重试处理”。')
    } finally {
      setIsLoading(false)
      setRegisteringSourceTxHash(null)
    }
  }

  const retryPendingSourceTx = async (sourceTxHash: `0x${string}`) => {
    setError(null)
    await registerSubmittedSourceTx(sourceTxHash)
  }

  const handleBridge = async () => {
    if (!bridgeSubmitEnabled) {
      setError('跨链发起功能维护中，暂时无法提交新任务')
      return
    }

    setError(null)
    setIsLoading(false)
    setBusy(true)

    try {
      if (!tokenA || !sourceBridge || !isAddress(tokenA) || !isAddress(sourceBridge)) {
        throw new Error('合约地址未配置')
      }
      if (!recipient || !isAddress(recipient)) throw new Error('接收地址无效')
      if (!amount || Number(amount) <= 0) throw new Error('请输入有效金额')

      await ensureConnectedAndChain()
      if (!address) throw new Error('未连接钱包')

      await ensureSiteLogin()

      const amountWei = parseUnits(amount, DECIMALS)

      await handleApproveIfNeeded(amountWei)

      const txHash = await writeContractAsync({
        account: address as Address,
        chain: optimismSepolia,
        address: sourceBridge as Address,
        abi: SOURCE_BRIDGE_ABI,
        functionName: 'bridge',
        args: [amountWei, recipient as Address, SEPOLIA_CHAIN_ID],
      })

      if (!txHash) throw new Error('交易未发出或取消')

      // 源链交易一旦得到哈希，立刻保存待接管记录；后端登记失败时重试同一笔交易。
      const pending: PendingSourceTx = {
        sourceTxHash: txHash as `0x${string}`,
        status: 'waiting_backend',
        createdAt: Date.now(),
      }

      lsUpsertPendingSourceTx(pending)
      setPendingSourceTxs((prev) => [
        pending,
        ...prev.filter((x) => x.sourceTxHash !== pending.sourceTxHash),
      ])

      await registerSubmittedSourceTx(pending.sourceTxHash)
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

  const isSiteAuthedForCurrentWallet = useMemo(() => {
    if (!siteUser || !address) return false
    return siteUser.address.toLowerCase() === address.toLowerCase()
  }, [siteUser, address])

  return (
    <div className="container py-10 min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">跨链桥 (OP Sepolia → Sepolia)</h1>
        <p className="text-gray-500 mb-8 text-sm">安全转移你的 Sepolia TKA 代币</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-gray-50 px-4 py-3">
                <div className="text-sm">
                  <div className="font-semibold text-gray-800">站点登录状态</div>
                  <div className="text-gray-500">
                    {isSiteAuthedForCurrentWallet ? `已登录站点：${siteUser?.address}` : '未登录站点'}
                  </div>
                </div>

                <button
                  onClick={loginSite}
                  disabled={authBusy || busy}
                  className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-300"
                >
                  {authBusy ? '签名登录中...' : '手动登录站点'}
                </button>
              </div>

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
                {!bridgeSubmitEnabled && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    跨链发起功能维护中，暂时无法提交新任务。已有历史任务仍可继续查看状态。
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">转账数量</label>
                  <input
                    className="w-full border rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={!bridgeSubmitEnabled || busy || authBusy}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">接收地址 (Sepolia)</label>
                  <input
                    className="w-full border rounded-lg px-4 py-3 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    disabled={!bridgeSubmitEnabled || busy || authBusy}
                  />
                </div>

                {error && <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

                <button
                  onClick={handleBridge}
                  disabled={!bridgeSubmitEnabled || busy || isLoading || authBusy}
                  className="w-full bg-blue-600 text-white py-4 rounded-lg font-bold hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {!bridgeSubmitEnabled
                    ? '维护中，暂停发起跨链'
                    : authBusy
                    ? '站点签名登录中...'
                    : isLoading
                    ? '后端入库中...'
                    : busy
                    ? '处理中...'
                    : '发起跨链'}
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-1">
            <h2 className="text-xl font-bold mb-4">历史记录</h2>

            {pollingError && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {pollingError}
              </div>
            )}

            <div className="space-y-3 max-h-[700px] overflow-y-auto pr-2">
              {pendingSourceTxs.length === 0 && items.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-xl border border-dashed text-gray-400">
                  暂无记录
                </div>
              ) : (
                <>
                  {pendingSourceTxs.map((pending) => (
                    <PendingSourceRecord
                      key={pending.sourceTxHash}
                      item={pending}
                      isRetrying={registeringSourceTxHash === pending.sourceTxHash}
                      onRetry={retryPendingSourceTx}
                    />
                  ))}
                  {items.map((it) => <TransferRecord key={it.transferId} item={it} />)}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}