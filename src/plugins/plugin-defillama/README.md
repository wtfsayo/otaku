# @elizaos/plugin-defillama

DeFiLlama plugin for ElizaOS that provides comprehensive DeFi market data, analytics, and yield information.

## Features

- **Protocol Data**: Real-time TVL, volume, rankings, and market share analysis
- **Yield Search**: Find and filter yield farming opportunities across protocols
- **Market Trends**: Analyze sector performance and identify market movements
- **Historical Data**: Access time-series data for pattern recognition and analysis
- **Cross-Chain Analytics**: Compare DeFi opportunities across different blockchain networks
- **Fees & Volume**: Track protocol fees, revenue, and DEX trading volumes
- **Price Data**: Current and historical token/coin prices with confidence scores
- **Stablecoin Analytics**: Monitor stablecoin market cap and circulation data
- **DeFi Recommendations**: Get intelligent suggestions for yield opportunities
- **Risk Analysis**: Assess protocol safety and investment risks

## Installation

```bash
bun add @elizaos/plugin-defillama
```

## Configuration

The plugin accepts the following environment variables:

```env
# Optional: DeFiLlama API key (if required in the future)
DEFILLAMA_API_KEY=

# Rate limiting
RATE_LIMIT_PER_MINUTE=300        # API request rate limit
MAX_CONCURRENT_REQUESTS=10       # Maximum concurrent API requests
```

## Usage

### Basic Setup

```typescript
import { createElizaAgent } from '@elizaos/core';
import { defiLlamaPlugin } from '@elizaos/plugin-defillama';

const agent = createElizaAgent({
  plugins: [defiLlamaPlugin],
  // ... other configuration
});
```

### Available Actions

#### Protocol Data
```
"What's the current TVL of Aave?"
"Compare Uniswap and Curve protocols"
"Show me the top 10 DeFi protocols by TVL"
"What's the market share of lending protocols?"
```

#### Yield Search
```
"Find the best stablecoin yields"
"Show me yields above 10% APY"
"What are the top yield opportunities on Ethereum?"
"Find USDC yields on Arbitrum"
```

#### Market Trends
```
"What are the current DeFi market trends?"
"Show me sector performance for the last week"
"Are there any unusual market movements?"
"Compare DEX vs lending protocol growth"
```

#### Historical Data
```
"Show me Compound's TVL history for the last month"
"What's the historical yield trend for USDT?"
"Compare protocol growth over the last year"
```

#### Cross-Chain Analysis
```
"Compare DeFi activity across all chains"
"Which chain has the highest yields?"
"Find the best opportunities on L2s"
"Show me bridge volumes between chains"
```

#### Fees & Volume
```
"Show me the top DEX volumes"
"What are the protocol fees for Ethereum?"
"Compare trading volume across all chains"
"Which protocols generate the most revenue?"
```

#### Price Data
```
"What is the current price of ETH?"
"Show me BTC and ETH prices"
"Get the price of AAVE token"
"How much is USDC worth?"
```

#### DeFi Recommendations
```
"Recommend safe high-yield opportunities"
"Find the best APY on Arbitrum"
"Suggest protocols for conservative investors"
"What are good yield strategies for $10k?"
```

#### Risk Analysis
```
"Is Aave safe to use?"
"Analyze the risk of this high APY pool"
"What are the risks in DeFi right now?"
"Check the security of Compound protocol"
```

#### Stablecoin Analytics
```
"Show me USDC market cap"
"Which stablecoins are growing?"
"Check DAI peg stability"
"Compare stablecoin circulation"
```

## Architecture

The plugin follows ElizaOS architecture patterns with a simplified, maintainable design:

### Core Service
- **DefiLlamaService**: Main API integration with intelligent rate limiting and error handling

### Actions
- **ProtocolDataAction**: Fetch comprehensive protocol information and analytics
- **YieldSearchAction**: Search and filter yield farming opportunities
- **MarketTrendsAction**: Analyze DeFi market trends and sector performance
- **HistoricalDataAction**: Retrieve and analyze historical data patterns
- **CrossChainAction**: Cross-chain comparisons and bridge analytics
- **FeesVolumeAction**: Protocol fees, revenue, and DEX volume data
- **PriceDataAction**: Current and historical token prices
- **DefiRecommendationAction**: Intelligent yield and protocol recommendations
- **RiskAnalysisAction**: Comprehensive risk assessment of protocols
- **StablecoinAction**: Stablecoin market analysis and peg monitoring

### Providers
- **MarketDataProvider**: Overall DeFi market state and trends for agent context
- **StablecoinContextProvider**: Stablecoin market health and peg status
- **ProtocolSlugsProvider**: Protocol identifier mapping and validation

## Key Features

### Intelligent Data Processing
- Smart validation and error handling across all endpoints
- Comprehensive data formatting for consistent responses
- Automatic fallback strategies for API issues

### Multi-Chain Support
- Ethereum, Arbitrum, Polygon, BSC, Avalanche, and more
- Cross-chain yield comparisons
- Bridge volume and activity tracking

### Risk Assessment
- Protocol security analysis
- Yield opportunity risk evaluation
- Market condition assessments

### Performance Optimized
- Streamlined architecture for fast responses
- Efficient API usage with smart request batching
- Minimal overhead with focused functionality

## Development

```bash
# Install dependencies
bun install

# Build the plugin
bun run build

# Run tests
bun test

# Run integration tests
bun test integration

# Lint code
bun run lint
```

## Testing

The plugin includes comprehensive test coverage:
- Unit tests for all actions and services
- Integration tests for API endpoints
- Provider tests for context data
- Error handling and edge case validation

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

## License

MIT