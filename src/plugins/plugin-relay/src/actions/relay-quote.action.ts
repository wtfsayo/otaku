import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  composePromptFromState,
  parseKeyValueXml,
  ModelType,
} from "@elizaos/core";
import { 
  mainnet, 
  base, 
  arbitrum, 
  polygon, 
  optimism, 
  zora,
  blast,
  scroll,
  linea,
  type Chain
} from "viem/chains";
import { RelayService } from "../services/relay.service";
import type { Execute } from "@relayprotocol/relay-sdk";

// Supported chains mapping
const SUPPORTED_CHAINS: Record<string, Chain> = {
  ethereum: mainnet,
  base: base,
  arbitrum: arbitrum,
  polygon: polygon,
  optimism: optimism,
  zora: zora,
  blast: blast,
  scroll: scroll,
  linea: linea,
};

interface QuoteParams {
  user: string;
  originChain: string;
  destinationChain: string;
  currency: string;
  toCurrency?: string;
  amount: string;
  recipient?: string;
  tradeType?: "EXACT_INPUT" | "EXACT_OUTPUT";
}

const parseQuoteParams = (text: string): QuoteParams | null => {
  const parsed = parseKeyValueXml(text);
  
  if (!parsed?.user || !parsed?.originChain || !parsed?.destinationChain || !parsed?.currency || !parsed?.amount) {
    console.warn(`Missing required quote parameters: ${JSON.stringify({ parsed })}`);
    return null;
  }

  return {
    user: parsed.user.trim(),
    originChain: parsed.originChain.toLowerCase().trim(),
    destinationChain: parsed.destinationChain.toLowerCase().trim(),
    currency: parsed.currency.toLowerCase().trim(),
    toCurrency: parsed.toCurrency?.toLowerCase().trim(),
    amount: parsed.amount,
    recipient: parsed.recipient?.trim(),
    tradeType: (parsed.tradeType || "EXACT_INPUT") as "EXACT_INPUT" | "EXACT_OUTPUT",
  };
};

/**
 * Resolve chain name to chain ID using viem chains
 */
const resolveChainNameToId = (chainName: string): number | null => {
  const normalized = chainName.toLowerCase().trim();
  const chain = SUPPORTED_CHAINS[normalized];
  
  if (!chain) {
    console.error(`Chain not found: ${chainName}. Available chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`);
    return null;
  }
  
  return chain.id;
};

/**
 * Parse amount to wei based on token decimals
 */
const parseAmountToWei = (amount: string, currency: string): string => {
  const decimals = currency.toLowerCase().includes("usdc") || 
                   currency.toLowerCase().includes("usdt") ? 6 : 18;
  
  const [integer, fractional = ""] = amount.split(".");
  const paddedFractional = fractional.padEnd(decimals, "0").slice(0, decimals);
  const amountInWei = BigInt(integer + paddedFractional);
  
  return amountInWei.toString();
};

const quoteTemplate = `# Cross-Chain Quote Request

## User Request
{{recentMessages}}

## Available Networks
- ethereum (Ethereum Mainnet)
- base (Base)
- arbitrum (Arbitrum One)
- polygon (Polygon)
- optimism (Optimism)
- zora (Zora)
- blast (Blast)
- scroll (Scroll)
- linea (Linea)

## Instructions
Extract the quote details from the user's request.

**Important Notes:**
- Use lowercase chain names ONLY (e.g., "ethereum", "base", "arbitrum")
- Do NOT provide chain IDs - only chain names
- For amounts, use human-readable format (e.g., "0.1" for 0.1 ETH, NOT in wei)
- Use token symbols (eth, usdc, usdt, weth, etc.)

Respond with the quote parameters in this exact format:
<quoteParams>
<user>0x742d35Cc6634C0532925a3b8d382F4d2d5d9a65e</user>
<originChain>ethereum</originChain>
<destinationChain>base</destinationChain>
<currency>eth</currency>
<toCurrency>eth</toCurrency>
<amount>0.1</amount>
<recipient></recipient>
<tradeType>EXACT_INPUT</tradeType>
</quoteParams>`;

