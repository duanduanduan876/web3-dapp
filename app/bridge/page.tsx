'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAccount, useChainId, useReadContract, useSwitchChain, useWriteContract } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, isAddress, parseUnits } from 'viem'
import { useCallback } from 'react'

const OP_SEPOLIA_CHAIN_ID = 11155420
const SEPOLIA_CHAIN_ID = 11155111
const DECIMALS = 18n

const tokenA = process.env.NEXT_PUBLIC_BRIDGE_TOKEN_A_ADDRESS
const sourceBridge = process.env.NEXT_PUBLIC_BRIDGE_SOURCE_BRIDGE_ADDRESS
const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
] as const

const SOURCE_BRIDGE_ABI = [
  { type: 'function', name: 'bridge', stateMutability: 'nonpayable', inputs: [
    { name: 'amount', type: 'uint256' },
    { name: 'recipient', type: 'address' },
    { name: 'dstChainId', type: 'uint32' },
  ], outputs: [{ name: '', type: 'bytes32' }] },
] as const

type Status = 'queued' | 'inflight' | 'complete' | 'failed'

//后端拿到这个transferid，创建一条交易记录，把这个返回给前端
type TransferItem = {
  transferId: `0x${string}`
  status: Status
  progress: number
  sourceTxHash: `0x${string}`
  targetTxHash?: `0x${string}` | null
  createdAt: number
  error?: string
}

function assertAddr(x: any, name: string): asserts x is `0x${string}` {
  if (!x || typeof x !== 'string' || !isAddress(x)) throw new Error(`${name} 地址无效：${String(x)}`)
}

//负责在前端把response里的内容读出来
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

