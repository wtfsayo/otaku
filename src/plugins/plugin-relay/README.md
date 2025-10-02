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
RELAY_API_KEY=your-relay-api-key  # For higher rate limits and priority support
RELAY_ENABLE_TESTNET=false        # Set to 'true' to use testnet (default: false)
```

**Production Requirements:**
- ✅ `EVM_PRIVATE_KEY`: Required for executing transactions
- ✅ Latest SDK: Using `@relayprotocol/relay-sdk` v2.4.6+
- ✅ Error Handling: Comprehensive validation and error handling implemented
- ✅ Type Safety: Full TypeScript support with proper typing
- ✅ Multi-chain Support: 9+ EVM chains supported
- ✅ Progress Tracking: Real-time transaction progress callbacks
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
- Quote generation
- Bridge execution
- Transaction status tracking
- Chain and currency information
- Transaction indexing

### Actions

#### relayQuoteAction
- **Name**: `GET_RELAY_QUOTE`
- **Purpose**: Get quotes for cross-chain transactions
- **Triggers**: Keywords like "quote", "bridge", "estimate", "cost"

#### relayBridgeAction
- **Name**: `EXECUTE_RELAY_BRIDGE`
- **Purpose**: Execute cross-chain bridge transactions
- **Triggers**: Keywords like "bridge", "transfer", "send" with chain names

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

### Basic Bridge

```typescript
import { RelayService } from "@elizaos/plugin-relay";

const relayService = runtime.getService<RelayService>(RelayService.serviceType);

const requestId = await relayService.executeBridge({
  user: "0x742d35Cc6634C0532925a3b8d382F4d2d5d9a65e",
  originChainId: 1,
  destinationChainId: 8453,
  currency: "eth",
  amount: "100000000000000000", // 0.1 ETH in wei
});
```

### Get Quote

```typescript
const quote = await relayService.getQuote({
  user: "0x742d35Cc6634C0532925a3b8d382F4d2d5d9a65e",
  originChainId: 1,
  destinationChainId: 8453,
  originCurrency: "eth",
  amount: "100000000000000000",
});

console.log(`Fee: ${quote.fees.gas} wei`);
console.log(`Rate: ${quote.details.rate}`);
```

### Check Status

```typescript
const statuses = await relayService.getStatus({
  requestId: "0x1234...",
});

console.log(`Status: ${statuses[0].status}`);
```

## Production Checklist

Before deploying to production, ensure:

- [ ] `EVM_PRIVATE_KEY` is securely stored (use environment variables, not hardcoded)
- [ ] Tested on testnet first (`RELAY_ENABLE_TESTNET=true`)
- [ ] Sufficient gas in wallet for all supported chains
- [ ] Error handling and monitoring in place
- [ ] Rate limiting configured (use `RELAY_API_KEY` for higher limits)
- [ ] Transaction status monitoring implemented
- [ ] Proper logging for debugging

## Security Best Practices

1. **Never expose private keys** - Use secure environment variable management
2. **Validate user inputs** - All amounts and addresses are validated before execution
3. **Monitor transactions** - Use `getStatus()` to track transaction progress
4. **Test thoroughly** - Always test on testnet before mainnet deployment
5. **Rate limiting** - Consider implementing rate limiting for user requests
6. **Error handling** - All methods include try-catch blocks and proper error messages

## Changelog

### v1.0.0 (October 2025)
- ✅ Updated to `@relayprotocol/relay-sdk` v2.4.6
- ✅ Added comprehensive error handling and validation
- ✅ Implemented proper TypeScript typing
- ✅ Added progress tracking for transactions
- ✅ Production-ready with mainnet support
- ✅ Added testnet support via configuration
- ✅ Enhanced security with input validation
- ✅ Improved logging and debugging
- ✅ **Chain name resolution**: LLM extracts chain names (not IDs) which are resolved using viem chains
- ✅ **Amount parsing**: Automatic conversion from human-readable amounts to wei
- ✅ **Robust validation**: Chain names validated against supported chains before execution

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
