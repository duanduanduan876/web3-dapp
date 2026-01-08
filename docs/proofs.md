# On-chain Proofs

## Swap & Pool (Sepolia)
Contracts:
- Swap (internal share AMM, no ERC20 LP token): 0xf18f6e03DE504BAfF2F399b5B13741c70B11720F
- TokenA: 0x4384Ebd716305505c3e26bAb16169450db73423F
- TokenB: 0xb95A750b5d63e086C1B6633c5948e1dF36E3f534
- LP Share: N/A (liquidity share tracked internally in Swap contract)

Tx:
- approve TokenA -> Swap: 0x8ac042e729f18054809f98ebc843fbc74675be9f2b2cd390bdf33c96af2e7307
- addLiquidity:0x71dd75fcba74d824455ff36865db9ce7b470008fa9ec0405fd18620e6d154ba3
- swap: 0x39bc94240df8afc36df18fecfeab4c5067408ba1722f6b8596735ebca813eca0
- removeLiquidity: 0xe1ac359abd8f1c87e0cb40d6daf015080e55c4c151acf3b58716f46253b7a1a3

## Farm (Sepolia)
Contracts:
- Farm: 0x426180Ef989d679fAD2C9DBb985868Ee279bD3DE
- StakingToken (custom ERC20, NOT AMM LP token): 0x38Af0BD84324481cD7147c91b3b93fAE0D38eE63
- RewardToken (ERC20): 0xAF533A87fAE69d014aFbFE8481367E6F8DC3F78E

Tx:
- approve(StakingToken -> Farm):: 0x2577c46a4df49750052e50a90e2bb65352cb8a44a903ef6348836ba9fb496565
- deposit(pid=0): 0x3bd8b249fc3923bffca9444daf07b8ca686e52c33eaeb21f816bd537410bcd6b
- harvest(pid=0): 0xe2d923d88fae498229c4fa32b2b45187a9d129dcbc590407d280928fcafc1c84
- withdraw(pid=0): 0x7a04d930d73005ba94bb135c89786a2524f5f92d187ccf3b824b027b3c808d66

## Bridge (OP Sepolia -> Sepolia)
Contracts:
- SourceBridge (OP Sepolia): 0x9C5142e08c2A4DC97d7dd172192024AC80Eb33Eb
- TargetBridge (Sepolia): 0x1fbd6F4Ae975EE935dC680027d15eEcF121875BF
- BridgeTokenA: 0x0744F4f9449Ded9fF9B314e7A234a9E6630e0Da4

Tx:
- source bridge tx: 0xfa3ae46a9c95118bcac4095db5e0ecbbf42339a4ca530bae4d0323d73aacf56d
- target mint tx: 0x9b95849524f4b84340ce71918c5a4c23af2211eb819ce35588de134d627145bb

## Launchpad (Sepolia)
Contracts:
- Launchpad: 0x33B886772BD6D45F3D1390baD435f6B77Afe5305
- PaymentToken: 0x9b00f9d1C7d37cD6bD9Dbb4D42d56aaA109c9397
- ProjectToken: 0x75Fe321aF5649DbC28D6655506dCeF642F5d647b

Tx:
- approve paymentToken -> Launchpad: 0xedad6ca65e4c6e359a9d12ecb4b77f7ada4422fd5c9356b5419cb8fc9e08a1b0
- contribute(projectId=19): 0xd372e6142bdacda84522760b799c57068e636b9ce6f5b2d018196b3472c4363a
- claim(projectId=19):0x9f588920988460cdb17048f6883ca05d2caf47f65205bc0170aa4751894b9150
