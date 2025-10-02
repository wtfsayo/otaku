# @elizaos/plugin-relay

Relay Link integration plugin for ElizaOS, enabling cross-chain bridging, swapping, and execution through the Relay protocol.

## Features

- 🌉 **Cross-Chain Bridging**: Bridge assets between multiple EVM chains
- 💱 **Token Swapping**: Swap tokens across different chains
- 📊 **Quote Generation**: Get accurate quotes for cross-chain transactions
- 🔍 **Transaction Tracking**: Monitor transaction status and history
- ⚡ **Fast & Low-Cost**: Optimized for speed (1-10 seconds) and minimal fees
- 🔒 **Secure**: Built on the Relay protocol with relayer validation

## Supported Chains

- Ethereum (Chain ID: 1)
- Base (Chain ID: 8453)
- Arbitrum (Chain ID: 42161)
- Polygon (Chain ID: 137)
- Optimism (Chain ID: 10)
- Zora (Chain ID: 7777777)
- Blast (Chain ID: 81457)
- Scroll (Chain ID: 534352)
- Linea (Chain ID: 59144)

## Supported Currencies

- ETH
- USDC
- USDT
- WETH
- USDC.e
- WBTC
- DEGEN
- TIA
- And more...

## Installation

```bash
bun add @elizaos/plugin-relay @relayprotocol/relay-sdk viem
```

**Note:** This plugin uses `@relayprotocol/relay-sdk` v2.4.6 (latest as of October 2025). Make sure you're using the correct package name (`@relayprotocol/relay-sdk`, not `@reservoir0x/relay-sdk`).

## Configuration

Add the following environment variables to your `.env` file:

```bash
# Required
EVM_PRIVATE_KEY=your-wallet-private-key

# Optional
RELAY_API_KEY=your-relay-api-key     # For higher rate limits and priority support
RELAY_ENABLE_TESTNET=false           # Set to 'true' to use testnet (default: false)
EVM_RPC_URL=your-rpc-url             # Custom RPC URL (optional)
BASE_RPC_URL=https://mainnet.base.org # Fallback RPC URL (optional)
```

**Note on Wallet Configuration:**
- The plugin uses a multi-chain wallet that dynamically switches between chains
- Wallet automatically derives from `EVM_PRIVATE_KEY`
- No need to manually configure wallet for each chain
- Chain-specific RPC URLs are provided by default for all supported chains

**Production Requirements:**
- ✅ `EVM_PRIVATE_KEY`: Required for executing transactions
- ✅ Latest SDK: Using `@relayprotocol/relay-sdk` v2.4.6+
- ✅ Error Handling: Comprehensive validation and error handling implemented
- ✅ Type Safety: Full TypeScript support with proper typing
- ✅ Multi-chain Support: 9+ EVM chains with dynamic wallet switching
- ✅ Progress Tracking: Real-time transaction progress callbacks
- ✅ Token Resolution: Automatic token symbol to address resolution via CoinGecko
- ✅ Smart Amount Parsing: Automatic decimal handling for all token types
- ✅ Mainnet Ready: Production API endpoints by default

## Usage

### Import and Register the Plugin

```typescript
import { relayPlugin } from "@elizaos/plugin-relay";

// Add to your agent's plugins
const agent = {
  plugins: [relayPlugin, ...otherPlugins],
};
```

### Available Actions

#### 1. Get Quote
Get a quote for cross-chain transactions:

```
"Get me a quote to bridge 0.1 ETH from Ethereum to Base"
"How much would it cost to send 100 USDC from Base to Arbitrum?"
```

#### 2. Execute Bridge
Execute cross-chain bridge transactions:

```
"Bridge 0.5 ETH from Ethereum to Base"
"Send 1000 USDC from Base to Arbitrum"
"Transfer 0.1 ETH from Polygon to Optimism"
```

#### 3. Check Status
Monitor transaction status:

```
"Check the status of request 0x1234..."
"What's the status of my bridge transaction?"
"Show me my recent cross-chain transfers"
```

## Architecture

### Services

#### RelayService
Main service handling Relay SDK integration:
- **Quote generation**: Get accurate quotes for cross-chain transactions
- **Bridge execution**: Execute cross-chain transfers with progress tracking
- **Transaction status tracking**: Monitor transaction progress and completion
- **Multi-chain wallet**: Dynamic wallet that switches chains automatically
- **Token resolution**: Automatic token symbol to contract address resolution
- **Chain validation**: Validates and resolves chain names to chain IDs

