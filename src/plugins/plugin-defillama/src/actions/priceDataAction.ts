/**
 * Price Data Action
 *
 * Direct cryptocurrency price fetcher that retrieves current price information
 * from DeFiLlama's price feeds. Returns raw data for LLM processing.
 *
 * Features:
 * - Token symbol and ID resolution from natural language queries
 * - Current price data fetching
 * - Multi-token batch price retrieval
 * - Smart token validation using LLM extraction and fallback patterns
 * - Clean data structuring for LLM response generation
 *
 * Process:
 * 1. Extract tokens from user query using LLM
 * 2. Fetch prices from DeFiLlama
 * 3. Return structured data for LLM to process
 */
import {
  Action,
  ActionResult,
  composePromptFromState,
  HandlerCallback,
  IAgentRuntime,
  logger,
  Memory,
  ModelType,
  State,
} from "@elizaos/core";
import { DefiLlamaService } from "../services/defiLlamaService";

const extractTokensTemplate = `# Extract token information for cryptocurrency price data

## Conversation Context
{{recentMessages}}

IMPORTANT: Follow DeFiLlama API specification exactly:
- Chain identifiers must be lowercase: ethereum, bsc, polygon, arbitrum, optimism, avax, fantom
- Token format: {chain}:{address} (e.g., "ethereum:0x123...", "polygon:0x456...")  
- CoinGecko format: coingecko:{id} (e.g., "coingecko:ethereum", "coingecko:bitcoin")
- All chain names in API parameters MUST be lowercase as per DeFiLlama API spec

The user might express price requests in various ways:
- "What's the price of ETH?" → token: "ethereum"
- "Show me BTC and ETH prices" → tokens: ["bitcoin", "ethereum"]
- "How much is 0x1234...abcd worth on Polygon?" → contract address with chain
- "What's USDC trading at?" → stablecoin symbol
- "Check the value of UNI and LINK" → multiple DeFi tokens
- "Price of Solana and Cardano" → full token names
- "What's the current worth of MATIC?" → alternative names

Extract and return ONLY a JSON object following DeFiLlama API format:
{
  "tokens": [
    {
      "identifier": "Symbol, name, or contract address",
      "chain": "LOWERCASE chain identifier (ethereum/polygon/arbitrum/optimism/bsc/avax/fantom) as per DeFiLlama API",
      "type": "symbol/name/address/coingecko_id"
    }
  ],
  "requestType": "single/multiple/comparison",
  "includeDetails": true/false (if user wants detailed info beyond just price),
  "searchWidth": "4h/24h/48h (time window for price search if mentioned)"
}

Return only the JSON object, no other text.`;

