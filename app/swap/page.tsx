'use client'

import { useState, useEffect, useRef } from 'react'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
  useChainId,
} from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { isAddress, type Address, type Hex } from 'viem'

import { parseUnits, formatUnits } from '../../lib/utils/units'
import ApproveButton from '../../components/ApproveButton'
import { TOKENS, getTokenAddress, getProtocolAddress } from '../../lib/constants'
import { SWAP_ABI } from '../../lib/abis'
import { sepolia } from 'viem/chains'

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
] as const

type Stage = 'idle' | 'preparing' | 'pendingWallet' | 'confirming' | 'success' | 'failed'
type ErrType = '用户拒签' | 'RPC 错误' | '合约 revert' | '未知' | null

function isUserRejected(err: any): boolean {
  const code = err?.code
  const name = String(err?.name || '')
  const msg = String(err?.shortMessage || err?.message || '')
  return code === 4001 || name.includes('UserRejected') || msg.toLowerCase().includes('rejected')
}

function isRevert(err: any): boolean {
  const name = String(err?.name || '')
  const msg = String(err?.shortMessage || err?.message || '')
  const low = msg.toLowerCase()
  return (
    name.includes('ContractFunctionExecutionError') ||
    name.includes('CallExecutionError') ||
    low.includes('execution reverted') ||
    low.includes('revert')
  )
}

function isRpcError(err: any): boolean {
  const msg = String(err?.shortMessage || err?.message || '')
  const low = msg.toLowerCase()
  return (
    low.includes('rpc') ||
    low.includes('json-rpc') ||
    low.includes('timeout') ||
    low.includes('timed out') ||
    low.includes('rate limit') ||
    low.includes('429') ||
    low.includes('network error')
  )
}

function toUiMsg(err: any): string {
  if (!err) return '未知错误'
  if (typeof err === 'string') return err
  return String(err?.shortMessage || err?.message || '未知错误')
}

const BPS_DENOM = 10_000n
function slippageToBps(s: number): bigint {
  return BigInt(Math.round(Number(s) * 100))
}

