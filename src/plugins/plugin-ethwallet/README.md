# ETH Wallet Plugin

A dedicated Ethereum and EVM chain wallet plugin for ElizaOS that supports creating, importing, and managing wallets across multiple EVM-compatible blockchains.

## 🌟 Features

- **Multi-Chain Support**: Ethereum, Base, Arbitrum, Optimism, Polygon, and more
- **Wallet Creation**: Generate secure new wallets for any supported chain
- **Wallet Import**: Import existing wallets using private keys
- **Balance Checking**: Check native token balances across different chains
- **Security Focused**: Secure key generation and validation
- **User-Friendly**: Natural language interface for all operations

## 🔗 Supported Chains

### Mainnets
- **Ethereum** (ETH) - Chain ID: 1
- **Base** (ETH) - Chain ID: 8453  
- **Arbitrum One** (ETH) - Chain ID: 42161
- **Optimism** (ETH) - Chain ID: 10
- **Polygon** (MATIC) - Chain ID: 137

### Testnets
- **Sepolia** (ETH) - Chain ID: 11155111

## 🚀 Usage Examples

### Create Wallets

```
# Create an Ethereum wallet
"Create an Ethereum wallet for me"

# Create a Base wallet  
"I need a Base chain wallet"

# Create wallets for all supported chains
"Create wallets for all supported chains"
```

### Import Wallets

```
# Import with private key
"Import wallet with private key 0x1234567890abcdef..."

# Import for specific chain
"Restore my Base wallet using this key: 0xabcdef..."
```

### Check Balances

```
# Check Ethereum balance
"Check balance 0x742d35Cc6634C0532925a3b8D84CB6Cef29100f7"

# Check balance on specific chain
"What's the balance of 0x742d35... on base?"
```

### List Information

```
# Show supported chains and commands
"List my ETH wallets"
"Show wallet information"
```

## 🏗️ Architecture

### Services

- **EVMWalletService**: Core wallet operations (create, import, balance)
- **EVMChainService**: Multi-chain management and coordination

### Actions

- **ethWalletCreate**: Create new wallets
- **ethWalletImport**: Import existing wallets  
- **ethWalletList**: List wallet information
- **ethWalletBalance**: Check wallet balances

### Providers

- **ethWalletProvider**: Static wallet capability information
- **ethWalletBalanceProvider**: Dynamic balance information

## 🔧 Installation

1. **Install Dependencies**:
   ```bash
   npm install ethers
   ```

2. **Environment Variables** (optional):
   ```env
   ETHEREUM_RPC_URL=https://your-ethereum-rpc
   BASE_RPC_URL=https://your-base-rpc
   ARBITRUM_RPC_URL=https://your-arbitrum-rpc
   OPTIMISM_RPC_URL=https://your-optimism-rpc
   POLYGON_RPC_URL=https://your-polygon-rpc
   ```

3. **Register Plugin**:
   ```typescript
   import { ethWalletPlugin } from './plugins/ethwallet';
   
   // Add to your ElizaOS configuration
   plugins: [ethWalletPlugin]
   ```

## 🔐 Security Features

- **Secure Key Generation**: Uses ethers.js cryptographically secure random generation
- **Private Key Validation**: Validates all private keys before import
- **Address Validation**: Confirms Ethereum address format
- **Multi-Pattern Detection**: Detects various private key formats
- **No Key Storage**: Plugin doesn't store private keys (implement your own secure storage)

## 🛠️ Configuration

### Chain Configuration

Edit `src/plugins/ethwallet/config/chains.ts` to:
- Add new EVM chains
- Modify RPC endpoints
- Update block explorer URLs
- Configure testnet/mainnet settings

### Custom RPC Endpoints

Set environment variables for custom RPC endpoints:

```env
ETHEREUM_RPC_URL=https://your-custom-ethereum-rpc
BASE_RPC_URL=https://your-custom-base-rpc
# ... other chains
```

## 📚 API Reference

### EVMWalletService Methods

```typescript
// Create new wallet
await createWallet(chainName: string): Promise<WalletCreationResult>

// Import existing wallet
await importWallet(privateKey: string, chainName: string): Promise<WalletCreationResult>

// Get wallet balance
await getWalletBalance(address: string, chainName: string): Promise<WalletBalance | null>

// Validate private key
isValidPrivateKey(privateKey: string): boolean

// Validate address
isValidAddress(address: string): boolean
```

### EVMChainService Methods

```typescript
// Create multi-chain wallet
await createMultiChainWallet(): Promise<Record<string, EVMWallet>>

// Get supported chains
getSupportedChains(): string[]

// Check if chain is supported
isChainSupported(chainName: string): boolean

// Detect private keys from text
detectPrivateKeysFromString(text: string): Array<{format: string, match: string, key: string}>
```

## ⚠️ Security Warnings

1. **Private Key Safety**: Never share private keys or store them in plaintext
2. **Secure Channels**: Only share private keys through secure, encrypted channels
3. **Key Management**: Implement secure key storage for production use
4. **Network Security**: Use trusted RPC endpoints and secure connections
5. **Address Validation**: Always validate addresses before sending funds

## 🧪 Testing

The plugin includes example interactions for testing:

1. Create a test wallet
2. Import a test private key (use testnet keys only!)
3. Check balances on testnets
4. Verify multi-chain functionality

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add new chains or features
4. Test thoroughly on testnets
5. Submit a pull request

## 📄 License

This plugin follows the same license as the main ElizaOS project.

## 🆘 Support

For issues, questions, or feature requests:
1. Check existing documentation
2. Test on testnets first
3. Provide clear reproduction steps
4. Include relevant error messages

---

**Happy wallet management! 🚀** 