import {
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  logger,
} from "@elizaos/core";

export interface EntityWalletResult {
  success: true;
  walletAddress: string;
  walletPrivateKey: string;
}

export interface EntityWalletError {
  success: false;
  result: ActionResult;
}

export type EntityWalletResponse = EntityWalletResult | EntityWalletError;

/**
 * Retrieves entity wallet information from runtime and validates it exists.
 * Returns either the wallet address on success, or a complete ActionResult on failure.
 */
export async function getEntityWallet(
  runtime: IAgentRuntime,
  message: Memory,
  actionName: string,
  callback?: HandlerCallback,
): Promise<EntityWalletResponse> {
  try {
    const entityId = message.entityId;
    const entity = (await runtime.getEntityById(entityId)) as any;

    if (!entity) {
      const errorText = "Unable to fetch entity information. Please try again.";

      if (callback) {
        await callback({
          text: errorText,
          content: { error: "Entity not found" },
        });
      }

      return {
        success: false,
        result: {
          text: errorText,
          success: false,
          values: { walletCreated: false, error: true },
          data: {
            actionName,
            error: "Entity not found",
          },
          error: new Error("Entity not found"),
        },
      };
    }

    // Check if wallet already exists in entity metadata
    if (!entity.metadata?.wallet) {
      const errorText =
        "Unable to fetch user's wallet information. Please create a wallet first.";

      if (callback) {
        await callback({
          text: errorText,
          content: { error: "Wallet not found" },
        });
      }

      return {
        success: false,
        result: {
          text: errorText,
          success: false,
          values: { walletCreated: false, error: true },
          data: {
            actionName,
            error: "Wallet not found",
          },
          error: new Error("Wallet not found"),
        },
      };
    }

    const walletAddress = entity.metadata.wallet.address;
    const walletPrivateKey = entity.metadata.wallet.privateKey;

    if (!walletAddress) {
      const errorText = "Wallet address not found in entity metadata.";

      if (callback) {
        await callback({
          text: errorText,
          content: { error: "Wallet address not found" },
        });
      }

      return {
        success: false,
        result: {
          text: errorText,
          success: false,
          values: { walletCreated: false, error: true },
          data: {
            actionName,
            error: "Wallet address not found",
          },
          error: new Error("Wallet address not found"),
        },
      };
    }

    return {
      success: true,
      walletAddress,
      walletPrivateKey,
    };
  } catch (error) {
    logger.error("Error getting entity wallet address:", error);

    const errorText = "Failed to retrieve wallet information.";

    if (callback) {
      await callback({
        text: errorText,
        content: { error: "Wallet retrieval failed" },
      });
    }

    return {
      success: false,
      result: {
        text: errorText,
        success: false,
        values: { walletCreated: false, error: true },
        data: {
          actionName,
          error: error instanceof Error ? error.message : String(error),
        },
        error: error instanceof Error ? error : new Error(String(error)),
      },
    };
  }
}
