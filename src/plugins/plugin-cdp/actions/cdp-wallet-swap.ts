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
- For native tokens, use the symbol: ETH (converts to WETH), MATIC (converts to WMATIC), etc.
- **ETH is automatically converted to WETH** for CDP swaps (CDP doesn't support native ETH)
- Only use contract addresses if explicitly provided by the user or if it's a well-known token
- Common tokens on Base: USDC, WETH, DAI, BNKR, ETH (as WETH)
- Common tokens on Ethereum: USDC, WETH, DAI, ETH (as WETH)
- **For "all", "max", "full balance", or "entire balance" requests, use "MAX" as the amount**

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
    
    // Don't convert to zero address - just return as-is
    // resolveTokenToAddress will handle native token conversion to WETH
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
 * WETH addresses for CDP swaps
 * CDP doesn't support native ETH in swaps - must use WETH instead
 * See: https://docs.cdp.coinbase.com/sdks/cdp-sdks-v2/typescript/evm/Actions
 */
const WETH_ADDRESSES: Record<string, string> = {
  "base": "0x4200000000000000000000000000000000000006",
  "base-sepolia": "0x4200000000000000000000000000000000000006",
  "ethereum": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "ethereum-sepolia": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "arbitrum": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  "optimism": "0x4200000000000000000000000000000000000006",
  "polygon": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", // Note: Polygon uses different WETH
};

/**
 * Resolve token to address using CoinGecko
 * Handles both symbols and addresses
 * 
 * IMPORTANT: CDP doesn't support native ETH in swaps - converts ETH to WETH automatically.
 * Always validates addresses with CoinGecko to prevent fake/invalid addresses.
 * The LLM may generate addresses that look valid but don't exist (e.g., 0xB1a2C3d4E5f678901234567890aBcDeFAbCdEf12).
 * This function ensures only real, verified tokens are used in swaps.
 */
const resolveTokenToAddress = async (
  token: string,
  network: string
): Promise<`0x${string}` | null> => {
  logger.debug(`Resolving token: ${token} on network: ${network}`);
  const trimmedToken = token.trim();
  
  // For native ETH - CDP uses WETH addresses in swaps
  if (trimmedToken.toLowerCase() === "eth") {
    const wethAddress = WETH_ADDRESSES[network];
    if (wethAddress) {
      logger.info(`Converting ETH to WETH address for ${network}: ${wethAddress}`);
      return wethAddress as `0x${string}`;
    }
    logger.warn(`No WETH address configured for network ${network}`);
  }
  
  // For native MATIC on Polygon - use WMATIC
  if (trimmedToken.toLowerCase() === "matic" && network === "polygon") {
    const wmaticAddress = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
    logger.info(`Converting MATIC to WMATIC address for Polygon: ${wmaticAddress}`);
    return wmaticAddress as `0x${string}`;
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
 * Note: CDP swaps require Permit2 token approval before execution.
 * 
 * The CDP service handles this in two steps:
 * 1. Approve the token for Permit2 contract (0x000000000022D473030F116dDEE9F6B43aC78BA3)
 * 2. Execute the swap using account.swap()
 * 
 * Permit2 is a token approval contract that provides a secure way to manage
 * ERC20 token approvals for swaps across different protocols.
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

      // Handle "MAX" amount - fetch token balance using same logic as CDP_WALLET_BALANCE action
      let amountToSwap = swapParams.amount;
      if (swapParams.amount.toUpperCase() === "MAX") {
        logger.info("MAX amount detected, fetching token balance...");
        const account = await cdpService.getOrCreateAccount({ name: message.entityId });
        const balancesResponse = await account.listTokenBalances({ network: swapParams.network as any });
        const rows = balancesResponse?.balances || [];
        
        if (!rows.length) {
          logger.error(`No token balances found on ${swapParams.network}`);
          throw new Error(`No token balances found in your wallet. Please check your wallet balance first.`);
        }

        // Helper to convert values to integer strings (same as balance action)
        const toIntegerString = (v: unknown): string => {
          if (typeof v === "bigint") return v.toString();
          if (typeof v === "number") return Math.trunc(v).toString();
          if (typeof v === "string") return v;
          return "0";
        };

        // Helper to format units (same as balance action)
        const formatUnits = (amountInBaseUnits: string, decimals: number): string => {
          if (!/^-?\d+$/.test(amountInBaseUnits)) return amountInBaseUnits;
          const negative = amountInBaseUnits.startsWith("-");
          const digits = negative ? amountInBaseUnits.slice(1) : amountInBaseUnits;
          const d = Math.max(0, decimals | 0);
          if (d === 0) return (negative ? "-" : "") + digits;
          const padded = digits.padStart(d + 1, "0");
          const i = padded.length - d;
          let head = padded.slice(0, i);
          let tail = padded.slice(i);
          // trim trailing zeros on fractional part
          tail = tail.replace(/0+$/, "");
          if (tail.length === 0) return (negative ? "-" : "") + head;
          // trim leading zeros on integer part
          head = head.replace(/^0+(?=\d)/, "");
          return (negative ? "-" : "") + head + "." + tail;
        };
        
        // Find the balance for the from token (same pattern as balance action)
        const tokenBalance = rows.find((b: any) => {
          const address = (b?.token?.contractAddress || b?.token?.address || "").toLowerCase();
          return address === fromToken.toLowerCase();
        });

        if (!tokenBalance) {
          logger.error(`Token ${fromToken} not found in wallet balances on ${swapParams.network}`);
          throw new Error(`No balance found for the token you're trying to swap. Please check your wallet balance first.`);
        }

        // Extract raw amount and decimals (same as balance action)
        const raw = toIntegerString(tokenBalance?.amount?.amount ?? tokenBalance?.amount ?? "0");
        const tokenDecimals = ((tokenBalance?.amount as any)?.decimals ?? (tokenBalance?.token as any)?.decimals ?? decimals) as number;
        
        logger.info(`Found token balance: ${raw} (${tokenDecimals} decimals)`);
        
        // Check if balance is zero or negative
        const balanceInWei = BigInt(raw);
        if (balanceInWei <= 0n) {
          logger.error(`Zero or negative balance for token ${fromToken}: ${raw}`);
          throw new Error(`You have zero balance for this token. Cannot swap.`);
        }
        
        // Format to human-readable amount (same as balance action)
        amountToSwap = formatUnits(raw, tokenDecimals);
        logger.info(`Using MAX balance: ${amountToSwap} (validated non-zero)`);
      }

      // Parse amount to wei using correct decimals
      const parseUnits = (value: string, decimals: number): bigint => {
        const [integer, fractional = ""] = value.split(".");
        const paddedFractional = fractional.padEnd(decimals, "0").slice(0, decimals);
        return BigInt(integer + paddedFractional);
      };

      const amountInWei = parseUnits(amountToSwap, decimals);
      logger.debug(`Amount in wei: ${amountInWei.toString()}`);

      logger.info(`Executing CDP swap: network=${swapParams.network}, fromToken=${fromToken}, toToken=${toToken}, amount=${swapParams.amount}, slippageBps=${swapParams.slippageBps}`);

      // Note: CDP service will handle token approval and swap execution
      // Step 1: Approve token for Permit2 contract
      // Step 2: Execute the swap via account.swap()
      logger.info("CDP service will approve token and execute swap");

      // Execute the swap using CDP service
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

      const successText = `✅ Successfully swapped ${amountToSwap} tokens on ${swapParams.network}\n` +
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
          amount: amountToSwap,
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
          amount: amountToSwap,
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
