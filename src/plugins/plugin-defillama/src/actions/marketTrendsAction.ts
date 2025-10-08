/**
 * Market Trends Action
 *
 * Direct market trends data fetcher that retrieves trend information
 * from DeFiLlama's API. Returns structured data for LLM processing.
 *
 * Features:
 * - Time period/category filtering from natural language queries using LLM
 * - Current market trend data (TVL changes, chain performance, sector trends)
 * - Multi-timeframe trend analysis
 * - Smart trend filtering using LLM extraction and fallback patterns
 * - Clean data structuring for LLM response generation
 *
 * Process:
 * 1. Extract trend criteria from user query using LLM
 * 2. Fetch market data from DeFiLlama
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
  parseKeyValueXml,
} from "@elizaos/core";
import { DefiLlamaService } from "../services/defiLlamaService";
import type { ProtocolDetails, Chain, ProtocolFees, DexVolume } from "../types";

interface TrendCriteria {
  timeframe: "1d" | "7d" | "30d";
  focus: "protocols" | "chains" | "categories" | "all";
  category?: string;
  sortBy: "tvl" | "volume" | "change";
  direction: "winners" | "losers" | "all";
  limit: number;
}

interface TrendItem {
  name: string;
  type: "protocol" | "chain" | "category";
  tvl: number;
  change_1d: number;
  change_7d: number;
  rank: number;
  category?: string;
  formatted?: string;
}

interface StructuredTrendData {
  trends: TrendItem[];
  totalTvl: number;
  marketSentiment: "bullish" | "bearish" | "neutral";
  timestamp: number;
}

// Simple type for trend data
interface TrendData {
  name: string;
  type: "protocol" | "chain" | "category";
  tvl: number;
  change_1d: number;
  change_7d: number;
  change_30d: number;
  rank: number;
  category?: string;
  formatted: string;
}

const extractMarketTrendsTemplate = `# Extract market trends analysis parameters for DeFi trend data

## Conversation Context
{{recentMessages}}

IMPORTANT: Follow DeFiLlama API specification exactly:
- /protocols endpoint returns protocol data with tvl, change_1d, change_7d, category
- /chains endpoint returns chain data with tvl (no change data available)
- /overview/fees and /overview/dexs endpoints provide additional performance metrics
- Protocol categories: "Dexs", "Lending", "Liquid Staking", "Derivatives", "Yield", "CDP", "Bridge"
- Chain names in proper case: "Ethereum", "Polygon", "Arbitrum", "Optimism", "BSC", "Avalanche"

The user might express market trends requests in various ways:
- "Best performing DeFi protocols this week" → focus: "protocols", timeframe: "7d", direction: "winners"
- "Chain performance trends last 30 days" → focus: "chains", timeframe: "30d", analysisType: "performance"
- "DEX sector analysis" → focus: "categories", category: "Dexs", sortBy: "tvl"
- "Top 5 lending protocols by TVL" → focus: "protocols", category: "Lending", sortBy: "tvl", limit: 5
- "Market losers today" → direction: "losers", timeframe: "1d"
- "DeFi market overview" → focus: "all", analysisType: "overview"
- "Volume leaders this month" → sortBy: "volume", timeframe: "30d"

Respond with parameters in this exact format:
<response>
  <focus>protocols/chains/categories/all</focus>
  <timeframe>1d/7d/30d</timeframe>
  <direction>winners/losers/all</direction>
  <category>Dexs/Lending/Liquid Staking/Derivatives</category>
  <sortBy>tvl/volume/change</sortBy>
  <analysisType>performance/overview/ranking/comparison</analysisType>
  <limit>10</limit>
  <includeMetrics>tvl,volume,fees,change</includeMetrics>
  <marketScope>overall/sector/chain</marketScope>
</response>`;

export const marketTrendsAction: Action = {
  name: "MARKET_TRENDS",
  similes: [
    "MARKET_ANALYSIS",
    "TREND_ANALYSIS",
    "MARKET_OVERVIEW",
    "DEFI_TRENDS",
    "SECTOR_PERFORMANCE",
    "CHAIN_TRENDS",
    "PROTOCOL_TRENDS",
    "TVL_TRENDS",
    "MARKET_SENTIMENT",
    "PERFORMANCE_ANALYSIS",
  ],
  description:
    "Use this action when you need DeFi market trend context across protocols, categories, or chains.",

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
      logger.info("[MARKET_TRENDS] Starting market trends data fetch");

      const defiLlamaService = runtime.getService(
        "defillama",
      ) as DefiLlamaService;
      if (!defiLlamaService) {
        throw new Error("DeFiLlama service not available");
      }

      const userQuestion = message.content.text || "";

      // Extract trend criteria using LLM first, with fallback to regex
      let extractedParams: any;

      // Check if we have explicit params in options
      if (options?.trendParams) {
        extractedParams = options.trendParams;
      } else {
        // Use LLM to extract criteria via recent messages context
        const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
        const prompt = composePromptFromState({ state: composedState, template: extractMarketTrendsTemplate });

        const response = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });

        if (response) {
          try {
            const parsed = parseKeyValueXml(response);

            if (!parsed) {
              throw new Error("Failed to parse XML response");
            }

            extractedParams = {
              focus: parsed.focus || "protocols",
              timeframe: parsed.timeframe || "7d",
              direction: parsed.direction || "all",
              category: parsed.category || undefined,
              sortBy: parsed.sortBy || "tvl",
              analysisType: parsed.analysisType || "performance",
              limit: parsed.limit ? parseInt(parsed.limit) : 10,
              includeMetrics: parsed.includeMetrics ? parsed.includeMetrics.split(',').map((s: string) => s.trim()) : [],
              marketScope: parsed.marketScope || "overall",
            };

            logger.info(
              `[MARKET_TRENDS] LLM extracted params: ${JSON.stringify(extractedParams)}`,
            );
          } catch (parseError) {
            logger.warn(
              `Failed to parse LLM response, falling back to regex: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            );
            // Fallback to regex-based extraction
            extractedParams = {
              ...extractTrendCriteriaLegacy(userQuestion),
              analysisType: "performance",
              includeMetrics: [],
              marketScope: "overall",
            };
          }
        } else {
          logger.warn(
            "[MARKET_TRENDS] No LLM response received, falling back to regex",
          );
          // Fallback to regex-based extraction
          extractedParams = {
            ...extractTrendCriteriaLegacy(userQuestion),
            analysisType: "performance",
            includeMetrics: [],
            marketScope: "overall",
          };
        }
      }

      logger.info(
        `[MARKET_TRENDS] Fetching trends with criteria: ${JSON.stringify(extractedParams)}`,
      );

      // Fetch market data
      const [protocols, chains, dexVolumes, protocolFees] = await Promise.all([
        defiLlamaService.getProtocols(),
        defiLlamaService.getChains(),
        defiLlamaService
          .getDexVolumes({
            excludeTotalDataChart: true,
            excludeTotalDataChartBreakdown: true,
          })
          .catch(() => null),
        defiLlamaService
          .getProtocolFees({
            excludeTotalDataChart: true,
            excludeTotalDataChartBreakdown: true,
            dataType: "dailyFees",
          })
          .catch(() => null),
      ]);

      // Validate API responses
      const validatedProtocols = Array.isArray(protocols) ? protocols : [];
      const validatedChains = Array.isArray(chains) ? chains : [];
      const validatedDexVolumes = Array.isArray(dexVolumes) ? dexVolumes : null;
      const validatedProtocolFees = Array.isArray(protocolFees)
        ? protocolFees
        : null;

      if (validatedProtocols.length === 0) {
        throw new Error("No market data available from API");
      }

      // Build trend data
      const trendData = buildTrendDataLLM(
        extractedParams,
        validatedProtocols,
        validatedChains,
        validatedDexVolumes,
        validatedProtocolFees,
      );

      // Generate response using LLM
      const response = await runtime.useModel(ModelType.LARGE, {
        prompt: `Respond concisely with market trends analysis based on data: ${JSON.stringify(trendData)}
        and user query: ${JSON.stringify(message.content)}`,
      });

      if (callback) {
        await callback({
          text: response || "Unable to analyze market trends at this time.",
          actions: ['MARKET_TRENDS'],
          source: message.content.source,
        });
      }

      return {
        text: response,
        success: true,
        data: {
          actionName: "MARKET_TRENDS",
          extractedParams,
          trendData,
          trendDataFetched: true,
          trendsFound: trendData.trends.length,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      logger.error(
        `[MARKET_TRENDS] Error: ${error instanceof Error ? error.message : String(error)}`,
      );

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      if (callback) {
        await callback({
          text: `❌ Failed to fetch trend data: ${errorMessage}`,
          actions: ["MARKET_TRENDS"],
          source: message.content.source,
        });
      }

      return {
        text: `Error fetching trend data: ${errorMessage}`,
        success: false,
        error: error instanceof Error ? error : new Error(errorMessage),
        data: {
          actionName: "MARKET_TRENDS",
          error: errorMessage,
          trendDataFetched: false,
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
          text: "What are the best performing DeFi protocols this week?",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Top DeFi performers this week: Aave +12.3% (rank #2), Uniswap +8.7% (rank #5), Curve +15.2% (rank #7). Lending and DEX categories showing strong growth with increased TVL inflows.",
          actions: ["MARKET_TRENDS"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Show me chain performance trends over the last 30 days",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "30-day chain trends: Arbitrum +18.5% TVL growth, Polygon +12.1%, Base +22.3%. Ethereum stable at +2.1%. L2s outperforming with increased adoption and lower fees driving growth.",
          actions: ["MARKET_TRENDS"],
        },
      },
    ],
  ],
};

// Helper functions for trend data extraction and formatting

function buildTrendDataLLM(
  params: any,
  protocols: ProtocolDetails[],
  chains: Chain[],
  dexVolumes: DexVolume[] | null,
  protocolFees: ProtocolFees[] | null,
): StructuredTrendData {
  const data: StructuredTrendData = {
    trends: [],
    totalTvl: 0,
    marketSentiment: "neutral",
    timestamp: Date.now(),
  };

  let items: TrendItem[] = [];

  // Build trend items based on focus
  if (params.focus === "chains") {
    items = chains.map((chain) => ({
      name: chain.name,
      type: "chain",
      tvl: chain.tvl || 0,
      change_1d: 0, // chains don't have change data in basic endpoint
      change_7d: 0,
      rank: 0,
    }));
  } else if (params.focus === "categories") {
    // Group protocols by category
    const categoryTvl: { [key: string]: any } = {};
    protocols.forEach((protocol) => {
      const category = protocol.category || "Other";
      if (!categoryTvl[category]) {
        categoryTvl[category] = {
          name: category,
          type: "category",
          tvl: 0,
          change_1d: 0,
          change_7d: 0,
          count: 0,
        };
      }
      categoryTvl[category].tvl += (protocol as any).tvl || 0;
      categoryTvl[category].change_1d += (protocol as any).change_1d || 0;
      categoryTvl[category].change_7d += (protocol as any).change_7d || 0;
      categoryTvl[category].count += 1;
    });

    // Average the changes
    items = Object.values(categoryTvl).map((cat: any) => ({
      ...cat,
      change_1d: cat.count > 0 ? cat.change_1d / cat.count : 0,
      change_7d: cat.count > 0 ? cat.change_7d / cat.count : 0,
    }));
  } else {
    // Protocols
    items = protocols.map((protocol, index) => ({
      name: protocol.name,
      type: "protocol" as const,
      tvl: protocol.tvl || 0,
      change_1d: protocol.change_1d || 0,
      change_7d: protocol.change_7d || 0,
      rank: index + 1,
      category: protocol.category,
    }));
  }

  // Filter by category if specified
  if (params.category) {
    items = items.filter(
      (item) =>
        item.category === params.category || item.name === params.category,
    );
  }

  // Filter by direction
  const getChangeValue = (item: TrendItem, timeframe: string): number => {
    if (timeframe === "1d") return item.change_1d;
    if (timeframe === "7d") return item.change_7d;
    return item.change_1d; // fallback
  };

  if (params.direction === "winners") {
    items = items.filter((item) => getChangeValue(item, params.timeframe) > 0);
  } else if (params.direction === "losers") {
    items = items.filter((item) => getChangeValue(item, params.timeframe) < 0);
  }

  // Sort items based on criteria
  if (params.sortBy === "tvl") {
    items.sort((a, b) => (b.tvl || 0) - (a.tvl || 0));
  } else if (params.sortBy === "change") {
    items.sort(
      (a, b) =>
        getChangeValue(b, params.timeframe) -
        getChangeValue(a, params.timeframe),
    );
  } else if (params.sortBy === "volume" && dexVolumes) {
    // For volume sorting, try to match with DEX volume data using improved matching
    items.forEach((item) => {
      const volumeData = findMatchingProtocolByName(dexVolumes, item.name);
      if (volumeData) {
        // Add volume data for sorting
        (item as any).volume = volumeData.total24h || 0;
      }
    });
    items.sort((a, b) => ((b as any).volume || 0) - ((a as any).volume || 0));
  } else {
    // Default to change-based sorting
    items.sort(
      (a, b) =>
        getChangeValue(b, params.timeframe) -
        getChangeValue(a, params.timeframe),
    );
  }

  // Take top items based on limit
  items = items.slice(0, params.limit);

  // Build trend data
  items.forEach((item) => {
    data.trends.push({
      name: item.name,
      type: item.type,
      tvl: item.tvl,
      change_1d: item.change_1d,
      change_7d: item.change_7d,
      rank: item.rank,
      category: item.category,
      formatted: formatTrendDataLLM(item, params.timeframe),
    });

    data.totalTvl += item.tvl || 0;
  });

  // Calculate market sentiment based on average change
  const avgChange =
    items.length > 0
      ? items.reduce(
          (sum, item) => sum + getChangeValue(item, params.timeframe),
          0,
        ) / items.length
      : 0;

  data.marketSentiment =
    avgChange > 5 ? "bullish" : avgChange < -5 ? "bearish" : "neutral";

  return data;
}

function extractTrendCriteriaLegacy(query: string): TrendCriteria {
  const searchText = query.toLowerCase();

  const criteria: TrendCriteria = {
    timeframe: "7d", // default
    focus: "protocols", // protocols, chains, categories, all
    category: undefined,
    sortBy: "tvl", // tvl, volume, change
    direction: "all", // winners, losers, all
    limit: 10,
  };

  // Extract timeframe
  if (
    searchText.includes("24h") ||
    searchText.includes("24 hour") ||
    searchText.includes("today")
  ) {
    criteria.timeframe = "1d";
  } else if (
    searchText.includes("week") ||
    searchText.includes("7d") ||
    searchText.includes("7 day")
  ) {
    criteria.timeframe = "7d";
  } else if (
    searchText.includes("month") ||
    searchText.includes("30d") ||
    searchText.includes("30 day")
  ) {
    criteria.timeframe = "30d";
  }

  // Extract focus area
  if (
    searchText.includes("chain") ||
    searchText.includes("blockchain") ||
    searchText.includes("network")
  ) {
    criteria.focus = "chains";
  } else if (searchText.includes("category") || searchText.includes("sector")) {
    criteria.focus = "categories";
  } else if (
    searchText.includes("protocol") ||
    searchText.includes("project")
  ) {
    criteria.focus = "protocols";
  }

  // Extract category filter
  const categoryKeywords = {
    dex: "Dexs",
    lending: "Lending",
    staking: "Liquid Staking",
    derivatives: "Derivatives",
    yield: "Yield",
    bridge: "Bridge",
    cdp: "CDP",
    insurance: "Insurance",
  };

  for (const [keyword, category] of Object.entries(categoryKeywords)) {
    if (searchText.includes(keyword)) {
      criteria.category = category;
      break;
    }
  }

  // Extract performance direction
  if (
    searchText.includes("winner") ||
    searchText.includes("best") ||
    searchText.includes("top") ||
    searchText.includes("gain")
  ) {
    criteria.direction = "winners";
  } else if (
    searchText.includes("loser") ||
    searchText.includes("worst") ||
    searchText.includes("declining") ||
    searchText.includes("loss")
  ) {
    criteria.direction = "losers";
  }

  // Extract sort preference
  if (searchText.includes("volume") || searchText.includes("trading")) {
    criteria.sortBy = "volume";
  } else if (
    searchText.includes("tvl") ||
    searchText.includes("value locked")
  ) {
    criteria.sortBy = "tvl";
  }

  return criteria;
}

// Utility functions

function formatTrendDataLLM(item: TrendItem, timeframe: string): string {
  const getChangeForFormat = (item: TrendItem, timeframe: string): number => {
    if (timeframe === "1d") return item.change_1d;
    if (timeframe === "7d") return item.change_7d;
    return item.change_1d; // fallback
  };

  const change = getChangeForFormat(item, timeframe).toFixed(1);
  const tvl = formatLargeNumber(item.tvl || 0);
  const sign = parseFloat(change) >= 0 ? "+" : "";

  return `${item.name}: $${tvl} TVL, ${sign}${change}% (${timeframe})`;
}

function formatLargeNumber(num: number): string {
  if (num >= 1e12) return (num / 1e12).toFixed(1) + "T";
  if (num >= 1e9) return (num / 1e9).toFixed(1) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(1) + "M";
  if (num >= 1e3) return (num / 1e3).toFixed(1) + "K";
  return num.toFixed(0);
}

/**
 * Common protocol name mappings for better matching accuracy
 * Maps user-friendly names to API-specific protocol names
 */
