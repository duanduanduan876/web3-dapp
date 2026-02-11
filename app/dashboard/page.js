'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAccount, useReadContract, useChainId } from 'wagmi'
import { isAddress } from 'viem'
import { formatUnits, formatUSD } from '@/lib/utils/units'
import { formatNumber } from '@/lib/utils/format'
import LineChartEcharts, { transformDataForEcharts, filterDataByDays } from '@/components/charts/LineChartEcharts'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
]

const FARM_ABI = [
  {
    name: 'userInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'address' },
    ],
    outputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'rewardDebt', type: 'uint256' },
    ],
  },
  {
    name: 'pendingReward',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'poolId', type: 'uint256' },
      { name: 'user', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

function isRpcError(err) {
  const msg = String(err?.message || '')
  const low = msg.toLowerCase()
  return (
    low.includes('network') ||
    low.includes('timeout') ||
    low.includes('timed out') ||
    low.includes('fetch') ||
    low.includes('503') ||
    low.includes('502') ||
    low.includes('500')
  )
}

function toUiMsg(err) {
  if (!err) return '未知错误'
  if (typeof err === 'string') return err
  return String(err?.message || '未知错误')
}

async function fetchJson(url, signal) {
  const res = await fetch(url, { signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return await res.json()
}

export default function DashboardPage() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()

  const SUPPORTED_CHAIN_ID = 11155111
  const chainOk = chainId === SUPPORTED_CHAIN_ID
  const addrOk = !!address && isAddress(address)

  const [priceData, setPriceData] = useState(null)
  const [poolsData, setPoolsData] = useState(null)
  const [farmData, setFarmData] = useState(null)

  const [priceDays, setPriceDays] = useState(7)
  const [apyDays, setApyDays] = useState(30)

  // 6 abilities（同口径，dashboard 用于 API/读数据）
  const [stage, setStage] = useState('idle') // idle → preparing → pendingWallet → confirming → success | failed
  const [errType, setErrType] = useState(null) // 用户拒签 | RPC 错误 | 合约 revert | 未知
  const [uiError, setUiError] = useState(null)

  const inFlightRef = useRef(false)
  const lastKickRef = useRef(0)

  const swapAddressRaw = process.env.NEXT_PUBLIC_SWAP_ADDRESS
  const farmAddressRaw = process.env.NEXT_PUBLIC_FARM_ADDRESS

  const tokenARaw = process.env.NEXT_PUBLIC_TOKEN_A_ADDRESS
  const tokenBRaw = process.env.NEXT_PUBLIC_TOKEN_B_ADDRESS
  const rewardTokenRaw = process.env.NEXT_PUBLIC_REWARD_TOKEN_ADDRESS

  const swapAddressOk = !!swapAddressRaw && isAddress(swapAddressRaw)
  const farmAddressOk = !!farmAddressRaw && isAddress(farmAddressRaw)

  const tokenAOk = !!tokenARaw && isAddress(tokenARaw)
  const tokenBOk = !!tokenBRaw && isAddress(tokenBRaw)
  const rewardTokenOk = !!rewardTokenRaw && isAddress(rewardTokenRaw)

  const swapAddress = swapAddressOk ? swapAddressRaw : ZERO_ADDRESS
  const farmAddress = farmAddressOk ? farmAddressRaw : ZERO_ADDRESS

  const tokenA = tokenAOk ? tokenARaw : ZERO_ADDRESS
  const tokenB = tokenBOk ? tokenBRaw : ZERO_ADDRESS
  const rewardToken = rewardTokenOk ? rewardTokenRaw : ZERO_ADDRESS

  const readEnabledBase = Boolean(isConnected && addrOk && chainOk)

  // Read token balances
  const { data: balanceTKA } = useReadContract({
    address: tokenA,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: addrOk ? [address] : undefined,
    query: { enabled: readEnabledBase && tokenAOk },
  })

  const { data: balanceTKB } = useReadContract({
    address: tokenB,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: addrOk ? [address] : undefined,
    query: { enabled: readEnabledBase && tokenBOk },
  })

  const { data: balanceDRT } = useReadContract({
    address: rewardToken,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: addrOk ? [address] : undefined,
    query: { enabled: readEnabledBase && rewardTokenOk },
  })

  // Read LP Token balance (Swap contract is also LP token)
  const { data: lpBalance } = useReadContract({
    address: swapAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: addrOk ? [address] : undefined,
    query: { enabled: readEnabledBase && swapAddressOk },
  })

  // Read Farm Pool user info
  const { data: farmPool0 } = useReadContract({
    address: farmAddress,
    abi: FARM_ABI,
    functionName: 'userInfo',
    args: addrOk ? [0n, address] : undefined,
    query: { enabled: readEnabledBase && farmAddressOk },
  })

  const { data: farmPool1 } = useReadContract({
    address: farmAddress,
    abi: FARM_ABI,
    functionName: 'userInfo',
    args: addrOk ? [1n, address] : undefined,
    query: { enabled: readEnabledBase && farmAddressOk },
  })

  const { data: farmPool2 } = useReadContract({
    address: farmAddress,
    abi: FARM_ABI,
    functionName: 'userInfo',
    args: addrOk ? [2n, address] : undefined,
    query: { enabled: readEnabledBase && farmAddressOk },
  })

  // Read pending rewards
  const { data: pendingPool0 } = useReadContract({
    address: farmAddress,
    abi: FARM_ABI,
    functionName: 'pendingReward',
    args: addrOk ? [0n, address] : undefined,
    query: { enabled: readEnabledBase && farmAddressOk },
  })

  const { data: pendingPool1 } = useReadContract({
    address: farmAddress,
    abi: FARM_ABI,
    functionName: 'pendingReward',
    args: addrOk ? [1n, address] : undefined,
    query: { enabled: readEnabledBase && farmAddressOk },
  })

  const { data: pendingPool2 } = useReadContract({
    address: farmAddress,
    abi: FARM_ABI,
    functionName: 'pendingReward',
    args: addrOk ? [2n, address] : undefined,
    query: { enabled: readEnabledBase && farmAddressOk },
  })

  // Calculate total LP holdings
  const totalLPHoldings = lpBalance ? formatUnits(lpBalance, 18, 6) : '0'

  // Calculate total staked in farms
  const totalStaked = [farmPool0, farmPool1, farmPool2].reduce((sum, pool) => {
    if (!pool) return sum
    const amountWei = pool?.[0] ?? pool?.amount ?? 0n
    return sum + Number(formatUnits(amountWei, 18, 6))
  }, 0)

  // Calculate total pending rewards
  const totalPendingRewards = [pendingPool0, pendingPool1, pendingPool2].reduce((sum, pending) => {
    if (!pending) return sum
    return sum + Number(formatUnits(pending, 18, 6))
  }, 0)

  // clear / again
  const clear = useCallback(() => {
    setPriceData(null)
    setPoolsData(null)
    setFarmData(null)
    setUiError(null)
    setErrType(null)
    setStage('idle')
  }, [])

  const loadAll = useCallback(async () => {
    const now = Date.now()
    // 防抖：300ms 内只允许一次
    if (now - lastKickRef.current < 300) return
    lastKickRef.current = now

    // in-flight 禁用
    if (inFlightRef.current) return
    inFlightRef.current = true

    setUiError(null)
    setErrType(null)
    setStage('preparing')

    const controller = new AbortController()

    try {
      // 数据读写前置校验（dashboard 的版本：链、地址）
      if (!chainOk) throw new Error('链不对：请切到 Sepolia')
      if (!addrOk) throw new Error('地址不合法：请先连接钱包')
      if (!swapAddressOk || !farmAddressOk) throw new Error('合约地址未配置或不合法')

      setStage('confirming')

      const [p, pools, farm] = await Promise.all([
        fetchJson('/api/token/price', controller.signal),
        fetchJson('/api/stake/pools', controller.signal),
        fetchJson('/api/farm/stats', controller.signal),
      ])

      setPriceData(p)
      setPoolsData(pools)
      setFarmData(farm)

      setStage('success')
    } catch (e) {
      const t = isRpcError(e) ? 'RPC 错误' : '未知'
      setErrType(t)
      setUiError(`${t}: ${toUiMsg(e)}`)
      setStage('failed')
    } finally {
      inFlightRef.current = false
    }

    return () => controller.abort()
  }, [addrOk, chainOk, farmAddressOk, swapAddressOk])

  // 初次加载
  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Charts data
  const priceChartData = priceData?.series
    ? filterDataByDays(transformDataForEcharts(priceData.series, 'ts', 'price'), priceDays)
    : []

  const tvlChartData = poolsData?.pools
    ? [
        {
          name: 'Total TVL',
          data: transformDataForEcharts(poolsData.pools[0]?.history || [], 'ts', 'tvl'),
        },
      ]
    : []

  const apyChartSeries = farmData?.apyHistory
    ? [
        {
          name: 'Pool 0',
          data: filterDataByDays(
            farmData.apyHistory.filter((item) => item.poolId === 0).map((item) => [item.ts, item.apy]),
            apyDays
          ),
        },
        {
          name: 'Pool 1',
          data: filterDataByDays(
            farmData.apyHistory.filter((item) => item.poolId === 1).map((item) => [item.ts, item.apy]),
            apyDays
          ),
        },
        {
          name: 'Pool 2',
          data: filterDataByDays(
            farmData.apyHistory.filter((item) => item.poolId === 2).map((item) => [item.ts, item.apy]),
            apyDays
          ),
        },
      ]
    : []

  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

      {uiError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {uiError}
        </div>
      )}

      {/* Wallet Balances */}
      {isConnected && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Token A Balance</div>
              <div className="text-2xl font-bold">{balanceTKA ? formatUnits(balanceTKA, 18, 4) : '0'} TKA</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Token B Balance</div>
              <div className="text-2xl font-bold">{balanceTKB ? formatUnits(balanceTKB, 18, 4) : '0'} TKB</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Reward Token Balance</div>
              <div className="text-2xl font-bold">{balanceDRT ? formatUnits(balanceDRT, 18, 4) : '0'} DRT</div>
            </div>
          </div>

          {/* LP Holdings & Farm Earnings */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-lg shadow-lg p-6 text-white">
              <div className="text-sm opacity-90 mb-1">💎 LP 持仓</div>
              <div className="text-2xl font-bold">{totalLPHoldings} LP</div>
              <div className="text-xs mt-2 opacity-80">钱包中的 LP Token</div>
            </div>
            <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-lg shadow-lg p-6 text-white">
              <div className="text-sm opacity-90 mb-1">🌾 Farm 质押</div>
              <div className="text-2xl font-bold">{totalStaked.toFixed(6)} LP</div>
              <div className="text-xs mt-2 opacity-80">已质押到 Farm 的 LP</div>
            </div>
            <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-lg shadow-lg p-6 text-white">
              <div className="text-sm opacity-90 mb-1">💰 待领取收益</div>
              <div className="text-2xl font-bold">{totalPendingRewards.toFixed(6)} DRT</div>
              <div className="text-xs mt-2 opacity-80">所有 Farm 池的总收益</div>
            </div>
          </div>
        </>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-lg p-6 text-white">
          <div className="text-sm opacity-90 mb-1">Token Price</div>
          <div className="text-3xl font-bold">${priceData?.price?.toFixed(4) || '0'}</div>
          <div className={`text-sm mt-2 ${priceData?.change24h >= 0 ? 'text-green-200' : 'text-red-200'}`}>
            {priceData?.change24h >= 0 ? '+' : ''}
            {priceData?.change24h?.toFixed(2)}% (24h)
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg shadow-lg p-6 text-white">
          <div className="text-sm opacity-90 mb-1">Total TVL</div>
          <div className="text-3xl font-bold">
            {poolsData ? formatUSD(poolsData.pools.reduce((sum, pool) => sum + parseFloat(pool.tvl), 0)) : '$0'}
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg shadow-lg p-6 text-white">
          <div className="text-sm opacity-90 mb-1">Farm TVL</div>
          <div className="text-3xl font-bold">{farmData ? formatUSD(farmData.totalValueLocked) : '$0'}</div>
        </div>

        <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg shadow-lg p-6 text-white">
          <div className="text-sm opacity-90 mb-1">Active Users</div>
          <div className="text-3xl font-bold">{farmData ? formatNumber(farmData.activeUsers) : '0'}</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Price Chart */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Token Price</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setPriceDays(7)}
                className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                  priceDays === 7 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                7天
              </button>
              <button
                onClick={() => setPriceDays(30)}
                className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                  priceDays === 30 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                30天
              </button>
            </div>
          </div>

          {priceChartData.length > 0 ? (
            <LineChartEcharts
              series={[{ name: 'Price', data: priceChartData }]}
              height={350}
              yAxisFormatter="${value}"
              areaStyle={true}
              smooth={true}
            />
          ) : (
            <div className="h-[350px] flex items-center justify-center text-gray-400">Loading price data...</div>
          )}
        </div>

        {/* TVL Chart */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Total Value Locked</h3>

          {tvlChartData.length > 0 && tvlChartData[0].data.length > 0 ? (
            <LineChartEcharts series={tvlChartData} height={350} yAxisFormatter="${value}" areaStyle={true} smooth={true} />
          ) : (
            <div className="h-[350px] flex items-center justify-center text-gray-400">Loading TVL data...</div>
          )}
        </div>
      </div>

      {/* APY Chart */}
      <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Farm APY History</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setApyDays(7)}
              className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                apyDays === 7 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              7天
            </button>
            <button
              onClick={() => setApyDays(30)}
              className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                apyDays === 30 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              30天
            </button>
          </div>
        </div>

        {apyChartSeries.length > 0 && apyChartSeries[0].data.length > 0 ? (
          <LineChartEcharts series={apyChartSeries} height={400} yAxisFormatter="{value}%" areaStyle={false} smooth={true} />
        ) : (
          <div className="h-[400px] flex items-center justify-center text-gray-400">Loading APY data...</div>
        )}
      </div>

      {/* Staking Pools */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-bold mb-4">Staking Pools</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4">Pool</th>
                <th className="text-right py-3 px-4">TVL</th>
                <th className="text-right py-3 px-4">APR</th>
                <th className="text-right py-3 px-4">Total Staked</th>
              </tr>
            </thead>
            <tbody>
              {poolsData?.pools?.map((pool) => (
                <tr key={pool.id} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4">
                    <div className="font-semibold">{pool.name}</div>
                    <div className="text-sm text-gray-600">
                      {pool.stakingToken} → {pool.rewardToken}
                    </div>
                  </td>
                  <td className="text-right py-3 px-4 font-semibold">{formatUSD(pool.tvl)}</td>
                  <td className="text-right py-3 px-4">
                    <span className="text-green-600 font-semibold">{pool.apr.toFixed(2)}%</span>
                  </td>
                  <td className="text-right py-3 px-4">{formatNumber(parseFloat(pool.totalStaked))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
