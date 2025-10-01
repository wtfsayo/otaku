# Otaku - DeFi Analysis AI Agent

Meet **Otaku**, a specialized DeFi and portfolio analysis AI agent built on ElizaOS. Otaku is a data-driven financial analyst that prioritizes on-chain data and market research before providing investment recommendations.

## 🤖 Agent Overview

**Otaku** is a nerdy DeFi analyst with expertise in:
- Advanced DeFi protocol analysis and yield farming strategies
- Portfolio optimization and risk assessment
- On-chain data interpretation and market trend analysis
- Cross-chain operations and bridge analysis
- Token deployment and management
- Automated trading and liquidity management

### Core Personality
- **Data-First Approach**: Always analyzes market data before making recommendations
- **Risk-Aware**: Focuses on risk assessment and safe investment strategies  
- **Analytical**: Provides precise, metric-driven insights
- **Protocol Expert**: Deep understanding of DeFi mechanics and tokenomics

## 🚀 Core Capabilities

### 🪙 Token Operations
- **Deploy New Tokens**: Create memecoins and custom tokens on Base L2 using Clanker protocol
- **Token Analysis**: Get comprehensive market data, price analysis, and holder statistics
- **Token Information**: Query real-time prices, market cap, trading volume, and liquidity metrics
- **Advanced Token Features**: Vanity addresses, custom pool configurations, and vesting schedules

### 💰 Wallet Management
- **Multi-Chain Wallets**: Create and manage Ethereum wallets across multiple EVM chains
- **Coinbase CDP Wallets**: Create secure, MPC-based wallets using Coinbase Developer Platform
- **Balance Tracking**: Check ETH and token balances across different networks
- **Secure Operations**: Private key generation and secure transaction signing
- **Address Validation**: Smart contract and EOA address verification

### 🔄 DeFi Trading & Transfers
- **Cross-Chain Bridging**: Bridge assets between Ethereum, Base, Arbitrum, and other EVM chains
- **Token Swapping**: Execute optimal swaps using LiFi integration and DEX aggregation
- **Native Transfers**: Send ETH and ERC-20 tokens with automatic gas optimization
- **MEV Protection**: Built-in protection against sandwich attacks and frontrunning

### 🏦 Advanced DeFi Protocols

#### Morpho Blue Integration
- **Optimized Lending**: Supply assets to earn enhanced yields through P2P matching
- **Efficient Borrowing**: Access better borrowing rates via direct peer matching
- **Collateral Management**: Smart collateral operations with health factor monitoring
- **Vault Operations**: Deposit/withdraw from curated Morpho Vaults (ERC4626)
- **Bundled Transactions**: Execute multiple operations atomically to save gas
- **Rewards Management**: Track and claim MORPHO and other incentive tokens

#### Market Analysis
- **Real-time Rates**: Compare Morpho vs pool rates across different assets
- **Position Health**: Monitor liquidation risks and position safety metrics
- **APY Calculations**: Historical yield analysis using blockchain data
- **Gas Optimization**: Smart gas allocation for P2P matching efficiency

### 📊 Portfolio & Market Analysis
- **Portfolio Tracking**: Monitor positions across multiple DeFi protocols
- **Risk Assessment**: Analyze correlation, diversification, and liquidation risks
- **Market Research**: Access DeFiLlama data for protocol TVL, volumes, and trends
- **Performance Analytics**: Track yield farming and liquidity mining returns

## 🌐 Platform Integrations

### Supported Platforms
- **Discord**: Deploy and manage through Discord commands
- **Twitter/X**: Share analysis and interact via Twitter integration  
- **Telegram**: Telegram bot functionality for portfolio updates

### AI Model Support
- **OpenAI**: Advanced reasoning and analysis capabilities
- **Anthropic**: Claude integration for complex DeFi analysis
- **OpenRouter**: Access to multiple AI models
- **Google GenAI**: Gemini integration for data processing

### Data Sources
- **DeFiLlama**: Protocol TVL, volume, and fundamental data
- **On-Chain Data**: Real-time blockchain data analysis
- **Market APIs**: Price feeds and trading data integration

