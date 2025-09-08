/**
 * Example usage of the ETH Wallet Plugin
 *
 * This file demonstrates how to integrate and use the ethwallet plugin
 * with ElizaOS for creating and managing Ethereum/EVM wallets.
 */

import { ethWalletPlugin } from "../index";
import type { IAgentRuntime } from "@elizaos/core";

// Example: Adding the plugin to your ElizaOS configuration
export const examplePluginConfig = {
  plugins: [
    ethWalletPlugin,
    // ... other plugins
  ],
};

// Example: Manual service usage (if accessing services directly)
export async function exampleDirectServiceUsage(runtime: IAgentRuntime) {
  // Get the EVM chain service
  const evmChainService = runtime.getService("EVM_CHAIN_SERVICE") as any;

  if (!evmChainService) {
    console.error("EVM Chain Service not available");
    return;
  }

  // Example 1: Create a new Ethereum wallet
  console.log("Creating new Ethereum wallet...");
  const ethWallet = await evmChainService.createWallet("ethereum");
  if (ethWallet) {
    console.log("✅ Ethereum wallet created:", ethWallet.address);
  }

  // Example 2: Create a new Base wallet
  console.log("Creating new Base wallet...");
  const baseWallet = await evmChainService.createWallet("base");
  if (baseWallet) {
    console.log("✅ Base wallet created:", baseWallet.address);
  }

  // Example 3: Create multi-chain wallets
  console.log("Creating multi-chain wallets...");
  const multiWallets = await evmChainService.createMultiChainWallet();
  console.log("✅ Multi-chain wallets created:", Object.keys(multiWallets));

  // Example 4: Import existing wallet
  const testPrivateKey = "0x" + "1".repeat(64); // Example key (NOT for production!)
  console.log("Importing wallet from private key...");
  const importedWallet = await evmChainService.importWallet(
    testPrivateKey,
    "ethereum",
  );
  if (importedWallet) {
    console.log("✅ Wallet imported:", importedWallet.address);
  }

  // Example 5: Check wallet balance
  if (ethWallet) {
    console.log("Checking wallet balance...");
    const balance = await evmChainService.getWalletBalance(
      ethWallet.address,
      "ethereum",
    );
    if (balance) {
      console.log("💰 Balance:", balance.nativeBalanceFormatted, "ETH");
    }
  }

  // Example 6: Get supported chains
  const supportedChains = evmChainService.getSupportedChains();
  console.log("🔗 Supported chains:", supportedChains);
}

// Example conversation flows that trigger the plugin actions
export const exampleConversationFlows = [
  // Wallet Creation Examples
  {
    user: "Create an Ethereum wallet for me",
    expectedAction: "ETH_WALLET_CREATE",
    description: "Creates a new Ethereum wallet",
  },
  {
    user: "I need a Base chain wallet",
    expectedAction: "ETH_WALLET_CREATE",
    description: "Creates a new Base wallet",
  },
  {
    user: "Create wallets for all supported chains",
    expectedAction: "ETH_WALLET_CREATE",
    description: "Creates wallets for all mainnet chains",
  },

  // Wallet Import Examples
  {
    user: "Import wallet with private key 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    expectedAction: "ETH_WALLET_IMPORT",
    description: "Imports an existing wallet from private key",
  },
  {
    user: "Restore my Base wallet using this key: 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    expectedAction: "ETH_WALLET_IMPORT",
    description: "Imports a wallet for specific chain",
  },

  // Balance Check Examples
  {
    user: "Check balance 0x742d35Cc6634C0532925a3b8D84CB6Cef29100f7",
    expectedAction: "ETH_WALLET_BALANCE",
    description: "Checks Ethereum balance for given address",
  },
  {
    user: "What's the balance of 0x742d35Cc6634C0532925a3b8D84CB6Cef29100f7 on base?",
    expectedAction: "ETH_WALLET_BALANCE",
    description: "Checks balance on specific chain",
  },

  // Information Examples
  {
    user: "List my ETH wallets",
    expectedAction: "ETH_WALLET_LIST",
    description: "Shows wallet information and supported chains",
  },
  {
    user: "Show wallet information",
    expectedAction: "ETH_WALLET_LIST",
    description: "Displays available commands and capabilities",
  },
];

// Example environment variables setup
export const exampleEnvironmentVariables = `
# Optional: Custom RPC endpoints
ETHEREUM_RPC_URL=https://eth.llamarpc.com
BASE_RPC_URL=https://mainnet.base.org
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
OPTIMISM_RPC_URL=https://mainnet.optimism.io
POLYGON_RPC_URL=https://polygon-rpc.com
SEPOLIA_RPC_URL=https://rpc.sepolia.org

# Note: The plugin will use default public RPCs if not specified
`;

// Example integration with existing ElizaOS agent
export const exampleAgentIntegration = `
import { ethWalletPlugin } from './plugins/ethwallet';

// In your agent configuration:
const agentConfig = {
  // ... other configuration
  plugins: [
    ethWalletPlugin,
    // ... other plugins
  ],
  // ... rest of configuration
};

// The plugin will automatically register its services and actions
// Users can then interact using natural language commands
`;

console.log("ETH Wallet Plugin Examples");
console.log("========================");
console.log("");
console.log(
  "This plugin provides comprehensive Ethereum and EVM wallet functionality.",
);
console.log(
  "Users can create, import, and manage wallets across multiple chains using natural language.",
);
console.log("");
console.log(
  "Supported chains:",
  [
    "Ethereum",
    "Base",
    "Arbitrum",
    "Optimism",
    "Polygon",
    "Sepolia (testnet)",
  ].join(", "),
);
console.log("");
console.log(
  "See the README.md file for complete documentation and usage examples.",
);