### Key Features

#### Multi-Chain Wallet Support
The plugin includes a custom `MultiChainWallet` class that:
- Dynamically creates wallet clients for each chain as needed
- Automatically switches to the correct chain before transactions
- Caches wallet clients for performance
- Uses chain-specific RPC URLs for reliable connections

#### Token Resolution
Automatic token address resolution:
- Resolves human-readable token symbols (e.g., "USDC", "ETH") to contract addresses
- Fetches token metadata from CoinGecko API
- Supports native tokens (ETH) with zero address
- Retrieves accurate token decimals for amount parsing

#### Smart Amount Parsing
Handles token amounts intelligently:
- Converts human-readable amounts (e.g., "1.5") to wei/smallest units
- Automatically fetches and uses correct decimals for each token
- Supports both 6-decimal (USDC, USDT) and 18-decimal (ETH, WETH) tokens

### Actions

#### relayQuoteAction
- **Name**: `GET_RELAY_QUOTE`
- **Purpose**: Get quotes for cross-chain transactions
- **Triggers**: Keywords like "quote", "bridge", "estimate", "cost"
- **Features**:
  - LLM extracts chain names (not IDs) from natural language
  - Resolves token symbols to contract addresses automatically
  - Calculates accurate amounts with proper decimals
  - Displays formatted quote with fees and exchange rate

#### relayBridgeAction
- **Name**: `EXECUTE_RELAY_BRIDGE`
- **Purpose**: Execute cross-chain bridge transactions
- **Triggers**: Keywords like "bridge", "transfer", "send" with chain names
- **Features**:
  - Validates chain names and resolves to chain IDs
  - Resolves token addresses on both origin and destination chains
  - Automatically switches wallet to correct chain
  - Provides real-time progress updates
  - Handles BigInt serialization for storage

#### relayStatusAction
- **Name**: `CHECK_RELAY_STATUS`
- **Purpose**: Check transaction status
- **Triggers**: Keywords like "status", "check" with transaction identifiers

## API Reference

### RelayService Methods

#### `getQuote(request: QuoteRequest): Promise<RelayQuote>`
Get a quote for cross-chain transaction.

#### `executeBridge(request: BridgeRequest, onProgress?): Promise<string>`
Execute a bridge transaction and return request ID.

#### `getStatus(request: StatusRequest): Promise<RelayStatus[]>`
Get status of one or more transactions.

#### `getChains(): Promise<RelayChain[]>`
Get list of supported chains.

#### `getCurrencies(chainId: number): Promise<RelayCurrencyInfo[]>`
Get supported currencies for a specific chain.

#### `indexTransaction(txHash: string, chainId: number): Promise<void>`
Index a transaction for faster processing.

## Development

### Build

```bash
bun run build
```

### Test

```bash
bun run test
```

### Lint

```bash
bun run lint
```

## Examples

### Natural Language Commands

The plugin is designed to work with natural language:

```
# Get a quote
"Get me a quote to bridge 1.5 USDC from Optimism to Base"
"How much would 0.1 ETH cost to bridge from Ethereum to Arbitrum?"

# Execute a bridge
"Bridge 1.5 USDC from Optimism to Base"
"Send 0.05 ETH from Base to Optimism"

# Check status
"Check the status of my last bridge"
"What's the status of request 0x..."
```

### Programmatic Usage

#### Basic Bridge with Token Resolution

```typescript
import { RelayService } from "@elizaos/plugin-relay";

const relayService = runtime.getService<RelayService>(RelayService.serviceType);

// The service automatically handles:
// - Token symbol to address resolution
// - Amount parsing with correct decimals
// - Chain switching
const requestId = await relayService.executeBridge({
  user: "0x742d35Cc6634C0532925a3b8d382F4d2d5d9a65e",
  originChainId: 10, // Optimism
  destinationChainId: 8453, // Base
  currency: "0x0b2c639c533813f4aa9d7837caf62653d097ff85", // USDC address on Optimism
  toCurrency: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC address on Base
  amount: "1500000", // 1.5 USDC (6 decimals)
});
```

#### Get Quote with Progress Tracking

