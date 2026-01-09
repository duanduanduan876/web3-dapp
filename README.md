# Web3 DApp 濂椾欢锛圖eFi + Bridge锛夆€?Next.js + wagmi/viem

**鍦ㄧ嚎婕旂ず锛圠ive Demo锛夛細** https://web3-dapp-two.vercel.app/  
**閾句笂璇佹槑锛圤n-chain Proofs锛夛細** `docs/proofs.md`

涓€涓亸宸ョ▼鍖栬惤鍦扮殑 Web3 DApp 椤圭洰闆嗗悎锛屽寘鍚?**Swap/Pool锛圓MM锛?*銆?*Farm锛堣川鎶兼寲鐭匡級**銆?*Launchpad锛圛DO锛?*銆?*Bridge锛圤P Sepolia 鈫?Sepolia锛?* 鍥涗釜妯″潡銆? 
閲嶇偣锛氶摼涓婁氦浜掗棴鐜€佷氦鏄撶敓鍛藉懆鏈?UI 寤烘ā銆佽疆璇㈠苟鍙戞帶鍒讹紙in-flight锛夈€佸熀浜?receipt/event 鐨勮繘搴﹂┍鍔ㄣ€佸彲澶嶇幇閾句笂璇佹嵁銆?

---

## 浜偣锛堥潰璇曞畼鐪嬬偣锛?
- **浜ゆ槗鐢熷懡鍛ㄦ湡 UI 寤烘ā**锛歴ubmit 鈫?confirming 鈫?success / fail锛堝悇妯″潡涓€鑷达級
- **杞骞跺彂鎺у埗**锛歩n-flight 闃查噸澶嶈姹?+ AbortController 閬垮厤鍗歌浇鍚庡洖鍐?
- **Bridge 浜嬩欢椹卞姩闂幆**锛氭簮閾?tx 鈫?鍚庣瑙ｆ瀽 receipt/event 鈫?transferId 鈫?鐩爣閾?mint 鈫?鍓嶇鐘舵€佹満杞
- **绫诲瀷涓庡湴鍧€瀹夊叏**锛氱粺涓€ Address 鏍￠獙锛岄伩鍏?string/0x 绫诲瀷瀵艰嚧 build 澶辫触

---

## 鎴浘锛圫creenshots锛?

### Bridge锛圤P Sepolia 鈫?Sepolia锛?
![Bridge](docs/images/bridge.png)

### Swap / Pool锛圓MM锛?
![Swap](docs/images/swap.png)

### Farm锛堣川鎶硷級
![Farm](docs/images/farm.png)

### Launchpad锛圛DO锛?
![Launchpad](docs/images/launchpad.png)

---

## 妯″潡鍔熻兘锛團eatures锛?

### Swap / Pool锛圓MM锛?
- allowance/approve 鈫?addLiquidity 鈫?swap 鈫?removeLiquidity
- BigInt 绮惧害澶勭悊锛坧arseUnits / formatUnits锛?
- UI 鐘舵€佸垎灞傦紝閬垮厤 pending/success 鎶栧姩

### Farm锛圫taking / Yield Farming锛?
- approve 鈫?deposit 鈫?harvest 鈫?withdraw
- **鍗曟睜璁捐锛歱id 鍙拷鐣ワ紝鍓嶇鎸?pid=0 澶勭悊**
- 璐ㄦ娂甯佷负**鑷畾涔?ERC20**锛堜笉鏄?AMM 鐨?LP token锛?

### Launchpad锛圛DO锛?
- 鐢熷懡鍛ㄦ湡椹卞姩 UI锛欱EFORE / ACTIVE / FINISHED / CLAIMABLE
- approve 鈫?contribute 鈫?claim 椤哄簭鏍￠獙涓庡厹搴?

### Bridge锛圤P Sepolia 鈫?Sepolia锛?
- OP Sepolia 鍙戣捣 approve + bridge锛坆urn/lock + event锛?
- 鍚庣瑙ｆ瀽 receipt/event 鐢熸垚 transferId
- relayer 鍦?Sepolia mint
- 鍓嶇杞鐘舵€佹満锛歲ueued / inflight / complete / failed

---

## 3 鍒嗛挓浣撻獙锛圚ow to Try锛?

### 鍓嶇疆
- 瀹夎 MetaMask锛堟垨鍏朵粬 EVM 閽卞寘锛?
- 鍑嗗娴嬭瘯甯侊細
  - **Sepolia ETH**锛圫wap/Pool/Farm/Launchpad锛?
  - **OP Sepolia ETH**锛圔ridge锛?

### 鏈€鐭矾寰?
1. 鎵撳紑鍦ㄧ嚎婕旂ず骞惰繛鎺ラ挶鍖?
2. **Swap/Pool锛圫epolia锛?*锛欰pprove TokenA 鈫?Add Liquidity 鈫?Swap 鈫?Remove Liquidity
3. **Farm锛圫epolia锛?*锛欰pprove StakingToken 鈫?Deposit锛坧id=0锛夆啋 Harvest 鈫?Withdraw
4. **Launchpad锛圫epolia锛?*锛欰pprove PaymentToken 鈫?Contribute锛坧rojectId=19锛夆啋 Claim
5. **Bridge锛圤P Sepolia 鈫?Sepolia锛?*锛氬垏鍒?OP Sepolia 鈫?Approve TokenA 鈫?Bridge 鈫?绛夊緟鐘舵€佹洿鏂?

> 鑻?faucet / gas / RPC 闄愭祦瀵艰嚧鐜板満鎿嶄綔澶辫触锛岀洿鎺ユ煡鐪?`docs/proofs.md`锛氭瘡鏉?tx 閮芥爣娉ㄤ簡鈥滆瘉鏄庝簡浠€涔堚€濄€?

---

## 閾句笂璇佹槑锛圤n-chain Proofs锛?
- 鍚堢害鍦板潃涓庝唬琛ㄦ€т氦鏄撳搱甯岃锛歚docs/proofs.md`
- 姣忔潯浜ゆ槗閮介檮涓€鍙ヨ瘽鐢ㄩ€旇鏄庯紙鎷涜仒鍙嬪ソ璇佹嵁锛?

---

## 鎶€鏈爤锛圱ech Stack锛?
- Next.js锛圓pp Router锛? React, TypeScript, Tailwind CSS
- wagmi v2, viem, RainbowKit
- Next.js API Routes锛坆ridge relay / 鐘舵€佹煡璇?/ 閮ㄥ垎涓氬姟鎺ュ彛锛?
- Networks锛歋epolia / OP Sepolia锛堥€氳繃鐜鍙橀噺閰嶇疆锛?

---

## 鏈湴杩愯锛圧unning Locally锛?

<<<<<<< HEAD



### 1）安装依赖
~~~bash
npm i
~~~

=======
### 1锛夊畨瑁呬緷璧?
```bash
npm i
```
>>>>>>> 9dea4d5 (docs: fix README code block)