## 🔧 Getting Started

### Prerequisites
```bash
# Ensure you have Bun installed
curl -fsSL https://bun.sh/install | bash

# Clone and setup
git clone <repository-url>
cd wise
bun install
```

### Environment Configuration
```bash
# Required for core functionality
EVM_PRIVATE_KEY=your-wallet-private-key
BASE_RPC_URL=https://mainnet.base.org

# Coinbase CDP (Developer Platform) - Required for CDP wallet operations
COINBASE_API_KEY_NAME=your-cdp-api-key-name
COINBASE_PRIVATE_KEY=your-cdp-private-key
COINBASE_WALLET_SECRET=your-wallet-secret-hex-string  # Generate with: openssl rand -hex 32

# Optional: AI Model APIs
OPENAI_API_KEY=your-openai-key
ANTHROPIC_API_KEY=your-anthropic-key
OPENROUTER_API_KEY=your-openrouter-key

# Optional: Platform Integrations  
DISCORD_API_TOKEN=your-discord-bot-token
TWITTER_API_KEY=your-twitter-api-key
TELEGRAM_BOT_TOKEN=your-telegram-bot-token

# Optional: Advanced Features
MORPHO_API_KEY=your-morpho-api-key
CLANKER_API_URL=https://api.clanker.com
```

### Setting Up Coinbase CDP Wallet

The `COINBASE_WALLET_SECRET` is **required** for creating and managing wallets through the Coinbase Developer Platform. This secret is used for multi-party computation (MPC) key management.

**Generate a secure wallet secret:**
```bash
# Using OpenSSL (recommended)
openssl rand -hex 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the generated hex string and add it to your `.env` file:
```bash
COINBASE_WALLET_SECRET=<your_generated_hex_string>
```

**Important Notes:**
- The wallet secret must be a hex-encoded string (64+ characters)
- Keep this secret secure - it's used for wallet authentication
- Do NOT commit this secret to version control
- Coinbase CDP uses MPC (Multi-Party Computation) for enhanced security

### Quick Start
```bash
# Start the agent in development mode
bun run dev

# Or start in production mode
bun run start

# Run tests
bun run test
```

## 💬 Usage Examples

### Token Operations
```bash
# Deploy a new memecoin
"Deploy a token called PEPE with symbol PEPE on Base"
"Create a token called DogeCoin with 0.1 ETH initial buy"

# Get token information
"What's the price of WETH?"
"Show me stats for 0x1234...token address"
"Get market data for BASE token"

# Check balances
"What's my ETH balance?"
"Check my wallet balance"
```

### DeFi Operations
```bash
# Morpho Blue lending
"Supply 1000 USDC to WETH/USDC market"
"Borrow 500 USDC against my WETH collateral"
"Withdraw 100 USDC from my position"
"Provide 0.5 WETH as collateral"

# Cross-chain operations
"Bridge 1 ETH from Ethereum to Base"
"Swap 1000 USDC for WETH on Base"
"Transfer 0.5 ETH to 0x742d35...address"
```

### Wallet Management
```bash
# Create wallets
"Create a new Ethereum wallet"
"Create a Base wallet"
"Create a CDP wallet for me"  # Coinbase Developer Platform wallet

# Wallet information
"Show my CDP wallet info"
"Check my wallet balance"
"List my wallets"

# Import existing wallets  
"Import wallet with private key 0x..."
```

### Market Analysis
```bash
# Portfolio analysis
"Analyze my DeFi positions"
"What's my portfolio health?"
"Show me my Morpho yields"

