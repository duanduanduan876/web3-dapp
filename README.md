# Web3 DApp 套件（DeFi + Bridge）— Next.js + wagmi/viem

**在线演示（Live Demo）：** https://web3-dapp-two.vercel.app/  
**链上证明（On-chain Proofs）：** `docs/proofs.md`

Architecture: docs/ARCHITECTURE.md

Known Issues: docs/KNOWN_ISSUES.md

一个偏工程化落地的 Web3 DApp 项目集合，包含 **Swap/Pool（AMM）**、**Farm（质押挖矿）**、**Launchpad（IDO）**、**Bridge（OP Sepolia → Sepolia）** 四个模块。  
重点：链上交互闭环、交易生命周期 UI 建模、轮询并发控制（in-flight）、基于 receipt/event 的进度驱动、可复现链上证据。

---

## 关键实现点
- **交易生命周期 UI 建模**：submit → confirming → success / fail（各模块一致）
- **轮询并发控制**：in-flight 防重复请求 + AbortController 避免卸载后回写
- **Bridge 事件驱动闭环**：源链 tx → 后端解析 receipt/event → transferId → 目标链 mint → 前端状态机轮询
- **类型与地址安全**：统一 Address 校验，避免 string/0x 类型问题导致运行时/构建失败

---

## 截图（Screenshots）

### Bridge（OP Sepolia → Sepolia）
![Bridge](docs/images/bridge.png)

### Swap / Pool（AMM）
![Swap](docs/images/swap.png)

### Farm（质押）
![Farm](docs/images/farm.png)

### Launchpad（IDO）
![Launchpad](docs/images/launchpad.png)

---

## 模块功能（Features）

### Swap / Pool（AMM）
- allowance/approve → addLiquidity → swap → removeLiquidity
- BigInt 精度处理（parseUnits / formatUnits）
- UI 状态分层，避免 pending/success 抖动

### Farm（Staking / Yield Farming）
- approve → deposit → harvest → withdraw
- **单池设计**：前端默认 `pid = 0`
- 质押币为**自定义 ERC20**（不是 AMM 的 LP token）

### Launchpad（IDO）
- 生命周期驱动 UI：BEFORE / ACTIVE / FINISHED / CLAIMABLE
- approve → contribute → claim 顺序校验与兜底提示

### Bridge（OP Sepolia → Sepolia）
这是一个基于 源链事件 + 后端解析回执 + Relayer 铸币 的最小跨链 Demo。用户在 OP Sepolia 发起交易并 burn 代币，后端解析源链 receipt/logs 生成 transferId 并建档，Relayer 在 Sepolia 执行 mintFromSource 完成目标链铸币。前端用状态机展示跨链进度并支持刷新恢复。

流程
OP Sepolia：如有需要先 approve，再调用 bridge(amount, recipient, dstChainId)，在源链 burn 并发出事件
后端：等待源链交易回执，解析事件参数，生成 transferId，创建一条跨链记录
Relayer（后端）：在 Sepolia 发起目标链交易 mintFromSource(transferId, recipient, amount)，并写入 targetTxHash
前端：轮询 /api/bridge/transfer?transferId=...，驱动状态机展示进度：queued → inflight → complete / failed

实现要点
前端状态机：queued / inflight / complete / failed，配合 progress 百分比展示
轮询并发控制：in-flight guard + AbortController，避免重复请求和组件卸载后的状态更新
刷新恢复：使用 localStorage 保存最近 N 条 transferId 与记录详情，刷新后自动恢复列表并继续轮询
后端 quick return：先入库返回 transferId，Relayer 在后台异步执行 mint 与回执确认，持续更新进度与错误信息
---

## 3 分钟体验（How to Try）

### 前置
- 安装 MetaMask（或其他 EVM 钱包）
- 准备测试币：
  - **Sepolia ETH**（Swap/Pool/Farm/Launchpad）
  - **OP Sepolia ETH**（Bridge）

### 最短路径
1. 打开在线演示并连接钱包
2. **Swap/Pool（Sepolia）**：Approve TokenA → Add Liquidity → Swap → Remove Liquidity
3. **Farm（Sepolia）**：Approve StakingToken → Deposit（pid=0）→ Harvest → Withdraw
4. **Launchpad（Sepolia）**：Approve PaymentToken → Contribute（projectId=19）→ Claim
5. **Bridge（OP Sepolia → Sepolia）**：切到 OP Sepolia → Approve TokenA → Bridge → 等待状态更新

> 如果现场 faucet / gas / RPC 限流导致操作失败：直接看 `docs/proofs.md`，每条 tx 都写清楚“证明了什么”。

## Vercel 说明（Bridge Relayer）

本项目的跨链桥（OP Sepolia → Sepolia）在“目标链 mint”这一步使用了 **部署在 Vercel 上的 Serverless Relayer**。
由于 Serverless **不是常驻进程**，所以采用 **“请求驱动的 API”** 来完成 relayer 工作，而不是后台一直监听链上事件。

### Vercel Serverless 的限制
- **不能后台常驻监听**：无法长期运行进程去持续订阅/监听链上事件。
- **有执行超时**：不适合在一次请求里长时间轮询或阻塞等待。
- **没有本地状态持久化**：不能依赖内存保存 transfer 状态（需要 KV/DB，或采用“无状态：直接查链上”的方式）。
- **私钥只能放在服务端环境变量**：relayer 私钥存放在 Vercel Env（只能用测试用 burner key）。

### 可行实现
1. **前端（OP Sepolia）** 发起源链跨链交易，拿到 `sourceTxHash`。
2. **前端** 调用 `POST /api/bridge/relay`，把下面参数传给后端：
   - `sourceTxHash`
   - `recipient`
   - `amount`
3. **后端 API（Vercel Serverless）** 做两件事：
   - 查询 OP Sepolia 的交易 `receipt`，从日志里解析出 `transferId`
   - 使用 relayer 私钥调用 Sepolia 的 `TargetBridge` 执行 mint，并返回 `targetTxHash`
4. **前端** 轮询 `GET /api/bridge/status?transferId=...`（无状态查询）：
   - 直接在 Sepolia 链上查 mint 相关事件/receipt，更新 UI 状态（`queued / inflight / complete / failed`）

---

## 链上证明（On-chain Proofs）
- 合约地址与代表性交易哈希见：`docs/proofs.md`
- 每条交易附用途说明，便于复现与核验

---

## 技术栈（Tech Stack）
- Next.js（App Router）/ React / TypeScript / Tailwind CSS
- wagmi v2 / viem / RainbowKit
- Next.js Route Handlers（Bridge relay / 状态查询 / 部分业务接口）
- Networks：Sepolia / OP Sepolia（通过环境变量配置）

---

## 本地运行（Running Locally）

### 1）安装依赖
```bash
npm i