```typescript
const quote = await relayService.getQuote({
  user: "0x742d35Cc6634C0532925a3b8d382F4d2d5d9a65e",
  chainId: 10, // Origin chain: Optimism
  toChainId: 8453, // Destination chain: Base
  currency: "0x0b2c639c533813f4aa9d7837caf62653d097ff85", // USDC on Optimism
  toCurrency: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC on Base
  amount: "1500000",
});

console.log(`Fee: ${quote.fees.gas} wei`);
console.log(`Exchange Rate: ${quote.details.rate}`);
console.log(`Estimated Time: ${quote.details.timeEstimate}s`);
```

#### Execute with Progress Callbacks

```typescript
const requestId = await relayService.executeBridge(
  {
    user: "0x742d35Cc6634C0532925a3b8d382F4d2d5d9a65e",
    originChainId: 10,
    destinationChainId: 8453,
    currency: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
    toCurrency: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    amount: "1500000",
  },
  (progress) => {
    console.log(`Progress: ${progress.currentStep.description}`);
    console.log(`Status: ${progress.status}`);
  }
);
```

#### Check Status

```typescript
const statuses = await relayService.getStatus({
  requestId: "0x1234...",
});

const status = statuses[0];
console.log(`Status: ${status.status}`);
console.log(`Current Step: ${status.currentStep?.description}`);
if (status.txHashes) {
  console.log(`TX Hashes:`, status.txHashes);
}
```

## Production Checklist

Before deploying to production, ensure:

- [ ] `EVM_PRIVATE_KEY` is securely stored (use environment variables, not hardcoded)
- [ ] Tested on testnet first (`RELAY_ENABLE_TESTNET=true`)
- [ ] Sufficient native token balance in wallet for gas on all supported chains
- [ ] Sufficient token balances for bridging on origin chains
- [ ] Error handling and monitoring in place
- [ ] Rate limiting configured (use `RELAY_API_KEY` for higher limits)
- [ ] Transaction status monitoring implemented
- [ ] Logging configured for production environment
- [ ] RPC URLs configured and tested for reliability
- [ ] Understand token resolution may fail for unlisted tokens

## Security Best Practices

1. **Never expose private keys** - Use secure environment variable management
2. **Validate user inputs** - All amounts and addresses are validated before execution
3. **Monitor transactions** - Use `getStatus()` to track transaction progress
4. **Test thoroughly** - Always test on testnet before mainnet deployment
5. **Rate limiting** - Consider implementing rate limiting for user requests
6. **Error handling** - All methods include try-catch blocks and proper error messages

## Changelog

### v1.1.0 (Current)
- ✅ **Multi-Chain Wallet**: Dynamic wallet switching between chains
- ✅ **Token Resolution**: Automatic token symbol to address resolution via CoinGecko
- ✅ **Smart Decimals**: Automatic decimal fetching and amount parsing
- ✅ **BigInt Serialization**: Proper handling of BigInt values in responses
- ✅ **Eliza Logger**: Migrated to Eliza's built-in logger
- ✅ **Clean Logging**: Minimal, essential logs only
- ✅ **Chain-Specific Resolution**: Resolves tokens on both origin and destination chains
- ✅ **Improved Error Handling**: Better error messages and validation

### v1.0.0 (October 2025)
- ✅ Updated to `@relayprotocol/relay-sdk` v2.4.6
- ✅ Added comprehensive error handling and validation
- ✅ Implemented proper TypeScript typing
- ✅ Added progress tracking for transactions
- ✅ Production-ready with mainnet support
- ✅ Added testnet support via configuration
- ✅ Enhanced security with input validation
- ✅ Chain name resolution using viem chains
- ✅ Amount parsing from human-readable format
- ✅ Robust chain validation

## Resources

- [Relay Link Documentation](https://docs.relay.link)
- [Relay SDK Getting Started](https://docs.relay.link/references/sdk/getting-started)
- [API Reference](https://docs.relay.link/references/api/overview)
- [ElizaOS Documentation](https://elizaos.ai)
- [GitHub Issues](https://github.com/elizaos/eliza/issues)

## Support

For issues or questions:
- Open an issue on [GitHub](https://github.com/elizaos/eliza/issues)
- Check the [Relay Documentation](https://docs.relay.link)
- Join the ElizaOS community

## License

MIT
