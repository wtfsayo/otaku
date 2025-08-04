import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger,
} from "@elizaos/core";
import { DEFAULT_CHAIN } from "../config/chains";

export const ethWalletCreate: Action = {
  name: "ETH_WALLET_CREATE",
  similes: [
    "CREATE_ETH_WALLET",
    "NEW_ETH_WALLET",
    "GENERATE_ETH_WALLET",
    "MAKE_ETH_WALLET",
    "ETH_WALLET_GENERATE",
  ],
  description:
    "Create a new Ethereum/EVM wallet for supported chains (Ethereum, Base, Arbitrum, etc.)",
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    // Check if EVM chain service is available
    const evmChainService = runtime.getService("EVM_CHAIN_SERVICE") as any;
    if (!evmChainService) {
      logger.error("EVM Chain Service not found");
      return false;
    }

    // Check if message contains keywords for wallet creation
    const text = message.content.text?.toLowerCase() || "";
    const keywords = [
      "create",
      "make",
      "generate",
      "new",
      "wallet",
      "eth",
      "ethereum",
      "base",
      "arbitrum",
      "optimism",
      "polygon",
    ];

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
      logger.log("ETH_WALLET_CREATE handler started");

      // Fetch the entity using entityId
      const entityId = message.entityId;
      const entity = (await runtime.getEntityById(entityId)) as any;

      if (!entity) {
        const errorText =
          "Unable to fetch entity information. Please try again.";
        callback?.({
          text: errorText,
          content: { error: "Entity not found" },
        });
        return {
          text: errorText,
          success: false,
          values: { walletCreated: false, error: true },
          data: {
            actionName: "ETH_WALLET_CREATE",
            error: "Entity not found",
          },
          error: new Error("Entity not found"),
        };
      }

      // Check if wallet already exists in entity metadata
      if (entity.metadata?.wallet) {
        const existingWalletText =
          `🏦 **Wallet Already Exists**\n\n` +
          `You already have a wallet configured:\n` +
          `**Address:** \`${entity.metadata.wallet.address}\`\n` +
          `**Chain:** ${DEFAULT_CHAIN.toUpperCase()}\n\n` +
          `ℹ️ Use your existing wallet or contact support if you need assistance.`;

        callback?.({
          text: existingWalletText,
          content: {
            action: "wallet_already_exists",
            chain: DEFAULT_CHAIN,
            address: entity.metadata.wallet.address,
          },
        });

        return {
          text: existingWalletText,
          success: true,
          values: {
            walletCreated: false,
            walletExists: true,
            chain: DEFAULT_CHAIN,
            address: entity.metadata.wallet.address,
          },
          data: {
            actionName: "ETH_WALLET_CREATE",
            type: "existing-wallet",
            chain: DEFAULT_CHAIN,
            address: entity.metadata.wallet.address,
          },
        };
      }

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
          values: { walletCreated: false, error: true },
          data: {
            actionName: "ETH_WALLET_CREATE",
            error: "Service not available",
          },
          error: new Error("Service not available"),
        };
      }

      // Create wallet for specific chain
      const wallet = await evmChainService.createWallet(DEFAULT_CHAIN);

      if (!wallet) {
        const errorText = `❌ Failed to create ${DEFAULT_CHAIN} wallet. Please try again.`;
        callback?.({
          text: errorText,
          content: { error: "Wallet creation failed" },
        });
        return {
          text: errorText,
          success: false,
          values: {
            walletCreated: false,
            error: true,
            errorMessage: "Wallet creation failed",
          },
          data: {
            actionName: "ETH_WALLET_CREATE",
            error: "Wallet creation failed",
            chain: DEFAULT_CHAIN,
          },
          error: new Error("Wallet creation failed"),
        };
      }

      // Update entity metadata with wallet information
      await runtime.updateEntity({
        ...entity,
        metadata: {
          ...entity.metadata,
          wallet: {
            address: wallet.address,
            privateKey: wallet.privateKey,
            chain: DEFAULT_CHAIN,
            createdAt: new Date().toISOString(),
          },
        },
      });

      const responseText =
        `🎉 **Created ${DEFAULT_CHAIN.toUpperCase()} Wallet**\n\n` +
        `**Address:** \`${wallet.address}\`\n` +
        `**Private Key:** ||\`${wallet.privateKey}\`|| ⚠️ *Keep this secret!*\n\n` +
        `⚠️ **SECURITY REMINDER:**\n` +
        `• Save your private key securely\n` +
        `• Never share it with anyone\n` +
        `• Delete this message after saving\n` +
        `• Fund your wallet to start using it!\n\n` +
        `✅ Wallet information has been saved to your profile.`;

      callback?.({
        text: responseText,
        content: {
          action: "wallet_created",
          chain: DEFAULT_CHAIN,
          address: wallet.address,
        },
      });

      return {
        text: responseText,
        success: true,
        values: {
          walletCreated: true,
          chain: DEFAULT_CHAIN,
          address: wallet.address,
        },
        data: {
          actionName: "ETH_WALLET_CREATE",
          type: "new-wallet",
          chain: DEFAULT_CHAIN,
          address: wallet.address,
        },
      };
    } catch (error) {
      logger.error("Error in ETH_WALLET_CREATE handler:", error);
      const errorText =
        "Sorry, there was an error creating your wallet. Please try again.";
      callback?.({
        text: errorText,
        content: { error: "Handler error" },
      });
      return {
        text: errorText,
        success: false,
        values: { walletCreated: false, error: true },
        data: {
          actionName: "ETH_WALLET_CREATE",
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
          text: "Create an Ethereum wallet for me",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "I'll create a new Ethereum wallet for you right away!",
          action: "ETH_WALLET_CREATE",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "I need a Base chain wallet",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Creating a Base wallet for you now!",
          action: "ETH_WALLET_CREATE",
        },
      },
    ],
  ],
};
