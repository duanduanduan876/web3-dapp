import { NextResponse } from 'next/server'
import { createPublicClient, http, formatUnits } from 'viem'
import { sepolia } from 'viem/chains'

/**
 * GET /api/launchpad/projects
 * 从链上读取 LaunchPad sales 列表
 */

const ZERO = '0x0000000000000000000000000000000000000000'

const LAUNCHPAD_ABI = [
  {
    type: 'function',
    name: 'nextSaleId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'sales',
    stateMutability: 'view',
    inputs: [{ name: 'saleId', type: 'uint256' }],
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'paymentToken', type: 'address' },
      { name: 'tokenDecimals', type: 'uint8' },
      { name: 'price', type: 'uint256' },       // 1e18 fixed
      { name: 'saleAmount', type: 'uint256' },  // token wei
      { name: 'sold', type: 'uint256' },        // token wei
      { name: 'startTime', type: 'uint256' },   // unix
      { name: 'endTime', type: 'uint256' },     // unix
      { name: 'minPurchase', type: 'uint256' }, // token wei
      { name: 'maxPurchase', type: 'uint256' }, // token wei
    ],
  },
]

const ERC20_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
]

const PRICE_SCALE = 10n ** 18n

async function fetchChainProjects() {
  const launchpadAddress =
    process.env.NEXT_PUBLIC_LAUNCHPAD_ADDRESS || process.env.LAUNCHPAD_ADDRESS

  const rpcUrl = process.env.SEPOLIA_RPC_URL

  if (!launchpadAddress || launchpadAddress === ZERO) return null
  if (!rpcUrl) return null

  const client = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  })

  const nextSaleId = await client.readContract({
    address: launchpadAddress,
    abi: LAUNCHPAD_ABI,
    functionName: 'nextSaleId',
  })

  // ✅ nextSaleId = 0 => 没有任何 sale
  // ✅ nextSaleId = 1 => 已存在 saleId=0
  const count = Number(nextSaleId)//当前时间的 Unix 秒时间戳

  const now = Math.floor(Date.now() / 1000)//当前时间的 Unix 秒时间戳
  const projects = []

  for (let saleId = 0; saleId < count; saleId++) {
    const saleInfo = await client.readContract({
      address: launchpadAddress,
      abi: LAUNCHPAD_ABI,
      functionName: 'sales',
      args: [BigInt(saleId)],
    })

    const [
      creator,
      saleToken,
      paymentToken,
      tokenDecimals,
      price,
      saleAmount,
      sold,
      startTime,
      endTime,
      minPurchase,
      maxPurchase,
    ] = saleInfo

    // 可选：跳过空槽（看你合约实现）
    if (!creator || creator === ZERO || !saleToken || saleToken === ZERO) continue

    // token 名称/符号
    //因为sale里面只有saletoken地址，ui不能只显示地址，必须显示token名字和token的符号
    let tokenName = 'Unknown Token'
    let tokenSymbol = 'TKN'
    try {
      tokenName = await client.readContract({ address: saleToken, abi: ERC20_ABI, functionName: 'name' })
      tokenSymbol = await client.readContract({ address: saleToken, abi: ERC20_ABI, functionName: 'symbol' })
    } catch (_) {}

    // status（前端只认 upcoming/active/ended）
    let status = 'active'
    if (now < Number(startTime)) status = 'upcoming'
    else if (now >= Number(endTime)) status = 'ended'

    // raised/goal（按 payment token 18 decimals 的“金额字符串”输出，和你前端 mock 一致）
    const raisedWei = (sold * price) / PRICE_SCALE
    const goalWei = (saleAmount * price) / PRICE_SCALE

    const raised = formatUnits(raisedWei, 18)
    const goal = formatUnits(goalWei, 18)
    const priceStr = formatUnits(price, 18)

    const progress = Number(goal) > 0 ? (Number(raised) / Number(goal)) * 100 : 0
    
    //把链上sale的原始数据整理成一个ui项目卡片需要的对象数据
    //生产出来前端要吃的东西
    projects.push({
      id: saleId,
      tokenDecimals: Number(tokenDecimals), // ✅加这个
      name: tokenName,
      symbol: tokenSymbol,
      description: `Token sale for ${tokenName} (${tokenSymbol})`,
      logo: `https://via.placeholder.com/200/6366f1/ffffff?text=${tokenSymbol}`,
      saleToken,
      paymentToken,
      price: priceStr,
      goal,
      raised,
      totalSupply: formatUnits(saleAmount, Number(tokenDecimals)),
      startTime: Number(startTime) * 1000,
      endTime: Number(endTime) * 1000,
      minPurchase: formatUnits(minPurchase, Number(tokenDecimals)),
      maxPurchase: formatUnits(maxPurchase, Number(tokenDecimals)),
      status,
      participants: 0,
      progress: Math.min(progress, 100),
      address: launchpadAddress,
      creator,
    })
  }

  return {
    projects,//核心的数据
    source: 'chain',//告诉前端这是链上真实的数据
    timestamp: new Date().toISOString(),
    debug: {//排错用的
      launchpadAddress,
      rpcUrlUsed: rpcUrl,
      nextSaleId: count,
    },
  }
}

// 只有链读取失败才回落 mock（否则你会被“明天开始”骗）
function generateMockProjects() {
  const now = Date.now()
  const oneDay = 24 * 60 * 60 * 1000
  return {
    projects: [
      {
        id: 0,
        name: 'Test Token',
        symbol: 'TEST',
        description: 'Test token sale - no real sales available yet',
        logo: 'https://via.placeholder.com/200/6366f1/ffffff?text=TEST',
        saleToken: ZERO,
        paymentToken: process.env.NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS || ZERO,
        price: '0.1',
        goal: '50000',
        raised: '0',
        totalSupply: '500000',
        startTime: now + oneDay,
        endTime: now + 7 * oneDay,
        minPurchase: '100',
        maxPurchase: '10000',
        status: 'upcoming',
        participants: 0,
        progress: 0,
        address: process.env.NEXT_PUBLIC_LAUNCHPAD_ADDRESS || ZERO,
      },
    ],
    source: 'mock',
    timestamp: new Date().toISOString(),
  }
}

export async function GET() {
  try {
    const chainData = await fetchChainProjects()
    if (chainData) return NextResponse.json(chainData)       // ✅ 链读成功：哪怕 projects 为空也返回链结果
    return NextResponse.json(generateMockProjects())         // ✅ 只有链读失败才 mock
  } catch (error) {
    console.error('Error fetching launchpad projects:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}


