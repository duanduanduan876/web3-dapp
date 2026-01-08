'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAccount, useChainId, useReadContract, useSwitchChain, useWriteContract } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, isAddress, parseUnits, type Address } from 'viem'
import { optimismSepolia } from 'viem/chains'

const OP_SEPOLIA_CHAIN_ID = 11155420
const SEPOLIA_CHAIN_ID = 11155111
const DECIMALS = 18

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

// env（直接 cast 到 Address | undefined，真正使用前再 assert）
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

function assertAddr(x: any, name: string): asserts x is Address {
  if (!x || typeof x !== 'string' || !isAddress(x)) {
    throw new Error(`${name} 地址无效：${String(x)}`)
  }
}

async function fetchJsonOrThrow(res: Response) {
  const raw = await res.text()
  let data: any
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error(`API 没返回 JSON（HTTP ${res.status}）：${raw.slice(0, 200)}`)
  }
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `API failed (HTTP ${res.status})`)
  }
  return data
}

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

    const t: ReturnType<typeof setInterval> = setInterval(async () => {
      if (stopped) return
      if (inFlight) return

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
      } catch (e) {
        // ignore
      } finally {
        inFlight = false
        controller = null
      }
    }, 2500)

    return () => {
      stopped = true
      clearInterval(t)
      controller?.abort()
    }
  }, [item.transferId, item.status, onUpdate])

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">
          ID: <span className="font-mono text-xs">{item.transferId}</span>
        </div>
        <div className="text-sm">
          {item.status} ({item.progress}%)
        </div>
      </div>
      <div className="text-xs text-gray-500 font-mono">sourceTx: {item.sourceTxHash}</div>
      {item.targetTxHash ? <div className="text-xs text-gray-500 font-mono">targetTx: {item.targetTxHash}</div> : null}
      {item.error ? <div className="text-xs text-red-600 mt-2">{item.error}</div> : null}
      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden mt-3">
        <div className="bg-blue-600 h-2" style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }} />
      </div>
    </div>
  )
}

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

  useEffect(() => {
    if (address && !recipient) setRecipient(address)
  }, [address, recipient])

  const canRead = Boolean(
    isConnected &&
      address &&
      tokenA &&
      sourceBridge &&
      isAddress(tokenA) &&
      isAddress(sourceBridge)
  )

  const { data: bal, error: balErr } = useReadContract({
    chainId: OP_SEPOLIA_CHAIN_ID,
    address: (tokenA ?? ZERO_ADDRESS) as Address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? ([address] as const) : undefined,
    query: { enabled: canRead },
  })

  const { data: allowance, error: allowErr } = useReadContract({
    chainId: OP_SEPOLIA_CHAIN_ID,
    address: (tokenA ?? ZERO_ADDRESS) as Address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && sourceBridge ? ([address, sourceBridge] as const) : undefined,
    query: { enabled: canRead },
  })

  const balanceText = bal ? formatUnits(bal as bigint, DECIMALS) : '0'
  const allowanceText = allowance ? formatUnits(allowance as bigint, DECIMALS) : '0'

  const patch = useCallback((id: string, patchObj: Partial<TransferItem>) => {
    setItems((prev) => prev.map((x) => (x.transferId === id ? { ...x, ...patchObj } : x)))
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

  const handleApproveIfNeeded = async (amountWei: bigint) => {
    // 让 TS 彻底收口（地址+账户）
    if (!address) throw new Error('未连接钱包')
    assertAddr(tokenA, 'TokenA')
    assertAddr(sourceBridge, 'SourceBridge')

    const current = (allowance as bigint | undefined) ?? 0n
    if (current >= amountWei) return

    const MAX = (1n << 256n) - 1n

    // 关键：补齐 chain/account，解决你 Vercel build 的 missing chain/account
    const tx = await writeContractAsync({
      chain: optimismSepolia,
      account: address as Address,
      chainId: OP_SEPOLIA_CHAIN_ID,
      address: tokenA,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [sourceBridge, MAX] as const,
    })

    return tx
  }

  const handleBridge = async () => {
    setError(null)
    setBusy(true)
    try {
      assertAddr(tokenA, 'TokenA')
      assertAddr(sourceBridge, 'SourceBridge')
      if (!recipient || !isAddress(recipient)) throw new Error('recipient 地址不合法')
      if (!amount || Number(amount) <= 0) throw new Error('amount 不合法')

      await ensureConnectedAndChain()
      if (!address) throw new Error('未连接钱包')

      const amountWei = parseUnits(amount, DECIMALS)

      await handleApproveIfNeeded(amountWei)

      const sourceTxHash = await writeContractAsync({
        chain: optimismSepolia,
        account: address as Address,
        chainId: OP_SEPOLIA_CHAIN_ID,
        address: sourceBridge,
        abi: SOURCE_BRIDGE_ABI,
        functionName: 'bridge',
        args: [amountWei, recipient as Address, SEPOLIA_CHAIN_ID] as const,
      })

      if (!sourceTxHash) throw new Error('writeContractAsync 没返回 tx hash（可能拒签/报错）')

      const res = await fetch('/api/bridge/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceTxHash }),
      })

      const data = await fetchJsonOrThrow(res)

      setItems((prev) => [data as TransferItem, ...prev])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container py-10">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">跨链桥（OP Sepolia → Sepolia）</h1>
        <div className="text-sm text-gray-600 mb-6">
          当前钱包链：{chainId}（必须是 {OP_SEPOLIA_CHAIN_ID} 才能读到你 OP 上的余额/授权）
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="mb-3 text-sm">
              <div>
                TokenA: <span className="font-mono">{String(tokenA)}</span>
              </div>
              <div>
                SourceBridge: <span className="font-mono">{String(sourceBridge)}</span>
              </div>
            </div>

            <div className="mb-4">
              <div className="text-sm text-gray-700">余额（OP Sepolia TKA）：{balanceText}</div>
              <div className="text-sm text-gray-700">Allowance（你 → SourceBridge）：{allowanceText}</div>
              {balErr || allowErr ? (
                <div className="mt-2 text-xs text-red-600">
                  allowance/余额读取失败：大概率是你钱包不在 OP Sepolia，或者 env 里 TokenA/Bridge 地址写错。
                </div>
              ) : null}
            </div>

            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">数量（TKA）</label>
              <input className="w-full border rounded px-3 py-2" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">接收地址（Sepolia）</label>
              <input
                className="w-full border rounded px-3 py-2 font-mono text-sm"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </div>

            {error ? (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">{error}</div>
            ) : null}

            {!isConnected ? (
              <button className="w-full bg-blue-600 text-white py-3 rounded" onClick={() => openConnectModal?.()}>
                连接钱包
              </button>
            ) : (
              <button className="w-full bg-blue-600 text-white py-3 rounded disabled:bg-gray-400" disabled={busy} onClick={handleBridge}>
                {busy ? '提交中…' : '发起跨链'}
              </button>
            )}
          </div>

          <div>
            <h2 className="text-xl font-bold mb-3">转账记录</h2>
            {items.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-10 text-gray-500">暂无记录</div>
            ) : (
              <div className="max-h-[600px] overflow-y-auto">
                {items.map((it) => (
                  <TransferRecord key={it.transferId} item={it} onUpdate={patch} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}




