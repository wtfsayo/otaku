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
import { getEntityWallet } from "../../../utils/entity";
import { CdpService } from "../services/cdp.service";
import { getTokenMetadata, getTokenDecimals } from "../utils/coingecko";
import { type CdpSwapNetwork } from "../types";

const swapTemplate = `# CDP Token Swap Request

## User Request
{{recentMessages}}

## Available Networks
- base
- base-sepolia  
- ethereum
- arbitrum
- optimism
- polygon

## Instructions
Extract the swap details from the user's request. If any detail is missing, use reasonable defaults.

**Important Notes:**
- For token addresses, use checksummed addresses (mixed case) starting with 0x
- For native tokens (ETH, MATIC, etc.), you can use the symbol or 0x0000000000000000000000000000000000000000
- Common token addresses on Base:
  - USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
  - WETH: 0x4200000000000000000000000000000000000006
  - DAI: 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb
- Common token addresses on Ethereum:
  - USDC: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
  - WETH: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
  - DAI: 0x6B175474E89094C44Da98b954EedeAC495271d0F

Respond with the swap parameters in this exact format:
<swapParams>
<network>base</network>
<fromToken>0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913</fromToken>
<toToken>0x4200000000000000000000000000000000000006</toToken>
<amount>100</amount>
<slippageBps>100</slippageBps>
</swapParams>`;

interface SwapParams {
  network: CdpSwapNetwork;
  fromToken: `0x${string}`;
  toToken: `0x${string}`;
  amount: string;
  slippageBps?: number;
}

const parseSwapParams = (text: string): SwapParams | null => {
  const parsed = parseKeyValueXml(text);
  
  if (!parsed?.network || !parsed?.fromToken || !parsed?.toToken || !parsed?.amount) {
    return null;
  }

  // Validate and format token addresses
  const formatTokenAddress = (token: string): `0x${string}` => {
    const cleaned = token.trim();
    
    // Handle native token symbols
    const nativeTokens = ["ETH", "MATIC", "BNB"];
    if (nativeTokens.includes(cleaned.toUpperCase())) {
      return "0x0000000000000000000000000000000000000000";
    }
    
    // Ensure address starts with 0x
    if (!cleaned.startsWith("0x")) {
      // If it's a symbol like USDC, we need to resolve it based on network
      // For now, return as is and let the service handle it
      return `0x${cleaned}` as `0x${string}`;
    }
    
    return cleaned as `0x${string}`;
  };

  return {
    network: parsed.network as SwapParams["network"],
    fromToken: formatTokenAddress(parsed.fromToken),
    toToken: formatTokenAddress(parsed.toToken),
    amount: parsed.amount,
    slippageBps: parsed.slippageBps ? parseInt(parsed.slippageBps) : 100,
  };
};

/**
 * Resolve token to address using CoinGecko
 * Handles both symbols and addresses
 */
const resolveTokenToAddress = async (
  token: string,
  network: string
): Promise<`0x${string}` | null> => {
  const trimmedToken = token.trim();
  
  // If it's already a valid address, return it
  if (trimmedToken.startsWith("0x") && trimmedToken.length === 42) {
    return trimmedToken.toLowerCase() as `0x${string}`;
  }
  
  // For native tokens
  if (trimmedToken.toLowerCase() === "eth" || trimmedToken.toLowerCase() === "matic") {
    return "0x0000000000000000000000000000000000000000";
  }
  
  // Try to fetch from CoinGecko
  const metadata = await getTokenMetadata(trimmedToken, network);
  if (metadata?.address) {
    logger.info(`Resolved ${token} to ${metadata.address} via CoinGecko`);
    return metadata.address as `0x${string}`;
  }
  
  logger.warn(`Could not resolve token ${token} on ${network}`);
  return null;
};