const PROTOCOL_NAME_MAPPINGS: { [key: string]: string[] } = {
  // Uniswap variations
  uniswap: ["uniswap-v3", "uniswap-v2", "uniswap"],
  uni: ["uniswap-v3", "uniswap-v2", "uniswap"],
  "uniswap v3": ["uniswap-v3"],
  "uniswap v2": ["uniswap-v2"],

  // Curve variations
  curve: ["curve-dex", "curve"],
  crv: ["curve-dex", "curve"],

  // Compound variations
  compound: ["compound-v3", "compound-v2", "compound"],
  comp: ["compound-v3", "compound-v2", "compound"],

  // Aave variations
  aave: ["aave-v3", "aave-v2", "aave"],
  "aave v3": ["aave-v3"],
  "aave v2": ["aave-v2"],

  // Balancer variations
  balancer: ["balancer-v2", "balancer"],
  bal: ["balancer-v2", "balancer"],

  // SushiSwap variations
  sushiswap: ["sushiswap", "sushi"],
  sushi: ["sushiswap", "sushi"],

  // PancakeSwap variations
  pancakeswap: ["pancakeswap", "pancake"],
  pancake: ["pancakeswap", "pancake"],
  pcs: ["pancakeswap"],

  // 1inch variations
  "1inch": ["1inch", "1inch-liquidity-protocol"],
  oneinch: ["1inch", "1inch-liquidity-protocol"],

  // MakerDAO variations
  makerdao: ["makerdao", "maker"],
  maker: ["makerdao", "maker"],
  dai: ["makerdao"],

  // Lido variations
  lido: ["lido", "lido-liquid-staking"],
  steth: ["lido"],

  // Rocket Pool variations
  "rocket pool": ["rocket-pool"],
  rocketpool: ["rocket-pool"],
  rpl: ["rocket-pool"],

  // Frax variations
  frax: ["frax-finance", "frax"],
  "frax finance": ["frax-finance"],

  // Convex variations
  convex: ["convex-finance"],
  "convex finance": ["convex-finance"],
  cvx: ["convex-finance"],
};

