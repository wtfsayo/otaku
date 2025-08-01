# EVM Plugin Test Suite

This directory contains comprehensive tests for the EVM plugin functionality, designed to work with real testnets for reliable validation.

## Test Networks

The tests use the following testnets:
- **Sepolia** (Ethereum testnet) - Chain ID: 11155111
- **Base Sepolia** - Chain ID: 84532  
- **Optimism Sepolia** - Chain ID: 11155420
- **Arbitrum Sepolia** - Chain ID: 421614

## Environment Setup

### Required Environment Variables

```bash
# Optional: Use a specific private key for testing (will generate random if not provided)
TEST_PRIVATE_KEY=0x1234567890abcdef...

# Optional: Use a funded wallet private key for integration tests
FUNDED_TEST_PRIVATE_KEY=0xabcdef1234567890...

# Optional: Custom RPC URLs (will use public endpoints if not provided)
SEPOLIA_RPC_URL=https://your-sepolia-rpc.com
BASE_SEPOLIA_RPC_URL=https://your-base-sepolia-rpc.com
OP_SEPOLIA_RPC_URL=https://your-optimism-sepolia-rpc.com
```

### Getting Testnet Funds

To run integration tests that actually execute transactions, you'll need testnet ETH:

1. **Sepolia ETH**: 
   - https://sepoliafaucet.com/
   - https://faucet.sepolia.dev/

2. **Base Sepolia ETH**:
   - https://bridge.base.org/ (bridge from Sepolia)
   - https://coinbase.com/faucets/base-ethereum-sepolia-faucet

3. **Optimism Sepolia ETH**:
   - https://app.optimism.io/faucet
   - Bridge from Sepolia via official bridges

## Test Structure

### 1. Wallet Tests (`wallet.test.ts`)
- Wallet initialization and configuration
- Chain management (adding/removing chains)
- Balance operations
- Network connectivity validation
- Custom RPC URL support

### 2. Transfer Tests (`transfer.test.ts`)
- Basic ETH transfers on testnets
- Parameter validation
- Gas estimation
- Error handling for insufficient funds
- Integration tests with funded wallets

### 3. Swap Tests (`swap.test.ts`)
- Token swaps on individual chains
- Multiple aggregator support (LiFi, Bebop)
- Slippage protection
- Quote comparison
- Error handling and recovery

### 4. Bridge Tests (`bridge.test.ts`)
- Cross-chain token bridging
- Multiple testnet support
- Progress monitoring
- Route discovery
- Cost estimation

## Running Tests

### Run All Tests
```bash
bun test
```

### Run Specific Test Files
```bash
# Wallet tests
bun test wallet.test.ts

# Transfer tests  
bun test transfer.test.ts

# Swap tests
bun test swap.test.ts

# Bridge tests
bun test bridge.test.ts
```

### Run with Environment Variables
```bash
TEST_PRIVATE_KEY=0x... FUNDED_TEST_PRIVATE_KEY=0x... bun test
```

## Test Behavior

### Without Funded Wallet
- Tests will use generated private keys with zero balance
- Tests will validate error handling for insufficient funds
- Network connectivity and parameter validation will still work
- No actual transactions will be executed

### With Funded Wallet
- Integration tests will execute real transactions
- Actual swaps and bridges will be attempted
- Transaction receipts will be validated
- Real network fees will be incurred

## Test Categories

### Unit Tests
- Parameter validation
- Error handling
- Configuration testing
- No network calls required

### Integration Tests  
- Network connectivity
- Balance fetching
- Gas estimation
- Requires network access but no funds

### End-to-End Tests
- Actual transaction execution
- Cross-chain operations
- Requires funded testnet wallet
- Real network fees apply

## Debugging

### Common Issues

1. **Network Connectivity**
   ```
   Error: Network unreachable
   ```
   - Check internet connection
   - Verify RPC URLs are working
   - Try different public RPC endpoints

2. **Insufficient Funds**
   ```
   Error: Transfer failed: insufficient funds
   ```
   - Fund your test wallet with testnet ETH
   - Check balance on block explorers
   - Ensure you're using the correct private key

3. **Transaction Failures**
   ```
   Error: Transaction reverted
   ```
   - Check gas prices on testnet
   - Verify token addresses are correct
   - Ensure sufficient balance for gas + amount

### Verbose Logging
```bash
DEBUG=1 bun test
```

## Best Practices

1. **Use Small Amounts**: Test with minimal amounts (0.001 ETH or less)
2. **Check Balances**: Verify wallet balances before running tests
3. **Monitor Gas**: Testnet gas prices can be volatile
4. **Parallel Tests**: Be careful running multiple tests simultaneously
5. **Clean State**: Each test should be independent

## Block Explorers

Monitor your test transactions:
- **Sepolia**: https://sepolia.etherscan.io/
- **Base Sepolia**: https://sepolia.basescan.org/
- **Optimism Sepolia**: https://sepolia-optimism.etherscan.io/

## Security

⚠️ **Never use mainnet private keys in tests!**
- Only use testnet wallets
- Keep funded amounts minimal
- Use environment variables for sensitive data
- Don't commit private keys to version control 