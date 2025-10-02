# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## PROJECT INFORMATION
- **Project Name:** Otaku - DeFi Analysis AI Agent
- **Git Repository:** Yes
- **Main Branch:** main
- **Package Manager:** Bun (required)

---

## COMMON COMMANDS

### Development
```bash
bun run start              # Start the agent in production mode
bun run dev                # Start in development mode with live reload
bun run build              # Build project for production (TypeScript + tsup)
bun run clean              # Clean all generated files and dependencies
```

### Code Quality
```bash
bun run lint               # Format code with Prettier
bun run format             # Format code (alias for lint)
bun run format:check       # Check code formatting
bun run type-check         # Run TypeScript type checking
bun run type-check:watch   # Watch mode for type checking
bun run check-all          # Run type-check + format:check + test
```

### Testing
```bash
bun run test               # Run all tests (component + e2e)
bun run test:component     # Run component tests only
bun run test:e2e           # Run end-to-end tests
bun run test:coverage      # Run tests with coverage report
bun run test:watch         # Run tests in watch mode
bun run cy:open            # Open Cypress UI for interactive testing
bun run cypress:component  # Run Cypress component tests
bun run cypress:e2e        # Run Cypress e2e tests
```

**IMPORTANT:** All test commands automatically run `bun run test:install` first to ensure test dependencies are properly installed.

---

## ARCHITECTURE

### ElizaOS Agent Structure
This is an **ElizaOS-based AI agent** with a plugin architecture:

- **Main Agent**: `Otaku` - A data-driven DeFi analysis AI character
- **Core Entry Point**: `src/index.ts` - Exports the main project and character
- **Character Definition**: `src/character.ts` - Defines agent personality and capabilities

### Plugin System
The agent uses a modular plugin system with 5 specialized plugins:

1. **bootstrap** (`/src/plugins/plugin-bootstrap/`) - Core message handling and coordination
2. **clanker** (`/src/plugins/plugin-clanker/`) - Token deployment and management on Base L2
3. **evm** (`/src/plugins/plugin-evm/`) - Multi-chain operations and cross-chain bridging
4. **morpho** (`/src/plugins/plugin-morpho/`) - Advanced DeFi lending via Morpho Blue protocol
5. **ethwallet** (`/src/plugins/plugin-ethwallet/`) - Ethereum wallet creation and management

Each plugin has its own:
- `package.json` with dependencies
- TypeScript configuration (`tsconfig.json`, `tsconfig.build.json`)
- Build configuration (`tsup.config.ts`)
- Comprehensive test suite
- Actions, services, and providers

### Key Services and Integrations

#### DeFi Protocols
- **Morpho Blue**: P2P lending optimization with SDK integration
- **LiFi**: Cross-chain bridging and swap aggregation
- **Clanker**: Token deployment on Base L2 network
- **DeFiLlama**: Protocol data and market analytics

#### Blockchain Networks
- **Multi-chain EVM support**: Ethereum, Base, Arbitrum, Polygon
- **Viem integration**: Modern Ethereum library for wallet operations
- **RPC management**: Configurable endpoints for different networks

---

## DEVELOPMENT WORKFLOW

### Plugin Development
When working on plugins:
1. Each plugin is self-contained with its own dependencies
2. Use `bun test` from plugin directories to run plugin-specific tests
3. Plugin actions follow ElizaOS action patterns with validators and handlers
4. Services handle external API integrations (Morpho, Clanker, LiFi)
5. Providers supply real-time data to the agent runtime

### Testing Strategy
- **85%+ test coverage** requirement across all plugins
- **Integration tests** for real protocol interactions
- **Unit tests** for individual components and services
- **E2E tests** using Cypress for full workflow validation
- **Mock services** for external API dependencies in tests

### Build Process
- **TypeScript compilation** with strict typing enabled
- **tsup bundling** for optimized production builds
- **ESM modules** throughout the codebase
- **External dependencies** like `dotenv`, `fs`, `path` are externalized

---

## CRITICAL REQUIREMENTS

### Security and Environment
- **Private keys**: Never expose in logs or commit to repository
- **Environment variables**: All sensitive data must use `.env` files
- **Gas optimization**: Automatic gas price monitoring and transaction optimization
- **Rate limiting**: Respect API rate limits for all external services

### Code Patterns
- **Data-first approach**: Always check market data before providing recommendations
- **Error handling**: Comprehensive error handling with retry logic for blockchain operations
- **TypeScript**: Strict typing required for all new code
- **ElizaOS conventions**: Follow ElizaOS patterns for actions, providers, and services

---

## PLUGIN ARCHITECTURE DETAILS

### Action Structure
```typescript
// Standard ElizaOS action pattern
{
  name: string,
  description: string,
  validate: (runtime, message, state) => boolean,
  handler: (runtime, message, state, options, callback) => Promise<any>
}
```

### Service Integration
Services handle external API integrations and should:
- Implement proper error handling and retries
- Use environment variables for configuration
- Provide TypeScript interfaces for all responses
- Include comprehensive test coverage

### Provider Pattern
Providers supply real-time context to the agent:
- **Position Context**: Current DeFi positions and health
- **Market Data**: Real-time prices and market metrics
- **Wallet Status**: Multi-chain wallet balances and status

---

## NETWORK AND PROTOCOL SUPPORT

### Supported Networks
- **Ethereum Mainnet**: Primary chain for established DeFi protocols
- **Base L2**: Optimized for token deployment and low-cost operations
- **Arbitrum**: Layer 2 scaling solution
- **Polygon**: Fast transactions for portfolio management

### Protocol Integrations
- **Morpho Blue**: Advanced P2P lending with SDK integration
- **Clanker Protocol**: Token deployment infrastructure on Base
- **LiFi Protocol**: Cross-chain bridging and DEX aggregation
- **Uniswap V3/V4**: Decentralized exchange operations

---

## ENVIRONMENT SETUP

### Required Environment Variables
```bash
# Core wallet functionality
EVM_PRIVATE_KEY=your-wallet-private-key
BASE_RPC_URL=https://mainnet.base.org

# Optional AI providers (at least one recommended)
OPENAI_API_KEY=your-openai-key
ANTHROPIC_API_KEY=your-anthropic-key
OPENROUTER_API_KEY=your-openrouter-key

# Optional platform integrations
DISCORD_API_TOKEN=your-discord-bot-token
TWITTER_API_KEY=your-twitter-api-key
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
```

### Development Setup
```bash
# Initial setup
git clone <repository-url>
cd wise
bun install

# Development workflow
bun run dev                    # Start development server
bun run type-check:watch       # Run TypeScript checking in watch mode
bun run test:watch             # Run tests in watch mode
```
