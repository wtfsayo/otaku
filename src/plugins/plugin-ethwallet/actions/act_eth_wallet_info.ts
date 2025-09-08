import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger,
} from "@elizaos/core";
import { getAllChainNames } from "../config/chains";
import { getEntityWallet } from "../../../utils/entity";

export const ethWalletInfo: Action = {
  name: "ETH_WALLET_INFO",
  similes: [
    "CHECK_ETH_BALANCE",
    "ETH_BALANCE",
    "WALLET_BALANCE",
    "BALANCE_CHECK",
    "WALLET_INFO",
    "CHECK_WALLET",
    "MY_WALLET",
    "SHOW_WALLET",
  ],
  description:
    "PRIMARY ACTION for ALL wallet-related queries and requests. This action should be triggered whenever a user asks ANYTHING related to wallets, addresses, or balances. It comprehensively handles: checking wallet information, balance queries, address validation, chain-specific data, and any wallet-related information requests. Automatically uses provided address or falls back to user's own wallet if no address specified. Should respond to ANY wallet-related question including 'my wallet', 'check balance', 'wallet info', 'how much do I have', 'show my tokens', etc.",
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: { [key: string]: unknown },
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      logger.log("ETH_WALLET_INFO handler started");

      const evmChainService = runtime.getService("EVM_CHAIN_SERVICE") as any;
      if (!evmChainService) {
        const errorText = "EVM wallet service is not available.";
        callback?.({
          text: errorText,
          content: { error: "Service not available" },
        });
        return {
          text: errorText,
          success: false,
          values: { walletInfoFetched: false, error: true },
          data: {
            actionName: "ETH_WALLET_INFO",
            error: "Service not available",
          },
          error: new Error("Service not available"),
        };
      }

      const text = message.content.text || "";

      // First try to extract Ethereum address from message (0x followed by 40 hex chars)
      const addressMatch = text.match(/0x[a-fA-F0-9]{40}/);
      let address: string;
      let isUserWallet = false;

      if (addressMatch) {
        // Address found in message
        address = addressMatch[0];
        logger.log(`Using address from message: ${address}`);
      } else {
        // No address in message, try to get user's wallet
        logger.log("No address found in message, trying to get user's wallet");
        const walletResult = await getEntityWallet(
          runtime,
          message,
          "ETH_WALLET_INFO",
          callback,
        );

        if (!walletResult.success) {
          // Both address extraction and entity wallet lookup failed
          const errorText =
            "❌ No wallet address found.\n\n" +
            "**Please either:**\n" +
            "• Provide an Ethereum address: `check wallet 0x742d35Cc6634C0532925a3b8D84CB6Cef29100f7`\n" +
            "• Or create a wallet first if you want to check your own wallet\n\n" +
            "💡 **Example:** `check balance 0x742d35Cc6634C0532925a3b8D84CB6Cef29100f7 ethereum`";

          if (callback) {
            await callback({
              text: errorText,
              content: { error: "No address or wallet found" },
            });
          }

          return {
            text: errorText,
            success: false,
            values: {
              walletInfoFetched: false,
              error: true,
              errorMessage: "No address or wallet found",
            },
            data: {
              actionName: "ETH_WALLET_INFO",
              error: "No address or wallet found",
            },
            error: new Error("No address or wallet found"),
          };
        }

        address = walletResult.walletAddress;
        isUserWallet = true;
        logger.log(`Using user's wallet address: ${address}`);
      }

      // Parse which chain to check (default to base)
      let targetChain = "base";
      const supportedChains = getAllChainNames();

      for (const chain of supportedChains) {
        if (text.toLowerCase().includes(chain)) {
          targetChain = chain;
          break;
        }
      }

      // Validate the address
      if (!evmChainService.isValidAddress(address)) {
        const errorText = `❌ Invalid Ethereum address: ${address}`;
        callback?.({
          text: errorText,
          content: { error: "Invalid address" },
        });
        return {
          text: errorText,
          success: false,
          values: {
            walletInfoFetched: false,
            error: true,
            errorMessage: "Invalid address",
          },
          data: {
            actionName: "ETH_WALLET_INFO",
            error: "Invalid address",
            address,
          },
          error: new Error("Invalid address"),
        };
      }

      // Get the balance
      const balance = await evmChainService.getWalletBalance(
        address,
        targetChain,
      );

      if (!balance) {
        const errorText =
          `❌ Unable to fetch wallet information for ${address} on ${targetChain}.\n` +
          "This could be due to network issues or invalid chain configuration.";
        callback?.({
          text: errorText,
          content: { error: "Wallet info fetch failed" },
        });
        return {
          text: errorText,
          success: false,
          values: {
            walletInfoFetched: false,
            error: true,
            errorMessage: "Wallet info fetch failed",
          },
          data: {
            actionName: "ETH_WALLET_INFO",
            error: "Wallet info fetch failed",
            address,
            chain: targetChain,
          },
          error: new Error("Wallet info fetch failed"),
        };
      }

      const nativeSymbol = targetChain === "polygon" ? "MATIC" : "ETH";
      const explorerUrl = getExplorerUrl(address, targetChain);

      let responseText = `🏦 **Wallet Information**\n\n`;

      // Show if this is the user's wallet or an external address
      if (isUserWallet) {
        responseText += `**Type:** Your Wallet 👤\n`;
      } else {
        responseText += `**Type:** External Address 🔍\n`;
      }

      responseText += `**Address:** \`${address}\`\n`;
      responseText += `**Chain:** ${targetChain.charAt(0).toUpperCase() + targetChain.slice(1)}\n`;
      responseText += `**Balance:** ${balance.nativeBalanceFormatted} ${nativeSymbol}\n`;

      if (explorerUrl) {
        responseText += `**Explorer:** [View on Explorer](${explorerUrl})\n`;
      }

      if (balance.tokens && balance.tokens.length > 0) {
        responseText += `\n🪙 **Token Holdings (${balance.tokens.length} ${balance.tokens.length === 1 ? "token" : "tokens"}):**\n`;

        balance.tokens.forEach((token: any) => {
          const formattedBalance = token.balanceFormatted || "0";
          const tokenSymbol = token.symbol || "Unknown";
          responseText += `• ${formattedBalance} ${tokenSymbol}\n`;
        });
      } else {
        responseText += `\n💰 **Token Holdings:** No tokens with balance found\n`;
      }

      callback?.({
        text: responseText,
        content: {
          action: "wallet_info_checked",
          address,
          chain: targetChain,
          balance: balance.nativeBalanceFormatted,
          nativeSymbol,
          isUserWallet,
          tokenCount: balance.tokens?.length || 0,
        },
      });

      return {
        text: responseText,
        success: true,
        values: {
          walletInfoFetched: true,
          address,
          chain: targetChain,
          balance: balance.nativeBalanceFormatted,
          nativeSymbol,
          isUserWallet,
          tokenCount: balance.tokens?.length || 0,
        },
        data: {
          actionName: "ETH_WALLET_INFO",
          address,
          chain: targetChain,
          balance: balance.nativeBalanceFormatted,
          nativeBalance: balance.nativeBalance,
          tokens: balance.tokens?.length || 0,
          explorerUrl,
          isUserWallet,
        },
      };
    } catch (error) {
      logger.error("Error in ETH_WALLET_INFO handler:", error);
      const errorText =
        "Sorry, there was an error checking the wallet information. Please try again.";
      callback?.({
        text: errorText,
        content: { error: "Handler error" },
      });
      return {
        text: errorText,
        success: false,
        values: { walletInfoFetched: false, error: true },
        data: {
          actionName: "ETH_WALLET_INFO",
          error: error instanceof Error ? error.message : String(error),
        },
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "Check wallet 0x742d35Cc6634C0532925a3b8D84CB6Cef29100f7",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "I'll check that wallet information for you!",
          action: "ETH_WALLET_INFO",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Show my wallet balance",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Let me show you your wallet information!",
          action: "ETH_WALLET_INFO",
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: {
          text: "What's the balance of 0x742d35Cc6634C0532925a3b8D84CB6Cef29100f7 on base?",
        },
      },
      {
        name: "{{user2}}",
        content: {
          text: "Checking the Base chain wallet information for that address!",
          action: "ETH_WALLET_INFO",
        },
      },
    ],
  ],
};

function getExplorerUrl(address: string, chain: string): string | null {
  const explorers: Record<string, string> = {
    ethereum: "https://etherscan.io/address/",
    base: "https://basescan.org/address/",
    arbitrum: "https://arbiscan.io/address/",
    optimism: "https://optimistic.etherscan.io/address/",
    polygon: "https://polygonscan.com/address/",
    sepolia: "https://sepolia.etherscan.io/address/",
  };

  return explorers[chain] ? explorers[chain] + address : null;
}