export const relayQuoteAction: Action = {
  name: "GET_RELAY_QUOTE",
  description: "Get a quote for cross-chain bridging or swapping using Relay Link",
  similes: [
    "QUOTE_BRIDGE",
    "QUOTE_CROSS_CHAIN",
    "GET_BRIDGE_QUOTE",
    "CHECK_RELAY_PRICE",
    "ESTIMATE_BRIDGE_COST",
  ],

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    const keywords = [
      "quote",
      "bridge",
      "cross-chain",
      "relay",
      "transfer",
      "swap",
      "estimate",
      "cost",
      "fee",
    ];

    const text = (message.content.text || "").toLowerCase();
    const hasKeyword = keywords.some(keyword => text.includes(keyword));
    const hasChains = /(?:ethereum|base|arbitrum|polygon|optimism|zora|blast|scroll|linea)/i.test(text);
    
    return hasKeyword && hasChains;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      // Get Relay service
      const relayService = runtime.getService<RelayService>(RelayService.serviceType);

      if (!relayService) {
        throw new Error("Relay service not initialized");
      }

      // Compose state and get quote parameters from LLM
      const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
      const context = composePromptFromState({
        state: composedState,
        template: quoteTemplate,
      });

      // Extract quote parameters using LLM (gets chain names, not IDs)
      const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: context,
      });
      
      const quoteParams = parseQuoteParams(xmlResponse);
      
      if (!quoteParams) {
        throw new Error("Failed to parse quote parameters from request");
      }

      // Resolve chain names to IDs
      const originChainId = resolveChainNameToId(quoteParams.originChain);
      const destinationChainId = resolveChainNameToId(quoteParams.destinationChain);

      if (!originChainId) {
        throw new Error(`Unsupported origin chain: ${quoteParams.originChain}. Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`);
      }

      if (!destinationChainId) {
        throw new Error(`Unsupported destination chain: ${quoteParams.destinationChain}. Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`);
      }

      // Parse amount to wei
      const amountInWei = parseAmountToWei(quoteParams.amount, quoteParams.currency);

      // Get quote from Relay with resolved parameters
      const quote = await relayService.getQuote({
        user: quoteParams.user,
        chainId: originChainId,
        toChainId: destinationChainId,
        currency: quoteParams.currency,
        toCurrency: quoteParams.toCurrency || quoteParams.currency,
        amount: amountInWei,
        recipient: quoteParams.recipient,
        tradeType: quoteParams.tradeType,
      });

      // Format response
      const response: ActionResult = {
        text: formatQuoteResponse(
          quote as Execute, 
          originChainId, 
          destinationChainId,
          quoteParams.amount,
          quoteParams.currency
        ),
        success: true,
        data: {
          quote,
          request: {
            ...quoteParams,
            resolvedOriginChainId: originChainId,
            resolvedDestinationChainId: destinationChainId,
            amountInWei,
          },
        },
      };

      if (callback) {
        callback({
          text: response.text,
          actions: ["GET_RELAY_QUOTE"],
          source: message.content.source,
          data: response.data,
        });
      }

      return response;
    } catch (error: unknown) {
      const errorMessage = (error as Error).message;
      const errorResponse: ActionResult = {
        text: `Failed to get Relay quote: ${errorMessage}`,
        success: false,
        error: errorMessage,
      };

      if (callback) {
        callback({
          text: errorResponse.text,
          content: { error: "relay_quote_failed", details: errorMessage },
        });
      }

      return errorResponse;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "Get me a quote to bridge 0.1 ETH from Ethereum to Base",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Let me get you a quote for bridging 0.1 ETH from Ethereum to Base...",
          action: "GET_RELAY_QUOTE",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "How much would it cost to send 100 USDC from Base to Arbitrum?",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll check the quote for bridging 100 USDC from Base to Arbitrum...",
          action: "GET_RELAY_QUOTE",
        },
      },
    ],
  ],
};

function formatQuoteResponse(
  quote: Execute, 
  originChainId: number, 
  destinationChainId: number,
  amount: string,
  currency: string
): string {
  // Handle both old and new SDK fee structures
  const gasFeeWei = typeof (quote as any).fees?.gas === "string"
    ? (quote as any).fees.gas as string
    : (quote as any).fees?.gas?.amount ?? "0";
  const relayerFeeWei = typeof (quote as any).fees?.relayer === "string"
    ? (quote as any).fees.relayer as string
    : (quote as any).fees?.relayer?.amount ?? "0";
  const totalFees = BigInt(gasFeeWei) + BigInt(relayerFeeWei);
  const feesInEth = Number(totalFees) / 1e18;

  // Extract details with fallbacks
  const amountIn = ((quote as any).details?.amountIn ?? "0") as string;
  const amountOut = ((quote as any).details?.amountOut ?? "0") as string;
  const currencyIn = ((quote as any).details?.currencyIn ?? currency) as string;
  const currencyOut = ((quote as any).details?.currencyOut ?? currency) as string;
  const rate = ((quote as any).details?.rate ?? "?") as string;
  const totalImpact = ((quote as any).details?.totalImpact ?? "?") as string;

  return `
🔄 **Cross-Chain Quote**

**Route:** ${getChainName(originChainId)} → ${getChainName(destinationChainId)}
**Amount In:** ${formatAmount(amountIn, currencyIn)}
**Amount Out:** ${formatAmount(amountOut, currencyOut)}
**Exchange Rate:** ${rate}

**Fees:**
- Gas: ${(Number(gasFeeWei) / 1e18).toFixed(6)} ETH
- Relayer: ${(Number(relayerFeeWei) / 1e18).toFixed(6)} ETH
- Total: ${feesInEth.toFixed(6)} ETH

**Price Impact:** ${totalImpact}%

The quote is ready for execution. Would you like to proceed with the bridge?
  `.trim();
}

function getChainName(chainId: number): string {
  const chains: Record<number, string> = {
    1: "Ethereum",
    8453: "Base",
    42161: "Arbitrum",
    137: "Polygon",
    10: "Optimism",
    7777777: "Zora",
    81457: "Blast",
    534352: "Scroll",
    59144: "Linea",
  };
  return chains[chainId] || `Chain ${chainId}`;
}

function formatAmount(amount: string, currency: string): string {
  const decimals = currency.toLowerCase().includes("usdc") || currency.toLowerCase().includes("usdt") ? 6 : 18;
  const value = Number(amount) / Math.pow(10, decimals);
  return `${value.toFixed(6)} ${currency.toUpperCase()}`;
}

export default relayQuoteAction;
