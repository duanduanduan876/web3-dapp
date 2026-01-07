'use client'

import { useState, useEffect } from 'react'
import {
  useAccount,
  useChainId,
  useWalletClient,
  usePublicClient,
  useReadContract,
} from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'

import {
  parseUnits,
  formatUnits,
  formatUSD,
} from '../../lib/utils/units'
import { formatNumber } from '../../lib/utils/format'
import ApproveButton from '../../components/ApproveButton'
import { getProtocolAddress } from '../../lib/constants'
import { FARM_ABI, ERC20_ABI } from '../../lib/abis'

console.log('[DEBUG] FARM_ABI length =', FARM_ABI.length)
console.log(
  '[DEBUG] FARM_ABI names =',
  FARM_ABI.filter((x) => x.type === 'function').map((x) => x.name)
)

/**
 * 单个池子的卡片
 */
function FarmPoolCard({ pool, isMockMode }) {
  // 钱包 & 链信息
  const { address: userAddress, isConnected, chainId } = useAccount()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const { openConnectModal } = useConnectModal()

  const farmAddress = getProtocolAddress(chainId, 'FARM')

  const [amount, setAmount] = useState('')
  const [activeTab, setActiveTab] = useState(
    'deposit',
  )

  const [isDepositing, setIsDepositing] = useState(false)
  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const [isHarvesting, setIsHarvesting] = useState(false)

  const [depositHash, setDepositHash] = useState(null)
  const [withdrawHash, setWithdrawHash] = useState(null)
  const [harvestHash, setHarvestHash] = useState(null)

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
  }, [
    chainId,
    farmAddress,
    pool.lpTokenAddress,
    pool.id,
    isConnected,
    userAddress,
    isMockMode,
  ])

  // ===== on–chain 读数据 =====

  // userInfo(pid, user)
  const { data: userInfo } = useReadContract({
    address: farmAddress,
    abi: FARM_ABI,
    functionName: 'userInfo',
    args:
      !isMockMode && userAddress && pool.id !== undefined
        ? [BigInt(pool.id), userAddress]
        : undefined,
    query: {
      //enabled: false → 这个 hook 不会真的发请求
      //enabled: true → 才真正根据 address + abi + functionName + args 去读链上数据
      enabled:
        !isMockMode &&
        !!farmAddress &&
        !!userAddress &&
        pool.id !== undefined,
    },
  })

  // pendingReward(pid, user)
  const { data: pendingReward } = useReadContract({
    address: farmAddress,
    abi: FARM_ABI,
    functionName: 'pendingReward',
    args:
      !isMockMode && userAddress && pool.id !== undefined
        ? [BigInt(pool.id), userAddress]
        : undefined,
    query: {
      enabled:
        !isMockMode &&
        !!farmAddress &&
        !!userAddress &&
        pool.id !== undefined,
    },
  })

  // LP 余额 balanceOf(user)
  const { data: rawLpBalance } = useReadContract({
    address: pool.lpTokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled:
        !!userAddress &&
        !!pool.lpTokenAddress &&
        isConnected &&
        !isMockMode,
    },
  })
  
  //“编码 + 构造 JSON-RPC” 是 viem / publicClient 干的；
  const userStaked = userInfo ? formatUnits(userInfo[0], 18, 6) : '0'
  const userPending = pendingReward
    ? formatUnits(pendingReward, 18, 6)
    : '0'
  const userLpBalance = rawLpBalance
    ? formatUnits(rawLpBalance, 18, 6)
    : '0'

  // ===== 交互：Deposit / Withdraw / Harvest =====

  const canWrite =
    !isMockMode && !!walletClient && !!userAddress && !!farmAddress

  const handleConnectWallet = () => {
    if (openConnectModal) openConnectModal()
  }

  const handleDeposit = async () => {
    if (!canWrite) {
      console.error('[DEPOSIT] write blocked', {
        isMockMode,
        walletClient: !!walletClient,
        userAddress,
        farmAddress,
      })
      return
    }
    if (!amount || pool.id === undefined) return

    const amountWei = parseUnits(amount, 18)

    console.log('[CLICK] handleDeposit', {
      amount,
      amountWei,
      farmAddress,
      poolId: pool.id,
      userAddress,
      chainId,
    })

    try {
      setIsDepositing(true)
      setDepositHash(null)

      const hash = await walletClient.writeContract({
        //readContract / writeContract 方法
        //调用 viem 的编码函数，把你传的 abi + functionName + args 编成 data；
        //拼 JSON-RPC 请求（eth_call / eth_sendTransaction / eth_sendRawTransaction）；
        //用 transport 发给“RPC 节点”或者“钱包 provider”。
        address: farmAddress,
        abi: FARM_ABI,
        functionName: 'deposit',
        args: [BigInt(pool.id), amountWei],
        account: userAddress,
      })

      console.log('[TX] deposit hash', hash)
      //返回 hash → 存 state → 触发重渲染 → UI 出现“view on Etherscan”。
      setDepositHash(hash)

      await publicClient.waitForTransactionReceipt({ hash })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      //不断调用节点的 eth_getTransactionReceipt，轮询这笔 hash

      console.log('[RECEIPT] deposit', receipt)

    } catch (err) {
      console.error('[ERR] deposit', err)
    } finally {
      setIsDepositing(false)
    }
  }

  const handleWithdraw = async () => {
    if (!canWrite) return
    if (!amount || pool.id === undefined) return

    const amountWei = parseUnits(amount, 18)

    console.log('[CLICK] handleWithdraw', {
      amount,
      amountWei,
      farmAddress,
      poolId: pool.id,
      userAddress,
      chainId,
    })

    try {
      setIsWithdrawing(true)
      setWithdrawHash(null)

      const hash = await walletClient.writeContract({
        address: farmAddress,
        abi: FARM_ABI,
        functionName: 'withdraw',
        args: [BigInt(pool.id), amountWei],
        account: userAddress,
      })

      console.log('[TX] withdraw hash', hash)
      setWithdrawHash(hash)
      await publicClient.waitForTransactionReceipt({ hash })
    } catch (err) {
      console.error('[ERR] withdraw', err)
    } finally {
      setIsWithdrawing(false)
    }
  }

  const handleHarvest = async () => {
    if (!canWrite) return
    if (pool.id === undefined) return

    console.log('[CLICK] handleHarvest', {
      farmAddress,
      poolId: pool.id,
      userAddress,
      chainId,
    })

    try {
      setIsHarvesting(true)
      setHarvestHash(null)

      const hash = await walletClient.writeContract({
        address: farmAddress,
        abi: FARM_ABI,
        functionName: 'harvest',
        args: [BigInt(pool.id)],
        account: userAddress,
      })

      console.log('[TX] harvest hash', hash)
      setHarvestHash(hash)
      await publicClient.waitForTransactionReceipt({ hash })
    } catch (err) {
      console.error('[ERR] harvest', err)
    } finally {
      setIsHarvesting(false)
    }
  }

  const handleMax = () => {
    if (activeTab === 'deposit') setAmount(userLpBalance)
    else setAmount(userStaked)
  }
  
  //只要有一件为真，这个deposit就应该被禁用
  const isDepositDisabled =
    !amount || isDepositing || !canWrite

  const isWithdrawDisabled =
    !amount || isWithdrawing || !canWrite

  // ===== UI =====
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

      {/* Pool Stats */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-xs text-gray-600 mb-1">TVL</div>
          <div className="text-lg font-semibold">
            {formatUSD(pool.tvl)}
          </div>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-xs text-gray-600 mb-1">Your Staked</div>
          <div className="text-lg font-semibold">{userStaked} LP</div>
        </div>
        <div className="bg-blue-50 rounded-lg p-3">
          <div className="text-xs text-blue-600 mb-1">LP Balance</div>
          <div className="text-lg font-semibold text-blue-700">
            {userLpBalance} LP
          </div>
        </div>
      </div>

      {/* Pending Rewards */}
      <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 rounded-lg p-4 mb-4">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-sm text-gray-600 mb-1">
              Pending Rewards
            </div>
            <div className="text-2xl font-bold text-orange-600">
              {userPending} DRT
            </div>
          </div>
          {!isMockMode ? (
            <button
              onClick={handleHarvest}
              disabled={
                isHarvesting ||
                parseFloat(userPending) === 0 ||
                !canWrite
              }
              className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              {isHarvesting ? 'Harvesting...' : 'Harvest'}
            </button>
          ) : (
            <button
              disabled
              className="bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg cursor-not-allowed"
            >
              Harvest (Mock)
            </button>
          )}
        </div>
      </div>

      {/* Tx 成功提示（简单版） */}
      {depositHash && (
        <div className="mb-2 text-xs text-green-700">
          Deposit tx:{' '}
          <a
            href={`https://sepolia.etherscan.io/tx/${depositHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            view on Etherscan
          </a>
        </div>
      )}
      {withdrawHash && (
        <div className="mb-2 text-xs text-green-700">
          Withdraw tx:{' '}
          <a
            href={`https://sepolia.etherscan.io/tx/${withdrawHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            view on Etherscan
          </a>
        </div>
      )}
      {harvestHash && (
        <div className="mb-2 text-xs text-green-700">
          Harvest tx:{' '}
          <a
            href={`https://sepolia.etherscan.io/tx/${harvestHash}`}
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
                {activeTab === 'deposit'
                  ? 'Deposit Amount'
                  : 'Withdraw Amount'}
              </label>
              <button
                onClick={handleMax}
                className="text-sm text-blue-600"
              >
                Balance:{' '}
                {activeTab === 'deposit'
                  ? userLpBalance
                  : userStaked}
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
              <div className="bg-white border rounded-lg px-3 py-2 font-semibold text-sm">
                LP
              </div>
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
            {activeTab === 'deposit' ? 'Deposit' : 'Withdraw'} (Mock
            Mode)
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
              {isDepositing ? 'Depositing...' : 'Deposit'}
            </button>
          </ApproveButton>
        ) : (
          <button
            onClick={handleWithdraw}
            disabled={isWithdrawDisabled}
            className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            {isWithdrawing ? 'Withdrawing...' : 'Withdraw'}
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
  //首次渲染，先运行hooks
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
  //首轮提交dom后，useEffect会执行
  //React 的调度逻辑就是：“提交 fiber → 刷新 DOM → 再异步执行本轮所有 useEffect 回调”。
  useEffect(() => {
    setIsLoading(true)
    //把旧的错误清理掉
    setError(null)

    fetch('/api/farm/stats')
    //HTTP 非 2xx 就是 res.ok === false
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
  }, [farmAddress])//第一次挂载完后执行一次
  
  //如果address有值，取前6个字符，再去后4个字符，中间加上...
  const shortAddress = (addr) =>
  addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : ''

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
  //允许用户随时连接钱包（这是 UI 的常规入口，和后端是否报错没强绑定）
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
            <p className="text-xl font-semibold text-gray-800 mb-2">
              Error Loading Farm Data
            </p>
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
            <p className="text-xl font-semibold text-gray-800 mb-2">
              No Farm Pools Available
            </p>
            <p className="text-gray-600">
              Check back later for farming opportunities
            </p>
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
            <p className="text-gray-600">
              Stake LP tokens to earn DRT rewards
            </p>
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
            <p className="font-semibold text-yellow-800">
              Mock Mode Active
            </p>
            <p className="text-sm text-yellow-700">
              Farm contract not deployed or unavailable. Displaying
              simulated data. Transactions are disabled.
            </p>
          </div>
        )}

        {/* Overall Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg shadow-lg p-6 text-white">
            <div className="text-sm opacity-90 mb-1">
              Total Value Locked
            </div>
            <div className="text-3xl font-bold">
              {formatUSD(farmData.totalValueLocked)}
            </div>
          </div>

          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-lg p-6 text-white">
            <div className="text-sm opacity-90 mb-1">Active Farms</div>
            <div className="text-3xl font-bold">
              {farmData.pools.length}
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg shadow-lg p-6 text-white">
            <div className="text-sm opacity-90 mb-1">Active Users</div>
            <div className="text-3xl font-bold">
              {formatNumber(farmData.activeUsers)}
            </div>
          </div>
        </div>

        {/* Farm Pools */}
        <div>
          <h2 className="text-xl font-bold mb-4">Available Pools</h2>
          {farmData.pools.map((pool, index) => (
            //map((pool, index)会对数组里的每一个元素执行一次回调，当前这条池子的数据对象
            <FarmPoolCard
            //返回的是一组卡片组件的数组
              key={pool.id ?? `pool-${index}`}//key是列表项用来识别的稳定标识
              pool={pool}
              isMockMode={isMockMode}
            />
          ))}
        </div>
      </div>
    </div>
  )
}





