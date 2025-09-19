import {
  type IAgentRuntime,
  type Memory,
  type Provider,
  type State,
} from "@elizaos/core";

export const ethWalletProvider: Provider = {
  name: "ETH_WALLET_PROVIDER",
  description:
    "Provides information about Ethereum and EVM wallet capabilities",
  dynamic: true,
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const evmChainService = runtime.getService("EVM_CHAIN_SERVICE") as any;

    if (!evmChainService) {
      return {
        data: {},
        values: {},
        text: "EVM wallet service is not available.",
      };
    }

    const supportedChains = evmChainService.getSupportedChains();
    const mainnetChains = evmChainService.getMainnetChains();

    const walletInfo = {
      supportedChains,
      mainnetChains,
      totalChains: supportedChains.length,
      capabilities: [
        "Create new wallets",
        "Import existing wallets",
        "Check balances",
        "Multi-chain support",
        "Secure key generation",
      ],
    };

    const text = `🔗 **EVM Wallet System Active**

**Supported Chains (${supportedChains.length}):**
${supportedChains.map((chain: string, i: number) => `${i + 1}. ${chain.charAt(0).toUpperCase() + chain.slice(1)}`).join("\n")}

**Available Commands:**
• Create wallet: "create [chain] wallet"
• Import wallet: "import wallet [private_key]"
• Check balance: "balance [address] [chain]"
• List wallets: "list wallets"

**Security Features:**
• Secure random key generation
• Private key validation
• Multi-chain address support
• Balance checking across networks

Ready to help with your EVM wallet needs!`;

    return {
      data: walletInfo,
      values: {
        supportedChains: supportedChains.join(", "),
        totalChains: supportedChains.length,
        isServiceActive: true,
      },
      text,
    };
  },
};
