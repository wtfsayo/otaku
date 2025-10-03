import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger,
} from "@elizaos/core";
import { getEntityWallet } from "../../../utils/entity";
import { CdpService } from "../services/cdp.service";

export const cdpCreateWallet: Action = {
  name: "CDP_CREATE_WALLET",
  similes: ["CREATE_CDP_WALLET", "NEW_CDP_WALLET", "CDP_EVM_CREATE"],
  description:
    "Create an EVM account via Coinbase CDP",
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    try {
      // Check if services are available
      const cdpService = runtime.getService(
        CdpService.serviceType,
      ) as CdpService;

      if (!cdpService) {
        logger.warn("Required services not available for token deployment");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "Error validating token deployment action:",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const cdpService = runtime.getService(CdpService.serviceType) as CdpService;

      // Check if wallet already exists using getEntityWallet
      const walletResult = await getEntityWallet(
        runtime,
        message,
        "CDP_CREATE_WALLET",
        undefined, // Don't pass callback here to avoid duplicate messages
      );

      // If wallet exists, return existing wallet info
      if (walletResult.success) {
        const existingWalletText =
          `🏦 **Wallet Already Exists**\n\n` +
          `You already have a wallet configured:\n` +
          `**Address:** \`${walletResult.walletAddress}\`\n` +
          `**Provider:** "Coinbase CDP"\n` +
          `ℹ️ Use your existing wallet.`;

        callback?.({
          text: existingWalletText,
          content: {
            action: "wallet_already_exists",
            address: walletResult.walletAddress,
          },
        });

        return {
          text: existingWalletText,
          success: true,
          values: {
            walletCreated: false,
            walletExists: true,
            address: walletResult.walletAddress,
          },
          data: {
            actionName: "CDP_CREATE_WALLET",
            type: "existing-wallet",
            address: walletResult.walletAddress,
          },
        };
      }

      // No wallet exists, proceed with creation
      const entityId = message.entityId;
      const entity = (await runtime.getEntityById(entityId)) as any;

      if (!entity) {
        const errorText = "Unable to fetch entity information. Please try again.";
        callback?.({ text: errorText, content: { error: "Entity not found" } });
        return {
          text: errorText,
          success: false,
          values: { walletCreated: false, error: true },
          data: { actionName: "CDP_CREATE_WALLET", error: "Entity not found" },
          error: new Error("Entity not found"),
        };
      }

      // Use getOrCreateAccount with entityId as name for consistency
      const account = await cdpService.getOrCreateAccount({
        name: entityId,
      });

      // Persist wallet info to entity metadata similar to ethwallet plugin
      const address = account.address;
      const createdAt = new Date().toISOString();

      await runtime.updateEntity({
        ...entity,
        metadata: {
          ...entity.metadata,
          wallet: {
            address,
            createdAt,
            provider: "cdp",
            cdpAccountName: entityId, // Store the CDP account name for reference
            chain: "base", // Default chain for CDP
          },
        },
      });

      const text =
        `🎉 **Created CDP EVM Wallet**\n\n` +
        `**Address:** \`${address ?? "unknown"}\`\n` +
        `✅ Wallet information has been saved to your profile.`;

      callback?.({ text, content: { action: "cdp_wallet_created", address } });
      return { text, success: true, data: { address } };
    } catch (error) {
      logger.error("CDP_CREATE_WALLET error:", error);
      const msg = "Failed to create CDP wallet.";
      callback?.({ text: msg, content: { error: "cdp_wallet_create_failed" } });
      return { text: msg, success: false, error: error as Error };
    }
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "I need to set up a wallet with Coinbase Developer Platform",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll create a secure wallet for you using Coinbase CDP. This will give you an EVM-compatible address on Base network that you can use for transactions.",
          action: "CDP_CREATE_WALLET",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "🎉 **Created CDP EVM Wallet**\n\n**Address:** `0x1234...5678`\n✅ Wallet information has been saved to your profile.",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "create a new cdp wallet for me" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Setting up your Coinbase CDP wallet now...",
          action: "CDP_CREATE_WALLET",
        },
      },
    ],
  ],
};


