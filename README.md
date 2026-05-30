# Web3 DApp 套件（DeFi + Bridge）| Next.js + wagmi/viem

**在线演示（Live Demo）：** https://web3-dapp-two.vercel.app/  
**链上证明（On-chain Proofs）：** `docs/proofs.md`  
**架构说明（Architecture）：** `docs/ARCHITECTURE.md`  
**已知问题（Known Issues）：** `docs/KNOWN_ISSUES.md`

一个偏工程化落地的 Web3 DApp 项目集合，包含 **Swap/Pool（AMM）**、**Farm（质押挖矿）**、**Launchpad（IDO）**、**Bridge（OP Sepolia → Sepolia）** 四个模块。  
重点覆盖：链上交互闭环、交易生命周期 UI 状态建模、轮询并发控制（in-flight）、基于 receipt/event 的进度驱动、可复现链上证据。

---

## 关键实现点
- **交易生命周期 UI 状态建模**：submit → confirming → success / failed（各模块统一口径）
- **轮询并发控制**：in-flight 防重复请求 + AbortController 避免卸载后回写
- **Bridge 事件驱动闭环**：源链 tx → 后端解析 receipt/logs → transferId → 目标链 mint → 前端状态机轮询
- **类型与地址安全**：统一 Address 校验与类型收敛，减少 string/0x/BigInt 引发的运行时与构建问题
- **异步任务恢复**：Bridge 任务使用 `localStorage` 保存历史任务快照，页面重新打开后恢复任务卡片，并按 `transferId` 继续查询后端最新状态。
* **状态查询稳定性**：批量轮询中使用 `inFlight` 防止请求重叠，使用 `AbortController` 和 cleanup 阻止旧请求在组件卸载或条件变化后继续回写页面。
* **异常可见化**：状态查询短暂失败时保留最后可信状态并提示自动重试；任务长时间未进入终态时显示“处理时间较长，请稍后核对状态”，但不误判为 failed。
* **提交维护开关**：支持关闭新的 Bridge 提交入口，同时保留历史任务展示和状态查询能力。
* **测试与回归**：使用 Vitest 覆盖用户拒签判断、API 错误转换和本地缓存工具函数；使用 Playwright E2E 验证任务展示、状态更新、查询失败恢复和卡单提示。


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
- UI 状态分层，减少 pending/success 抖动与重复提交

### Farm（Staking / Yield Farming）
- approve → deposit → harvest → withdraw
- **单池设计**：前端默认 `pid = 0`
- 质押币为 **自定义 ERC20**（非 AMM 的 LP token）

### Launchpad（IDO）
- 生命周期驱动 UI：BEFORE / ACTIVE / FINISHED / CLAIMABLE
- approve → contribute → claim 顺序校验与兜底提示

### Bridge（OP Sepolia → Sepolia）
一个基于 **源链事件 + 后端解析回执 + Relayer 铸币** 的最小跨链 Demo。用户在 OP Sepolia 发起交易并 **burn（销毁）** 代币，源链事件携带 `transferId` 等关键参数。后端解析 OP Sepolia 的 `receipt/logs` 建档，并在 Sepolia 执行 `mintFromSource` 完成目标链铸币。前端用状态机展示跨链进度并支持刷新恢复。

#### 流程
1. **OP Sepolia**：如有需要先 `approve`，再调用 `bridge(amount, recipient, dstChainId)`，源链 **burn（销毁）** 并发出事件  
2. **后端**：解析源链 `receipt/logs` 得到 `transferId`，创建跨链记录并快速返回  
3. **Relayer（后端）**：在 **Sepolia** 发起 `mintFromSource(transferId, recipient, amount)`，写入 `targetTxHash`，等待回执确认  
4. **前端**：轮询 `GET /api/bridge/transfer?transferId=...`，驱动状态机：`queued → inflight → complete / failed`

#### 实现要点
- **前端状态机**：`queued / inflight / complete / failed`，配合 `progress` 百分比展示
- **轮询并发控制**：in-flight guard + AbortController，避免重复请求与卸载后 setState
- **刷新恢复**：使用 localStorage 保存最近 N 条 `transferId`，刷新后自动恢复列表并继续轮询
- **后端 quick return**：先入库返回 `transferId`，mint 与回执确认在后台异步执行，持续更新状态

#### Vercel Relayer 说明
- Relayer 运行在 Vercel Serverless 上，适合“请求触发式执行”
- Serverless 会冷启动，内存状态不保证持久化，跨链记录持久化策略见 `docs/KNOWN_ISSUES.md`
- Relayer 私钥仅存放在服务端环境变量中（测试用 burner key）

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
4. **Launchpad（Sepolia）**：Approve PaymentToken → Contribute → Claim
5. **Bridge（OP Sepolia → Sepolia）**：切到 OP Sepolia → Approve TokenA → Bridge → 等待状态更新

提示：现场 faucet / gas / RPC 限流导致失败时，直接查看 `docs/proofs.md`，每条 tx 都附带用途说明，可核验可复现。

---

## 链上证明（On-chain Proofs）
- 合约地址与代表性交易哈希见：`docs/proofs.md`
- 每条交易附用途说明，便于复现与核验

---

## 技术栈（Tech Stack）
- Next.js（App Router）/ React / TypeScript / Tailwind CSS
- wagmi v2 / viem / RainbowKit
- Next.js Route Handlers（Bridge transfer API 与部分业务接口）
- Networks：Sepolia / OP Sepolia（通过环境变量配置）

---

## 本地运行（Running Locally）

### 1）安装依赖
```bash
npm i

2）启动开发服务器
npm run dev

默认访问：

http://localhost:3007
3）运行单元测试
npm test -- --run
4）运行 E2E 测试
npm run test:e2e

调试时可以显示浏览器窗口：

npm run test:e2e:headed -- --workers=1








