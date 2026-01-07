import { http, createConfig } from 'wagmi'
import { sepolia, optimismSepolia, polygonAmoy, mainnet } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

const anvil = {
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL_ANVIL || 'http://127.0.0.1:8545'] },
    public:  { http: [process.env.NEXT_PUBLIC_RPC_URL_ANVIL || 'http://127.0.0.1:8545'] },
  },
  testnet: true,
}

export const config = createConfig({
  chains: [sepolia, optimismSepolia, polygonAmoy, anvil, mainnet], // ✅ 去重
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(process.env.NEXT_PUBLIC_RPC_URL_SEPOLIA),
    [optimismSepolia.id]: http(
      process.env.NEXT_PUBLIC_RPC_URL_OPTIMISMSEPOLIA || 'https://sepolia.optimism.io'
    ),
    [polygonAmoy.id]: http(
      process.env.NEXT_PUBLIC_RPC_URL_POLYGONAMOY || 'https://rpc-amoy.polygon.technology/'
    ),
    [anvil.id]: http(process.env.NEXT_PUBLIC_RPC_URL_ANVIL || 'http://127.0.0.1:8545'),
    [mainnet.id]: http(),
  },
  ssr: true,
})
