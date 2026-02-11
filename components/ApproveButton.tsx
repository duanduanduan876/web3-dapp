'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { isAddress, type Address } from 'viem'
import { ERC20_ABI } from '../lib/abis'

type ApproveButtonProps = {
  tokenAddress?: Address | string
  spenderAddress?: Address | string
  amount?: bigint | string | null | undefined
  onApproved?: () => void
  children: React.ReactNode
  disabled?: boolean
  approveMax?: boolean
}

const MAX_UINT256 =
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn

function toAddress(v?: Address | string): Address | undefined {
  if (!v) return undefined
  return isAddress(v) ? (v as Address) : undefined
}

function toBigintAmount(v?: bigint | string | null | undefined): bigint {
  if (v === null || v === undefined) return 0n
  if (typeof v === 'bigint') return v
  const s = String(v).trim()
  if (!s) return 0n
  try {
    return BigInt(s)
  } catch {
    return 0n
  }
}

export default function ApproveButton({
  tokenAddress,
  spenderAddress,
  amount,
  onApproved,
  children,
  disabled = false,
  approveMax = true,
}: ApproveButtonProps) {
  const { address } = useAccount()

  const chainId = useChainId()
  const publicClient = usePublicClient({ chainId })
  const chain = publicClient?.chain

  const owner = useMemo(() => toAddress(address as any), [address])
  const token = useMemo(() => toAddress(tokenAddress as any), [tokenAddress])
  const spender = useMemo(() => toAddress(spenderAddress as any), [spenderAddress])
  const amountBig = useMemo(() => toBigintAmount(amount), [amount])

  const [needsApproval, setNeedsApproval] = useState(false)

  const canCheckAllowance = Boolean(owner && token && spender && amountBig > 0n)

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: canCheckAllowance ? [owner!, spender!] : undefined,
    query: { enabled: canCheckAllowance },
  })

  const { data: approveHash, writeContract: approve, isPending: isApproving } =
    useWriteContract()

  const { isLoading: isConfirming, isSuccess: isApproved } =
    useWaitForTransactionReceipt({
      hash: approveHash,
    })

  useEffect(() => {
    if (!canCheckAllowance) {
      setNeedsApproval(false)
      return
    }

    // allowance 可能是 unknown，先变成 string 再 BigInt，TS 就不会炸
    const allowanceBig =
      typeof allowance === 'bigint'
        ? allowance
        : BigInt(String(allowance ?? 0))

    setNeedsApproval(allowanceBig < amountBig)
  }, [canCheckAllowance, allowance, amountBig])

  useEffect(() => {
    if (!isApproved) return
    refetchAllowance?.()
    onApproved?.()
  }, [isApproved, refetchAllowance, onApproved])

  const handleApprove = () => {
    if (!owner || !token || !spender) return
    if (!chain) return
    if (amountBig <= 0n) return

    approve({
      address: token,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, approveMax ? MAX_UINT256 : amountBig],
      account: owner,
      chain,
    } as any)
  }

  if (!needsApproval) return <>{children}</>

  const btnDisabled =
    disabled || isApproving || isConfirming || !owner || !token || !spender || !chain

  return (
    <button
      onClick={handleApprove}
      disabled={btnDisabled}
      className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
    >
      {isApproving || isConfirming ? 'Approving...' : 'Approve Token'}
    </button>
  )
}
