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

export const ethWalletImport: Action = {
  name: "ETH_WALLET_IMPORT",
  similes: [
    "IMPORT_ETH_WALLET",
    "ADD_ETH_WALLET",
    "IMPORT_ETHEREUM_WALLET",
    "RESTORE_ETH_WALLET",
  ],
  description: "Import an existing Ethereum/EVM wallet using a private key",
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    // Check if EVM chain service is available
    const evmChainService = runtime.getService("EVM_CHAIN_SERVICE") as any;
    if (!evmChainService) {
      logger.error("EVM Chain Service not found");
      return false;
    }

    const text = message.content.text || "";

    // Check if message contains potential private key or import keywords
    const hasImportKeywords = ["import", "restore", "add wallet"].some(
      (keyword) => text.toLowerCase().includes(keyword),
    );

    // Check if message contains potential Ethereum private key
    const keys = evmChainService.detectPrivateKeysFromString(text);

    return hasImportKeywords || keys.length > 0;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: { [key: string]: unknown },
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      logger.log("ETH_WALLET_IMPORT handler started");

      const evmChainService = runtime.getService("EVM_CHAIN_SERVICE") as any;
      if (!evmChainService) {
        const errorText =
          "EVM wallet service is not available. Please check the service configuration.";
        callback?.({
          text: errorText,
          content: { error: "Service not available" },
        });
        return {
          text: errorText,
          success: false,
          values: { walletImported: false, error: true },
          data: {
            actionName: "ETH_WALLET_IMPORT",
            error: "Service not available",
          },
          error: new Error("Service not available"),
        };
      }

      const text = message.content.text || "";

      // Detect private keys in the message
      const detectedKeys = evmChainService.detectPrivateKeysFromString(text);

      if (detectedKeys.length === 0) {
        const errorText =
          "❌ No valid Ethereum private key detected. Please provide a valid private key.\n\n" +
          "**Expected format:**\n" +
          "• 0x followed by 64 hexadecimal characters\n" +
          "• Or 64 hexadecimal characters without 0x prefix\n\n" +
          "⚠️ **Security reminder:** Only share private keys in secure, private channels!";
        callback?.({
          text: errorText,
          content: { error: "No private key found" },
        });
        return {
          text: errorText,
          success: false,
          values: {
            walletImported: false,
            error: true,
            errorMessage: "No private key found",
          },
          data: {
            actionName: "ETH_WALLET_IMPORT",
            error: "No private key found",
          },
          error: new Error("No private key found"),
        };
      }

      // Parse which chain the user wants (default to ethereum)
      let targetChain = "ethereum";
      const supportedChains = getAllChainNames();

      for (const chain of supportedChains) {
        if (text.toLowerCase().includes(chain)) {
          targetChain = chain;
          break;
        }
      }

      // Use the first detected private key
      const privateKey = detectedKeys[0].key;

      // Import the wallet
      const wallet = await evmChainService.importWallet(
        privateKey,
        targetChain,
      );

      if (!wallet) {
        const errorText = `❌ Failed to import wallet for ${targetChain}. Please check that your private key is valid.`;
        callback?.({
          text: errorText,
          content: { error: "Import failed" },
        });
        return {
          text: errorText,
          success: false,
          values: {
            walletImported: false,
            error: true,
            errorMessage: "Import failed",
          },
          data: {
            actionName: "ETH_WALLET_IMPORT",
            error: "Import failed",
            chain: targetChain,
          },
          error: new Error("Import failed"),
        };
      }

      // Get wallet balance
      const balance = await evmChainService.getWalletBalance(
        wallet.address,
        targetChain,
      );
      const balanceText = balance
        ? `**Balance:** ${balance.nativeBalanceFormatted} ${targetChain === "polygon" ? "MATIC" : "ETH"}`
        : "**Balance:** Unable to fetch balance";

      const responseText =
        `✅ **Successfully Imported ${targetChain.toUpperCase()} Wallet**\n\n` +
        `**Address:** \`${wallet.address}\`\n` +
        `${balanceText}\n` +
        `**Chain:** ${targetChain}\n` +
        `**Type:** Imported\n\n` +
        `🔒 **Your wallet is now ready to use!**\n` +
        `⚠️ **Security reminder:** Keep your private key safe and never share it with anyone.`;

      callback?.({
        text: responseText,
        content: {
          action: "wallet_imported",
          chain: targetChain,
          address: wallet.address,
          balance: balance?.nativeBalanceFormatted || "0",
        },
      });

      return {
        text: responseText,
        success: true,
        values: {
          walletImported: true,
          chain: targetChain,
          address: wallet.address,
          balance: balance?.nativeBalanceFormatted || "0",
        },
        data: {
          actionName: "ETH_WALLET_IMPORT",
          chain: targetChain,
          address: wallet.address,
          balance: balance?.nativeBalanceFormatted || "0",
          type: "imported",
        },
      };
    } catch (error) {
      logger.error("Error in ETH_WALLET_IMPORT handler:", error);
      const errorText =
        "Sorry, there was an error importing your wallet. Please check your private key and try again.";
      callback?.({
        text: errorText,
        content: { error: "Handler error" },
      });
      return {
        text: errorText,
        success: false,
        values: { walletImported: false, error: true },
        data: {
          actionName: "ETH_WALLET_IMPORT",
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
          text: "Import wallet with private key 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "I'll import that Ethereum wallet for you right away!",
          action: "ETH_WALLET_IMPORT",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Restore my Base wallet using this key: 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Importing your Base wallet now!",
          action: "ETH_WALLET_IMPORT",
        },
      },
    ],
  ],
};