export const priceDataAction: Action = {
  name: "PRICE_DATA",
  similes: [
    "GET_PRICE",
    "TOKEN_PRICE",
    "COIN_PRICE",
    "CURRENT_PRICE",
    "PRICE_CHECK",
    "MARKET_PRICE",
    "TOKEN_VALUE",
    "CRYPTO_PRICE",
  ],
  description:
    "Use this action when you need current crypto prices.",

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
  ): Promise<boolean> => {
    const defiLlamaService = runtime.getService(
      DefiLlamaService.serviceType,
    ) as DefiLlamaService;
    if (!defiLlamaService) {
      logger.error("Required services not available");
      return false;
    }
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      logger.info("[PRICE_DATA] Starting price data fetch");

      const defiLlamaService = runtime.getService(
        "defillama",
      ) as DefiLlamaService;
      if (!defiLlamaService) {
        throw new Error("DeFiLlama service not available");
      }

      const userQuestion = message.content.text || "";

      // Extract tokens using LLM first, with fallback to regex
      let tokens: string[] = [];
      let searchWidth: string | undefined = undefined;

      // Check if we have explicit tokens in options
      if (options?.tokens) {
        tokens = Array.isArray(options.tokens)
          ? options.tokens
          : [options.tokens];
      } else {
        // Use LLM to extract tokens using recent messages context
        const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
        const prompt = composePromptFromState({ state: composedState, template: extractTokensTemplate });

        const response = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });

        if (response) {
          try {
            // Strip markdown code blocks if present
            const cleanedResponse = response
              .replace(/^```(?:json)?\n?/, "")
              .replace(/\n?```$/, "")
              .trim();
            const parsed = JSON.parse(cleanedResponse);

            if (parsed.tokens && Array.isArray(parsed.tokens)) {
              for (const tokenInfo of parsed.tokens) {
                const resolvedToken = resolveTokenToId(
                  tokenInfo.identifier,
                  tokenInfo.chain,
                  tokenInfo.type,
                );
                if (resolvedToken) {
                  tokens.push(resolvedToken);
                }
              }

              // Extract searchWidth if specified
              if (parsed.searchWidth) {
                searchWidth = parsed.searchWidth;
              }

              logger.info(
                `[PRICE_DATA] LLM extracted tokens: ${tokens.join(", ")}, searchWidth: ${searchWidth || "default"}`,
              );
            } else {
              logger.warn(
                "[PRICE_DATA] LLM response missing tokens array, falling back to regex",
              );
              tokens = extractTokensFromQueryLegacy(userQuestion, "");
            }
          } catch (parseError) {
            logger.warn(
              `Failed to parse LLM response, falling back to regex: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            );
            // Fallback to regex-based extraction
            tokens = extractTokensFromQueryLegacy(userQuestion, "");
          }
        } else {
          logger.warn(
            "[PRICE_DATA] No LLM response received, falling back to regex",
          );
          // Fallback to regex-based extraction
          tokens = extractTokensFromQueryLegacy(userQuestion, "");
        }
      }

      if (tokens.length === 0) {
        throw new Error("No valid tokens found in query");
      }

      // Validate tokens before making API call
      const validTokens = tokens.filter((token) => {
        // Check for valid format: either chain:address or coingecko:id
        const isValidFormat = /^(\w+:0x[a-fA-F0-9]{40}|coingecko:[\w-]+)$/.test(
          token,
        );
        if (!isValidFormat) {
          logger.warn(`[PRICE_DATA] Skipping invalid token format: ${token}`);
          return false;
        }
        return true;
      });

      if (validTokens.length === 0) {
        throw new Error("No valid token formats found after validation");
      }

      if (validTokens.length !== tokens.length) {
        logger.info(
          `[PRICE_DATA] Filtered ${tokens.length - validTokens.length} invalid tokens`,
        );
      }

      logger.info(
        `[PRICE_DATA] Fetching prices for validated tokens: ${validTokens.join(", ")}`,
      );

      // Fetch current prices
      const currentPrices = await defiLlamaService.getCoinPrices(
        validTokens,
        searchWidth,
      );

      // Structure response data
      const priceData: Record<string, any> = {};
      for (const token of validTokens) {
        const price = currentPrices.coins?.[token];
        if (price) {
          priceData[token] = {
            token: getTokenDisplayName(token),
            symbol: price.symbol,
            price: price.price,
            confidence: price.confidence,
            timestamp: price.timestamp,
            formatted: formatPrice(price.price),
          };
        }
      }

      const response = await runtime.useModel(ModelType.LARGE, {
        prompt: `Respond concisely based on data: ${JSON.stringify(priceData)}
        and context: ${JSON.stringify(message.content)}`,
      });

      if (callback) {
        await callback({
          text: response || "Unable to fetch price data at this time.",
          actions: ['PRICE_DATA'],
          source: message.content.source,
        });
      }

      return {
        text: response,
        success: true,
        data: {
          actionName: "PRICE_DATA",
          tokens: validTokens,
          prices: priceData,
          priceDataFetched: true,
          tokensFound: validTokens.length,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      logger.error(
        `[PRICE_DATA] Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      return {
        text: `Failed to fetch price data: ${errorMessage}`,
        success: false,
        error: error instanceof Error ? error : new Error(errorMessage),
        data: {
          actionName: "PRICE_DATA",
          error: errorMessage,
          priceDataFetched: false,
          timestamp: Date.now(),
        },
      };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "What is the current price of ETH?",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Retrieved price data for: Ethereum (ETH): $2,543.67, confidence 99%, updated 2m ago",
          actions: ["PRICE_DATA"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Show me BTC and ETH prices",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Bitcoin (BTC): $43,256.78, confidence 99%, updated 1m ago, Ethereum (ETH): $2,543.67, updated 2m ago",
          actions: ["PRICE_DATA"],
        },
      },
    ],
  ],
};

