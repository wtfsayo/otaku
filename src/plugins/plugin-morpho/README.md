# @elizaos/plugin-morpho

A plugin for ElizaOS that integrates with the Morpho Blue protocol on Base L2, enabling optimized lending and borrowing through peer-to-peer matching. This plugin uses the official Morpho Blue SDK for real protocol interactions.

## Overview

The Morpho plugin allows ElizaOS agents to interact with the Morpho Blue protocol, providing access to enhanced yields and better borrowing rates through Morpho's unique P2P matching engine. Built with the official **Morpho Blue SDK v4.4.0**, this plugin provides real protocol interactions including:

- **Real SDK Integration**: Uses `@morpho-org/blue-sdk` for authentic protocol interactions
- **Live Market Data**: Fetches actual market rates, utilization, and liquidity
- **Position Management**: Real position tracking and health factor calculations
- **Historical Analytics**: Accurate APY calculations using blockchain data
- **P2P Matching Optimization**: Leverages actual matching engine efficiency

## Features

### Core Lending Operations
- **Optimized Supply**: Earn higher yields through P2P matching
- **Efficient Borrowing**: Access better rates with direct peer matching
- **Smart Withdrawals**: Minimize matching impact during withdrawals
- **Intelligent Repayments**: Optimize interest payments through efficient matching

### Morpho Vaults (ERC4626)
- **Vault Deposits**: Deposit into curated Morpho Vaults for automated yield optimization
- **Vault Withdrawals**: Withdraw from vaults with fee optimization
- **Vault Performance Tracking**: Monitor vault performance and curator strategies

### Bundler Operations
- **Atomic Transactions**: Execute multiple operations in a single transaction
- **Supply + Borrow**: Combine collateral supply and borrowing atomically
- **Gas Optimization**: Reduce total gas costs with bundled operations
- **MEV Protection**: Minimize sandwich attack risks

### Rewards System
- **Reward Tracking**: Monitor claimable MORPHO and other incentive tokens
- **Automatic Claims**: Claim all available rewards efficiently
- **Multi-token Support**: Handle various reward token types

### Analytics & Monitoring
- **Rate Monitoring**: Real-time comparison of Morpho vs pool rates
- **Position Management**: Track and optimize your lending positions
- **Health Factor Monitoring**: Track liquidation risks and position safety
- **Gas Optimization**: Smart gas allocation for P2P matching
- **Comprehensive Analytics**: Evaluate matching efficiency and rate improvements

## Installation

```bash
bun add @elizaos/plugin-morpho
```

## Configuration

The plugin requires the following environment variables:

```env
# Required
BASE_RPC_URL=https://mainnet.base.org
WALLET_PRIVATE_KEY=0x... # Your wallet private key

# Optional
MORPHO_API_KEY=your_api_key # If using Morpho API
MORPHO_NETWORK=base # or base-sepolia for testnet
MAX_GAS_FOR_MATCHING=500000 # Max gas for P2P matching
MATCHING_EFFICIENCY_THRESHOLD=0.7 # Min efficiency threshold (0-1)
RATE_IMPROVEMENT_THRESHOLD=0.1 # Min rate improvement threshold
MAX_GAS_PRICE=50000000000 # Max gas price in wei
RETRY_ATTEMPTS=3 # Number of retry attempts
MONITORING_INTERVAL=60000 # Position monitoring interval in ms
```

## Usage

### Basic Setup

```typescript
import { morphoPlugin } from '@elizaos/plugin-morpho';
import { createAgent } from '@elizaos/core';

const agent = createAgent({
  plugins: [morphoPlugin],
  // ... other configuration
});
```

### Natural Language Commands

The plugin understands various natural language commands. **Important**: Always specify the token symbol (USDC, WETH, DAI) with amounts for clarity.

#### Market Structure
In Morpho Blue markets like "WETH/USDC":
- **Loan Token** (USDC): Used for supply/borrow operations to earn yield or take loans
- **Collateral Token** (WETH): Used for collateral operations to secure borrowing positions