/**
 * Improved name matching algorithm with multi-stage approach
 * 1. Exact name match (case-insensitive)
 * 2. Common protocol name mappings
 * 3. Contains match (fallback to original approach)
 *
 * @param protocols Array of protocols to search through
 * @param targetName Name to find matches for
 * @returns Matching protocol or null if no match found
 */
function findMatchingProtocolByName<T extends { name?: string }>(
  protocols: T[],
  targetName: string,
): T | null {
  if (!protocols || protocols.length === 0 || !targetName) {
    return null;
  }

  const normalizedTarget = targetName.toLowerCase().trim();

  // Stage 1: Exact name match (case-insensitive)
  const exactMatch = protocols.find(
    (protocol) => protocol.name?.toLowerCase().trim() === normalizedTarget,
  );
  if (exactMatch) {
    return exactMatch;
  }

  // Stage 2: Common protocol name mappings
  const mappedNames = PROTOCOL_NAME_MAPPINGS[normalizedTarget];
  if (mappedNames) {
    for (const mappedName of mappedNames) {
      const mappedMatch = protocols.find(
        (protocol) =>
          protocol.name?.toLowerCase().trim() === mappedName.toLowerCase(),
      );
      if (mappedMatch) {
        return mappedMatch;
      }
    }

    // Also try contains match for mapped names
    for (const mappedName of mappedNames) {
      const mappedContainsMatch = protocols.find(
        (protocol) =>
          protocol.name?.toLowerCase().includes(mappedName.toLowerCase()) ||
          mappedName.toLowerCase().includes(protocol.name?.toLowerCase() || ""),
      );
      if (mappedContainsMatch) {
        return mappedContainsMatch;
      }
    }
  }

  // Stage 3: Contains match (original approach, but more careful)
  // Only proceed if the target name is reasonably specific (3+ characters)
  if (normalizedTarget.length >= 3) {
    const containsMatch = protocols.find((protocol) => {
      const protocolName = protocol.name?.toLowerCase().trim() || "";

      // Bidirectional contains check to reduce false positives
      return (
        protocolName.includes(normalizedTarget) ||
        normalizedTarget.includes(protocolName)
      );
    });

    if (containsMatch) {
      return containsMatch;
    }
  }

  // No match found
  return null;
}