# Market research
"What are the best yield farming opportunities?"
"Compare lending rates across protocols"
"Show me Base ecosystem protocols"
```

## 🏗️ Architecture

### Core Components

#### Plugins
- **Bootstrap Plugin**: Core message handling and action coordination
- **Clanker Plugin**: Token deployment and management on Base L2
- **CDP Plugin**: Coinbase Developer Platform integration for MPC wallet management
- **EVM Plugin**: Multi-chain wallet operations and cross-chain bridging
- **Morpho Plugin**: Advanced DeFi lending and yield optimization
- **Eth Wallet Plugin**: Secure wallet creation and management

#### Services
- **CdpService**: Manages Coinbase Developer Platform authentication and wallet operations
- **ClankerService**: Interfaces with Clanker SDK for token operations
- **MorphoService**: Integrates with Morpho Blue protocol via official SDK
- **WalletService**: Manages multi-chain wallet operations and transactions
- **EVMChainService**: Handles cross-chain operations and RPC management

#### Providers
- **Position Context**: Supplies real-time position data across protocols
- **Market Data**: Provides current market rates, gas prices, and liquidity
- **Wallet Status**: Tracks wallet health and required user actions

## 🧪 Testing

The project includes comprehensive testing across all components:

```bash
# Run all tests
bun run test

# Run component tests only
bun run test:component

# Run with coverage
bun run test:coverage

# Watch mode for development
bun run test:watch
```

### Test Coverage
- **85%+ Coverage**: Comprehensive test coverage across all plugins
- **Integration Tests**: Real protocol interactions using test networks
- **Unit Tests**: Individual component and service testing
- **E2E Tests**: Full agent workflow testing

## 🔒 Security Considerations

### Best Practices
- **Private Key Management**: Never expose private keys in logs or code
- **Environment Variables**: Use secure environment variable management
- **Transaction Validation**: All transactions include parameter validation
- **Gas Optimization**: Automatic gas price monitoring and optimization
- **Slippage Protection**: Built-in slippage and MEV protection

### Risk Management
- **Health Factor Monitoring**: Automatic position health tracking
- **Liquidation Alerts**: Proactive risk management for lending positions
- **Rate Validation**: Market rate verification before executing trades
- **Retry Logic**: Robust transaction retry with exponential backoff

## 📈 Supported Networks

### EVM Chains
- **Ethereum Mainnet**: Primary chain for established protocols
- **Base L2**: Optimized for token deployment and low-cost operations
- **Arbitrum**: Layer 2 scaling with DeFi ecosystem
- **Polygon**: Fast and cheap transactions for portfolio management
- **Custom Chains**: Configurable support for additional EVM networks

### Protocol Support
- **Morpho Blue**: P2P lending optimization on Base
- **Clanker**: Token deployment infrastructure on Base
- **LiFi**: Cross-chain bridging and swap aggregation
- **Uniswap V3/V4**: Decentralized exchange integration
- **DeFiLlama**: Protocol data and analytics

## 🛠️ Development

### Project Structure
```
src/
├── character.ts          # Otaku character configuration
├── index.ts             # Main agent entry point
├── plugins/             # Specialized plugin modules
│   ├── plugin-bootstrap/    # Core message handling
│   ├── plugin-cdp/         # Coinbase Developer Platform
│   ├── plugin-clanker/     # Token deployment
│   ├── plugin-evm/         # Multi-chain operations
│   ├── plugin-morpho/      # DeFi lending
│   └── plugin-ethwallet/   # Wallet management
└── utils/               # Shared utilities

tests/
├── actions/             # Action test suites
├── services/            # Service integration tests
└── utils/               # Test utilities
```

### Building and Deployment
```bash
# Build for production
bun run build

# Type checking
bun run type-check

# Code formatting
bun run format

# Linting
bun run lint
```

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests (`bun test`)
4. Commit changes (`git commit -m 'Add amazing feature'`)
5. Push to branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

### Development Guidelines
- Write comprehensive tests for new features
- Follow existing code style and patterns
- Update documentation for API changes
- Ensure all tests pass before submitting PRs

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **ElizaOS**: The foundational AI agent framework
- **Morpho Protocol**: Advanced DeFi lending infrastructure
- **Clanker Protocol**: Token deployment platform on Base
- **LiFi**: Cross-chain bridging and swap aggregation
- **Base Network**: L2 scaling solution for efficient operations
