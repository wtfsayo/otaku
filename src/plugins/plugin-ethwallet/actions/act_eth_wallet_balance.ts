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

export const ethWalletBalance: Action = {
  name: "ETH_WALLET_BALANCE",
  similes: [
    "CHECK_ETH_BALANCE",
    "ETH_BALANCE",
    "WALLET_BALANCE",
    "BALANCE_CHECK",
  ],
  description: "Check the balance of an Ethereum/EVM wallet address",
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const text = message.content.text?.toLowerCase() || "";
    const keywords = ["balance", "check balance", "wallet balance", "how much"];

    return keywords.some((keyword) => text.includes(keyword));
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.log("ETH_WALLET_BALANCE handler started");

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
          values: { balanceFetched: false, error: true },
          data: {
            actionName: "ETH_WALLET_BALANCE",
            error: "Service not available",
          },
          error: new Error("Service not available"),
        };
      }

      const text = message.content.text || "";

      // Extract Ethereum address from message (0x followed by 40 hex chars)
      const addressMatch = text.match(/0x[a-fA-F0-9]{40}/);

      if (!addressMatch) {
        const errorText =
          "❌ No valid Ethereum address found in your message.\n\n" +
          "**Expected format:** 0x followed by 40 hexadecimal characters\n" +
          "**Example:** `check balance 0x742d35Cc6634C0532925a3b8D84CB6Cef29100f7 ethereum`\n\n" +
          "💡 **Tip:** Include the address and optionally specify the chain (ethereum, base, etc.)";
        callback?.({
          text: errorText,
          content: { error: "No address found" },
        });
        return {
          text: errorText,
          success: false,
          values: {
            balanceFetched: false,
            error: true,
            errorMessage: "No address found",
          },
          data: { actionName: "ETH_WALLET_BALANCE", error: "No address found" },
          error: new Error("No address found"),
        };
      }

      const address = addressMatch[0];

      // Parse which chain to check (default to ethereum)
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
            balanceFetched: false,
            error: true,
            errorMessage: "Invalid address",
          },
          data: {
            actionName: "ETH_WALLET_BALANCE",
            error: "Invalid address",
            address,
          },
          error: new Error("Invalid address"),
        };
      }

      // Get the balance
      const balance = await evmChainService.getWalletBalance(
        address,
        targetChain
      );

      if (!balance) {
        const errorText =
          `❌ Unable to fetch balance for ${address} on ${targetChain}.\n` +
          "This could be due to network issues or invalid chain configuration.";
        callback?.({
          text: errorText,
          content: { error: "Balance fetch failed" },
        });
        return {
          text: errorText,
          success: false,
          values: {
            balanceFetched: false,
            error: true,
            errorMessage: "Balance fetch failed",
          },
          data: {
            actionName: "ETH_WALLET_BALANCE",
            error: "Balance fetch failed",
            address,
            chain: targetChain,
          },
          error: new Error("Balance fetch failed"),
        };
      }

      const nativeSymbol = targetChain === "polygon" ? "MATIC" : "ETH";
      const explorerUrl = getExplorerUrl(address, targetChain);

      let responseText = `💰 **Wallet Balance**\n\n`;
      responseText += `**Address:** \`${address}\`\n`;
      responseText += `**Chain:** ${targetChain.charAt(0).toUpperCase() + targetChain.slice(1)}\n`;
      responseText += `**Balance:** ${balance.nativeBalanceFormatted} ${nativeSymbol}\n`;

      if (explorerUrl) {
        responseText += `**Explorer:** [View on Explorer](${explorerUrl})\n`;
      }

      responseText += `\n🔍 **Balance Details:**\n`;
      responseText += `• Native Balance: ${balance.nativeBalanceFormatted} ${nativeSymbol}\n`;
      responseText += `• Wei/Raw: ${balance.nativeBalance}\n`;

      if (balance.tokens && balance.tokens.length > 0) {
        responseText += `• Tokens: ${balance.tokens.length} different tokens found\n`;
      }

      callback?.({
        text: responseText,
        content: {
          action: "balance_checked",
          address,
          chain: targetChain,
          balance: balance.nativeBalanceFormatted,
          nativeSymbol,
        },
      });

      return {
        text: responseText,
        success: true,
        values: {
          balanceFetched: true,
          address,
          chain: targetChain,
          balance: balance.nativeBalanceFormatted,
          nativeSymbol,
        },
        data: {
          actionName: "ETH_WALLET_BALANCE",
          address,
          chain: targetChain,
          balance: balance.nativeBalanceFormatted,
          nativeBalance: balance.nativeBalance,
          tokens: balance.tokens?.length || 0,
          explorerUrl,
        },
      };
    } catch (error) {
      logger.error("Error in ETH_WALLET_BALANCE handler:", error);
      const errorText =
        "Sorry, there was an error checking the wallet balance. Please try again.";
      callback?.({
        text: errorText,
        content: { error: "Handler error" },
      });
      return {
        text: errorText,
        success: false,
        values: { balanceFetched: false, error: true },
        data: {
          actionName: "ETH_WALLET_BALANCE",
          error: error instanceof Error ? error.message : String(error),
        },
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: {
          text: "Check balance 0x742d35Cc6634C0532925a3b8D84CB6Cef29100f7",
        },
      },
      {
        name: "{{user2}}",
        content: {
          text: "I'll check that wallet balance for you!",
          action: "ETH_WALLET_BALANCE",
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
          text: "Checking the Base chain balance for that address!",
          action: "ETH_WALLET_BALANCE",
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
