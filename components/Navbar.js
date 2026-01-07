'use client'

import Link from 'next/link'
import { ConnectButton } from '@rainbow-me/rainbowkit'

export default function Navbar() {
  const navItems = [
    { name: 'LaunchPad', href: '/launchpad' },
    { name: 'Bridge', href: '/bridge' },
    { name: 'Swap', href: '/swap' },
    { name: 'Pool', href: '/pool' },
    { name: 'Farm', href: '/farm' },
  ]

  return (
    <header className="border-b border-gray-200">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* 左侧：Logo + 导航 */}
        <div className="flex items-center gap-6">
          <span className="text-lg font-bold">Web3 DApp</span>
          <nav className="flex items-center gap-4 text-sm text-gray-600">
            <Link href="/swap" className="hover:text-black">Swap</Link>
            <Link href="/pool" className="hover:text-black">Pool</Link>
            <Link href="/farm" className="hover:text-black">Farm</Link>
            <Link href="/bridge" className="hover:text-black">Bridge</Link>
          </nav>
        </div>

        {/* 右侧：RainbowKit 钱包按钮 */}
        <ConnectButton
          accountStatus="address"   // 显示缩写地址
          chainStatus="icon"        // 只显示网络图标
          showBalance={false}       // 不显示余额，干净一点
        />
      </div>
    </header>
  )
}
