# Known Issues / Limitations

This project is a demo-grade Web3 DApp suite deployed on testnets (Sepolia / OP Sepolia).

## Network / Wallet
- **Chain switching required**:
  - Swap/Pool/Farm/Launchpad run on **Sepolia**
  - Bridge source tx runs on **OP Sepolia**
- If the connected wallet is on the wrong chain, the UI will fail early or prompt switching.

## Faucet / RPC Rate Limits
- Public RPC endpoints and faucets may rate-limit requests.
- Symptoms:
  - delayed receipts
  - intermittent “request failed / timeout”
- Mitigations in UI:
  - clear error messaging (user-retry friendly)
  - no infinite blocking waits in a single request

## Bridge Relayer (Vercel Serverless)
- The bridge mint step uses a **serverless relayer**:
  - **No background listener** (cannot keep watching events)
  - **Execution timeout** (cannot long-poll in one request)
  - **No local persistent state** (status is derived from chain queries)
- **Relayer private key is stored in Vercel env vars**:
  - must use a **burner test key only**
  - for demo purposes; not production security model

## Not Production-Hardened
- This repo focuses on end-to-end workflows and reproducible on-chain proofs.
- It does not include:
  - full monitoring / alerting
  - database-backed transfer tracking
  - production-grade key management or dedicated relayer infra
