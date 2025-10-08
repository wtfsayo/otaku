/**
 * Stablecoin Data Action
 *
 * Direct stablecoin data fetcher that retrieves stablecoin information
 * from DeFiLlama's API. Returns structured data for LLM processing.
 *
 * Features:
 * - Stablecoin name/symbol resolution from natural language queries using LLM
 * - Current stablecoin metrics (market cap, circulation, peg stability)
 * - Multi-stablecoin batch data retrieval
 * - Smart stablecoin validation using LLM extraction and fallback patterns
 * - Clean data structuring for LLM response generation
 *
 * Process:
 * 1. Extract stablecoins from user query using LLM
 * 2. Fetch stablecoin data from DeFiLlama
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

// Simple type for stablecoin data
interface StablecoinData {
  id: string;
  name: string;
  symbol: string;
  pegType: string;
  pegMechanism: string;
  circulating: number;
  chains: string[];
  price?: number;
  formatted: string;
}

const extractStablecoinTemplate = `# Extract stablecoin analysis parameters for stablecoin data and analysis

## Conversation Context
{{recentMessages}}

IMPORTANT: Follow DeFiLlama API specification exactly:
- /stablecoins endpoint returns data with {peggedAssets: []} structure
- Chain names in proper case: "Ethereum", "Tron", "BSC", "Polygon", "Arbitrum", "Avalanche"
- Stablecoin names/symbols as returned by API: "Tether"/"USDT", "USD Coin"/"USDC", "Dai"/"DAI", etc.
- pegMechanism values: "fiat-backed", "crypto-backed", "algorithmic"

The user might express stablecoin requests in various ways:
- "USDC market cap" → stablecoins: ["USDC"], metrics: ["circulation", "market_cap"]
- "Compare USDT vs USDC stability" → stablecoins: ["USDT", "USDC"], analysis: "comparison", metrics: ["peg_stability"]
- "Algorithmic stablecoins" → pegMechanism: "algorithmic"
- "Stablecoins on Ethereum" → chains: ["Ethereum"]
- "DAI depeg risk analysis" → stablecoins: ["DAI"], metrics: ["depeg_risk", "peg_stability"]
- "Top 5 stablecoins by market cap" → count: 5, sortBy: "circulation"
- "Fiat-backed stablecoins" → pegMechanism: "fiat-backed"

Extract and return ONLY a JSON object following DeFiLlama API format:
{
  "stablecoins": ["Stablecoin symbols if mentioned: USDT/USDC/DAI/FRAX/BUSD/TUSD"],
  "chains": ["Chain names as per /stablecoins endpoint: Ethereum/Tron/BSC/Polygon/Arbitrum"],
  "pegMechanism": ["fiat-backed/crypto-backed/algorithmic if mentioned"],
  "metrics": ["circulation/market_cap/peg_stability/depeg_risk/price if requested"],
  "analysisType": "overview/comparison/ranking/stability_analysis/risk_assessment",
  "sortBy": "circulation/price/name (how to sort results)",
  "count": number (how many results, default 10),
  "includePrices": true/false (if user wants current prices),
  "timeframe": "current/historical if mentioned"
}

Return only the JSON object, no other text.`;

export const stablecoinAction: Action = {
  name: "STABLECOIN_ANALYSIS",
  similes: [
    "STABLECOIN_DATA",
    "STABLE_ANALYSIS",
    "USDC_ANALYSIS",
    "TETHER_ANALYSIS",
    "STABLECOIN_MARKET",
    "PEG_ANALYSIS",
    "DEPEG_RISK",
    "STABLECOIN_YIELD",
    "PEG_STABILITY",
    "STABLECOIN_SAFETY",
    "STABLE_COMPARISON",
    "STABLECOIN_BACKING",
  ],
  description:
    "Use this action when you need stablecoin metrics and peg stability context.",

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
      logger.info("[STABLECOIN_ANALYSIS] Starting stablecoin data fetch");

      const defiLlamaService = runtime.getService(
        "defillama",
      ) as DefiLlamaService;
      if (!defiLlamaService) {
        throw new Error("DeFiLlama service not available");
      }

      const userQuestion = message.content.text || "";

      // Extract stablecoin criteria using LLM first, with fallback to regex
      let extractedParams: any;

      // Check if we have explicit params in options
      if (options?.stablecoinParams) {
        extractedParams = options.stablecoinParams;
      } else {
        // Use LLM to extract stablecoin criteria from recent messages context
        const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
        const prompt = composePromptFromState({ state: composedState, template: extractStablecoinTemplate });

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
              stablecoins: parsed.stablecoins || [],
              chains: parsed.chains || [],
              pegMechanism: parsed.pegMechanism || [],
              metrics: parsed.metrics || [],
              analysisType: parsed.analysisType || "overview",
              sortBy: parsed.sortBy || "circulation",
              count: parsed.count || 10,
              includePrices: parsed.includePrices || false,
              timeframe: parsed.timeframe || "current",
            };

            logger.info(
              `[STABLECOIN_ANALYSIS] LLM extracted params: ${JSON.stringify(extractedParams)}`,
            );
          } catch (parseError) {
            logger.warn(
              `Failed to parse LLM response, falling back to regex: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            );
            // Fallback to regex-based extraction
            extractedParams = {
              stablecoins: extractStablecoinsFromQueryLegacy(userQuestion),
              chains: [],
              pegMechanism: [],
              metrics: [],
              analysisType: "overview",
              sortBy: "circulation",
              count: 10,
              includePrices: false,
              timeframe: "current",
            };
          }
        } else {
          logger.warn(
            "[STABLECOIN_ANALYSIS] No LLM response received, falling back to regex",
          );
          // Fallback to regex-based extraction
          extractedParams = {
            stablecoins: extractStablecoinsFromQueryLegacy(userQuestion),
            chains: [],
            pegMechanism: [],
            metrics: [],
            analysisType: "overview",
            sortBy: "circulation",
            count: 10,
            includePrices: false,
            timeframe: "current",
          };
        }
      }

      logger.info(
        `[STABLECOIN_ANALYSIS] Fetching data for stablecoins: ${extractedParams.stablecoins.join(", ") || "all"}`,
      );

      // Fetch stablecoin data
      const [stablecoins, stablecoinChains] = await Promise.all([
        defiLlamaService.getStablecoins({
          includePrices: extractedParams.includePrices || false,
        }),
        defiLlamaService.getStablecoinChains(),
      ]);

      // Validate API responses
      const validatedStablecoins = Array.isArray(stablecoins)
        ? stablecoins
        : [];

      if (validatedStablecoins.length === 0) {
        throw new Error("No stablecoin data available from API");
      }

      // Filter and structure stablecoin data
      const stablecoinData = buildStablecoinDataLLM(
        extractedParams,
        validatedStablecoins,
        stablecoinChains,
      );

      // Generate response using LLM
      const response = await runtime.useModel(ModelType.LARGE, {
        prompt: `Respond concisely with stablecoin analysis based on data: ${JSON.stringify(stablecoinData)}
        and user query: ${JSON.stringify(message.content)}`,
      });

      if (callback) {
        await callback({
          text: response || "Unable to analyze stablecoin data at this time.",
          actions: ['STABLECOIN_ANALYSIS'],
          source: message.content.source,
        });
      }

      return {
        text: response,
        success: true,
        data: {
          actionName: "STABLECOIN_ANALYSIS",
          extractedParams,
          stablecoinData,
          stablecoinDataFetched: true,
          stablecoinsFound: stablecoinData.stablecoins.length,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      logger.error(
        `[STABLECOIN_ANALYSIS] Error: ${error instanceof Error ? error.message : String(error)}`,
      );

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      if (callback) {
        await callback({
          text: `❌ Failed to fetch stablecoin data: ${errorMessage}`,
          actions: ["STABLECOIN_ANALYSIS"],
          source: message.content.source,
        });
      }

      return {
        text: `Error fetching stablecoin data: ${errorMessage}`,
        success: false,
        error: error instanceof Error ? error : new Error(errorMessage),
        data: {
          actionName: "STABLECOIN_ANALYSIS",
          error: errorMessage,
          stablecoinDataFetched: false,
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
          text: "What's USDC's current market cap and circulation?",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "USDC currently has $28.1B in circulation across 15 chains, maintaining its $1.00 peg with 99.8% stability. It's the 2nd largest stablecoin by market cap.",
          actions: ["STABLECOIN_ANALYSIS"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Compare USDT vs USDC vs DAI stability",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "USDT: $118B circulation, fiat-backed, 99.9% peg stability. USDC: $28B circulation, fiat-backed, 99.8% stability. DAI: $4.8B circulation, crypto-backed, 99.7% stability. All maintain strong pegs.",
          actions: ["STABLECOIN_ANALYSIS"],
        },
      },
    ],
  ],
};

// Helper functions for stablecoin data extraction and formatting

function buildStablecoinDataLLM(
  params: any,
  allStablecoins: any[],
  chainData: any,
): any {
  const data: any = {
    stablecoins: [],
    totalCirculation: 0,
    chainBreakdown: {},
    timestamp: Date.now(),
  };

  let relevantStablecoins = allStablecoins;

  // Filter by specific stablecoins if mentioned
  if (params.stablecoins && params.stablecoins.length > 0) {
    relevantStablecoins = allStablecoins.filter((s) =>
      params.stablecoins.some((target: string) => {
        const targetLower = target.toLowerCase();
        const nameLower = s.name?.toLowerCase() || "";
        const symbolLower = s.symbol?.toLowerCase() || "";
        return (
          nameLower.includes(targetLower) ||
          symbolLower.includes(targetLower) ||
          targetLower.includes(nameLower) ||
          targetLower.includes(symbolLower)
        );
      }),
    );
  }

  // Filter by chains if specified (case-insensitive)
  if (params.chains && params.chains.length > 0) {
    relevantStablecoins = relevantStablecoins.filter(
      (s) =>
        s.chains &&
        params.chains.some((chain: string) =>
          s.chains.some((sChain: string) =>
            sChain.toLowerCase().includes(chain.toLowerCase()),
          ),
        ),
    );
  }

  // Filter by peg mechanism if specified
  if (params.pegMechanism && params.pegMechanism.length > 0) {
    relevantStablecoins = relevantStablecoins.filter((s) =>
      params.pegMechanism.some((mechanism: string) =>
        s.pegMechanism?.toLowerCase().includes(mechanism.toLowerCase()),
      ),
    );
  }

  // Sort based on criteria
  const sortBy = params.sortBy || "circulation";
  if (sortBy === "circulation") {
    relevantStablecoins = relevantStablecoins.sort((a, b) => {
      const aCirc = a.circulating?.peggedUSD || 0;
      const bCirc = b.circulating?.peggedUSD || 0;
      return bCirc - aCirc;
    });
  } else if (sortBy === "price") {
    relevantStablecoins = relevantStablecoins.sort((a, b) => {
      const aPrice = Math.abs((a.price || 1) - 1);
      const bPrice = Math.abs((b.price || 1) - 1);
      return aPrice - bPrice; // Sort by closest to $1
    });
  } else if (sortBy === "name") {
    relevantStablecoins = relevantStablecoins.sort((a, b) =>
      (a.name || "").localeCompare(b.name || ""),
    );
  }

  // Take top results based on count
  relevantStablecoins = relevantStablecoins.slice(0, params.count || 10);

  // Build stablecoin data
  relevantStablecoins.forEach((stablecoin) => {
    const circulation = stablecoin.circulating?.peggedUSD || 0;

    data.stablecoins.push({
      id: stablecoin.id,
      name: stablecoin.name || "Unknown",
      symbol: stablecoin.symbol || "Unknown",
      pegType: stablecoin.pegType || "Unknown",
      pegMechanism: stablecoin.pegMechanism || "Unknown",
      circulating: circulation,
      chains: stablecoin.chains || [],
      price: stablecoin.price || 1.0,
      formatted: formatStablecoinData(stablecoin),
    });

    data.totalCirculation += circulation;
  });

  // Build chain breakdown from chain data if available
  if (chainData && Array.isArray(chainData)) {
    data.chainBreakdown = chainData.reduce((acc: any, chain: any) => {
      if (chain.name && chain.totalCirculating?.peggedUSD) {
        acc[chain.name] = chain.totalCirculating.peggedUSD;
      }
      return acc;
    }, {});
  }

  return data;
}

function extractStablecoinsFromQueryLegacy(query: string): string[] {
  const stablecoinKeywords = {
    usdt: "tether",
    tether: "tether",
    usdc: "usd-coin",
    "usd coin": "usd-coin",
    dai: "dai",
    frax: "frax",
    busd: "binance-usd",
    "binance usd": "binance-usd",
    tusd: "trueusd",
    "true usd": "trueusd",
    usdp: "paxos-standard",
    "pax dollar": "paxos-standard",
    gusd: "gemini-dollar",
    "gemini dollar": "gemini-dollar",
    usdd: "usdd",
    lusd: "liquity-usd",
    "liquity usd": "liquity-usd",
    ustc: "terrausd",
    "terra usd": "terrausd",
    mimatic: "mimatic",
    "mai finance": "mimatic",
    fei: "fei-usd",
    "fei usd": "fei-usd",
    ust: "terrausd-wormhole",
  };

  const found: string[] = [];
  const searchText = query.toLowerCase();

  for (const [keyword, stablecoinId] of Object.entries(stablecoinKeywords)) {
    if (searchText.includes(keyword)) {
      found.push(stablecoinId);
    }
  }

  return [...new Set(found)]; // Remove duplicates
}

function formatStablecoinData(stablecoin: any): string {
  const circulation = formatLargeNumber(stablecoin.circulating?.peggedUSD || 0);
  const price = stablecoin.price?.toFixed(4) || "1.0000";
  return `${stablecoin.name}: $${circulation} circulation, $${price} price`;
}

function formatLargeNumber(num: number): string {
  if (num >= 1e12) return (num / 1e12).toFixed(1) + "T";
  if (num >= 1e9) return (num / 1e9).toFixed(1) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(1) + "M";
  if (num >= 1e3) return (num / 1e3).toFixed(1) + "K";
  return num.toFixed(0);
}
