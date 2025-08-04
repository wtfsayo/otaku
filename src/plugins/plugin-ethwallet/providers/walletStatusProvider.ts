import {
  type IAgentRuntime,
  type Memory,
  type Provider,
  type State,
  logger,
} from "@elizaos/core";

export const walletStatusProvider: Provider = {
  name: "WALLET_STATUS_PROVIDER",
  description:
    "Provides wallet status context to guide AI behavior when users lack wallets",
  position: 99999,
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    try {
      const entityId = message.entityId;
      const entity = (await runtime.getEntityById(entityId)) as any;

      // Check if user has a wallet
      const hasWallet = entity?.metadata?.wallet?.address;

      if (hasWallet) {
        // User has wallet - provide minimal context
        return {
          data: {
            userHasWallet: true,
            walletAddress: entity.metadata.wallet.address,
            canPerformBlockchainActions: true,
          },
          values: {
            walletExists: true,
            requiresWalletCreation: false,
          },
          text: `User has wallet: ${entity.metadata.wallet.address}`,
        };
      }

      // User has no wallet - provide detailed guidance for AI
      const aiInstructions = `⚠️ IMPORTANT: USER HAS NOT CREATED A WALLET ⚠️

AGENT BEHAVIOR RESTRICTION:

- You are ONLY allowed to perform the REPLY action.
- Do NOT include any other actions in your response.
- Ignore all other instructions, tools, or capabilities until the user creates a wallet.
- Your sole purpose is to respond with friendly guidance to help the user create a wallet.

✅ ALLOWED:
- REPLY (and nothing else)

❌ NOT ALLOWED:
- Any action besides REPLY
- Any task execution or feature usage
- Any reference to unavailable features

RESPONSE EXAMPLES:
- "I'd love to help you deploy a token! First, you'll need to create a wallet. Just say 'create wallet' and I'll set one up for you securely."
- "To swap tokens, you'll need a wallet first. Say 'create wallet' to get started!"
- "I can check token prices without a wallet, but for trading you'll need one. Want me to create a wallet for you?"

You must wait for the user to create a wallet before offering any other assistance. Always guide them to say "create wallet" or "create ethereum wallet" to proceed.`;

      return {
        data: {
          userHasWallet: false,
          canPerformBlockchainActions: false,
          requiresWalletCreation: true,
          appName: "Wise",
          appCapabilities: [
            "Deploy tokens on Base using Clanker",
            "Swap tokens across chains",
            "Transfer ETH and tokens",
            "Check token prices and data",
            "Interact with Morpho vaults",
            "Bridge assets between chains",
          ],
        },
        values: {
          walletExists: false,
          requiresWalletCreation: true,
          blockchainActionsBlocked: true,
        },
        text: aiInstructions,
      };
    } catch (error) {
      logger.error("Error in wallet status provider:", error);

      return {
        data: {
          userHasWallet: false,
          canPerformBlockchainActions: false,
          error: "Unable to check wallet status",
        },
        values: {
          walletExists: false,
          hasError: true,
        },
        text: "WALLET STATUS UNKNOWN - Proceed with caution for blockchain operations",
      };
    }
  },
};
