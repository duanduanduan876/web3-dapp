'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useChainId } from 'wagmi'
import { type Address, isAddress, zeroAddress } from 'viem'

import { parseUnits, formatUnits } from '@/lib/utils/units'
import ApproveButton from '@/components/ApproveButton'
import { getTokenAddress, getProtocolAddress } from '@/lib/constants'
import { SWAP_ABI, ERC20_ABI } from '@/lib/abis'

import { sepolia } from 'viem/chains'


function asAddress(v?: string | null): Address | undefined {
  if (!v) return undefined
  return isAddress(v) ? (v as Address) : undefined
}

export default function PoolPage() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()

  // 关键：把 string | undefined 收敛成 Address | undefined
  const swapAddress = useMemo(() => asAddress(getProtocolAddress(chainId, 'SWAP')), [chainId])
  const tokenAAddress = useMemo(() => asAddress(getTokenAddress(chainId, 'TKA')), [chainId])
  const tokenBAddress = useMemo(() => asAddress(getTokenAddress(chainId, 'TKB')), [chainId])

  const isMockMode = !swapAddress

  // State
  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [amountA, setAmountA] = useState('')
  const [amountB, setAmountB] = useState('')
  const [lpAmount, setLpAmount] = useState('')
  const [poolData, setPoolData] = useState<any>(null)

  // ===== Reads (wagmi v2: 用 query.enabled) =====

  // Reserves
  const { data: reservesRaw, isError: reservesError } = useReadContract({
    // 给一个兜底 Address，配合 query.enabled=false 不会真的去读
    address: (swapAddress ?? zeroAddress) as Address,
    abi: SWAP_ABI as any,
    functionName: 'getReserves',
    query: {
      enabled: Boolean(swapAddress),
    },
  })
  const reserves = reservesRaw as readonly [bigint, bigint] | undefined

  // LP balance (如果你的 Swap 合约本身是 LP ERC20，这样读才成立)
  const { data: lpBalanceRaw } = useReadContract({
    address: (swapAddress ?? zeroAddress) as Address,
    abi: SWAP_ABI as any,
    functionName: 'balanceOf',
    args: address ? [address as Address] : undefined,
    query: {
      enabled: Boolean(swapAddress && address),
    },
  })
  const lpBalance = lpBalanceRaw as bigint | undefined

  // Token balances
  const { data: balanceTKARaw } = useReadContract({
    address: (tokenAAddress ?? zeroAddress) as Address,
    abi: ERC20_ABI as any,
    functionName: 'balanceOf',
    args: address ? [address as Address] : undefined,
    query: {
      enabled: Boolean(tokenAAddress && address),
    },
  })
  const balanceTKA = balanceTKARaw as bigint | undefined

  const { data: balanceTKBRaw } = useReadContract({
    address: (tokenBAddress ?? zeroAddress) as Address,
    abi: ERC20_ABI as any,
    functionName: 'balanceOf',
    args: address ? [address as Address] : undefined,
    query: {
      enabled: Boolean(tokenBAddress && address),
    },
  })
  const balanceTKB = balanceTKBRaw as bigint | undefined

  // ===== Writes =====
  const { data: addHash, writeContract: addLiquidity, isPending: isAdding } = useWriteContract()
  const { isLoading: isAddConfirming, isSuccess: isAddSuccess } = useWaitForTransactionReceipt({
    hash: addHash,
  })

  const { data: removeHash, writeContract: removeLiquidity, isPending: isRemoving } = useWriteContract()
  const { isLoading: isRemoveConfirming, isSuccess: isRemoveSuccess } = useWaitForTransactionReceipt({
    hash: removeHash,
  })

  // Fetch pool data from API
  useEffect(() => {
    fetch('/api/stake/pools')
      .then((res) => res.json())
      .then((data) => setPoolData(data))
      .catch(console.error)
  }, [])

  // Auto-calc amountB
  useEffect(() => {
    if (mode !== 'add' || !amountA || Number(amountA) <= 0) return

    if (reserves && reserves[0] > 0n && reserves[1] > 0n) {
      const reserveA = Number(reserves[0]) / 1e18
      const reserveB = Number(reserves[1]) / 1e18
      const ratio = reserveB / reserveA
      setAmountB((Number(amountA) * ratio).toFixed(6))
      return
    }

    setAmountB((Number(amountA) * 1.5).toFixed(6))
  }, [amountA, reserves, mode])

  // Remove calc
  const calculateRemoveAmounts = () => {
    if (!lpAmount || Number(lpAmount) <= 0 || !reserves || !lpBalance) {
      return { amountA: '0', amountB: '0' }
    }

    const lpAmountWei = parseUnits(lpAmount, 18) as bigint
    if (lpAmountWei > lpBalance) return { amountA: '0', amountB: '0' }

    const amountAWei = (lpAmountWei * reserves[0]) / lpBalance
    const amountBWei = (lpAmountWei * reserves[1]) / lpBalance

    return {
      amountA: formatUnits(amountAWei, 18, 6),
      amountB: formatUnits(amountBWei, 18, 6),
    }
  }

  const removeAmounts = calculateRemoveAmounts()

  const handleAddLiquidity = () => {
    if (!swapAddress) return
    if (!amountA || !amountB) return

    const amountAWei = parseUnits(amountA, 18) as bigint
    const amountBWei = parseUnits(amountB, 18) as bigint

    // add
    addLiquidity({
      address: swapAddress as Address,
      abi: SWAP_ABI as any,
      functionName: 'addLiquidity',
      args: [amountAWei, amountBWei] as const,
      account: address as Address,
      chain: sepolia,
    })
  } // <--- 修改点 1：补上这个括号，闭合 handleAddLiquidity

  const handleRemoveLiquidity = () => {
    if (!swapAddress) return
    if (!lpAmount) return

    const lpAmountWei = parseUnits(lpAmount, 18) as bigint

    removeLiquidity({
      address: swapAddress as Address,
      abi: SWAP_ABI as any,
      functionName: 'removeLiquidity',
      args: [lpAmountWei] as const,
      account: address as Address,
      chain: sepolia,
    })
  }
  const handleMaxLP = () => {
    if (lpBalance) setLpAmount(formatUnits(lpBalance, 18, 6))
  }
  const handleMaxTKA = () => {
    if (balanceTKA) setAmountA(formatUnits(balanceTKA, 18, 6))
  }

  // 渲染层的 “能交互” 条件，保证 ApproveButton 的 props 传进去一定是 Address
  const canInteract =
    Boolean(isConnected && swapAddress && tokenAAddress && tokenBAddress) && !isMockMode

