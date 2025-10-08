/**
 * Historical Data Action
 *
 * Direct historical data fetcher that retrieves time-series information
 * from DeFiLlama's API. Returns structured data for LLM processing.
 *
 * Features:
 * - Protocol/timeframe filtering from natural language queries using LLM
 * - Historical TVL, price, and protocol data
 * - Multi-timeframe data retrieval (24h, 7d, 30d, 90d, 1y)
 * - Smart period extraction using LLM and fallback patterns
 * - Clean data structuring for LLM response generation
 *
 * Process:
 * 1. Extract protocols and timeframe from user query using LLM
 * 2. Fetch historical data from DeFiLlama
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
import type { ProtocolDetails, Chain, HistoricalData } from "../types";

interface HistoricalProtocolData {
  protocol: string;
  protocolInfo?: {
    tvl?: number;
    category?: string;
    chain?: string;
    chainTvls?: Record<string, number>; // Added for chain-specific TVL
    chains?: string[]; // Added for chain names
  };
  historicalTVL?: Array<{
    totalLiquidityUSD: number;
    date: number;
  }>;
}

interface MarketOverviewData {
  protocols: Array<{
    name: string;
    tvl: number;
    category: string;
    change_7d?: number;
  }>;
  chains?: Array<{
    name: string;
    tvl: number;
  }>;
}

interface StructuredHistoricalData {
  timeframe: string;
  protocolsAnalyzed: string[] | string;
  protocolData: Array<{
    name: string;
    currentTvl: number;
    category: string;
    chain: string;
    historicalPoints: number;
    latestChange: number;
  }>;
  marketData: MarketOverviewData | null;
  summary: {
    totalProtocols: number;
    dataPoints: number;
    timeRange: string;
  };
}

const extractHistoricalTemplate = `# Extract historical data analysis parameters for time-series DeFi data

## Conversation Context
{{recentMessages}}

IMPORTANT: Follow DeFiLlama API specification exactly:
- /protocol/{protocol} endpoint returns historical TVL data with chainTvls.tvl[].{date, totalLiquidityUSD}
- /protocols endpoint returns current protocol data with tvl, category, chains
- /v2/historicalChainTvl/{chain} returns historical chain-level TVL data
- Chain names in proper case: "Ethereum", "Polygon", "Arbitrum", "Optimism", "BSC", "Avalanche"
- Protocol names as returned by API: "Aave", "Uniswap", "Compound", "Curve", etc.

The user might express historical data requests in various ways:
- "Aave TVL growth over 6 months" → protocols: ["Aave"], timeframe: "6m", dataType: "tvl"
- "Compare Uniswap vs SushiSwap last year" → protocols: ["Uniswap", "SushiSwap"], timeframe: "1y", analysisType: "comparison"
- "DeFi trends last 30 days" → timeframe: "30d", analysisType: "market_overview"
- "Ethereum TVL historical performance" → chains: ["Ethereum"], timeframe: "1y", dataType: "tvl"
- "Protocol performance since January" → timeframe: "custom", analysisType: "performance"
- "Weekly growth analysis for lending protocols" → category: "Lending", timeframe: "7d", analysisType: "growth"

Extract and return ONLY a JSON object following DeFiLlama API format:
{
  "protocols": ["Protocol names if mentioned: Aave/Uniswap/Compound/Curve"],
  "chains": ["Chain names as per API: Ethereum/Polygon/Arbitrum/Optimism/BSC/Avalanche"],
  "timeframe": "24h/7d/30d/90d/180d/1y/custom (time period requested)",
  "dataType": "tvl/volume/fees/price (what historical data to analyze)",
  "analysisType": "growth/comparison/trends/performance/market_overview",
  "category": ["Lending/Dexs/Derivatives if mentioned"],
  "granularity": "daily/weekly/monthly (data point frequency if specified)",
  "includeBreakdown": true/false (if user wants chain/token breakdown),
  "compareToMarket": true/false (if user wants market comparison),
  "count": number (how many protocols/chains to analyze, default 10)
}

Return only the JSON object, no other text.`;

export const historicalDataAction: Action = {
  name: "HISTORICAL_DATA",
  similes: [
    "historical analysis",
    "price history",
    "tvl trends",
    "protocol growth",
    "historical comparison",
    "time series",
    "trend analysis",
    "historical performance",
    "past data",
    "historical metrics",
  ],
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const defiLlamaService = runtime.getService(
      DefiLlamaService.serviceType,
    ) as DefiLlamaService;
    if (!defiLlamaService) {
      logger.error("Required services not available");
      return false;
    }
    return true;
  },
  description:
    "Use this action when you need historical TVL, price, or protocol time-series data.",
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: any,
    options: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("[HISTORICAL_DATA] Starting historical data analysis");

    try {
      const userQuestion = message.content.text || "";

      // Extract historical criteria using LLM first, with fallback to regex
      let extractedParams: any;

      // Check if we have explicit params in options
      if (options?.historicalParams) {
        extractedParams = options.historicalParams;
      } else {
        // Use LLM to extract criteria from recent messages context
        const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
        const prompt = composePromptFromState({ state: composedState, template: extractHistoricalTemplate });

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
              chains: parsed.chains || [],
              timeframe: parsed.timeframe || "30d",
              dataType: parsed.dataType || "tvl",
              analysisType: parsed.analysisType || "trends",
              category: parsed.category || [],
              granularity: parsed.granularity || "daily",
              includeBreakdown: parsed.includeBreakdown || false,
              compareToMarket: parsed.compareToMarket || false,
              count: parsed.count || 10,
            };

            logger.info(
              `[HISTORICAL_DATA] LLM extracted params: ${JSON.stringify(extractedParams)}`,
            );
          } catch (parseError) {
            logger.warn(
              "Failed to parse LLM response, falling back to regex:",
              parseError instanceof Error ? parseError.message : String(parseError),
            );
            // Fallback to regex-based extraction
            const timeframe = extractTimeframeFromQueryLegacy(userQuestion);
            const targetProtocols =
              extractProtocolsFromQueryLegacy(userQuestion);
            extractedParams = {
              protocols: targetProtocols,
              chains: [],
              timeframe: timeframe,
              dataType: "tvl",
              analysisType: "trends",
              category: [],
              granularity: "daily",
              includeBreakdown: false,
              compareToMarket: false,
              count: 10,
            };
          }
        } else {
          logger.warn(
            "[HISTORICAL_DATA] No LLM response received, falling back to regex",
          );
          // Fallback to regex-based extraction
          const timeframe = extractTimeframeFromQueryLegacy(userQuestion);
          const targetProtocols = extractProtocolsFromQueryLegacy(userQuestion);
          extractedParams = {
            protocols: targetProtocols,
            chains: [],
            timeframe: timeframe,
            dataType: "tvl",
            analysisType: "trends",
            category: [],
            granularity: "daily",
            includeBreakdown: false,
            compareToMarket: false,
            count: 10,
          };
        }
      }

      logger.info(
        `[HISTORICAL_DATA] Fetching data for timeframe: ${extractedParams.timeframe}, protocols: ${extractedParams.protocols.join(", ") || "all"}`,
      );

      // Fetch historical data
      const defiLlamaService = runtime.getService<DefiLlamaService>(
        DefiLlamaService.serviceType,
      );

      if (!defiLlamaService) {
        throw new Error("DeFiLlama service not available");
      }

      let historicalData: any = {};

      if (extractedParams.protocols.length > 0) {
        // Fetch specific protocol historical data
        const protocolDataPromises = extractedParams.protocols.map(
          async (protocol: string) => {
            try {
              const protocolSlug = protocol.toLowerCase().replace(/\s+/g, "-");
              const [protocolInfo, historicalTVL] = await Promise.all([
                defiLlamaService.getProtocol(protocolSlug),
                defiLlamaService.getHistoricalTVL(
                  protocolSlug,
                  extractedParams.timeframe,
                ),
              ]);
              return { protocol, protocolInfo, historicalTVL };
            } catch (error) {
              logger.warn(
                `[HISTORICAL_DATA] Failed to fetch data for ${protocol}: ${error}`,
              );
              return null;
            }
          },
        );

        const protocolResults = await Promise.allSettled(protocolDataPromises);
        historicalData.protocols = protocolResults
          .filter(
            (
              result,
            ): result is PromiseFulfilledResult<{
              protocol: string;
              protocolInfo: ProtocolDetails;
              historicalTVL: HistoricalData[];
            }> => result.status === "fulfilled" && result.value !== null,
          )
          .map((result) => result.value);
      } else {
        // Fetch general market data
        const [protocols, chains] = await Promise.all([
          defiLlamaService.getProtocols(),
          defiLlamaService.getChains(),
        ]);

        // Filter by category if specified
        let filteredProtocols = protocols;
        if (extractedParams.category && extractedParams.category.length > 0) {
          filteredProtocols = protocols.filter((p: any) =>
            extractedParams.category.some((cat: string) =>
              p.category?.toLowerCase().includes(cat.toLowerCase()),
            ),
          );
        }

        historicalData.protocols = filteredProtocols.slice(
          0,
          extractedParams.count,
        );
        historicalData.chains = chains.slice(0, 5); // Top 5 chains
      }

      // Structure data for LLM response
      const structuredData = buildHistoricalDataLLM(
        historicalData,
        extractedParams,
      );

      logger.info("[HISTORICAL_DATA] Data fetched and structured successfully");

      // Generate response using LLM
      const response = await runtime.useModel(ModelType.LARGE, {
        prompt: `Respond concisely with historical analysis based on data: ${JSON.stringify(structuredData)}

Question: ${userQuestion}

Provide insights on:
- Historical trends and patterns in the specified timeframe
- Key performance changes and growth metrics
- Significant events or inflection points
- Comparative analysis if multiple protocols mentioned

Keep response focused, data-driven, and under 150 words.`,
        temperature: 0.7,
        stop: ["<END>"],
      });

      if (callback) {
        await callback({
          text: response || "Unable to analyze historical data at this time.",
          actions: ['HISTORICAL_DATA'],
          source: message.content.source,
        });
      }

      return {
        text: response || "Historical analysis completed",
        success: true,
        data: {
          actionName: "HISTORICAL_DATA",
          extractedParams,
          structuredData,
          historicalDataFetched: true,
          protocolsAnalyzed:
            extractedParams.protocols.length || "market overview",
          timestamp: Date.now(),
        },
      } as ActionResult;
    } catch (error) {
      const errorMessage = `Failed to fetch historical data: ${error}`;
      logger.error(`[HISTORICAL_DATA] ${errorMessage}`);

      if (callback) {
        await callback({
          text: "I encountered an error while fetching historical data. Please try again.",
          source: "HISTORICAL_DATA",
        });
      }

      return {
        text: "Error fetching historical data. Please try again.",
        success: false,
        data: {
          actionName: "HISTORICAL_DATA",
          error: errorMessage,
          historicalDataFetched: false,
          timestamp: Date.now(),
        },
      } as ActionResult;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: { text: "Show me Aave's TVL growth over the last 6 months" },
      },
      {
        name: "assistant",
        content: {
          text: "Here's Aave's TVL historical analysis over the past 6 months: [analysis based on latest DeFiLlama data]",
          source: "HISTORICAL_DATA",
        },
      },
    ],
    [
      {
        name: "user",
        content: {
          text: "Compare Uniswap and SushiSwap performance over the last year",
        },
      },
      {
        name: "assistant",
        content: {
          text: "Here's a comparative analysis of Uniswap vs SushiSwap performance over the past year: [detailed historical comparison]",
          source: "HISTORICAL_DATA",
        },
      },
    ],
    [
      {
        name: "user",
        content: {
          text: "What are the major DeFi trends from the past 30 days?",
        },
      },
      {
        name: "assistant",
        content: {
          text: "Based on the last 30 days of data, here are the major DeFi trends: [market trend analysis]",
          source: "HISTORICAL_DATA",
        },
      },
    ],
  ],
};

// Helper functions for historical data extraction and formatting

function buildHistoricalDataLLM(
  data: any,
  params: any,
): StructuredHistoricalData {
  const result: StructuredHistoricalData = {
    timeframe: params.timeframe,
    protocolsAnalyzed:
      params.protocols.length > 0 ? params.protocols : "market overview",
    protocolData: [],
    marketData: null,
    summary: {
      totalProtocols: 0,
      dataPoints: 0,
      timeRange: params.timeframe,
    },
  };

  if (data.protocols && data.protocols.length > 0) {
    if (params.protocols.length > 0) {
      // Process specific protocol data
      result.protocolData = data.protocols.map(
        (item: HistoricalProtocolData) => {
          // Calculate current TVL from chainTvls if not directly available
          const currentTvl =
            item.protocolInfo?.tvl ||
            (item.protocolInfo?.chainTvls
              ? Object.values(
                  item.protocolInfo.chainTvls as Record<string, number>,
                ).reduce((sum: number, val: number) => sum + val, 0)
              : 0);

          return {
            name: item.protocol,
            currentTvl: currentTvl,
            category: item.protocolInfo?.category || "Unknown",
            chain: item.protocolInfo?.chains?.join(", ") || "Multi-chain",
            historicalPoints: item.historicalTVL?.length || 0,
            latestChange: calculateChangeLLM(item.historicalTVL),
          };
        },
      );
    } else {
      // Process market overview data
      result.marketData = {
        protocols: data.protocols
          .slice(0, params.count)
          .map(
            (protocol: {
              name: string;
              tvl: number;
              category: string;
              change_7d?: number;
            }) => ({
              name: protocol.name,
              tvl: protocol.tvl || 0,
              category: protocol.category || "Unknown",
              change_7d: protocol.change_7d || 0,
            }),
          ),
        chains:
          data.chains
            ?.slice(0, 5)
            .map((chain: { name: string; tvl: number }) => ({
              name: chain.name,
              tvl: chain.tvl || 0,
            })) || [],
      };
    }

    result.summary.totalProtocols = data.protocols.length;
    result.summary.dataPoints = data.protocols.reduce(
      (sum: number, item: HistoricalProtocolData) =>
        sum + (item.historicalTVL?.length || 1),
      0,
    );
  }

  // Handle chain-specific data if available
  if (data.chains && params.chains.length > 0) {
    result.summary.totalProtocols = data.chains.length;
    result.summary.dataPoints = data.chains.reduce(
      (sum: number, item: any) => sum + (item.historicalTVL?.length || 1),
      0,
    );
  }

  return result;
}

function calculateChangeLLM(
  historicalData:
    | Array<{ totalLiquidityUSD: number; date: number }>
    | undefined,
): number {
  if (!historicalData || historicalData.length < 2) return 0;

  const latest = historicalData[historicalData.length - 1];
  const previous = historicalData[0];

  if (!latest?.totalLiquidityUSD || !previous?.totalLiquidityUSD) return 0;

  return (
    ((latest.totalLiquidityUSD - previous.totalLiquidityUSD) /
      previous.totalLiquidityUSD) *
    100
  );
}

function extractTimeframeFromQueryLegacy(query: string): string {
  const lowerQuery = query.toLowerCase();

  // Map common time expressions to API periods
  const timeFramePatterns = {
    "24h": ["24h", "24 hour", "1 day", "today", "daily"],
    "7d": ["7d", "7 day", "week", "weekly", "last week"],
    "30d": ["30d", "30 day", "month", "monthly", "last month"],
    "90d": ["90d", "90 day", "3 month", "quarter", "quarterly"],
    "365d": ["365d", "year", "yearly", "annual", "last year", "12 month"],
  };

  for (const [period, patterns] of Object.entries(timeFramePatterns)) {
    if (patterns.some((pattern) => lowerQuery.includes(pattern))) {
      return period;
    }
  }

  return "30d"; // Default timeframe
}

function extractProtocolsFromQueryLegacy(query: string): string[] {
  const protocols: string[] = [];
  const lowerQuery = query.toLowerCase();

  const protocolKeywords = {
    aave: "Aave",
    uniswap: "Uniswap",
    compound: "Compound",
    sushiswap: "SushiSwap",
    curve: "Curve",
    pancakeswap: "PancakeSwap",
    balancer: "Balancer",
    maker: "MakerDAO",
    "1inch": "1inch",
    synthetix: "Synthetix",
    yearn: "Yearn Finance",
    convex: "Convex Finance",
    lido: "Lido",
    frax: "Frax",
  };

  for (const [keyword, protocol] of Object.entries(protocolKeywords)) {
    if (lowerQuery.includes(keyword)) {
      protocols.push(protocol);
    }
  }

  return protocols;
}