export const cdpWalletSwap: Action = {
  name: "CDP_WALLET_SWAP",
  similes: [
    "CDP_SWAP",
    "CDP_TRADE",
    "CDP_EXCHANGE",
    "SWAP_TOKENS_CDP",
    "TRADE_TOKENS_CDP",
    "EXCHANGE_TOKENS_CDP",
  ],
  description: "Swap tokens on supported networks using Coinbase CDP SDK",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = message.content.text?.toLowerCase() || "";
    const hasSwapKeywords = ["swap", "exchange", "trade", "convert", "sell", "buy"].some(
      (k) => text.includes(k)
    );
    const hasCdpKeywords = ["cdp", "coinbase"].some((k) => text.includes(k));
    
    // Return true if swap keywords are present, optionally with CDP keywords
    return hasSwapKeywords;
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
        "CDP_WALLET_SWAP",
        callback,
      );
      if (walletResult.success === false) {
        return walletResult.result;
      }

      // Compose state and get swap parameters from LLM
      const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
      const context = composePromptFromState({
        state: composedState,
        template: swapTemplate,
      });

      const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: context,
      });

      const swapParams = parseSwapParams(xmlResponse);
      
      if (!swapParams) {
        throw new Error("Failed to parse swap parameters from request");
      }

      // Resolve token symbols to addresses using CoinGecko
      const fromTokenResolved = await resolveTokenToAddress(swapParams.fromToken, swapParams.network);
      const toTokenResolved = await resolveTokenToAddress(swapParams.toToken, swapParams.network);
      
      if (!fromTokenResolved) {
        throw new Error(`Could not resolve source token: ${swapParams.fromToken}`);
      }
      if (!toTokenResolved) {
        throw new Error(`Could not resolve destination token: ${swapParams.toToken}`);
      }

      const fromToken = fromTokenResolved;
      const toToken = toTokenResolved;

      // Get decimals for the source token from CoinGecko
      const decimals = await getTokenDecimals(fromToken, swapParams.network);

      // Parse amount to wei using correct decimals
      const parseUnits = (value: string, decimals: number): bigint => {
        const [integer, fractional = ""] = value.split(".");
        const paddedFractional = fractional.padEnd(decimals, "0").slice(0, decimals);
        return BigInt(integer + paddedFractional);
      };

      const amountInWei = parseUnits(swapParams.amount, decimals);

      logger.info(`Executing CDP swap: network=${swapParams.network}, fromToken=${fromToken}, toToken=${toToken}, amount=${swapParams.amount}, slippageBps=${swapParams.slippageBps}`);

      // Execute the swap using CDP service
      const result = await cdpService.swap({
        accountName: message.entityId,
        network: swapParams.network,
        fromToken,
        toToken,
        fromAmount: amountInWei,
        slippageBps: swapParams.slippageBps,
      });

      const successText = `✅ Successfully swapped ${swapParams.amount} tokens on ${swapParams.network}\n` +
                         `Transaction Hash: ${result.transactionHash}\n` +
                         `From: ${fromToken}\n` +
                         `To: ${toToken}`;

      callback?.({
        text: successText,
        content: {
          success: true,
          transactionHash: result.transactionHash,
          network: swapParams.network,
          fromToken,
          toToken,
          amount: swapParams.amount,
        },
      });

      return {
        text: successText,
        success: true,
        data: {
          transactionHash: result.transactionHash,
          network: swapParams.network,
          fromToken,
          toToken,
          amount: swapParams.amount,
          slippageBps: swapParams.slippageBps,
        },
        values: {
          swapSuccess: true,
          transactionHash: result.transactionHash,
        },
      };
    } catch (error) {
      logger.error("CDP_WALLET_SWAP error:", error);
      
      let errorMessage = "Failed to execute swap.";
      if (error instanceof Error) {
        if (error.message.includes("insufficient")) {
          errorMessage = "Insufficient balance for this swap.";
        } else if (error.message.includes("slippage")) {
          errorMessage = "Swap failed due to price movement. Try increasing slippage tolerance.";
        } else if (error.message.includes("not authenticated")) {
          errorMessage = "CDP service is not authenticated. Please check your API credentials.";
        } else {
          errorMessage = `Swap failed: ${error.message}`;
        }
      }
      
      callback?.({
        text: errorMessage,
        content: { error: "cdp_wallet_swap_failed", details: error },
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
        content: { text: "swap 100 USDC to WETH on base" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll swap 100 USDC to WETH on Base network for you.",
          action: "CDP_WALLET_SWAP",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "exchange 0.5 ETH for DAI on ethereum" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Executing swap of 0.5 ETH to DAI on Ethereum...",
          action: "CDP_WALLET_SWAP",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "trade my MATIC for USDC on polygon with 2% slippage" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll trade your MATIC for USDC on Polygon with 2% slippage tolerance.",
          action: "CDP_WALLET_SWAP",
        },
      },
    ],
  ],
};

export default cdpWalletSwap;