// 1. 请确保删除了 return 之前的那个多余的 “}”
  return (
    <div className="container max-w-2xl mx-auto py-12">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Liquidity Pool</h1>
        <p className="text-gray-600">Add or remove liquidity to earn trading fees</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-lg p-6 text-white">
          <div className="text-sm opacity-90 mb-1">Total TVL</div>
          <div className="text-2xl font-bold">
            {poolData?.pools?.[0]?.tvl ? `$${Number(poolData.pools[0].tvl).toLocaleString()}` : '$0'}
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg shadow-lg p-6 text-white">
          <div className="text-sm opacity-90 mb-1">Reserve A</div>
          <div className="text-2xl font-bold">
            {reserves ? formatUnits(reserves[0], 18, 2) : '0'} TKA
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg shadow-lg p-6 text-white">
          <div className="text-sm opacity-90 mb-1">Reserve B</div>
          <div className="text-2xl font-bold">
            {reserves ? formatUnits(reserves[1], 18, 2) : '0'} TKB
          </div>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-white rounded-2xl shadow-lg p-6">
        {/* Mode selector */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setMode('add')}
            className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-colors ${
              mode === 'add' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Add Liquidity
          </button>
          <button
            onClick={() => setMode('remove')}
            className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-colors ${
              mode === 'remove' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Remove Liquidity
          </button>
        </div>

        {/* Mock warning */}
        {isMockMode && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-800">
              <strong>Mock Mode:</strong> Swap contract not deployed. Using simulated data.
            </p>
          </div>
        )}

        {/* Add mode */}
        {mode === 'add' && (
          <>
            <div className="mb-4">
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex justify-between mb-2">
                  <label className="text-sm text-gray-600">Token A</label>
                  <button onClick={handleMaxTKA} className="text-sm text-blue-600">
                    Balance: {balanceTKA ? formatUnits(balanceTKA, 18, 4) : '0'}
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={amountA}
                    onChange={(e) => setAmountA(e.target.value)}
                    placeholder="0.0"
                    className="flex-1 text-2xl font-semibold bg-transparent outline-none"
                  />
                  <div className="bg-white border rounded-lg px-3 py-2 font-semibold">TKA</div>
                </div>
              </div>
            </div>

            <div className="flex justify-center -my-2 relative z-10">
              <div className="bg-white border-4 border-gray-50 rounded-xl p-2">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
            </div>

            <div className="mb-6">
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex justify-between mb-2">
                  <label className="text-sm text-gray-600">Token B</label>
                  <button
                    onClick={() => balanceTKB && setAmountB(formatUnits(balanceTKB, 18, 6))}
                    className="text-sm text-blue-600"
                  >
                    Balance: {balanceTKB ? formatUnits(balanceTKB, 18, 4) : '0'}
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={amountB}
                    onChange={(e) => setAmountB(e.target.value)}
                    placeholder="0.0"
                    className="flex-1 text-2xl font-semibold bg-transparent outline-none"
                  />
                  <div className="bg-white border rounded-lg px-3 py-2 font-semibold">TKB</div>
                </div>
              </div>
            </div>

            {!isConnected ? (
              <button className="w-full bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg">
                Connect Wallet
              </button>
            ) : !canInteract ? (
              <button
                disabled
                className="w-full bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg cursor-not-allowed"
              >
                {isMockMode ? 'Add Liquidity (Mock Mode)' : 'Contract / Token address invalid'}
              </button>
            ) : (
              <ApproveButton
                tokenAddress={tokenAAddress as any}
                spenderAddress={swapAddress as any}
                amount={amountA ? parseUnits(amountA, 18) : 0n}
                disabled={!amountA || !amountB || isAdding || isAddConfirming}
              >
                <ApproveButton
                  tokenAddress={tokenBAddress as any}
                  spenderAddress={swapAddress as any}
                  amount={amountB ? parseUnits(amountB, 18) : 0n}
                  disabled={!amountA || !amountB || isAdding || isAddConfirming}
                >
                  <button
                    onClick={handleAddLiquidity}
                    disabled={!amountA || !amountB || isAdding || isAddConfirming}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                  >
                    {isAdding || isAddConfirming ? 'Adding Liquidity...' : 'Add Liquidity'}
                  </button>
                </ApproveButton>
              </ApproveButton>
            )}

            {isAddSuccess && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-green-800 font-semibold">Liquidity Added Successfully!</p>
                <a
                  href={`https://sepolia.etherscan.io/tx/${addHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline"
                >
                  View on Etherscan →
                </a>
              </div>
            )}
          </>
        )}

        {/* Remove mode */}
        {mode === 'remove' && (
          <>
            <div className="mb-4">
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex justify-between mb-2">
                  <label className="text-sm text-gray-600">LP Tokens</label>
                  <button onClick={handleMaxLP} className="text-sm text-blue-600">
                    Balance: {lpBalance ? formatUnits(lpBalance, 18, 4) : '0'}
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={lpAmount}
                    onChange={(e) => setLpAmount(e.target.value)}
                    placeholder="0.0"
                    className="flex-1 text-2xl font-semibold bg-transparent outline-none"
                  />
                  <div className="bg-white border rounded-lg px-3 py-2 font-semibold">LP</div>
                </div>
              </div>
            </div>

            <div className="flex justify-center -my-2 relative z-10">
              <div className="bg-white border-4 border-gray-50 rounded-xl p-2">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>
            </div>

            <div className="mb-6 space-y-3">
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-sm text-gray-600 mb-1">You will receive</div>
                <div className="text-xl font-semibold">{removeAmounts.amountA} TKA</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-sm text-gray-600 mb-1">You will receive</div>
                <div className="text-xl font-semibold">{removeAmounts.amountB} TKB</div>
              </div>
            </div>

            {!isConnected ? (
              <button className="w-full bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg">
                Connect Wallet
              </button>
            ) : !swapAddress || isMockMode ? (
              <button
                disabled
                className="w-full bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg cursor-not-allowed"
              >
                {isMockMode ? 'Remove Liquidity (Mock Mode)' : 'Swap Contract Not Available'}
              </button>
            ) : (
              <button
                onClick={handleRemoveLiquidity}
                disabled={!lpAmount || isRemoving || isRemoveConfirming}
                className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                {isRemoving || isRemoveConfirming ? 'Removing Liquidity...' : 'Remove Liquidity'}
              </button>
            )}

            {isRemoveSuccess && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-green-800 font-semibold">Liquidity Removed Successfully!</p>
                <a
                  href={`https://sepolia.etherscan.io/tx/${removeHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline"
                >
                  View on Etherscan →
                </a>
              </div>
            )}
          </>
        )}
      </div>

      {/* Info */}
      <div className="mt-6 p-4 bg-gray-50 rounded-lg">
        <h3 className="font-semibold mb-2">How it works</h3>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• Add liquidity in a ratio based on reserves</li>
          <li>• Receive LP tokens representing your pool share</li>
          <li>• Remove liquidity anytime by burning LP tokens</li>
          <li>• Earn fee proportional to your share</li>
        </ul>
      </div>

      {/* Reserves read error */}
      {reservesError && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          getReserves 读取失败。先确认 SWAP 地址和 ABI
        </div>
      )}
    </div>
  );
} // 2. 这里补上最后一个收尾括号
