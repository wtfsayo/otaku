/**
 * Protocol Data Action
 *
 * Direct DeFi protocol data fetcher that retrieves protocol information
 * from DeFiLlama's API. Returns structured data for LLM processing.
 *
 * Features:
 * - Protocol name/symbol resolution from natural language queries using LLM
 * - Current protocol metrics (TVL, rankings, category data)
 * - Multi-protocol batch data retrieval
 * - Smart protocol validation using LLM extraction and fallback patterns
 * - Clean data structuring for LLM response generation
 *
 * Process:
 * 1. Extract protocols from user query using LLM
 * 2. Fetch protocol data from DeFiLlama
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

// Simple type for protocol data
interface ProtocolData {
  name: string;
  slug: string;
  tvl: number;
  rank: number;
  category: string;
  chains: number;
  change_1d: number;
  change_7d: number;
  change_30d: number;
  formatted: string;
}

const extractProtocolsTemplate = `# Extract protocol and analysis information for DeFi protocol data

## Conversation Context
{{recentMessages}}

IMPORTANT: Follow DeFiLlama API specification exactly:
- Protocol responses use proper case names: "Ethereum", "Polygon", "Arbitrum", "Optimism", "BSC", "Avalanche"
- Category names match API format: "Dexs", "Lending", "Liquid Staking", "Derivatives", "Yield", "CDP", "Bridge"
- Chain filtering should use proper case as returned by /v2/chains endpoint

The user might express protocol requests in various ways:
- "What's Aave's TVL?" → specific protocol: "Aave"
- "Compare Uniswap and SushiSwap" → multiple protocols: ["Uniswap", "SushiSwap"]
- "Top lending protocols" → category: "lending"
- "Show me DEX rankings" → category: "dex"
- "Best yield farming protocols" → category: "yield"
- "Ethereum DeFi protocols" → chain: "Ethereum"
- "Protocol analysis for MakerDAO and Compound" → protocols: ["MakerDAO", "Compound"]
- "TVL comparison of top 5 protocols" → analysis: "top_ranking", count: 5

Extract and return ONLY a JSON object following DeFiLlama API format:
{
  "protocols": ["Protocol names if specifically mentioned"],
  "categories": ["Category names if mentioned: Dexs/Lending/Liquid Staking/Derivatives/Yield/CDP/Bridge"],
  "chains": ["Chain names as per /v2/chains endpoint: Ethereum/Polygon/Arbitrum/Optimism/BSC/Avalanche"],
  "analysisType": "specific/comparison/ranking/category_analysis/overview",
  "metrics": ["tvl/ranking/volume/fees/apy if specifically requested"],
  "count": number (if user wants top N protocols),
  "timeframe": "24h/7d/30d if mentioned for changes",
  "includeDetails": true/false (if user wants detailed breakdown)
}

Return only the JSON object, no other text.`;

export const protocolDataAction: Action = {
  name: "PROTOCOL_DATA",
  similes: [
    "GET_PROTOCOL",
    "PROTOCOL_INFO",
    "PROTOCOL_TVL",
    "PROTOCOL_STATS",
    "COMPARE_PROTOCOLS",
    "PROTOCOL_ANALYSIS",
    "PROTOCOL_METRICS",
    "PROTOCOL_RESEARCH",
    "COMPETITIVE_ANALYSIS",
    "PROTOCOL_INTELLIGENCE",
    "MARKET_POSITION",
    "PROTOCOL_HEALTH",
  ],
  description:
    "Use this action when you need protocol metrics, rankings, or comparisons.",

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
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
      logger.info("[PROTOCOL_DATA] Starting protocol data fetch");

      const defiLlamaService = runtime.getService(
        "defillama",
      ) as DefiLlamaService;
      if (!defiLlamaService) {
        throw new Error("DeFiLlama service not available");
      }

      const userQuestion = message.content.text || "";

      // Extract protocol information using LLM first, with fallback to regex
      let extractedParams: any = {};

      // Check if we have explicit params in options
      if (options?.protocolParams) {
        extractedParams = options.protocolParams;
      } else {
        // Use LLM to extract protocol information from recent messages context
        const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
        const prompt = composePromptFromState({ state: composedState, template: extractProtocolsTemplate });

        const response = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });

        if (response) {
          try {
            // Strip markdown code blocks if present
            const cleanedResponse = response
              .replace(/^```(?:json)?\n?/, "")
              .replace(/\n?```$/, "")
              .trim();
            const parsed = JSON.parse(cleanedResponse);

            extractedParams = {
              protocols: parsed.protocols || [],
              categories: parsed.categories || [],
              chains: parsed.chains || [],
              analysisType: parsed.analysisType || "overview",
              metrics: parsed.metrics || [],
              count: parsed.count || 10,
              timeframe: parsed.timeframe || "24h",
              includeDetails: parsed.includeDetails || false,
            };

            logger.info(
              `[PROTOCOL_DATA] LLM extracted params: ${JSON.stringify(extractedParams)}`,
            );
          } catch (parseError) {
            logger.warn(
              `Failed to parse LLM response, falling back to regex: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            );
            // Fallback to regex-based extraction
            extractedParams = {
              protocols: [],
              categories: [extractCategoryFromQueryLegacy(userQuestion)].filter(
                Boolean,
              ),
              chains: [],
              analysisType: "overview",
              metrics: [],
              count: 10,
              timeframe: "24h",
              includeDetails: false,
            };
          }
        } else {
          logger.warn(
            "[PROTOCOL_DATA] No LLM response received, falling back to regex",
          );
          // Fallback to regex-based extraction
          extractedParams = {
            protocols: [],
            categories: [extractCategoryFromQueryLegacy(userQuestion)].filter(
              Boolean,
            ),
            chains: [],
            analysisType: "overview",
            metrics: [],
            count: 10,
            timeframe: "24h",
            includeDetails: false,
          };
        }
      }

      logger.info(
        `[PROTOCOL_DATA] Processing request with categories: ${extractedParams.categories.join(", ")}, protocols: ${extractedParams.protocols.join(", ")}`,
      );

      // Fetch protocol data
      const [protocols, chains] = await Promise.all([
        defiLlamaService.getProtocols(),
        defiLlamaService.getChains(),
      ]);

      // Validate API responses
      const validatedProtocols = Array.isArray(protocols) ? protocols : [];

      if (validatedProtocols.length === 0) {
        throw new Error("No protocol data available from API");
      }

      // Extract target protocols using LLM-extracted parameters
      const targetProtocols = extractProtocolsFromDataLLM(
        extractedParams,
        validatedProtocols,
      );

      logger.info(
        `[PROTOCOL_DATA] Found protocols: ${targetProtocols.map((p) => p.name).join(", ")}`,
      );

      // Filter and structure protocol data
      const protocolData = buildProtocolData(
        targetProtocols,
        validatedProtocols,
        extractedParams.categories[0], // Use first category if multiple
        extractedParams.count,
      );

      // Generate response using LLM
      const response = await runtime.useModel(ModelType.LARGE, {
        prompt: `Respond concisely with protocol analysis based on data: ${JSON.stringify(protocolData)}
        and user query: ${JSON.stringify(message.content)}`,
      });

      if (callback) {
        await callback({
          text: response || "Unable to analyze protocol data at this time.",
          actions: ['PROTOCOL_DATA'],
          source: message.content.source,
        });
      }

      return {
        text: response,
        success: true,
        data: {
          actionName: "PROTOCOL_DATA",
          extractedParams,
          targetProtocols,
          protocolData,
          protocolDataFetched: true,
          protocolsFound: protocolData.protocols.length,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      logger.error(
        `[PROTOCOL_DATA] Error: ${error instanceof Error ? error.message : String(error)}`,
      );

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      if (callback) {
        await callback({
          text: `❌ Failed to fetch protocol data: ${errorMessage}`,
          actions: ["PROTOCOL_DATA"],
          source: message.content.source,
        });
      }

      return {
        text: `Error fetching protocol data: ${errorMessage}`,
        success: false,
        error: error instanceof Error ? error : new Error(errorMessage),
        data: {
          actionName: "PROTOCOL_DATA",
          error: errorMessage,
          protocolDataFetched: false,
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
          text: "What is Aave's current TVL and ranking?",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Aave currently ranks #2 in DeFi with $12.8B TVL, up 2.3% over 24h. It's the leading lending protocol with deployments across 8 chains.",
          actions: ["PROTOCOL_DATA"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Compare Uniswap and SushiSwap TVL",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Uniswap: $5.2B TVL (Rank #5), SushiSwap: $890M TVL (Rank #23). Uniswap leads with 5.8x higher TVL in the DEX category.",
          actions: ["PROTOCOL_DATA"],
        },
      },
    ],
  ],
};

// Helper functions for protocol data extraction and formatting

function extractProtocolsFromDataLLM(params: any, protocols: any[]): any[] {
  let foundProtocols: any[] = [];

  // If specific protocols mentioned, search for them
  if (params.protocols && params.protocols.length > 0) {
    for (const protocolName of params.protocols) {
      const protocol = findProtocolByName(protocolName, protocols);
      if (protocol) {
        foundProtocols.push(protocol);
      }
    }
  }

  // If categories specified, filter by category
  if (params.categories && params.categories.length > 0) {
    for (const category of params.categories) {
      const categoryProtocols = protocols.filter(
        (p) =>
          p.category && p.category.toLowerCase() === category.toLowerCase(),
      );
      foundProtocols.push(...categoryProtocols);
    }
  }

  // If chains specified, filter by chain (this would need chain-specific protocol data)
  if (params.chains && params.chains.length > 0) {
    // Note: This would need additional logic to filter by chains
    // For now, we'll include all protocols that support the specified chains
    const chainProtocols = protocols.filter(
      (p) =>
        p.chains &&
        params.chains.some((chain: string) =>
          p.chains.some(
            (pChain: string) => pChain.toLowerCase() === chain.toLowerCase(),
          ),
        ),
    );
    foundProtocols.push(...chainProtocols);
  }

  // Remove duplicates
  foundProtocols = foundProtocols.filter(
    (protocol, index, self) =>
      index === self.findIndex((p) => p.slug === protocol.slug),
  );

  // If no specific protocols found, return top protocols
  if (foundProtocols.length === 0) {
    foundProtocols = protocols.slice(0, params.count || 10);
  }

  return foundProtocols;
}

function findProtocolByName(name: string, protocols: any[]): any | null {
  const searchName = name.toLowerCase();

  // Try exact matches first
  let protocol = protocols.find(
    (p) =>
      p.name.toLowerCase() === searchName ||
      p.slug.toLowerCase() === searchName ||
      p.symbol?.toLowerCase() === searchName,
  );

  if (protocol) return protocol;

  // Try partial matches
  protocol = protocols.find(
    (p) =>
      p.name.toLowerCase().includes(searchName) ||
      searchName.includes(p.name.toLowerCase()) ||
      (p.slug && p.slug.toLowerCase().includes(searchName)) ||
      (p.symbol && searchName.includes(p.symbol.toLowerCase())),
  );

  return protocol || null;
}

function extractCategoryFromQueryLegacy(query: string): string | null {
  const searchText = query.toLowerCase();

  // Category mapping with keywords based on actual API categories
  const categoryMappings = {
    Dexs: [
      "dex",
      "dexs",
      "decentralized exchange",
      "trading",
      "swap",
      "swapping",
      "amm",
      "automated market maker",
      "trading experience",
      "best trading",
      "trading platform",
      "exchange protocols",
    ],
    Lending: [
      "lending",
      "borrow",
      "borrowing",
      "loan",
      "loans",
      "credit",
      "lending protocol",
      "borrowing platform",
      "lend",
    ],
    "Liquid Staking": [
      "liquid staking",
      "staking",
      "stake",
      "validator",
      "liquid stake",
      "staking protocol",
      "staking platform",
    ],
    Derivatives: [
      "derivatives",
      "perp",
      "perpetual",
      "futures",
      "options",
      "derivative protocol",
      "trading derivatives",
    ],
    Yield: [
      "yield",
      "yield farming",
      "farming",
      "liquidity mining",
      "yield protocol",
      "yield platform",
      "yields",
    ],
    CDP: [
      "cdp",
      "collateralized debt position",
      "collateral",
      "debt position",
      "cdp protocol",
      "maker",
      "makerdao",
    ],
    Bridge: [
      "bridge",
      "cross-chain",
      "cross chain",
      "bridging",
      "bridge protocol",
    ],
  };

  // Check each category
  for (const [category, keywords] of Object.entries(categoryMappings)) {
    if (keywords.some((keyword) => searchText.includes(keyword))) {
      return category;
    }
  }

  return null; // No specific category detected
}

function buildProtocolData(
  targetProtocols: any[],
  allProtocols: any[],
  categoryFilter: string | null = null,
  count: number = 10,
): any {
  const data: any = {
    protocols: [],
    totalTvl: 0,
    categoryBreakdown: {},
    timestamp: Date.now(),
  };

  let relevantProtocols = allProtocols;

  // Filter by category if specified
  if (categoryFilter) {
    relevantProtocols = allProtocols.filter(
      (p) => p.category === categoryFilter,
    );
  }

  // If specific protocols found, use those
  if (targetProtocols.length > 0) {
    relevantProtocols = targetProtocols;
  }

  // Sort by TVL and take top protocols
  relevantProtocols = relevantProtocols
    .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
    .slice(0, count);

  // Build protocol data
  relevantProtocols.forEach((protocol, index) => {
    data.protocols.push({
      name: protocol.name,
      slug: protocol.slug,
      tvl: protocol.tvl || 0,
      rank: calculateProtocolRank(protocol, allProtocols),
      category: protocol.category || "Unknown",
      chains: protocol.chains?.length || 0,
      change_1d: protocol.change_1d || 0,
      change_7d: protocol.change_7d || 0,
      change_30d: protocol.change_30d || 0,
      formatted: formatProtocolData(protocol),
    });

    data.totalTvl += protocol.tvl || 0;
  });

  // Build category breakdown
  data.categoryBreakdown = allProtocols.reduce((acc: any, p: any) => {
    const category = p.category || "Other";
    acc[category] = (acc[category] || 0) + (p.tvl || 0);
    return acc;
  }, {});

  return data;
}

// Utility functions

function calculateProtocolRank(protocol: any, allProtocols: any[]): number {
  const sorted = allProtocols.sort((a, b) => (b.tvl || 0) - (a.tvl || 0));
  return sorted.findIndex((p) => p.slug === protocol.slug) + 1;
}

function formatProtocolData(protocol: any): string {
  const tvl = formatTvl(protocol.tvl || 0);
  const change = formatChange(protocol.change_1d);
  return `${protocol.name}: $${tvl} TVL (${change} 24h)`;
}

function formatTvl(tvl: number): string {
  if (tvl >= 1e9) return (tvl / 1e9).toFixed(1) + "B";
  if (tvl >= 1e6) return (tvl / 1e6).toFixed(1) + "M";
  if (tvl >= 1e3) return (tvl / 1e3).toFixed(1) + "K";
  return tvl.toFixed(0);
}

function formatChange(change: number | undefined): string {
  if (!change) return "N/A";
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}%`;
}