#### Token Operation Mapping
- **Supply/Borrow/Withdraw/Repay**: Uses the loan token (e.g., USDC in WETH/USDC)
- **Supply Collateral/Withdraw Collateral**: Uses the collateral token (e.g., WETH in WETH/USDC)

#### Examples by Operation Type

#### Supply Assets (Lend to Earn Yield)
- "Supply 1000 USDC to WETH/USDC market"
- "Lend 0.5 USDC to WETH/USDC for yield"
- "Supply 500 DAI to DAI/WETH market"

#### Supply Collateral  
- "Provide 0.5 WETH as collateral in WETH/USDC"
- "Supply 1 WETH collateral for WETH/USDC market"
- "Add 2 WETH as collateral in WETH/DAI"

#### Borrow Assets
- "Borrow 500 USDC from WETH/USDC market"
- "Take a loan of 200 USDC against WETH"
- "Borrow 1000 DAI from DAI/WETH market"

#### Withdraw Assets (Remove Supplied Funds)
- "Withdraw 300 USDC from WETH/USDC market"
- "Remove 100 USDC from my supply position"
- "Withdraw 500 DAI from DAI/WETH"

#### Withdraw Collateral
- "Remove 0.1 WETH collateral from WETH/USDC"
- "Withdraw 0.5 WETH collateral from WETH/DAI"
- "Remove WETH collateral from market"

#### Repay Loans
- "Repay 200 USDC in WETH/USDC market"
- "Pay back all USDC debt in WETH/USDC"
- "Repay 500 DAI loan in DAI/WETH"

#### Vault Operations
- "Deposit 1000 USDC into the Morpho USDC vault"
- "Withdraw 500 USDC from my vault position"
- "I want to add 0.5 WETH to the vault"
- "Remove all my shares from the USDC vault"

#### Bundled Operations
- "Supply 1 WETH and borrow 2000 USDC in one transaction"
- "I want to supply collateral and take a loan atomically"
- "Bundle supply and borrow to save gas"

#### Rewards
- "Claim my Morpho rewards"
- "I want to harvest my MORPHO tokens"
- "Check and claim all my available rewards"

### Advanced Usage

#### Custom Gas Settings
```
"Supply 1000 USDC with max 300000 gas for matching"
"Borrow 0.5 WETH using 400000 gas for better rates"
```

## Architecture

### Services

- **MorphoService**: Handles all Morpho Blue protocol interactions using real SDK
  - Real market data fetching via `Market.fetch()`
  - Authentic position tracking with `AccrualPosition.fetch()`
  - Live market configuration via `MarketParams.fetch()`
  - Historical APY calculations using blockchain data

### Actions

#### Core Lending Actions
- **SupplyAction**: Handles asset supply with P2P matching
- **BorrowAction**: Manages borrowing with rate optimization
- **WithdrawAction**: Executes withdrawals with minimal impact
- **RepayAction**: Processes loan repayments efficiently

#### Vault Actions
- **VaultDepositAction**: Deposits assets into Morpho Vaults
- **VaultWithdrawAction**: Withdraws from vaults with fee optimization

#### Bundler Actions
- **BundledSupplyBorrowAction**: Executes supply+borrow atomically
- **More bundler combinations**: Additional atomic operation patterns

#### Rewards Actions
- **ClaimRewardsAction**: Claims available protocol rewards

### Providers

- **PositionContextProvider**: Supplies position information to the agent
- **MatchingRateProvider**: Provides rate comparison context

### Evaluators

- **RateImprovementEvaluator**: Analyzes rate improvements post-transaction
- **MatchingEfficiencyEvaluator**: Evaluates P2P matching effectiveness

## API Endpoints

The plugin exposes the following REST endpoints:

- `GET /api/morpho/position/:address?` - Get user position
- `GET /api/morpho/rates/:asset` - Get rate comparison for an asset
- `GET /api/morpho/markets` - Get all market data
- `GET /api/morpho/vaults` - Get available Morpho Vaults
- `GET /api/morpho/vault/:address` - Get specific vault information
- `GET /api/morpho/rewards/:address?` - Get user's claimable rewards
- `GET /api/morpho/health/:address?` - Get user's health factor and liquidation risk

## Examples

### Example 1: Supply with Optimal Matching

```typescript
// User: "Supply 5000 USDC to WETH/USDC market to earn yield"
// Agent response:
"🏦 I'll supply 5000 USDC to the WETH/USDC market for optimized yields through peer-to-peer matching.

📊 Transaction Details:
- Market: WETH/USDC (supplying USDC - the loan token)
- Transaction Hash: 0xabc...123
- Amount Supplied: 5000 USDC
- P2P Matched: 3500 USDC (70%)
- Pool Deposited: 1500 USDC

💰 Rate Improvement:
- Your APY: 4.5%
- Pool APY: 3.0%
- Improvement: +50%"
```

### Example 2: Efficient Borrowing

```typescript
// User: "Borrow 1000 USDC from WETH/USDC market"
// Agent response:
"💸 I'll borrow 1000 USDC from the WETH/USDC market with optimized rates through peer-to-peer matching.

📊 Transaction Details:
- Market: WETH/USDC (borrowing USDC - the loan token)
- Amount Borrowed: 1000 USDC
- P2P Matched: 600 USDC (60%)
- Your Rate: 3.2%
- Pool Rate: 4.5%
- Rate Savings: 1.3%"
```

### Example 3: Collateral Management

```typescript
// User: "Provide 2 WETH as collateral in WETH/USDC market"
// Agent response:
"🔐 I'll provide 2 WETH as collateral to the WETH/USDC market.

📊 Transaction Details:
- Market: WETH/USDC (collateralizing WETH - the collateral token)
- Amount: 2 WETH
- Health Factor: 2.8 (Safe)
- Max Borrowable: ~4,800 USDC"
```

## Error Handling

The plugin includes comprehensive error handling for:

- Insufficient collateral
- P2P matching failures
- Liquidity constraints
- Network issues
- Invalid parameters

Each error includes helpful suggestions for resolution.

## Gas Optimization

The plugin automatically optimizes gas usage for P2P matching:

1. Estimates required gas based on market conditions
2. Adjusts gas limits for network congestion
3. Analyzes cost-benefit of matching operations
4. Provides recommendations for optimal gas allocation

## Best Practices

1. **Monitor Health Factor**: Keep health factor above 1.5 for safety
2. **Optimize Timing**: Execute transactions during high matching periods
3. **Adjust Amounts**: Match common liquidity sizes for better P2P matching
4. **Gas Management**: Use recommended gas limits for optimal results
5. **Regular Monitoring**: Check position efficiency periodically

## Troubleshooting

### Common Issues

1. **Low Matching Efficiency**
   - Try different transaction amounts
   - Execute during peak activity periods
   - Increase gas allocation for matching

2. **High Gas Costs**
   - Reduce matching gas limit for smaller positions
   - Bundle operations when possible
   - Monitor network congestion

3. **Rate Not Improving**
   - Check current market conditions
   - Verify P2P liquidity availability
   - Consider different assets

## Development

### Running Tests

```bash
# Run all tests
bun test

# Run only unit tests  
bun test:unit

# Run integration tests (requires RPC configuration)
bun test:integration

# Watch mode
bun test:watch
```

### Building

```bash
bun run build
```

### Type Checking

```bash
bun run lint
```

## Security Considerations

- Never share your private key
- Use a dedicated wallet for testing
- Monitor position health regularly
- Understand liquidation risks
- Verify transaction details before execution

## License

MIT

## Support

For issues and feature requests, please open an issue on the [ElizaOS GitHub repository](https://github.com/elizaos/eliza/issues).