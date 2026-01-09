# Architecture

This repo is a Web3 DApp suite (DeFi + Bridge) built with Next.js (App Router) + wagmi/viem.
Modules share a consistent **transaction lifecycle UI model** and a common approach to
**on-chain proofability** (every flow has reproducible tx hashes in `docs/proofs.md`).

## Modules Overview

### 1) Swap / Pool (Sepolia)
**Goal**: AMM swap + add/remove liquidity (internal share accounting, no ERC20 LP token)

- **Key contracts**
  - Swap (AMM + internal liquidity share)
  - TokenA / TokenB (ERC20)

- **Frontend lifecycle (write tx)**
  - `idle → submit → confirming → success | fail`
  - Reads: balance / allowance / reserves
  - Writes: approve → addLiquidity → swap → removeLiquidity

- **State notes**
  - Liquidity share is tracked **inside Swap contract storage**, not an LP ERC20.
  - UI uses `in-flight` guard to prevent duplicate submits.

---

### 2) Farm (Sepolia)
**Goal**: stake token → earn reward → harvest → withdraw

- **Key contracts**
  - Farm
  - StakingToken (custom ERC20; NOT AMM LP token)
  - RewardToken (ERC20)

- **Frontend lifecycle**
  - approve(StakingToken) → deposit → harvest → withdraw
  - `idle → submit → confirming → success | fail`

- **State notes**
  - Single pool usage in UI (treat `pid=0` as default).

---

### 3) Launchpad (Sepolia)
**Goal**: contribute payment token into a sale → claim project token

- **Key contracts**
  - Launchpad
  - PaymentToken (ERC20)
  - ProjectToken (ERC20)

- **Frontend lifecycle**
  - approve(PaymentToken) → contribute(projectId) → claim(projectId)
  - Sale state UI: `BEFORE / ACTIVE / FINISHED / CLAIMABLE`

---

### 4) Bridge (OP Sepolia → Sepolia)
**Goal**: source-chain action + target-chain mint, with serverless relayer API

- **Key contracts**
  - SourceBridge (OP Sepolia)
  - TargetBridge (Sepolia)
  - BridgeTokenA (bridged ERC20)

- **High-level flow**
  1. **Frontend (OP Sepolia)** sends source tx → gets `sourceTxHash`
  2. **Frontend** calls `POST /api/bridge/relay` with `{ sourceTxHash, recipient, amount }`
  3. **Backend API (Serverless relayer)**
     - fetches OP Sepolia receipt
     - decodes logs → `transferId`
     - sends Sepolia mint tx via TargetBridge → returns `targetTxHash`
  4. **Frontend** polls `GET /api/bridge/status?transferId=...` (stateless chain query)
     - updates UI state: `queued / inflight / complete / failed`

- **Why request-driven**
  - Vercel Serverless is not a long-running process, so the relayer is implemented via API calls
    rather than a background event listener.

---

## Shared UI Transaction Model

Across modules, write operations follow the same user-visible state machine:

- `idle`: ready
- `submit`: user signed / tx submitted
- `confirming`: waiting for receipt
- `success`: confirmed on-chain
- `fail`: reverted / rejected / RPC error

This makes the UX consistent and simplifies debugging and proof collection.