// Helper functions for price data extraction and formatting

function resolveTokenToId(
  identifier: string,
  chain?: string,
  type?: string,
): string | null {
  const lowerIdentifier = identifier.toLowerCase();

  // Handle contract addresses
  if (type === "address" || /^0x[a-fA-F0-9]{40}$/.test(identifier)) {
    const resolvedChain = chain || guessChainFromContext(lowerIdentifier);
    return `${resolvedChain}:${identifier}`;
  }

  // Handle coingecko IDs
  if (type === "coingecko_id" || identifier.startsWith("coingecko:")) {
    return identifier.startsWith("coingecko:")
      ? identifier
      : `coingecko:${identifier}`;
  }

  // Try token mappings first
  const tokenMap = getTokenMappings();
  if (tokenMap[lowerIdentifier]) {
    return tokenMap[lowerIdentifier];
  }

  // For unknown tokens, try as coingecko ID but log warning
  logger.warn(
    `[PRICE_DATA] Unknown token "${identifier}", attempting as coingecko ID`,
  );
  return `coingecko:${lowerIdentifier}`;
}

function extractTokensFromQueryLegacy(
  query: string,
  assetsFromAI: string,
): string[] {
  const found: string[] = [];
  const searchText = (query + " " + assetsFromAI).toLowerCase();

  // 1. Check for contract addresses (0x...)
  const addressPattern = /0x[a-fA-F0-9]{40}/g;
  const addresses = searchText.match(addressPattern);
  if (addresses) {
    for (const addr of addresses) {
      // Try to guess chain from context, default to ethereum
      const chain = guessChainFromContext(searchText);
      found.push(`${chain}:${addr}`);
    }
  }

  // 2. Check for explicit chain:address format
  const chainAddressPattern = /(\w+):0x[a-fA-F0-9]{40}/g;
  const chainAddresses = searchText.match(chainAddressPattern);
  if (chainAddresses) {
    found.push(...chainAddresses);
  }

  // 3. Check for coingecko: format
  const coingeckoPattern = /coingecko:[\w-]+/g;
  const coingeckoIds = searchText.match(coingeckoPattern);
  if (coingeckoIds) {
    found.push(...coingeckoIds);
  }

  // 4. Common token symbol/name mappings (expanded)
  const tokenMap = getTokenMappings();
  for (const [token, id] of Object.entries(tokenMap)) {
    if (searchText.includes(token)) {
      found.push(id);
    }
  }

  // 5. Pattern-based extraction for unknown tokens
  if (found.length === 0) {
    const patterns = [
      /price of ([a-z0-9]+)/i,
      /([a-z0-9]+) price/i,
      /how much is ([a-z0-9]+)/i,
      /value of ([a-z0-9]+)/i,
      /([a-z0-9]+) worth/i,
      /([a-z0-9]+) token/i,
    ];

    for (const pattern of patterns) {
      const match = searchText.match(pattern);
      if (match) {
        const token = match[1].toLowerCase();
        // First try known mappings
        if (tokenMap[token]) {
          found.push(tokenMap[token]);
        } else {
          // Try as coingecko ID (many tokens use their symbol as coingecko ID)
          found.push(`coingecko:${token}`);
        }
      }
    }
  }

  return Array.from(new Set(found)); // Remove duplicates
}

function guessChainFromContext(text: string): string {
  const chainKeywords: Record<string, string> = {
    ethereum: "ethereum",
    eth: "ethereum",
    mainnet: "ethereum",
    polygon: "polygon",
    matic: "polygon",
    arbitrum: "arbitrum",
    arb: "arbitrum",
    optimism: "optimism",
    op: "optimism",
    bsc: "bsc",
    binance: "bsc",
    avalanche: "avax",
    avax: "avax",
    fantom: "fantom",
    ftm: "fantom",
  };

  for (const [keyword, chain] of Object.entries(chainKeywords)) {
    if (text.includes(keyword)) {
      return chain;
    }
  }

  return "ethereum"; // Default to ethereum
}

