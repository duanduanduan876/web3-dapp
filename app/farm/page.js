'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  useAccount,
  useChainId,
  useWalletClient,
  usePublicClient,
  useReadContract,
} from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'

import { parseUnits, formatUnits, formatUSD } from '../../lib/utils/units'
import { formatNumber } from '../../lib/utils/format'
import ApproveButton from '../../components/ApproveButton'
import { getProtocolAddress } from '../../lib/constants'
import { FARM_ABI, ERC20_ABI } from '../../lib/abis'
import { isAddress } from 'viem'

console.log('[DEBUG] FARM_ABI length =', FARM_ABI.length)
console.log(
  '[DEBUG] FARM_ABI names =',
  FARM_ABI.filter((x) => x.type === 'function').map((x) => x.name)
)

const SUPPORTED_CHAIN_ID = 11155111
const BPS_DEBOUNCE_MS = 300

const ERC20_ALLOWANCE_ABI = [
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

function classifyError(err) {
  const msg = String(err?.shortMessage || err?.message || err || '')
  const low = msg.toLowerCase()

  // 用户拒签
  if (
    low.includes('user rejected') ||
    low.includes('user denied') ||
    low.includes('denied transaction') ||
    low.includes('rejected the request') ||
    low.includes('action_rejected') ||
    err?.name === 'UserRejectedRequestError'
  ) {
    return '用户拒签'
  }

  // 合约 revert
  if (
    low.includes('execution reverted') ||
    low.includes('revert') ||
    low.includes('insufficient') ||
    low.includes('failed to simulate') ||
    low.includes('call exception')
  ) {
    return '合约 revert'
  }

  // RPC 错误
  if (
    low.includes('network') ||
    low.includes('timeout') ||
    low.includes('timed out') ||
    low.includes('fetch') ||
    low.includes('503') ||
    low.includes('502') ||
    low.includes('500') ||
    low.includes('rpc')
  ) {
    return 'RPC 错误'
  }

  return '未知'
}

function toUiMsg(err) {
  if (!err) return '未知错误'
  if (typeof err === 'string') return err
  return String(err?.shortMessage || err?.message || '未知错误')
}

/**
 * 单个池子的卡片
 */
function FarmPoolCard({ pool, isMockMode }) {
  // 钱包 & 链信息
  const { address: userAddress, isConnected } = useAccount()
  const chainId = useChainId()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const { openConnectModal } = useConnectModal()

  const farmAddress = getProtocolAddress(chainId, 'FARM')

  const chainOk = chainId === SUPPORTED_CHAIN_ID
  const addrOk = !!userAddress && isAddress(userAddress)
  const farmAddrOk = !!farmAddress && isAddress(farmAddress)
  const lpAddrOk = !!pool.lpTokenAddress && isAddress(pool.lpTokenAddress)

  const [amount, setAmount] = useState('')
  const [activeTab, setActiveTab] = useState('deposit')

  // ===== 6 个能力：状态机 + 错误分类 + in-flight + txHash + clear + 前置校验 =====
  const [stage, setStage] = useState('idle') // idle → preparing → pendingWallet → confirming → success | failed
  const [errType, setErrType] = useState(null) // 用户拒签、RPC 错误、合约 revert、未知
  const [uiError, setUiError] = useState(null)

  const inFlightRef = useRef(false)
  const lastClickRef = useRef(0)

  const [depositHash, setDepositHash] = useState(null)
  const [withdrawHash, setWithdrawHash] = useState(null)
  const [harvestHash, setHarvestHash] = useState(null)

  const clear = useCallback(() => {
    setStage('idle')
    setErrType(null)
    setUiError(null)
    setDepositHash(null)
    setWithdrawHash(null)
    setHarvestHash(null)
    setAmount('')
  }, [])

  // ===== 启动时打 LP DEBUG 日志 =====
  useEffect(() => {
    if (!farmAddress || !pool.lpTokenAddress) return
    console.log('[LP DEBUG] =>', {
      chainId,
      farmAddress,
      lpTokenAddress: pool.lpTokenAddress,
      poolId: pool.id,
      isConnected,
      userAddress,
      isMockMode,
    })
  }, [chainId, farmAddress, pool.lpTokenAddress, pool.id, isConnected, userAddress, isMockMode])

  // ===== on–chain 读数据 =====

  // userInfo(pid, user)
  const { data: userInfo } = useReadContract({
    address: farmAddress,
    abi: FARM_ABI,
    functionName: 'userInfo',
    args: !isMockMode && addrOk && pool.id !== undefined ? [BigInt(pool.id), userAddress] : undefined,
    query: {
      enabled: !isMockMode && farmAddrOk && addrOk && pool.id !== undefined && chainOk,
    },
  })

  // pendingReward(pid, user)
  const { data: pendingReward } = useReadContract({
    address: farmAddress,
    abi: FARM_ABI,
    functionName: 'pendingReward',
    args: !isMockMode && addrOk && pool.id !== undefined ? [BigInt(pool.id), userAddress] : undefined,
    query: {
      enabled: !isMockMode && farmAddrOk && addrOk && pool.id !== undefined && chainOk,
    },
  })

  // LP 余额 balanceOf(user)
  const { data: rawLpBalance } = useReadContract({
    address: pool.lpTokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: addrOk ? [userAddress] : undefined,
    query: {
      enabled: addrOk && lpAddrOk && isConnected && !isMockMode && chainOk,
    },
  })

  // allowance(owner, spender)
  const { data: rawAllowance } = useReadContract({
    address: pool.lpTokenAddress,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: 'allowance',
    args: addrOk && farmAddrOk ? [userAddress, farmAddress] : undefined,
    query: {
      enabled: addrOk && lpAddrOk && farmAddrOk && isConnected && !isMockMode && chainOk,
    },
  })

  const userStaked = userInfo ? formatUnits(userInfo[0], 18, 6) : '0'
  const userPending = pendingReward ? formatUnits(pendingReward, 18, 6) : '0'
  const userLpBalance = rawLpBalance ? formatUnits(rawLpBalance, 18, 6) : '0'

  const stakedWei = userInfo?.[0] ?? 0n
  const lpBalWei = rawLpBalance ?? 0n
  const allowanceWei = rawAllowance ?? 0n

  // ===== 交互：Deposit / Withdraw / Harvest =====

  const canWrite =
    !isMockMode &&
    !!walletClient &&
    !!publicClient &&
    isConnected &&
    chainOk &&
    addrOk &&
    farmAddrOk &&
    pool.id !== undefined

  const handleConnectWallet = () => {
    if (openConnectModal) openConnectModal()
  }

  const guardClick = () => {
    const now = Date.now()
    if (now - lastClickRef.current < BPS_DEBOUNCE_MS) return false
    lastClickRef.current = now
    if (inFlightRef.current) return false
    inFlightRef.current = true
    return true
  }

  const releaseClick = () => {
    inFlightRef.current = false
  }

  const precheckCommon = () => {
    if (!isConnected) return { ok: false, msg: '请先连接钱包' }
    if (!chainOk) return { ok: false, msg: '链不对：请切到 Sepolia' }
    if (!addrOk) return { ok: false, msg: '地址不合法' }
    if (!farmAddrOk) return { ok: false, msg: 'Farm 合约地址不合法/缺失' }
    if (!lpAddrOk) return { ok: false, msg: 'LP Token 地址不合法/缺失' }
    if (pool.id === undefined) return { ok: false, msg: 'poolId 缺失' }
    return { ok: true }
  }

  const handleDeposit = async () => {
    if (!guardClick()) return
    setUiError(null)
    setErrType(null)

    try {
      const base = precheckCommon()
      if (!base.ok) {
        setErrType('未知')
        setUiError(base.msg)
        setStage('failed')
        return
      }
      if (!amount) return

      const amountWei = parseUnits(amount, 18)

      // 余额不足
      if (amountWei > lpBalWei) {
        setErrType('合约 revert')
        setUiError('余额不足：LP Balance 不够')
        setStage('failed')
        return
      }

      // allowance 不够
      if (amountWei > allowanceWei) {
        setErrType('合约 revert')
        setUiError('allowance 不够：请先 Approve')
        setStage('failed')
        return
      }

      setStage('preparing')
      setStage('pendingWallet')
      setDepositHash(null)

      const hash = await walletClient.writeContract({
        address: farmAddress,
        abi: FARM_ABI,
        functionName: 'deposit',
        args: [BigInt(pool.id), amountWei],
        account: userAddress,
      })

      setDepositHash(hash)
      setStage('confirming')

      await publicClient.waitForTransactionReceipt({ hash })
      setStage('success')
    } catch (err) {
      const t = classifyError(err)
      setErrType(t)
      setUiError(`${t}: ${toUiMsg(err)}`)
      setStage('failed')
    } finally {
      releaseClick()
    }
  }

  const handleWithdraw = async () => {
    if (!guardClick()) return
    setUiError(null)
    setErrType(null)

    try {
      const base = precheckCommon()
      if (!base.ok) {
        setErrType('未知')
        setUiError(base.msg)
        setStage('failed')
        return
      }
      if (!amount) return

      const amountWei = parseUnits(amount, 18)

      // 余额不足（可提取不足）
      if (amountWei > stakedWei) {
        setErrType('合约 revert')
        setUiError('余额不足：Your Staked 不够')
        setStage('failed')
        return
      }

      setStage('preparing')
      setStage('pendingWallet')
      setWithdrawHash(null)

      const hash = await walletClient.writeContract({
        address: farmAddress,
        abi: FARM_ABI,
        functionName: 'withdraw',
        args: [BigInt(pool.id), amountWei],
        account: userAddress,
      })

      setWithdrawHash(hash)
      setStage('confirming')

      await publicClient.waitForTransactionReceipt({ hash })
      setStage('success')
    } catch (err) {
      const t = classifyError(err)
      setErrType(t)
      setUiError(`${t}: ${toUiMsg(err)}`)
      setStage('failed')
    } finally {
      releaseClick()
    }
  }

  const handleHarvest = async () => {
    if (!guardClick()) return
    setUiError(null)
    setErrType(null)

    try {
      const base = precheckCommon()
      if (!base.ok) {
        setErrType('未知')
        setUiError(base.msg)
        setStage('failed')
        return
      }

      setStage('preparing')
      setStage('pendingWallet')
      setHarvestHash(null)

      const hash = await walletClient.writeContract({
        address: farmAddress,
        abi: FARM_ABI,
        functionName: 'harvest',
        args: [BigInt(pool.id)],
        account: userAddress,
      })

      setHarvestHash(hash)
      setStage('confirming')

      await publicClient.waitForTransactionReceipt({ hash })
      setStage('success')
    } catch (err) {
      const t = classifyError(err)
      setErrType(t)
      setUiError(`${t}: ${toUiMsg(err)}`)
      setStage('failed')
    } finally {
      releaseClick()
    }
  }

  const handleMax = () => {
    if (activeTab === 'deposit') setAmount(userLpBalance)
    else setAmount(userStaked)
  }

  const txHash = depositHash || withdrawHash || harvestHash
  const isBusy = stage === 'preparing' || stage === 'pendingWallet' || stage === 'confirming'
  const canInteract = canWrite && !isBusy

  // 只要有一件为真，这个按钮应该被禁用
  const isDepositDisabled = !amount || !canInteract || activeTab !== 'deposit'
  const isWithdrawDisabled = !amount || !canInteract || activeTab !== 'withdraw'
  const isHarvestDisabled = !canInteract || parseFloat(userPending) === 0

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 mb-4">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-xl font-bold">{pool.name}</h3>
          <p className="text-sm text-gray-600">{pool.lpToken}</p>
        </div>
        <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-semibold">
          {pool.apy.toFixed(2)}% APY
        </span>
      </div>

      {/* 错误提示 */}
      {uiError && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {uiError}
        </div>
      )}

      {/* 成功提示 + clear / again */}
      {(stage === 'success' || stage === 'failed') && (
        <div className="mb-3 flex items-center justify-between p-3 bg-gray-50 border rounded-lg">
          <div className="text-sm text-gray-700">
            状态：{stage}
            {errType ? `（${errType}）` : ''}
          </div>
          <button onClick={clear} className="text-sm text-blue-600 hover:underline">
            clear / again
          </button>
        </div>
      )}

      {/* Pool Stats */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-xs text-gray-600 mb-1">TVL</div>
          <div className="text-lg font-semibold">{formatUSD(pool.tvl)}</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-xs text-gray-600 mb-1">Your Staked</div>
          <div className="text-lg font-semibold">{userStaked} LP</div>
        </div>
        <div className="bg-blue-50 rounded-lg p-3">
          <div className="text-xs text-blue-600 mb-1">LP Balance</div>
          <div className="text-lg font-semibold text-blue-700">{userLpBalance} LP</div>
        </div>
      </div>

      {/* Pending Rewards */}
      <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 rounded-lg p-4 mb-4">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-sm text-gray-600 mb-1">Pending Rewards</div>
            <div className="text-2xl font-bold text-orange-600">{userPending} DRT</div>
          </div>
          {!isMockMode ? (
            <button
              onClick={handleHarvest}
              disabled={isHarvestDisabled}
              className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              {stage === 'pendingWallet' || stage === 'confirming' ? 'Harvesting...' : 'Harvest'}
            </button>
          ) : (
            <button disabled className="bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg cursor-not-allowed">
              Harvest (Mock)
            </button>
          )}
        </div>
      </div>

      {/* 交易证据：txHash 展示 + 浏览器链接 */}
      {txHash && (
        <div className="mb-2 text-xs text-green-700">
          txHash:{' '}
          <a
            href={`https://sepolia.etherscan.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            view on Etherscan
          </a>
        </div>
      )}

      {/* Deposit / Withdraw Tabs */}
      <div className="border-t pt-4">
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setActiveTab('deposit')}
            className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-colors ${
              activeTab === 'deposit'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Deposit
          </button>
          <button
            onClick={() => setActiveTab('withdraw')}
            className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-colors ${
              activeTab === 'withdraw'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Withdraw
          </button>
        </div>

        {/* Amount Input */}
        <div className="mb-4">
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="flex justify-between mb-2">
              <label className="text-sm text-gray-600">
                {activeTab === 'deposit' ? 'Deposit Amount' : 'Withdraw Amount'}
              </label>
              <button onClick={handleMax} className="text-sm text-blue-600">
                Balance: {activeTab === 'deposit' ? userLpBalance : userStaked}
              </button>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                className="flex-1 text-xl font-semibold bg-transparent outline-none"
              />
              <div className="bg-white border rounded-lg px-3 py-2 font-semibold text-sm">LP</div>
            </div>
          </div>
        </div>

        {/* Action Button */}
        {!userAddress ? (
          <button
            onClick={handleConnectWallet}
            className="w-full bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg"
          >
            Connect Wallet
          </button>
        ) : isMockMode ? (
          <button
            disabled
            className="w-full bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg cursor-not-allowed"
          >
            {activeTab === 'deposit' ? 'Deposit' : 'Withdraw'} (Mock Mode)
          </button>
        ) : activeTab === 'deposit' ? (
          <ApproveButton
            tokenAddress={pool.lpTokenAddress}
            spenderAddress={farmAddress}
            amount={amount ? parseUnits(amount, 18) : 0n}
            disabled={isDepositDisabled}
          >
            <button
              onClick={handleDeposit}
              disabled={isDepositDisabled}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              {stage === 'pendingWallet' || stage === 'confirming' ? 'Depositing...' : 'Deposit'}
            </button>
          </ApproveButton>
        ) : (
          <button
            onClick={handleWithdraw}
            disabled={isWithdrawDisabled}
            className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            {stage === 'pendingWallet' || stage === 'confirming' ? 'Withdrawing...' : 'Withdraw'}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Farm 总页面
 */
export default function FarmPage() {
  const chainId = useChainId()
  const farmAddress = getProtocolAddress(chainId, 'FARM')
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()

  const [farmData, setFarmData] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isMockMode, setIsMockMode] = useState(false)

  const handleConnectWallet = () => {
    if (openConnectModal) openConnectModal()
  }

  useEffect(() => {
    setIsLoading(true)
    setError(null)

    fetch('/api/farm/stats')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch farm data')
        return res.json()
      })
      .then((data) => {
        setFarmData(data)
        setIsMockMode(!farmAddress)
        setIsLoading(false)
      })
      .catch((err) => {
        console.error('Error fetching farm data:', err)
        setError(err.message)
        setIsLoading(false)
      })
  }, [farmAddress])

  const shortAddress = (addr) => (addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '')

  if (isLoading) {
    return (
      <div className="container py-12">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold">Farm</h1>
          </div>
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
            <p className="text-gray-600">别急等会</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container py-12">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold">Farm</h1>
            <button
              onClick={handleConnectWallet}
              className="bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg"
            >
              {isConnected ? shortAddress(address) : 'Connect Wallet'}
            </button>
          </div>
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <p className="text-xl font-semibold text-gray-800 mb-2">Error Loading Farm Data</p>
            <p className="text-gray-600">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!farmData || !farmData.pools || farmData.pools.length === 0) {
    return (
      <div className="container py-12">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold">Farm</h1>
            <button
              onClick={handleConnectWallet}
              className="bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg"
            >
              {isConnected ? shortAddress(address) : 'Connect Wallet'}
            </button>
          </div>
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <p className="text-xl font-semibold text-gray-800 mb-2">No Farm Pools Available</p>
            <p className="text-gray-600">Check back later for farming opportunities</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container py-12">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Farm</h1>
            <p className="text-gray-600">Stake LP tokens to earn DRT rewards</p>
          </div>
          <button
            onClick={handleConnectWallet}
            className="bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg"
          >
            {isConnected ? shortAddress(address) : 'Connect Wallet'}
          </button>
        </div>

        {/* Mock Mode 提示 */}
        {isMockMode && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="font-semibold text-yellow-800">Mock Mode Active</p>
            <p className="text-sm text-yellow-700">
              Farm contract not deployed or unavailable. Displaying simulated data. Transactions are disabled.
            </p>
          </div>
        )}

        {/* Overall Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg shadow-lg p-6 text-white">
            <div className="text-sm opacity-90 mb-1">Total Value Locked</div>
            <div className="text-3xl font-bold">{formatUSD(farmData.totalValueLocked)}</div>
          </div>

          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-lg p-6 text-white">
            <div className="text-sm opacity-90 mb-1">Active Farms</div>
            <div className="text-3xl font-bold">{farmData.pools.length}</div>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg shadow-lg p-6 text-white">
            <div className="text-sm opacity-90 mb-1">Active Users</div>
            <div className="text-3xl font-bold">{formatNumber(farmData.activeUsers)}</div>
          </div>
        </div>

        {/* Farm Pools */}
        <div>
          <h2 className="text-xl font-bold mb-4">Available Pools</h2>
          {farmData.pools.map((pool, index) => (
            <FarmPoolCard
              key={pool.id ?? `pool-${index}`}
              pool={pool}
              isMockMode={isMockMode}
            />
          ))}
        </div>
      </div>
    </div>
  )
}






