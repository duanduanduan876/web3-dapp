export const LAUNCHPAD_ABI = [
  // write
  {
    type: 'function',
    name: 'buy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'saleId', type: 'uint256' },
      { name: 'amount', type: 'uint256' }, // token amount (wei)
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'saleId', type: 'uint256' }],
    outputs: [],
  },

  // reads
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
      { name: 'price', type: 'uint256' },
      { name: 'saleAmount', type: 'uint256' },
      { name: 'sold', type: 'uint256' },
      { name: 'startTime', type: 'uint256' },
      { name: 'endTime', type: 'uint256' },
      { name: 'minPurchase', type: 'uint256' },
      { name: 'maxPurchase', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'purchased',
    stateMutability: 'view',
    inputs: [
      { name: 'saleId', type: 'uint256' },
      { name: 'user', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'claimed',
    stateMutability: 'view',
    inputs: [
      { name: 'saleId', type: 'uint256' },
      { name: 'user', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
  },
] 