function getTokenMappings(): Record<string, string> {
  return {
    // Major cryptocurrencies
    bitcoin: "coingecko:bitcoin",
    btc: "coingecko:bitcoin",
    ethereum: "coingecko:ethereum",
    eth: "coingecko:ethereum",

    // Stablecoins
    usdc: "coingecko:usd-coin",
    usdt: "coingecko:tether",
    dai: "coingecko:dai",
    busd: "coingecko:binance-usd",
    frax: "coingecko:frax",

    // Layer 1s
    bnb: "coingecko:binancecoin",
    ada: "coingecko:cardano",
    sol: "coingecko:solana",
    matic: "coingecko:matic-network",
    polygon: "coingecko:matic-network",
    avax: "coingecko:avalanche-2",
    avalanche: "coingecko:avalanche-2",
    dot: "coingecko:polkadot",
    atom: "coingecko:cosmos",

    // DeFi tokens
    link: "coingecko:chainlink",
    uni: "coingecko:uniswap",
    aave: "coingecko:aave",
    comp: "coingecko:compound-governance-token",
    mkr: "coingecko:maker",
    crv: "coingecko:curve-dao-token",
    snx: "coingecko:havven",
    synthetix: "coingecko:havven",
    sushi: "coingecko:sushi",

    // Layer 2s
    arb: "coingecko:arbitrum",
    arbitrum: "coingecko:arbitrum",
    op: "coingecko:optimism",
    optimism: "coingecko:optimism",

    // Popular DeFi
    gmx: "coingecko:gmx",
    ldo: "coingecko:lido-dao",
    rpl: "coingecko:rocket-pool",
    bal: "coingecko:balancer",
    yfi: "coingecko:yearn-finance",

    // Meme coins (popular ones)
    doge: "coingecko:dogecoin",
    shib: "coingecko:shiba-inu",
    pepe: "coingecko:pepe",
  };
}

// Utility functions

function getTokenDisplayName(tokenId: string): string {
  const nameMap: Record<string, string> = {
    "coingecko:bitcoin": "Bitcoin",
    "coingecko:ethereum": "Ethereum",
    "coingecko:usd-coin": "USD Coin",
    "coingecko:tether": "Tether",
    "coingecko:dai": "Dai",
    "coingecko:binancecoin": "BNB",
    "coingecko:cardano": "Cardano",
    "coingecko:solana": "Solana",
    "coingecko:matic-network": "Polygon",
    "coingecko:avalanche-2": "Avalanche",
    "coingecko:polkadot": "Polkadot",
    "coingecko:chainlink": "Chainlink",
    "coingecko:uniswap": "Uniswap",
    "coingecko:aave": "Aave",
    "coingecko:compound-governance-token": "Compound",
    "coingecko:maker": "Maker",
    "coingecko:curve-dao-token": "Curve",
    "coingecko:havven": "Synthetix",
  };

  return nameMap[tokenId] || tokenId.split(":")[1] || tokenId;
}

function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } else if (price >= 1) {
    return price.toFixed(4);
  } else {
    return price.toFixed(6);
  }
}

function formatTimestamp(timestamp: number): string {
  const now = Date.now() / 1000;
  const diffSeconds = now - timestamp;

  if (diffSeconds < 60) {
    return "just now";
  } else if (diffSeconds < 3600) {
    return `${Math.floor(diffSeconds / 60)}m ago`;
  } else if (diffSeconds < 86400) {
    return `${Math.floor(diffSeconds / 3600)}h ago`;
  } else {
    return `${Math.floor(diffSeconds / 86400)}d ago`;
  }
}

function formatLargeNumber(num: number): string {
  if (num >= 1e12) return (num / 1e12).toFixed(1) + "T";
  if (num >= 1e9) return (num / 1e9).toFixed(1) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(1) + "M";
  if (num >= 1e3) return (num / 1e3).toFixed(1) + "K";
  return num.toFixed(0);
}
