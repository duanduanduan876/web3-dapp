On-chain proofs: docs/proofs.md
# Web3 DApp Suite (DeFi + Bridge) — Next.js + wagmi/viem

一个用于演示与学习的 Web3 DApp 项目集合，包含 **Swap/Pool、Farm、Launchpad、Bridge** 模块。
本仓库基于课程实战项目做了较大幅度的工程化改造与功能完善（重点在：链上交互闭环、异步状态建模、轮询并发控制、错误兜底与可复现配置）。

## Features
- **Swap / Pool (AMM)**
  - allowance/approve → swap / addLiquidity / removeLiquidity
  - BigInt 精度处理（parseUnits/formatUnits）与 UI 状态分层（submit/confirm/success/fail）
- **Farm (Staking / Yield Farming)**
  - 多池 poolId 模型：approve → deposit → harvest → withdraw
  - 防按钮连点、状态抖动与异步错乱
- **Launchpad (IDO)**
  - BEFORE / ACTIVE / FINISHED / CLAIMABLE 生命周期驱动 UI
  - approve → contribute → claim 顺序校验与兜底
- **Bridge (OP Sepolia → Sepolia)**
  - 源链 bridge 交易 → 后端解析 receipt/event 生成 transferId
  - 目标链 relayer mint → 前端轮询状态机（queued/inflight/complete/failed）
  - 轮询并发控制（in-flight 防重复请求）与错误恢复

## Tech Stack
- Next.js (App Router), React, TypeScript/JavaScript, Tailwind CSS
- wagmi v2, viem, RainbowKit
- Next.js API Routes（bridge relay / 状态查询 / 部分业务数据接口）
- Networks: Sepolia / OP Sepolia（按环境变量配置）

## Running Locally

### Env
Copy env template and fill your own values:

- Windows PowerShell:
  copy .env.example .env.local

- macOS/Linux:
  cp .env.example .env.local

### Start
npm i
npm run dev

### On-chain Proofs
Contract addresses and representative tx hashes:
- see `docs/proofs.md`

### Notes
- Relayer uses server-only env vars (SEPOLIA_RPC_URL / OP_SEPOLIA_RPC_URL / RELAYER_PRIVATE_KEY).
- `.env.local` is gitignored; `.env.example` contains placeholders only.


