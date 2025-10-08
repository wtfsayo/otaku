/**
 * Fees Volume Action
 *
 * Direct fees and volume data fetcher that retrieves protocol economics
 * from DeFiLlama's API. Returns structured data for LLM processing.
 *
 * Features:
 * - Protocol/chain filtering from natural language queries using LLM
 * - Current fees and volume metrics (revenue, daily fees, trading volume)
 * - Multi-protocol batch data retrieval
 * - Smart filtering using LLM extraction and fallback patterns
 * - Clean data structuring for LLM response generation
 *
 * Process:
 * 1. Extract protocols/chains from user query using LLM
 * 2. Fetch fees and volume data from DeFiLlama
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
import type { ProtocolFees, DexVolume } from "../types";

interface FeesVolumeCriteria {
  targetProtocols: string[];
  chainFilter: string | null;
  analysisType: "fees" | "volume" | "both";
}

interface StructuredFeesVolumeData {
  criteria: FeesVolumeCriteria;
  protocolFees: ProtocolFees[];
  dexVolumes: DexVolume[];
  summary: {
    totalDailyFees: number;
    totalDailyVolume: number;
    protocolCount: number;
    avgFeeEfficiency: number;
  };
}

const extractFeesVolumeTemplate = `# Extract fees and volume analysis parameters for protocol economics data

## Conversation Context
{{recentMessages}}

IMPORTANT: Follow DeFiLlama API specification exactly:
- /overview/fees endpoint returns {protocols: []} with protocol names, total24h, revenue24h, change_1d, chains
- /overview/dexs endpoint returns {protocols: []} with protocol names, total24h, total7d, change_1d, change_7d, chains
- Chain names in proper case: "Ethereum", "Polygon", "Arbitrum", "Optimism", "BSC", "Avalanche"
- Protocol names as returned by API: "Uniswap", "Aave", "Compound", "Curve", etc.

The user might express fees/volume requests in various ways:
- "Uniswap fees analysis" → protocols: ["Uniswap"], analysisType: "fees"
- "DEX trading volumes" → analysisType: "volume", category: "dex"
- "Ethereum protocol fees vs volume" → chains: ["Ethereum"], analysisType: "both"
- "Compare Aave and Compound revenue" → protocols: ["Aave", "Compound"], analysisType: "fees"
- "Top 5 protocols by volume" → count: 5, sortBy: "volume", analysisType: "volume"
- "Protocol economics on Polygon" → chains: ["Polygon"], analysisType: "both"
- "Daily fees for lending protocols" → category: "lending", analysisType: "fees"

Extract and return ONLY a JSON object following DeFiLlama API format:
{
  "protocols": ["Protocol names if mentioned: Uniswap/Aave/Compound/Curve"],
  "chains": ["Chain names as per API: Ethereum/Polygon/Arbitrum/Optimism/BSC/Avalanche"],
  "analysisType": "fees/volume/both (what user wants to analyze)",
  "category": ["dex/lending/derivatives if mentioned"],
  "timeframe": "24h/7d/30d (time period if specified)",
  "metrics": ["revenue/volume/fees/efficiency if specifically requested"],
  "sortBy": "fees/volume/name/change (how to sort results)",
  "count": number (how many results, default 10),
  "includeBreakdown": true/false (if user wants detailed breakdown),
  "compareMode": true/false (if user wants comparison analysis)
}

Return only the JSON object, no other text.`;

export const feesVolumeAction: Action = {
  name: "FEE_VOLUME_DATA",
  similes: [
    "protocol fees",
    "trading volume",
    "revenue analysis",
    "dex volume",
    "protocol economics",
    "fee comparison",
    "volume trends",
    "protocol profitability",
    "trading activity",
    "fee structure",
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
    "Use this action when you need protocol fees/revenue or DEX trading volume data.",
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: any,
    options: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("[FEES_VOLUME] Starting fees and volume data action");

    try {
      const userQuestion = message.content.text || "";

      // Extract fees/volume criteria using LLM first, with fallback to regex
      let extractedParams: any;

      // Check if we have explicit params in options
      if (options?.feesVolumeParams) {
        extractedParams = options.feesVolumeParams;
      } else {
        // Use LLM to extract criteria from recent messages context
        const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
        const prompt = composePromptFromState({ state: composedState, template: extractFeesVolumeTemplate });

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
              analysisType: parsed.analysisType || "both",
              category: parsed.category || [],
              timeframe: parsed.timeframe || "24h",
              metrics: parsed.metrics || [],
              sortBy: parsed.sortBy || "volume",
              count: parsed.count || 10,
              includeBreakdown: parsed.includeBreakdown || false,
              compareMode: parsed.compareMode || false,
            };

            logger.info(
              `[FEES_VOLUME] LLM extracted params: ${JSON.stringify(extractedParams)}`,
            );
          } catch (parseError) {
            logger.warn(
              "Failed to parse LLM response, falling back to regex:",
              parseError instanceof Error ? parseError.message : String(parseError),
            );
            // Fallback to regex-based extraction
            const chainFilter = extractChainFromQueryLegacy(userQuestion);
            const targetProtocols =
              extractProtocolsFromQueryLegacy(userQuestion);
            extractedParams = {
              protocols: targetProtocols,
              chains: chainFilter ? [chainFilter] : [],
              analysisType: "both",
              category: [],
              timeframe: "24h",
              metrics: [],
              sortBy: "volume",
              count: 10,
              includeBreakdown: false,
              compareMode: false,
            };
          }
        } else {
          logger.warn(
            "[FEES_VOLUME] No LLM response received, falling back to regex",
          );
          // Fallback to regex-based extraction
          const chainFilter = extractChainFromQueryLegacy(userQuestion);
          const targetProtocols = extractProtocolsFromQueryLegacy(userQuestion);
          extractedParams = {
            protocols: targetProtocols,
            chains: chainFilter ? [chainFilter] : [],
            analysisType: "both",
            category: [],
            timeframe: "24h",
            metrics: [],
            sortBy: "volume",
            count: 10,
            includeBreakdown: false,
            compareMode: false,
          };
        }
      }

      // Extract chain filter from params (use first chain if multiple)
      const chainFilter =
        extractedParams.chains && extractedParams.chains.length > 0
          ? extractedParams.chains[0]
          : null;

      logger.info(
        `[FEES_VOLUME] Fetching data for chain: ${chainFilter || "all"}, analysis: ${extractedParams.analysisType}`,
      );

      // Fetch fees and volume data
      const defiLlamaService = runtime.getService<DefiLlamaService>(
        DefiLlamaService.serviceType,
      );

      if (!defiLlamaService) {
        throw new Error("DeFiLlama service not available");
      }

      const [feesData, volumeData] = await Promise.all([
        chainFilter
          ? defiLlamaService.getProtocolFeesByChain(chainFilter, {
              excludeTotalDataChart: true,
              excludeTotalDataChartBreakdown: true,
              dataType: "dailyFees",
            })
          : defiLlamaService.getProtocolFees({
              excludeTotalDataChart: true,
              excludeTotalDataChartBreakdown: true,
              dataType: "dailyFees",
            }),
        chainFilter
          ? defiLlamaService.getDexVolumesByChain(chainFilter, {
              excludeTotalDataChart: true,
              excludeTotalDataChartBreakdown: true,
            })
          : defiLlamaService.getDexVolumes({
              excludeTotalDataChart: true,
              excludeTotalDataChartBreakdown: true,
            }),
      ]);

      // Filter data based on LLM extracted parameters
      const filteredData = filterFeesVolumeDataLLM(
        feesData,
        volumeData,
        extractedParams,
      );

      // Structure data for LLM response
      const structuredData = buildFeesVolumeDataLLM(
        filteredData,
        extractedParams,
      );

      logger.info("[FEES_VOLUME] Data fetched and structured successfully");

      // Generate response using LLM
      const response = await runtime.useModel(ModelType.LARGE, {
        prompt: `Respond concisely with fees and volume analysis based on data: ${JSON.stringify(structuredData)}

Question: ${userQuestion}

Provide insights on:
- Protocol revenue trends and sustainability
- Trading volume patterns and market share
- Fee efficiency and competitive positioning
- Chain-specific performance if relevant

Keep response focused, data-driven, and under 150 words.`,
        temperature: 0.7,
        stop: ["<END>"],
      });

      if (callback) {
        await callback({
          text:
            response || "Unable to analyze fees and volume data at this time.",
          actions: ['FEE_VOLUME_DATA'],
          source: message.content.source,
        });
      }

      return {
        text: response || "Analysis completed",
        success: true,
        data: {
          actionName: "FEES_VOLUME_DATA",
          extractedParams,
          structuredData,
          feesVolumeDataFetched: true,
          protocolsAnalyzed: extractedParams.protocols.length || "all",
          chainFilterUsed: chainFilter || "all",
          timestamp: Date.now(),
        },
      } as ActionResult;
    } catch (error) {
      const errorMessage = `Failed to fetch fees and volume data: ${error}`;
      logger.error(`[FEES_VOLUME] ${errorMessage}`);

      if (callback) {
        await callback({
          text: "I encountered an error while fetching fees and volume data. Please try again.",
          source: "FEE_VOLUME_DATA",
        });
      }

      return {
        text: "Error fetching fees and volume data. Please try again.",
        success: false,
        data: {
          actionName: "FEES_VOLUME_DATA",
          error: errorMessage,
          feesVolumeDataFetched: false,
          timestamp: Date.now(),
        },
      } as ActionResult;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: { text: "Show me the fee revenue for Uniswap and Aave" },
      },
      {
        name: "assistant",
        content: {
          text: "Here's the current fee revenue analysis for Uniswap and Aave: [analysis based on latest DeFiLlama data]",
          source: "FEE_VOLUME_DATA",
        },
      },
    ],
    [
      {
        name: "user",
        content: {
          text: "Which protocols generate the most trading volume on Ethereum?",
        },
      },
      {
        name: "assistant",
        content: {
          text: "Based on the latest data, here are the top volume-generating protocols on Ethereum: [detailed breakdown]",
          source: "FEE_VOLUME_DATA",
        },
      },
    ],
    [
      {
        name: "user",
        content: {
          text: "Compare DEX trading volumes across different chains",
        },
      },
      {
        name: "assistant",
        content: {
          text: "Here's a comparison of DEX trading volumes across major chains: [cross-chain analysis]",
          source: "FEE_VOLUME_DATA",
        },
      },
    ],
  ],
};

// Helper functions for fees/volume data extraction and formatting

function filterFeesVolumeDataLLM(
  feesData: ProtocolFees[],
  volumeData: DexVolume[],
  params: any,
): any {
  let filteredFees = feesData;
  let filteredVolume = volumeData;

  // Filter by specific protocols if mentioned (case-insensitive)
  if (params.protocols && params.protocols.length > 0) {
    if (Array.isArray(feesData)) {
      filteredFees = feesData.filter((item: ProtocolFees) =>
        params.protocols.some((protocol: string) =>
          item.name?.toLowerCase().includes(protocol.toLowerCase()),
        ),
      );
    }

    if (Array.isArray(volumeData)) {
      filteredVolume = volumeData.filter((item: DexVolume) =>
        params.protocols.some((protocol: string) =>
          item.name?.toLowerCase().includes(protocol.toLowerCase()),
        ),
      );
    }
  }

  // Filter by category if specified
  if (params.category && params.category.length > 0) {
    if (Array.isArray(feesData)) {
      filteredFees = feesData.filter((item: ProtocolFees) =>
        params.category.some((cat: string) =>
          item.category?.toLowerCase().includes(cat.toLowerCase()),
        ),
      );
    }
    // Note: Volume data doesn't typically have category field in DeFiLlama API
  }

  return {
    fees: filteredFees,
    volume: filteredVolume,
  };
}

function buildFeesVolumeDataLLM(
  data: any,
  params: any,
): StructuredFeesVolumeData {
  const result: StructuredFeesVolumeData = {
    criteria: {
      targetProtocols: params.protocols || [],
      chainFilter:
        params.chains && params.chains.length > 0 ? params.chains[0] : null,
      analysisType: params.analysisType || "both",
    },
    protocolFees: [],
    dexVolumes: [],
    summary: {
      totalDailyFees: 0,
      totalDailyVolume: 0,
      protocolCount: 0,
      avgFeeEfficiency: 0,
    },
  };

  // Process fees data
  if (Array.isArray(data.fees)) {
    let feesArray = data.fees;

    // Sort by fees if specified
    if (params.sortBy === "fees") {
      feesArray = feesArray.sort(
        (a: ProtocolFees, b: ProtocolFees) =>
          (b.total24h || 0) - (a.total24h || 0),
      );
    }

    result.protocolFees = feesArray
      .slice(0, params.count || 10)
      .map((protocol: ProtocolFees) => ({
        name: protocol.name || "Unknown",
        total24h: protocol.total24h || 0,
        revenue24h: protocol.revenue24h || 0,
        change_1d: protocol.change_1d || 0,
        category: protocol.category || "Unknown",
      }));

    result.summary.protocolCount = data.fees.length;
    result.summary.totalDailyFees = data.fees.reduce(
      (sum: number, p: ProtocolFees) => sum + (p.total24h || 0),
      0,
    );
  }

  // Process volume data
  if (Array.isArray(data.volume)) {
    let volumeArray = data.volume;

    // Sort by volume if specified
    if (params.sortBy === "volume") {
      volumeArray = volumeArray.sort(
        (a: DexVolume, b: DexVolume) => (b.total24h || 0) - (a.total24h || 0),
      );
    }

    result.dexVolumes = volumeArray
      .slice(0, params.count || 10)
      .map((dex: DexVolume) => ({
        name: dex.name || "Unknown",
        total24h: dex.total24h || 0,
        total7d: dex.total7d || 0,
        change_1d: dex.change_1d || 0,
        change_7d: dex.change_7d || 0,
      }));

    result.summary.totalDailyVolume = data.volume.reduce(
      (sum: number, d: DexVolume) => sum + (d.total24h || 0),
      0,
    );
  }

  return result;
}

function extractChainFromQueryLegacy(query: string): string | null {
  const chainKeywords = {
    ethereum: "Ethereum",
    polygon: "Polygon",
    bsc: "BSC",
    "binance smart chain": "BSC",
    arbitrum: "Arbitrum",
    optimism: "Optimism",
    avalanche: "Avalanche",
    solana: "Solana",
    fantom: "Fantom",
  };

  const lowerQuery = query.toLowerCase();
  for (const [keyword, chain] of Object.entries(chainKeywords)) {
    if (lowerQuery.includes(keyword)) {
      return chain;
    }
  }
  return null;
}

function extractProtocolsFromQueryLegacy(query: string): string[] {
  const protocols: string[] = [];
  const lowerQuery = query.toLowerCase();

  const protocolKeywords = {
    uniswap: "Uniswap",
    aave: "Aave",
    compound: "Compound",
    sushiswap: "SushiSwap",
    curve: "Curve",
    pancakeswap: "PancakeSwap",
    balancer: "Balancer",
    "1inch": "1inch",
    "0x": "0x",
    dydx: "dYdX",
    gmx: "GMX",
    synthetix: "Synthetix",
  };

  for (const [keyword, protocol] of Object.entries(protocolKeywords)) {
    if (lowerQuery.includes(keyword)) {
      protocols.push(protocol);
    }
  }

  return protocols;
}
