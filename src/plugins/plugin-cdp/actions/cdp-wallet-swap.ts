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

// Network types based on CDP SDK support
type CdpSwapNetwork = "base" | "ethereum" | "arbitrum" | "optimism";
type CdpNetwork = CdpSwapNetwork | "base-sepolia" | "ethereum-sepolia" | "ethereum-hoodi" | "polygon" | "polygon-mumbai" | "arbitrum-sepolia" | "optimism-sepolia";

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

const resolveCommonTokens = (
  symbol: string,
  network: string
): `0x${string}` | null => {
  const tokens: Record<string, Record<string, `0x${string}`>> = {
    base: {
      USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      WETH: "0x4200000000000000000000000000000000000006",
      DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
      ETH: "0x0000000000000000000000000000000000000000",
    },
    ethereum: {
      USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      ETH: "0x0000000000000000000000000000000000000000",
    },
    arbitrum: {
      USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
      ETH: "0x0000000000000000000000000000000000000000",
    },
    optimism: {
      USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      WETH: "0x4200000000000000000000000000000000000006",
      DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
      ETH: "0x0000000000000000000000000000000000000000",
    },
    polygon: {
      USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
      DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
      MATIC: "0x0000000000000000000000000000000000000000",
    },
  };

  const upperSymbol = symbol.toUpperCase();
  return tokens[network]?.[upperSymbol] || null;
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

      // Try to resolve token symbols to addresses if they're not valid addresses
      let fromToken = swapParams.fromToken;
      let toToken = swapParams.toToken;
      
      if (!fromToken.startsWith("0x") || fromToken.length !== 42) {
        const resolved = resolveCommonTokens(fromToken.replace("0x", ""), swapParams.network);
        if (resolved) {
          fromToken = resolved;
        }
      }
      
      if (!toToken.startsWith("0x") || toToken.length !== 42) {
        const resolved = resolveCommonTokens(toToken.replace("0x", ""), swapParams.network);
        if (resolved) {
          toToken = resolved;
        }
      }

      // Parse amount to wei (assuming 18 decimals for now, could be improved)
      const parseUnits = (value: string, decimals: number = 18): bigint => {
        const [integer, fractional = ""] = value.split(".");
        const paddedFractional = fractional.padEnd(decimals, "0").slice(0, decimals);
        return BigInt(integer + paddedFractional);
      };

      const amountInWei = parseUnits(swapParams.amount);

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
