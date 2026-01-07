import type { Abi } from "viem";

export const SOURCE_BRIDGE_ABI = [
  {
    type: "event",
    name: "BridgeInitiated",
    anonymous: false,
    inputs: [
      { indexed: true, name: "transferId", type: "bytes32" },
      { indexed: true, name: "recipient", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "dstChainId", type: "uint256" },
    ],
  },
] as const satisfies Abi;


export const TARGET_BRIDGE_ABI = [
  { type: 'function', name: 'processed', stateMutability: 'view', inputs: [{ name: '', type: 'bytes32' }], outputs: [{ name: '', type: 'bool' }] },
  {
    type: 'function',
    name: 'mintFromSource',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'transferId', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const satisfies Abi