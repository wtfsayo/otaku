/**
 * Yield Search Action
 *
 * Direct yield opportunity fetcher that retrieves yield farming data
 * from DeFiLlama's API. Returns structured data for LLM processing.
 *
 * Features:
 * - Asset/protocol/chain filtering from natural language queries using LLM
 * - Current yield pool data (APY, TVL, chains, protocols)
 * - Multi-filter yield pool retrieval
 * - Smart yield filtering using LLM extraction and fallback patterns
 * - Clean data structuring for LLM response generation
 *
 * Process:
 * 1. Extract yield criteria from user query using LLM
 * 2. Fetch yield data from DeFiLlama
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

// Simple type for yield data
interface YieldData {
  pool: string;
  project: string;
  symbol: string;
  chain: string;
  tvlUsd: number;
  apy: number;
  apyBase: number;
  apyReward: number;
  rewardTokens: string[];
  underlyingTokens: string[];
  poolMeta: string;
  formatted: string;
}

const extractYieldTemplate = `# Extract yield search criteria for DeFi yield farming opportunities

## Conversation Context
{{recentMessages}}

IMPORTANT: Follow DeFiLlama API specification exactly:
- /pools endpoint returns data with chain names in proper case: "Ethereum", "Polygon", "Arbitrum", "Optimism", "BSC", "Avalanche"
- Protocol names as returned by API: "Aave", "Compound", "Uniswap", "Curve", etc.
- Asset symbols as in underlyingTokens/symbol fields: "USDC", "ETH", "WBTC", etc.

The user might express yield requests in various ways:
- "Best USDC yields" → asset: "USDC", sortBy: "apy"
- "Aave staking opportunities" → protocol: "Aave"
- "High APY farming above 15%" → minApy: 15, riskTolerance: "high"
- "Safe stablecoin yields on Polygon" → chains: ["Polygon"], assets: ["stablecoins"], riskTolerance: "low"
- "Ethereum lending yields under 10%" → chains: ["Ethereum"], maxApy: 10, categories: ["lending"]
- "Auto-compounding WETH farms" → assets: ["WETH"], features: ["auto-compound"]

Extract and return ONLY a JSON object following DeFiLlama API format:
{
  "assets": ["Asset symbols if mentioned: USDC/ETH/WBTC/DAI/stablecoins"],
  "protocols": ["Protocol names if mentioned: Aave/Compound/Uniswap/Curve"],
  "chains": ["Chain names as per /pools endpoint: Ethereum/Polygon/Arbitrum/Optimism/BSC/Avalanche"],
  "minApy": number (minimum APY if specified),
  "maxApy": number (maximum APY if specified),
  "minTvl": number (minimum TVL in USD if specified),
  "riskTolerance": "low/medium/high/any (based on user preference)",
  "categories": ["lending/dex/staking/farming if mentioned"],
  "features": ["auto-compound/rewards/stable if mentioned"],
  "sortBy": "apy/tvl/project (how to sort results)",
  "limit": number (how many results, default 15)
}

Return only the JSON object, no other text.`;

export const yieldSearchAction: Action = {
  name: "YIELD_SEARCH",
  similes: [
    "FIND_YIELDS",
    "YIELD_FARMING",
    "BEST_APY",
    "STAKING_YIELDS",
    "FARM_SEARCH",
    "APY_SEARCH",
    "YIELD_OPPORTUNITIES",
    "FARMING_OPTIONS",
    "STAKE_REWARDS",
    "LIQUIDITY_MINING",
  ],
  description:
    "Use this action when you need to find current DeFi yield opportunities.",

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
      logger.info("[YIELD_SEARCH] Starting yield data fetch");

      const defiLlamaService = runtime.getService(
        "defillama",
      ) as DefiLlamaService;
      if (!defiLlamaService) {
        throw new Error("DeFiLlama service not available");
      }

      const userQuestion = message.content.text || "";

      // Extract yield criteria using LLM first, with fallback to regex
      let yieldCriteria: any;

      // Check if we have explicit criteria in options
      if (options?.yieldParams) {
        yieldCriteria = options.yieldParams;
      } else {
        // Use LLM to extract yield criteria using recent messages context
        const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
        const prompt = composePromptFromState({ state: composedState, template: extractYieldTemplate });

        const response = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });

        if (response) {
          try {
            // Strip markdown code blocks if present
            const cleanedResponse = response
              .replace(/^```(?:json)?\n?/, "")
              .replace(/\n?```$/, "")
              .trim();
            const parsed = JSON.parse(cleanedResponse);

            yieldCriteria = {
              assets: parsed.assets || [],
              protocols: parsed.protocols || [],
              chains: parsed.chains || [],
              minApy: parsed.minApy || 0,
              maxApy: parsed.maxApy || 1000,
              minTvl: parsed.minTvl || 0,
              riskTolerance: parsed.riskTolerance || "any",
              categories: parsed.categories || [],
              features: parsed.features || [],
              sortBy: parsed.sortBy || "apy",
              limit: parsed.limit || 15,
            };

            logger.info(
              `[YIELD_SEARCH] LLM extracted criteria: ${JSON.stringify(yieldCriteria)}`,
            );
          } catch (parseError) {
            logger.warn(
              `Failed to parse LLM response, falling back to regex: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            );
            // Fallback to regex-based extraction
            yieldCriteria = extractYieldCriteriaLegacy(userQuestion);
          }
        } else {
          logger.warn(
            "[YIELD_SEARCH] No LLM response received, falling back to regex",
          );
          // Fallback to regex-based extraction
          yieldCriteria = extractYieldCriteriaLegacy(userQuestion);
        }
      }

      logger.info(
        `[YIELD_SEARCH] Fetching yields with criteria: ${JSON.stringify(yieldCriteria)}`,
      );

      // Fetch yield data
      const yields = await defiLlamaService.getYields();

      // Validate API response
      const validatedYields = Array.isArray(yields) ? yields : [];

      if (validatedYields.length === 0) {
        throw new Error("No yield data available from API");
      }

      // Filter and structure yield data
      const yieldData = buildYieldData(yieldCriteria, validatedYields);

      // Generate response using LLM
      const response = await runtime.useModel(ModelType.LARGE, {
        prompt: `Respond concisely with yield analysis based on data: ${JSON.stringify(yieldData)}
        and user query: ${JSON.stringify(message.content)}`,
      });

      if (callback) {
        await callback({
          text: response || "Unable to fetch yield data at this time.",
          actions: ['YIELD_SEARCH'],
          source: message.content.source,
        });
      }

      return {
        text: response,
        success: true,
        data: {
          actionName: "YIELD_SEARCH",
          extractedCriteria: yieldCriteria,
          yieldData,
          yieldDataFetched: true,
          yieldsFound: yieldData.yields.length,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      logger.error(
        `[YIELD_SEARCH] Error: ${error instanceof Error ? error.message : String(error)}`,
      );

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      if (callback) {
        await callback({
          text: `❌ Failed to fetch yield data: ${errorMessage}`,
          actions: ["YIELD_SEARCH"],
          source: message.content.source,
        });
      }

      return {
        text: `Error fetching yield data: ${errorMessage}`,
        success: false,
        error: error instanceof Error ? error : new Error(errorMessage),
        data: {
          actionName: "YIELD_SEARCH",
          error: errorMessage,
          yieldDataFetched: false,
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
          text: "What are the best USDC yields right now?",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Best USDC yields: Aave V3 Polygon 4.2% APY ($45M TVL), Compound V3 3.8% APY ($120M TVL), Venus BSC 5.1% APY ($12M TVL). All are stable lending yields with low risk.",
          actions: ["YIELD_SEARCH"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Find me high APY farming opportunities above 15%",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "High APY opportunities: PancakeSwap CAKE-BNB 18.5% APY, TraderJoe AVAX-USDC 22.1% APY, SpookySwap BOO-FTM 28.3% APY. Note: Higher APY carries increased impermanent loss and smart contract risks.",
          actions: ["YIELD_SEARCH"],
        },
      },
    ],
  ],
};

// Helper functions for yield data extraction and formatting

function extractYieldCriteriaLegacy(query: string): any {
  const searchText = query.toLowerCase();

  const criteria: any = {
    assets: [],
    protocols: [],
    chains: [],
    minApy: 0,
    maxApy: 1000,
    riskLevel: "any",
  };

  // Extract asset preferences
  const assetKeywords = {
    usdc: "usdc",
    usdt: "usdt",
    dai: "dai",
    eth: "eth",
    weth: "weth",
    btc: "btc",
    wbtc: "wbtc",
    matic: "matic",
    avax: "avax",
    bnb: "bnb",
    stablecoin: ["usdc", "usdt", "dai", "frax", "busd"],
  };

  for (const [keyword, assets] of Object.entries(assetKeywords)) {
    if (searchText.includes(keyword)) {
      criteria.assets.push(...(Array.isArray(assets) ? assets : [assets]));
    }
  }

  // Extract protocol preferences
  const protocolKeywords = {
    aave: "aave",
    compound: "compound",
    uniswap: "uniswap",
    sushiswap: "sushiswap",
    pancakeswap: "pancakeswap",
    curve: "curve",
    yearn: "yearn",
    convex: "convex",
    lido: "lido",
    maker: "maker",
  };

  for (const [keyword, protocol] of Object.entries(protocolKeywords)) {
    if (searchText.includes(keyword)) {
      criteria.protocols.push(protocol);
    }
  }

  // Extract chain preferences
  const chainKeywords = {
    ethereum: "Ethereum",
    polygon: "Polygon",
    arbitrum: "Arbitrum",
    optimism: "Optimism",
    avalanche: "Avalanche",
    bsc: "BSC",
    fantom: "Fantom",
    solana: "Solana",
  };

  for (const [keyword, chain] of Object.entries(chainKeywords)) {
    if (searchText.includes(keyword)) {
      criteria.chains.push(chain);
    }
  }

  // Extract APY requirements
  const apyMatch = searchText.match(/(\d+)%?\s*(apy|apr|yield)/i);
  if (apyMatch) {
    const apy = parseInt(apyMatch[1]);
    if (
      searchText.includes("above") ||
      searchText.includes("over") ||
      searchText.includes("high")
    ) {
      criteria.minApy = apy;
    } else if (searchText.includes("under") || searchText.includes("below")) {
      criteria.maxApy = apy;
    }
  }

  // Extract risk preferences
  if (
    searchText.includes("safe") ||
    searchText.includes("stable") ||
    searchText.includes("low risk")
  ) {
    criteria.riskLevel = "low";
  } else if (
    searchText.includes("high risk") ||
    searchText.includes("aggressive")
  ) {
    criteria.riskLevel = "high";
  }

  return criteria;
}

function buildYieldData(criteria: any, allYields: any[]): any {
  const data: any = {
    yields: [],
    totalTvl: 0,
    averageApy: 0,
    timestamp: Date.now(),
  };

  let filteredYields = allYields;

  // Filter by assets (case-insensitive for robustness)
  if (criteria.assets && criteria.assets.length > 0) {
    filteredYields = filteredYields.filter((y) => {
      const symbol = y.symbol?.toLowerCase() || "";
      const underlying =
        y.underlyingTokens?.map((t: string) => t.toLowerCase()) || [];
      return criteria.assets.some((asset: string) => {
        const searchAsset = asset.toLowerCase();
        if (searchAsset === "stablecoins") {
          return ["usdc", "usdt", "dai", "frax", "busd"].some(
            (stable) =>
              symbol.includes(stable) ||
              underlying.some((u: string) => u.includes(stable)),
          );
        }
        return (
          symbol.includes(searchAsset) ||
          underlying.some((u: string) => u.includes(searchAsset))
        );
      });
    });
  }

  // Filter by protocols (case-insensitive)
  if (criteria.protocols && criteria.protocols.length > 0) {
    filteredYields = filteredYields.filter((y) =>
      criteria.protocols.some((protocol: string) =>
        y.project?.toLowerCase().includes(protocol.toLowerCase()),
      ),
    );
  }

  // Filter by chains (case-insensitive)
  if (criteria.chains && criteria.chains.length > 0) {
    filteredYields = filteredYields.filter((y) =>
      criteria.chains.some((chain: string) =>
        y.chain?.toLowerCase().includes(chain.toLowerCase()),
      ),
    );
  }

  // Filter by APY range
  filteredYields = filteredYields.filter((y) => {
    const apy = y.apy || 0;
    return apy >= (criteria.minApy || 0) && apy <= (criteria.maxApy || 1000);
  });

  // Filter by TVL if specified
  if (criteria.minTvl && criteria.minTvl > 0) {
    filteredYields = filteredYields.filter(
      (y) => (y.tvlUsd || 0) >= criteria.minTvl,
    );
  }

  // Filter by risk level
  if (criteria.riskTolerance === "low") {
    filteredYields = filteredYields.filter((y) => {
      const apy = y.apy || 0;
      const tvl = y.tvlUsd || 0;
      // Conservative: lower APY, higher TVL
      return apy < 15 && tvl > 1000000; // < 15% APY, > $1M TVL
    });
  } else if (criteria.riskTolerance === "high") {
    filteredYields = filteredYields.filter((y) => {
      const apy = y.apy || 0;
      // Aggressive: higher APY
      return apy > 20; // > 20% APY
    });
  }

  // Sort based on criteria
  const sortBy = criteria.sortBy || "apy";
  if (sortBy === "apy") {
    filteredYields = filteredYields.sort((a, b) => (b.apy || 0) - (a.apy || 0));
  } else if (sortBy === "tvl") {
    filteredYields = filteredYields.sort(
      (a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0),
    );
  } else if (sortBy === "project") {
    filteredYields = filteredYields.sort((a, b) =>
      (a.project || "").localeCompare(b.project || ""),
    );
  }

  // Take top results based on limit
  filteredYields = filteredYields.slice(0, criteria.limit || 15);

  // Build yield data
  filteredYields.forEach((yieldPool) => {
    data.yields.push({
      pool: yieldPool.pool,
      project: yieldPool.project || "Unknown",
      symbol: yieldPool.symbol || "Unknown",
      chain: yieldPool.chain || "Unknown",
      tvlUsd: yieldPool.tvlUsd || 0,
      apy: yieldPool.apy || 0,
      apyBase: yieldPool.apyBase || 0,
      apyReward: yieldPool.apyReward || 0,
      rewardTokens: yieldPool.rewardTokens || [],
      underlyingTokens: yieldPool.underlyingTokens || [],
      poolMeta: yieldPool.poolMeta || "",
      formatted: formatYieldData(yieldPool),
    });

    data.totalTvl += yieldPool.tvlUsd || 0;
  });

  // Calculate average APY
  if (data.yields.length > 0) {
    data.averageApy =
      data.yields.reduce((sum: number, y: any) => sum + y.apy, 0) /
      data.yields.length;
  }

  return data;
}

// Utility functions

function formatYieldData(yieldPool: any): string {
  const apy = (yieldPool.apy || 0).toFixed(1);
  const tvl = formatLargeNumber(yieldPool.tvlUsd || 0);
  return `${yieldPool.project} ${yieldPool.symbol}: ${apy}% APY, $${tvl} TVL`;
}

function formatLargeNumber(num: number): string {
  if (num >= 1e9) return (num / 1e9).toFixed(1) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(1) + "M";
  if (num >= 1e3) return (num / 1e3).toFixed(1) + "K";
  return num.toFixed(0);
}
