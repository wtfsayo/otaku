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
import { getTokenMetadata, getTokenDecimals, resolveTokenSymbol } from "../utils/coingecko";
import { type CdpSwapNetwork } from "../types";

const swapTemplate = `# CDP Token Swap Request

## User Request
{{recentMessages}}

## Available Networks
- base (default)
- base-sepolia  
- ethereum
- arbitrum
- optimism
- polygon

## Instructions
Extract the swap details from the user's request. If any detail is missing, use reasonable defaults.

**Important Notes:**
- **Default network is "base"** - only specify another network if explicitly mentioned by the user
- You can use EITHER token symbols (USDC, BNKR, DAI) OR contract addresses (0x...)
- If the user provides a symbol, just return the symbol as-is - the system will resolve it automatically
- For native tokens (ETH, MATIC, etc.), use the symbol: ETH, MATIC, etc.
- Only use contract addresses if explicitly provided by the user or if it's a well-known token
- Common tokens on Base: USDC, WETH, DAI, BNKR, ETH
- Common tokens on Ethereum: USDC, WETH, DAI

Respond with the swap parameters in this exact format:
<swapParams>
<network>base</network>
<fromToken>USDC</fromToken>
<toToken>WETH</toToken>
<amount>100</amount>
<slippageBps>100</slippageBps>
</swapParams>`;

interface SwapParams {
  network: CdpSwapNetwork;
  fromToken: string; // Can be symbol or address, gets resolved later
  toToken: string; // Can be symbol or address, gets resolved later
  amount: string;
  slippageBps?: number;
}

const parseSwapParams = (text: string): SwapParams | null => {
  logger.debug("Parsing swap parameters from XML response");
  const parsed = parseKeyValueXml(text);
  logger.debug(`Parsed XML data: ${JSON.stringify(parsed)}`);
  
  // Network defaults to "base" if not provided
  if (!parsed?.fromToken || !parsed?.toToken || !parsed?.amount) {
    logger.warn(`Missing required swap parameters: ${JSON.stringify({ parsed })}`);
    return null;
  }

  // Validate and format token addresses
  const formatTokenAddress = (token: string): string => {
    const cleaned = token.trim();
    
    // Handle native token symbols - convert to zero address
    const nativeTokens = ["ETH", "MATIC", "BNB"];
    if (nativeTokens.includes(cleaned.toUpperCase())) {
      return "0x0000000000000000000000000000000000000000";
    }
    
    // Return as-is - let resolveTokenToAddress handle symbol vs address logic
    return cleaned;
  };

  const swapParams = {
    network: (parsed.network || "base") as SwapParams["network"],
    fromToken: formatTokenAddress(parsed.fromToken),
    toToken: formatTokenAddress(parsed.toToken),
    amount: parsed.amount,
    slippageBps: parsed.slippageBps ? parseInt(parsed.slippageBps) : 100,
  };
  
  logger.debug(`Formatted swap parameters: ${JSON.stringify(swapParams)}`);
  return swapParams;
};

/**
 * Resolve token to address using CoinGecko
 * Handles both symbols and addresses
 * 
 * IMPORTANT: Always validates addresses with CoinGecko to prevent fake/invalid addresses.
 * The LLM may generate addresses that look valid but don't exist (e.g., 0xB1a2C3d4E5f678901234567890aBcDeFAbCdEf12).
 * This function ensures only real, verified tokens are used in swaps.
 */
const resolveTokenToAddress = async (
  token: string,
  network: string
): Promise<`0x${string}` | null> => {
  logger.debug(`Resolving token: ${token} on network: ${network}`);
  const trimmedToken = token.trim();
  
  // For native tokens
  if (trimmedToken.toLowerCase() === "eth" || trimmedToken.toLowerCase() === "matic") {
    logger.debug(`Token ${token} is a native token, using zero address`);
    return "0x0000000000000000000000000000000000000000";
  }
  
  // If it looks like an address, validate it with CoinGecko to prevent fake addresses
  if (trimmedToken.startsWith("0x") && trimmedToken.length === 42) {
    logger.debug(`Token ${token} looks like an address, validating with CoinGecko`);
    const metadata = await getTokenMetadata(trimmedToken, network);
    if (metadata?.address) {
      logger.info(`Validated address ${token} exists on CoinGecko: ${metadata.symbol} (${metadata.name})`);
      return metadata.address as `0x${string}`;
    }
    logger.warn(`Address ${token} not found on CoinGecko for network ${network} - may be fake/invalid`);
    return null;
  }
  
  // Try to resolve symbol to address via CoinGecko
  logger.debug(`Resolving token symbol from CoinGecko for ${trimmedToken}`);
  const address = await resolveTokenSymbol(trimmedToken, network);
  if (address) {
    logger.info(`Resolved ${token} to ${address} via CoinGecko`);
    return address as `0x${string}`;
  }
  
  logger.warn(`Could not resolve token ${token} on ${network}`);
  return null;
};