export default function SwapPage() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { openConnectModal } = useConnectModal()

  const SUPPORTED_CHAIN_ID = 11155111
  const chainOk = chainId === SUPPORTED_CHAIN_ID

  const { switchChainAsync, isPending: isSwitching } = useSwitchChain()

  const [tokenIn, setTokenIn] = useState('TKA')
  const [tokenOut, setTokenOut] = useState('TKB')
  const [amountIn, setAmountIn] = useState('')
  const [amountOut, setAmountOut] = useState('')

  const [slippage, setSlippage] = useState(0.5)
  const [showSlippageModal, setShowSlippageModal] = useState(false)
  const [customSlippage, setCustomSlippage] = useState('')

  const [uiError, setUiError] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [errType, setErrType] = useState<ErrType>(null)
  const [txHash, setTxHash] = useState<Hex | null>(null)

  const lastClickAtRef = useRef(0)

  const tokenInData = { ...TOKENS[tokenIn], address: getTokenAddress(SUPPORTED_CHAIN_ID, tokenIn) }
  const tokenOutData = { ...TOKENS[tokenOut], address: getTokenAddress(SUPPORTED_CHAIN_ID, tokenOut) }
  const swapAddress = getProtocolAddress(SUPPORTED_CHAIN_ID, 'SWAP')

  const isMockMode = !swapAddress

  const amountInValid = !!amountIn && !Number.isNaN(Number(amountIn)) && Number(amountIn) > 0

  const tokenInAddrOk = !!tokenInData?.address && isAddress(tokenInData.address)
  const tokenOutAddrOk = !!tokenOutData?.address && isAddress(tokenOutData.address)
  const swapAddrOk = !!swapAddress && isAddress(swapAddress)

  const amountInWei =
    amountInValid && tokenInData?.decimals != null ? parseUnits(amountIn, tokenInData.decimals) : 0n

  const explorerTxUrl = txHash ? `https://sepolia.etherscan.io/tx/${txHash}` : null

  const inFlight = stage === 'preparing' || stage === 'pendingWallet' || stage === 'confirming'

  const resetAfterSuccess = () => {
    setUiError(null)
    setErrType(null)
    setStage('idle')
    setTxHash(null)
    setAmountIn('')
    setAmountOut('')
  }

  useEffect(() => {
    if (stage === 'success') return
    if (stage === 'failed') return
    if (txHash) return
    setStage('idle')
  }, [stage, txHash])

  const { data: reserves } = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: (swapAddress ?? '0x0000000000000000000000000000000000000000') as Address,
    abi: SWAP_ABI,
    functionName: 'getReserves',
    query: { enabled: swapAddrOk },
  })

  const { data: chainQuote, isError: isQuoteError } = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: (swapAddress ?? '0x0000000000000000000000000000000000000000') as Address,
    abi: SWAP_ABI,
    functionName: 'getAmountOut',
    args:
      amountInValid && tokenInAddrOk
        ? [(tokenInData.address as Address) ?? '0x0000000000000000000000000000000000000000', amountInWei]
        : undefined,
    query: { enabled: swapAddrOk && amountInValid && tokenInAddrOk },
  })

  const { data: balIn } = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: (tokenInData.address ?? '0x0000000000000000000000000000000000000000') as Address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address as Address] : undefined,
    query: { enabled: !!address && tokenInAddrOk },
  })

  const { data: allowanceIn } = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: (tokenInData.address ?? '0x0000000000000000000000000000000000000000') as Address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && swapAddrOk ? [address as Address, swapAddress as Address] : undefined,
    query: { enabled: !!address && tokenInAddrOk && swapAddrOk },
  })

  const balanceEnough = typeof balIn === 'bigint' ? balIn >= amountInWei : true
  const allowanceEnough = typeof allowanceIn === 'bigint' ? allowanceIn >= amountInWei : true

  const { writeContractAsync, isPending: isWalletPending } = useWriteContract()

  const {
    isLoading: isConfirming,
    isSuccess: isSwapSuccess,
    isError: isReceiptError,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    query: { enabled: !!txHash },
  })

  useEffect(() => {
    if (!txHash) return

    if (isConfirming) setStage('confirming')

    if (isSwapSuccess) {
      setStage('success')
      setErrType(null)
      setUiError(null)
    }

    if (isReceiptError) {
      const e = receiptError
      let t: ErrType = '未知'
      if (isUserRejected(e)) t = '用户拒签'
      else if (isRevert(e)) t = '合约 revert'
      else if (isRpcError(e)) t = 'RPC 错误'
      setErrType(t)
      setUiError(`${t}: ${toUiMsg(e)}`)
      setStage('failed')
    }
  }, [txHash, isConfirming, isSwapSuccess, isReceiptError, receiptError])

  useEffect(() => {
    if (!amountIn || parseFloat(amountIn) <= 0) {
      setAmountOut('')
      return
    }
    if (chainQuote && !isQuoteError) {
      setAmountOut(formatUnits(chainQuote as bigint, tokenOutData.decimals))
    } else {
      setAmountOut('')
    }
  }, [amountIn, chainQuote, isQuoteError, tokenIn, tokenInData, tokenOutData])

  const canSwap =
    Boolean(
      swapAddrOk &&
        tokenInAddrOk &&
        tokenOutAddrOk &&
        isConnected &&
        chainOk &&
        amountInValid &&
        chainQuote &&
        !isQuoteError &&
        balanceEnough &&
        allowanceEnough &&
        !inFlight &&
        !isSwitching &&
        !isWalletPending
    ) && stage !== 'success'

  async function handleSwap() {
    const now = Date.now()
    if (now - lastClickAtRef.current < 800) return
    lastClickAtRef.current = now

    if (stage === 'success') {
      resetAfterSuccess()
      return
    }

    setUiError(null)
    setErrType(null)

    if (!isConnected) {
      openConnectModal?.()
      return
    }

    if (!chainOk) {
      setStage('preparing')
      try {
        await switchChainAsync({ chainId: SUPPORTED_CHAIN_ID })
      } catch (e: any) {
        const t: ErrType = isUserRejected(e) ? '用户拒签' : isRpcError(e) ? 'RPC 错误' : '未知'
        setErrType(t)
        setUiError(`${t}: 切链失败`)
        setStage('failed')
      }
      return
    }

    setStage('preparing')

    if (!swapAddrOk) {
      setErrType('未知')
      setUiError('未知: SWAP 合约地址缺失或不合法')
      setStage('failed')
      return
    }

    if (!tokenInAddrOk || !tokenOutAddrOk) {
      setErrType('未知')
      setUiError('未知: Token 地址不合法')
      setStage('failed')
      return
    }

    if (!address || !isAddress(address)) {
      setErrType('未知')
      setUiError('未知: 钱包地址不合法')
      setStage('failed')
      return
    }

    if (!amountInValid) {
      setErrType('未知')
      setUiError('未知: 请输入有效的 amountIn')
      setStage('failed')
      return
    }

    if (!chainQuote || isQuoteError) {
      setErrType('RPC 错误')
      setUiError('RPC 错误: 当前无法获取链上报价')
      setStage('failed')
      return
    }

    if (!balanceEnough) {
      setErrType('未知')
      setUiError('未知: 余额不足')
      setStage('failed')
      return
    }

    if (!allowanceEnough) {
      setErrType('未知')
      setUiError('未知: allowance 不够，请先 approve')
      setStage('failed')
      return
    }

    const bps = slippageToBps(slippage)
    const minOutWei = ((chainQuote as bigint) * (BPS_DENOM - bps)) / BPS_DENOM
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 5)

    try {
      setStage('pendingWallet')
      setTxHash(null)

      const h = await writeContractAsync({
        chain: sepolia,
        chainId: SUPPORTED_CHAIN_ID,
        account: address as Address,
        address: swapAddress as Address,
        abi: SWAP_ABI,
        functionName: 'swap',
        args: [tokenInData.address as Address, amountInWei, minOutWei, address as Address, deadline],
      })

      setTxHash(h as Hex)
      setStage('confirming')
    } catch (e: any) {
      let t: ErrType = '未知'
      if (isUserRejected(e)) t = '用户拒签'
      else if (isRevert(e)) t = '合约 revert'
      else if (isRpcError(e)) t = 'RPC 错误'
      setErrType(t)
      setUiError(`${t}: ${toUiMsg(e)}`)
      setStage('failed')
    }
  }

  const switchTokens = () => {
    setTokenIn(tokenOut)
    setTokenOut(tokenIn)
    setAmountIn(amountOut)
    setAmountOut('')
  }

  const handleApproved = () => {
    setUiError(null)
    setErrType(null)
  }

  const minAmountOut =
    chainQuote && !isQuoteError
      ? formatUnits(((chainQuote as bigint) * (BPS_DENOM - slippageToBps(slippage))) / BPS_DENOM, tokenOutData.decimals)
      : '0'

  const reserveIn = reserves ? formatUnits((reserves as any)[tokenIn === 'TKA' ? 0 : 1], tokenInData.decimals) : '0'
  const priceImpact =
    reserves && amountInValid && Number(reserveIn) > 0 ? ((Number(amountIn) / Number(reserveIn)) * 100).toFixed(2) : '0'

  const slippagePresets = [0.1, 0.5, 1.0]

  const handleSlippagePreset = (value: number) => {
    setSlippage(value)
    setCustomSlippage('')
  }

  const handleCustomSlippage = (value: string) => {
    setCustomSlippage(value)
    const numValue = parseFloat(value)
    if (!isNaN(numValue) && numValue >= 0 && numValue <= 50) {
      setSlippage(numValue)
    }
  }

  const actionLabel =
    stage === 'success'
      ? '再来一笔'
      : stage === 'preparing'
      ? '准备中...'
      : stage === 'pendingWallet'
      ? '等待钱包确认...'
      : stage === 'confirming'
      ? '链上确认中...'
      : stage === 'failed'
      ? '重试'
      : isSwitching
      ? '切链中...'
      : '交换'

  const actionDisabled =
    stage === 'success'
      ? false
      : !canSwap || inFlight || isWalletPending || isConfirming || isSwitching || !amountOut

  return (
    <div className="container max-w-lg mx-auto py-12">
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">swap</h1>
          <div className="flex items-center gap-2">
            {isMockMode && (
              <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">Mock Mode</span>
            )}
            <button
              onClick={() => setShowSlippageModal(true)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Settings"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="mb-4">
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="flex justify-between mb-2">
              <label className="text-sm text-gray-600">From</label>
              <button className="text-sm text-blue-600">Max</button>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={amountIn}
                onChange={(e) => setAmountIn(e.target.value)}
                placeholder="0.0"
                className="flex-1 text-2xl font-semibold bg-transparent outline-none"
              />
              <select
                value={tokenIn}
                onChange={(e) => setTokenIn(e.target.value)}
                className="bg-white border rounded-lg px-3 py-2 font-semibold"
              >
                {Object.keys(TOKENS).map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {symbol}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-center -my-2 relative z-10">
          <button
            onClick={switchTokens}
            className="bg-white border-4 border-gray-50 rounded-xl p-2 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        {uiError && <div style={{ color: 'red', marginTop: 8 }}>{uiError}</div>}

        <div className="mb-6">
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="flex justify-between mb-2">
              <label className="text-sm text-gray-600">To</label>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={amountOut}
                readOnly
                placeholder="0.0"
                className="flex-1 text-2xl font-semibold bg-transparent outline-none text-gray-600"
              />
              <select
                value={tokenOut}
                onChange={(e) => setTokenOut(e.target.value)}
                className="bg-white border rounded-lg px-3 py-2 font-semibold"
              >
                {Object.keys(TOKENS)
                  .filter((s) => s !== tokenIn)
                  .map((symbol) => (
                    <option key={symbol} value={symbol}>
                      {symbol}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        </div>

        {amountOut && (
          <div className="mb-4 space-y-2">
            <div className="p-3 bg-blue-50 rounded-lg space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Rate</span>
                <span className="font-semibold">
                  1 {tokenIn} = {(parseFloat(amountOut) / parseFloat(amountIn)).toFixed(4)} {tokenOut}
                </span>
              </div>
              {reserves && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Liquidity</span>
                    <span className="font-semibold">
                      ${((Number((reserves as any)[0]) + Number((reserves as any)[1])) / 1e18 * 1.5).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Price Impact</span>
                    <span
                      className={`font-semibold ${
                        parseFloat(priceImpact) > 5 ? 'text-red-600' : parseFloat(priceImpact) > 2 ? 'text-yellow-600' : 'text-green-600'
                      }`}
                    >
                      {priceImpact}%
                    </span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Slippage Tolerance</span>
                <span className="font-semibold">{slippage}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Minimum Received</span>
                <span className="font-semibold">
                  {minAmountOut} {tokenOut}
                </span>
              </div>
            </div>
            {parseFloat(priceImpact) > 5 && (
              <div className="p-2 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs text-red-800">⚠️ High price impact! Consider a smaller amount.</p>
              </div>
            )}
          </div>
        )}

        {!isConnected ? (
          <button
            type="button"
            onClick={openConnectModal}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            连接钱包
          </button>
        ) : !swapAddress ? (
          <button
            type="button"
            disabled
            className="w-full bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg cursor-not-allowed"
          >
            Swap 合约不可用
          </button>
        ) : (
          <ApproveButton
            tokenAddress={tokenInData?.address}
            spenderAddress={swapAddress}
            amount={amountInValid ? amountInWei : 0n}
            onApproved={handleApproved}
            disabled={!amountInValid || !amountOut || inFlight || isSwitching || !chainOk}
          >
            <button
              type="button"
              onClick={handleSwap}
              disabled={actionDisabled}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              {actionLabel}
            </button>
          </ApproveButton>
        )}

        {txHash && (
          <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <p className="text-gray-800 font-semibold">TxHash</p>
            <p className="text-xs text-gray-600 font-mono break-all">{txHash}</p>
            {explorerTxUrl && (
              <a
                href={explorerTxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline"
              >
                View on Etherscan →
              </a>
            )}
          </div>
        )}

        {isSwapSuccess && (
          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-green-800 font-semibold">Swap Successful!</p>
            {explorerTxUrl && (
              <a
                href={explorerTxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline"
              >
                View on Etherscan →
              </a>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 p-4 bg-gray-50 rounded-lg">
        <h3 className="font-semibold mb-2">How it works</h3>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• Select tokens to swap</li>
          <li>• Enter amount and get instant quote</li>
          <li>• Approve token spending (one-time)</li>
          <li>• Confirm swap transaction</li>
        </ul>
      </div>

      {showSlippageModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Settings</h2>
              <button onClick={() => setShowSlippageModal(false)} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-3">Slippage Tolerance</label>
                <div className="flex gap-2 mb-3">
                  {slippagePresets.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => handleSlippagePreset(preset)}
                      className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-colors ${
                        slippage === preset && !customSlippage
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {preset}%
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <input
                    type="number"
                    value={customSlippage}
                    onChange={(e) => handleCustomSlippage(e.target.value)}
                    placeholder="Custom"
                    step="0.1"
                    min="0"
                    max="50"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                  <span className="absolute right-3 top-2 text-gray-500">%</span>
                </div>
                {customSlippage && parseFloat(customSlippage) > 5 && (
                  <p className="mt-2 text-sm text-yellow-600">⚠️ High slippage may result in unfavorable rates</p>
                )}
                {customSlippage && parseFloat(customSlippage) > 15 && (
                  <p className="mt-2 text-sm text-red-600">⚠️ Very high slippage! You may lose significant value.</p>
                )}
              </div>

              <div className="pt-4 border-t">
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-sm text-gray-700">
                    <strong>What is slippage?</strong>
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    Slippage is the difference between expected and actual trade price.
                    Your transaction will revert if the price changes unfavorably by more than this percentage.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowSlippageModal(false)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