//子组件收到的props就包含两个字段
//这是 TypeScript 的类型标注，告诉编译器：item 必须长得像 TransferItem
//onUpdate 必须是一个函数，参数是 (id: string, patch: Partial<TransferItem>)，且没有返回值（void）
//它的作用是：让你写错字段名/类型时立刻报错，让 IDE 自动补全、提示参数
function TransferRecord({
  item,
  onUpdate,
}: {
  item: TransferItem
  onUpdate: (id: string, patch: Partial<TransferItem>) => void
}) {
  useEffect(() => {
    // 完成/失败：不再轮询
    //只要这条记录还没结束（不是 complete/failed）
    //就每 2.5 秒去问一次后端：
    if (item.status === 'complete' || item.status === 'failed') return

    let inFlight = false
    let stopped = false
    let controller: AbortController | null = null

    const t: ReturnType<typeof setInterval> = setInterval(async () => {
      // 已卸载/已停止：不做事
      if (stopped) return

      // 上一轮请求还没结束：这轮直接空跑 return
      if (inFlight) return

      inFlight = true
      controller = new AbortController()

      try {
        const res = await fetch(
          `/api/bridge/transfer?transferId=${item.transferId}`,
          { signal: controller.signal }
        )
        const data = await res.json()

        if (data?.success) {
          onUpdate(item.transferId, {
            status: data.status,
            progress: data.progress,
            targetTxHash: data.targetTxHash ?? null,
          })
        }
      } catch (e) {
        // 你想吞错就吞；至少别把 abort 当成错误
        // if ((e as any)?.name !== 'AbortError') console.error(e)
      } finally {
        inFlight = false
        controller = null
      }
    }, 2500)

    return () => {
      stopped = true
      clearInterval(t)
      //控制器中止
      controller?.abort() // 组件卸载时，把正在飞的请求干掉，避免“回来的时候还想更新”
    }
  }, [item.transferId, item.status, onUpdate])

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">ID: <span className="font-mono text-xs">{item.transferId}</span></div>
        <div className="text-sm">{item.status} ({item.progress}%)</div>
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
  
  //首次渲染如果 address 已经有值，会在首轮提交 DOM 后把 recipient 设成 address，触发一次重渲染。
  useEffect(() => {
    if (address && !recipient) setRecipient(address)
  }, [address, recipient])

  

  const canRead = Boolean(isConnected && address && tokenA && sourceBridge && isAddress(tokenA) && isAddress(sourceBridge))

  const { data: bal, error: balErr } = useReadContract({
    chainId: OP_SEPOLIA_CHAIN_ID,
    address: tokenA as any,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: canRead },
  })

  const { data: allowance, error: allowErr } = useReadContract({
    chainId: OP_SEPOLIA_CHAIN_ID,
    address: tokenA as any,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && sourceBridge ? [address, sourceBridge] : undefined,
    query: { enabled: canRead },
  })

  const balanceText = bal ? formatUnits(bal as bigint, Number(DECIMALS)) : '0'
  const allowanceText = allowance ? formatUnits(allowance as bigint, Number(DECIMALS)) : '0'
  
  //partial表示只提供一部分字段
  const patch = useCallback((id: string, patchObj: Partial<TransferItem>) => {
  setItems((prev) =>
    prev.map((x) => (x.transferId === id ? { ...x, ...patchObj } : x))
  )
}, [])

  const ensureConnectedAndChain = async () => {
    if (!isConnected) {
      openConnectModal?.()
      throw new Error('连接钱包')
    }
    if (chainId !== OP_SEPOLIA_CHAIN_ID) {
      await switchChainAsync({ chainId: OP_SEPOLIA_CHAIN_ID })
    }
  }

  const handleApproveIfNeeded = async (amountWei: bigint) => {
    assertAddr(tokenA, 'TokenA')
    assertAddr(sourceBridge, 'SourceBridge')
    
    //(allowance as bigint | undefined)TypeScript 类型断言,你用 as bigint | undefined 是在告诉 TS：
    //“我把它当成 bigint 或 undefined 来用。”
    //a ?? b 的意思是：
    //如果 a 是 null 或 undefined → 用 b,否则用 a
    const current = (allowance as bigint | undefined) ?? 0n
    if (current >= amountWei) return

    // 直接批一个大额度，省得你反复授权
    const MAX = (1n << 256n) - 1n

    const tx = await writeContractAsync({
      chainId: OP_SEPOLIA_CHAIN_ID,
      address: tokenA,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [sourceBridge, MAX],
    })
    // 不等 receipt（你之前就容易 timeout），让用户签完就行
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

      const amountWei = parseUnits(amount, Number(DECIMALS))

      await handleApproveIfNeeded(amountWei)
      
      //promise是异步任务的最终结果
      //await promise 的本质是：给 promise 挂一个 then/catch，把“后续代码”做成续写，等 promise 有结果再继续执行。
    
      //await等待期间只是暂停了handlebridge，不是暂停整个程序
      // 1) 用户在 OP Sepolia 发起 bridge（会 transferFrom + burn，并发 BridgeInitiated 事件）
      const sourceTxHash = await writeContractAsync({
        chainId: OP_SEPOLIA_CHAIN_ID,
        address: sourceBridge,
        abi: SOURCE_BRIDGE_ABI,
        functionName: 'bridge',
        args: [amountWei, recipient, SEPOLIA_CHAIN_ID],
      })

      // 2) 把 sourceTxHash 扔给后端：后端去拿 receipt -> 解 transferId -> 在 Sepolia mint

      console.log('sourceTxHash=', sourceTxHash)
      if (!sourceTxHash) throw new Error('writeContractAsync 没返回 tx hash（可能钱包拒签/报错被你 catch 吞了）')

      const res = await fetch('/api/bridge/transfer', {
        method: 'POST',//post的语义是提交一件事，这里是提交跨链任务
        headers: { 'Content-Type': 'application/json' },//告诉后端，我发过去的请求体格式是json
        body: JSON.stringify({ sourceTxHash }),//把js对象sourceTxHash转成json字符串发过去
      })
      
      
      const data = await fetchJsonOrThrow(res)
      //更新items列表，触发重渲染
      //第一项是 newItem（data）
      //后面跟着旧数组所有元素（...prev 展开）
      setItems((prev) => {
       debugger
       return [data as TransferItem, ...prev]
       })



    } catch (e: any) {
      //catch (e) 是捕获 try 中抛出的错误
      //: any 是 TypeScript 标注：告诉 TS “我不关心错误类型，当 any 用”
      setError(e?.message || String(e))
    } finally {
      //finally解锁ui
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
              <div>TokenA: <span className="font-mono">{String(tokenA)}</span></div>
              <div>SourceBridge: <span className="font-mono">{String(sourceBridge)}</span></div>
            </div>

            <div className="mb-4">
              <div className="text-sm text-gray-700">余额（OP Sepolia TKA）：{balanceText}</div>
              <div className="text-sm text-gray-700">Allowance（你 → SourceBridge）：{allowanceText}</div>
              {(balErr || allowErr) ? (
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
              <input className="w-full border rounded px-3 py-2 font-mono text-sm" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
            </div>

            {error ? <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">{error}</div> : null}

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

                  //子组件调用onupdata就是在调用父组件的patch
                  //父组件把这个onUpdate绑定成了patch
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



