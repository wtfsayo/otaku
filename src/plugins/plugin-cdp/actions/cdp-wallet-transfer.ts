import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger,
  ModelType,
  composePromptFromState,
  parseKeyValueXml,
} from "@elizaos/core";
import { parseUnits } from "viem";
import { getEntityWallet } from "../../../utils/entity";
import { CdpService } from "../services/cdp.service";
import { getTokenMetadata, getTokenDecimals, resolveTokenToAddress } from "../utils/coingecko";
import { type CdpNetwork } from "../types";

const transferTemplate = `# CDP Token Transfer Request

## User Request
{{recentMessages}}

## Supported Networks
- base (Base Mainnet)
- base-sepolia (Base Testnet)
- ethereum (Ethereum Mainnet)
- ethereum-sepolia (Ethereum Testnet)
- arbitrum (Arbitrum One)
- optimism (Optimism Mainnet)
- polygon (Polygon Mainnet)

## Supported Tokens
Common tokens (can use symbol):
- eth / ETH (native token)
- usdc / USDC
- dai / DAI
- weth / WETH

Or use token contract address like: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

## Instructions
Extract the transfer details from the user's request. All fields are required.

**Important Notes:**
- Amount should be in human-readable format (e.g., "10.5" for 10.5 tokens)
- Recipient address must start with 0x and be 42 characters
- For ENS names, resolve to 0x address first
- Use lowercase for token symbols
- Default to base network if not specified

Respond with the transfer parameters in this exact format:
<transferParams>
<network>base</network>
<to>0x1234567890123456789012345678901234567890</to>
<token>usdc</token>
<amount>10.5</amount>
</transferParams>`;

interface TransferParams {
  network: CdpNetwork;
  to: `0x${string}`;
  token: string;
  amount: string;
}

const parseTransferParams = (text: string): TransferParams | null => {
  const parsed = parseKeyValueXml(text);
  
  if (!parsed?.network || !parsed?.to || !parsed?.token || !parsed?.amount) {
    return null;
  }

  // Validate recipient address
  const to = parsed.to.trim();
  if (!to.startsWith("0x") || to.length !== 42) {
    logger.warn(`Invalid recipient address: ${to}`);
    return null;
  }

  return {
    network: parsed.network as CdpNetwork,
    to: to as `0x${string}`,
    token: parsed.token.toLowerCase(),
    amount: parsed.amount,
  };
};

// use strict resolver from utils

export const cdpWalletTransfer: Action = {
  name: "CDP_WALLET_TRANSFER",
  similes: [
    "CDP_SEND",
    "CDP_TRANSFER",
    "CDP_PAY",
    "SEND_TOKENS_CDP",
    "TRANSFER_TOKENS_CDP",
    "PAY_WITH_CDP",
  ],
  description: "Transfer tokens to another address using Coinbase CDP",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    try {
      // Check if services are available
      const cdpService = _runtime.getService(
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
    state: State,
    _options: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const cdpService = runtime.getService(CdpService.serviceType) as CdpService;
      
      if (!cdpService) {
        throw new Error("CDP Service not initialized");
      }

      // Ensure the user has a wallet saved
      const walletResult = await getEntityWallet(
        runtime,
        message,
        "CDP_WALLET_TRANSFER",
        callback,
      );
      if (walletResult.success === false) {
        return walletResult.result;
      }

      // Compose state and get transfer parameters from LLM
      const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
      const context = composePromptFromState({
        state: composedState,
        template: transferTemplate,
      });

      const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: context,
      });

      const transferParams = parseTransferParams(xmlResponse);
      
      if (!transferParams) {
        throw new Error("Failed to parse transfer parameters from request");
      }

      // Resolve token using CoinGecko
      const resolvedTokenOrZero = await resolveTokenToAddress(
        transferParams.token,
        transferParams.network
      );
      if (!resolvedTokenOrZero) {
        throw new Error(`Could not resolve token: ${transferParams.token}`);
      }
      const resolvedToken = resolvedTokenOrZero === "0x0000000000000000000000000000000000000000" ? "eth" : resolvedTokenOrZero;
      
      // Determine token type for CDP API
      let token: `0x${string}` | "usdc" | "eth";
      const lowerToken = resolvedToken.toLowerCase();
      
      if (lowerToken === "usdc" || lowerToken === "eth") {
        token = lowerToken;
      } else if (lowerToken.startsWith("0x") && lowerToken.length === 42) {
        token = lowerToken as `0x${string}`;
      } else {
        throw new Error(`Invalid token format: ${resolvedToken}`);
      }
      
      // Get token decimals from CoinGecko
      const decimals = await getTokenDecimals(
        resolvedToken === "eth" ? "0x0000000000000000000000000000000000000000" : resolvedToken,
        transferParams.network
      );
      
      // Parse amount to proper units
      const amount = parseUnits(transferParams.amount, decimals);

      logger.info(`Executing CDP transfer: network=${transferParams.network}, to=${transferParams.to}, token=${token}, amount=${transferParams.amount}`);

      // Get the account and execute transfer
      const account = await cdpService.getOrCreateAccount({ name: message.entityId });
      
      // Use the network-scoped account for type safety
      const networkAccount = await account.useNetwork(transferParams.network);
      
      const result = await networkAccount.transfer({
        to: transferParams.to,
        amount,
        token,
      });

      const successText = `✅ Successfully transferred ${transferParams.amount} ${transferParams.token.toUpperCase()} on ${transferParams.network}\n` +
                         `To: ${transferParams.to}\n` +
                         `Transaction Hash: ${result.transactionHash}`;

      callback?.({
        text: successText,
        content: {
          success: true,
          transactionHash: result.transactionHash,
          network: transferParams.network,
          to: transferParams.to,
          token: transferParams.token,
          amount: transferParams.amount,
        },
      });

      return {
        text: successText,
        success: true,
        data: {
          transactionHash: result.transactionHash,
          network: transferParams.network,
          to: transferParams.to,
          token: token,
          amount: transferParams.amount,
          decimals,
        },
        values: {
          transferSuccess: true,
          transactionHash: result.transactionHash,
        },
      };
    } catch (error) {
      logger.error("CDP_WALLET_TRANSFER error:", error);
      
      let errorMessage = "Failed to execute transfer.";
      if (error instanceof Error) {
        if (error.message.includes("insufficient")) {
          errorMessage = "Insufficient balance for this transfer.";
        } else if (error.message.includes("invalid address")) {
          errorMessage = "Invalid recipient address provided.";
        } else if (error.message.includes("not authenticated")) {
          errorMessage = "CDP service is not authenticated. Please check your API credentials.";
        } else {
          errorMessage = `Transfer failed: ${error.message}`;
        }
      }
      
      callback?.({
        text: errorMessage,
        content: { error: "cdp_wallet_transfer_failed", details: error },
      });
      
      return {
        text: errorMessage,
        success: false,
        error: error as Error,
      };
    }
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "send 10 USDC to 0x1234567890123456789012345678901234567890 on base" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll send 10 USDC to that address on Base network for you.",
          action: "CDP_WALLET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "transfer 0.5 ETH to 0xabcd...1234" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Sending 0.5 ETH to the specified address...",
          action: "CDP_WALLET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "pay 100 DAI to 0x9999...8888 on ethereum" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Processing payment of 100 DAI on Ethereum mainnet...",
          action: "CDP_WALLET_TRANSFER",
        },
      },
    ],
  ],
};

export default cdpWalletTransfer;