/**
 * Note: According to CDP Trade API documentation, the all-in-one swap pattern is recommended:
 * 
 * account.swap() handles everything automatically:
 * - Creates swap quote
 * - Handles token approvals (including Permit2)
 * - Executes the swap
 * 
 * From the official docs:
 * "You can also create and execute a swap in a single call using account.swap()."
 * 
 * Reference: https://docs.cdp.coinbase.com/trade-api/quickstart#3-execute-a-swap
 */

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
  description: "Swap tokens from one to another on EVM; e.g. USDC -> BNKR or USDC -> ETH or ETH -> USDC",
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
    logger.info("CDP_WALLET_SWAP handler invoked");
    logger.debug(`Message content: ${JSON.stringify(message.content)}`);
    
    try {
      logger.debug("Retrieving CDP service");
      const cdpService = runtime.getService(CdpService.serviceType) as CdpService;
      
      if (!cdpService) {
        logger.error("CDP Service not initialized");
        throw new Error("CDP Service not initialized");
      }
      logger.debug("CDP service retrieved successfully");

      // Ensure the user has a wallet saved
      logger.debug("Verifying entity wallet for:", message.entityId);
      const walletResult = await getEntityWallet(
        runtime,
        message,
        "CDP_WALLET_SWAP",
        callback,
      );
      if (walletResult.success === false) {
        logger.warn("Entity wallet verification failed");
        return walletResult.result;
      }
      logger.debug("Entity wallet verified successfully");

      // Compose state and get swap parameters from LLM
      logger.debug("Composing state for LLM prompt");
      const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
      const context = composePromptFromState({
        state: composedState,
        template: swapTemplate,
      });
      logger.debug("Composed prompt context");

      logger.debug("Calling LLM to extract swap parameters");
      const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: context,
      });
      logger.debug("LLM response received:", xmlResponse);

      const swapParams = parseSwapParams(xmlResponse);
      
      if (!swapParams) {
        logger.error("Failed to parse swap parameters from LLM response");
        throw new Error("Failed to parse swap parameters from request");
      }
      logger.info(`Swap parameters parsed successfully: ${JSON.stringify(swapParams)}`);

      // Resolve token symbols to addresses using CoinGecko
      logger.debug("Resolving token addresses");
      const fromTokenResolved = await resolveTokenToAddress(swapParams.fromToken, swapParams.network);
      const toTokenResolved = await resolveTokenToAddress(swapParams.toToken, swapParams.network);
      
      if (!fromTokenResolved) {
        logger.error(`Could not resolve source token: ${swapParams.fromToken}`);
        throw new Error(`Could not resolve source token: ${swapParams.fromToken}`);
      }
      if (!toTokenResolved) {
        logger.error(`Could not resolve destination token: ${swapParams.toToken}`);
        throw new Error(`Could not resolve destination token: ${swapParams.toToken}`);
      }

      const fromToken = fromTokenResolved;
      const toToken = toTokenResolved;
      logger.debug(`Token addresses resolved: ${JSON.stringify({ fromToken, toToken })}`);

      // Get decimals for the source token from CoinGecko
      logger.debug(`Fetching decimals for source token: ${fromToken}`);
      const decimals = await getTokenDecimals(fromToken, swapParams.network);
      logger.debug(`Token decimals: ${decimals}`);

      // Parse amount to wei using correct decimals
      const parseUnits = (value: string, decimals: number): bigint => {
        const [integer, fractional = ""] = value.split(".");
        const paddedFractional = fractional.padEnd(decimals, "0").slice(0, decimals);
        return BigInt(integer + paddedFractional);
      };

      const amountInWei = parseUnits(swapParams.amount, decimals);
      logger.debug(`Amount in wei: ${amountInWei.toString()}`);

      logger.info(`Executing CDP swap: network=${swapParams.network}, fromToken=${fromToken}, toToken=${toToken}, amount=${swapParams.amount}, slippageBps=${swapParams.slippageBps}`);

      // Note: CDP service uses the all-in-one account.swap() pattern
      // This automatically handles: quote creation, token approvals (Permit2), and execution
      logger.info("CDP service will execute all-in-one swap (handles quote, approvals, and execution)");

      // Execute the swap using CDP service (all-in-one pattern)
      logger.debug(`Calling CDP service swap method with params: ${JSON.stringify({
        accountName: message.entityId,
        network: swapParams.network,
        fromToken,
        toToken,
        fromAmount: amountInWei.toString(),
        slippageBps: swapParams.slippageBps,
      })}`);
      
      const result = await cdpService.swap({
        accountName: message.entityId,
        network: swapParams.network,
        fromToken,
        toToken,
        fromAmount: amountInWei,
        slippageBps: swapParams.slippageBps,
      });
      
      logger.info("CDP swap executed successfully");
      logger.debug(`Swap result: ${JSON.stringify(result)}`);

      const successText = `✅ Successfully swapped ${swapParams.amount} tokens on ${swapParams.network}\n` +
                         `Transaction Hash: ${result.transactionHash}\n` +
                         `From: ${fromToken}\n` +
                         `To: ${toToken}`;

      logger.debug("Sending success callback");
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

      logger.debug("Returning success result");
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
      logger.error("Error stack:", error instanceof Error ? error.stack : "No stack trace available");
      
      let errorMessage = "Failed to execute swap.";
      if (error instanceof Error) {
        logger.debug(`Processing error message: ${error.message}`);
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
      
      logger.debug(`Sending error callback: ${errorMessage}`);
      callback?.({
        text: errorMessage,
        content: { error: "cdp_wallet_swap_failed", details: error },
      });
      
      logger.debug("Returning error result");
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
        content: { text: "swap 3 USDC to BNKR" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll swap 3 USDC to BNKR on Base for you.",
          action: "CDP_WALLET_SWAP",
        },
      },
    ],
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
