/**
 * Cross Chain Action
 *
 * Direct cross-chain analysis tool that compares DeFi opportunities across chains
 * from DeFiLlama's API. Returns structured data for LLM processing.
 *
 * Features:
 * - Multi-chain comparison from natural language queries using LLM
 * - Cross-chain yield opportunities and protocol analysis
 * - Bridge data and cross-chain strategy suggestions
 * - Smart chain filtering using LLM extraction and fallback patterns
 * - Clean data structuring for LLM response generation
 *
 * Process:
 * 1. Extract chains and analysis criteria from user query using LLM
 * 2. Fetch multi-chain data from DeFiLlama
 * 3. Return structured cross-chain data for LLM to process
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

interface CrossChainCriteria {
  targetChains: string[];
  analysisType: "comparison" | "arbitrage" | "yield" | "general";
  minTvl: number;
  focusCategories: string[];
}

interface ChainAnalysis {
  name: string;
  tvl: number;
  protocolCount: number;
  topProtocols: Array<{
    name: string;
    tvl: number;
    category: string;
  }>;
  dominanceMetrics: {
    totalMarketShare: number;
    categoryLeader: string;
  };
}

interface BridgeOpportunity {
  name: string;
  displayName: string;
  volume24h: number;
  supportedChains: string[];
  category: string;
}

interface CrossChainYield {
  protocol: string;
  chain: string;
  apy: number;
  tvl: number;
  category: string;
  riskLevel: "low" | "medium" | "high";
}

interface StructuredCrossChainData {
  analysisType: string;
  targetChains: string[];
  chainAnalysis: ChainAnalysis[];
  bridgeOpportunities: BridgeOpportunity[];
  crossChainYields: CrossChainYield[];
  summary: {
    totalTvlAcrossChains: number;
    totalProtocols: number;
    averageYield: number;
    topChainByTvl: string;
  };
}

const extractCrossChainTemplate = `# Extract cross-chain analysis parameters for multi-chain DeFi analysis

## Conversation Context
{{recentMessages}}

IMPORTANT: Follow DeFiLlama API specification exactly:
- Chain names as per /v2/chains and /bridges endpoints: "Ethereum", "Arbitrum", "Optimism", "Polygon", "Avalanche", "Fantom", "BSC"
- Bridge data uses proper case chain names in chains array
- Yield data matches chain names from /pools endpoint

The user might express cross-chain requests in various ways:
- "Compare Ethereum vs Arbitrum DeFi" → chains: ["Ethereum", "Arbitrum"], analysis: "comparison"
- "Best bridges to move assets" → analysis: "bridge", focus: ["bridge protocols"]
- "Cross-chain yield farming opportunities" → analysis: "yield", focus: ["yield farming"]
- "Arbitrage between Polygon and BSC" → chains: ["Polygon", "BSC"], analysis: "arbitrage"
- "Layer 2 protocol comparison" → chains: ["Arbitrum", "Optimism", "Polygon"], analysis: "comparison"
- "Multi-chain lending protocols" → focus: ["lending"], analysis: "comparison"
- "Migrate from Ethereum to cheaper chains" → sourceChain: "Ethereum", analysis: "migration"

Extract and return ONLY a JSON object following DeFiLlama API format:
{
  "targetChains": ["Chain names as per DeFiLlama API: Ethereum/Arbitrum/Optimism/Polygon/Avalanche/Fantom/BSC"],
  "sourceChain": "Source chain if migration mentioned",
  "analysisType": "comparison/arbitrage/yield/bridge/migration/general",
  "focusCategories": ["Category focus: lending/dex/staking/bridge/yield if mentioned"],
  "minTvlPreference": "large/medium/small/any (based on user preference)",
  "riskTolerance": "low/medium/high (if mentioned)",
  "specificProtocols": ["Protocol names if specifically mentioned"],
  "metrics": ["tvl/volume/fees/apy if specific metrics requested"],
  "timeframe": "24h/7d/30d if historical comparison mentioned",
  "includeDetails": true/false (if user wants detailed breakdown)
}

Return only the JSON object, no other text.`;

export const crossChainAction: Action = {
  name: "CROSS_CHAIN_ANALYSIS",
  similes: [
    "cross chain",
    "multi chain",
    "bridge assets",
    "chain comparison",
    "arbitrage opportunities",
    "L2 analysis",
    "chain migration",
    "cross chain yield",
    "bridge protocols",
    "multi chain defi",
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
    "Use this action when you need cross-chain comparisons or opportunities.",
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("[CROSS_CHAIN] Starting cross-chain analysis");

    try {
      const userQuestion = message.content.text || "";

      // Extract cross-chain criteria using LLM first, with fallback to regex
      let criteria: CrossChainCriteria;

      // Check if we have explicit criteria in options
      if (options?.crossChainParams) {
        criteria = options.crossChainParams as CrossChainCriteria;
      } else {
        // Use LLM to extract cross-chain criteria from recent messages context
        const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
        const template = extractCrossChainTemplate.replace("{{userMessage}}", "{{recentMessages}}");
        const prompt = composePromptFromState({ state: composedState, template });

        const response = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });

        if (response) {
          try {
            // Strip markdown code blocks if present
            const cleanedResponse = response
              .replace(/^```(?:json)?\n?/, "")
              .replace(/\n?```$/, "")
              .trim();
            const parsed = JSON.parse(cleanedResponse);

            criteria = {
              targetChains: parsed.targetChains || [],
              analysisType: parsed.analysisType || "general",
              minTvl: parseMinTvlFromPreference(parsed.minTvlPreference),
              focusCategories: parsed.focusCategories || [],
            };

            // Ensure we have target chains
            if (criteria.targetChains.length === 0) {
              if (parsed.sourceChain) {
                criteria.targetChains = [
                  parsed.sourceChain,
                  "Arbitrum",
                  "Polygon",
                  "Optimism",
                ];
              } else {
                criteria.targetChains = [
                  "Ethereum",
                  "Arbitrum",
                  "Polygon",
                  "Optimism",
                ];
              }
            }

            logger.info(
              `[CROSS_CHAIN] LLM extracted criteria: ${JSON.stringify(criteria)}`,
            );
          } catch (parseError) {
            logger.warn(
              "Failed to parse LLM response, falling back to regex:",
              parseError instanceof Error ? parseError.message : String(parseError),
            );
            // Fallback to regex-based extraction
            criteria = extractCrossChainCriteriaLegacy(userQuestion);
          }
        } else {
          logger.warn(
            "[CROSS_CHAIN] No LLM response received, falling back to regex",
          );
          // Fallback to regex-based extraction
          criteria = extractCrossChainCriteriaLegacy(userQuestion);
        }
      }

      logger.info(
        `[CROSS_CHAIN] Analyzing chains: ${criteria.targetChains.join(", ")}, type: ${criteria.analysisType}`,
      );

      // Fetch cross-chain data
      const defiLlamaService = runtime.getService<DefiLlamaService>(
        DefiLlamaService.serviceType,
      );

      if (!defiLlamaService) {
        throw new Error("DeFiLlama service not available");
      }

      const [protocols, chains, yields, bridges] = await Promise.all([
        defiLlamaService.getProtocols(),
        defiLlamaService.getChains(),
        defiLlamaService.getYields(),
        defiLlamaService.getBridges({ includeChains: true }),
      ]);

      // Structure cross-chain analysis
      const structuredData = buildCrossChainAnalysis(
        protocols,
        chains,
        yields,
        bridges,
        criteria,
      );

      logger.info("[CROSS_CHAIN] Cross-chain analysis completed successfully");

      // Generate response using LLM
      const response = await runtime.useModel(ModelType.LARGE, {
        prompt: `Respond concisely with cross-chain analysis based on data: ${JSON.stringify(structuredData)}

Question: ${userQuestion}

Provide insights on:
- Key differences and opportunities across chains
- Best protocols and yields on each chain
- Bridge recommendations for asset movement
- Strategic cross-chain opportunities

Keep response focused, practical, and under 150 words.`,
        temperature: 0.7,
        stop: ["<END>"],
      });

      if (callback) {
        await callback({
          text:
            response ||
            "Unable to analyze cross-chain opportunities at this time.",
          actions: ['CROSS_CHAIN_ANALYSIS'],
          source: message.content.source,
        });
      }

      return {
        text: response || "Cross-chain analysis completed",
        success: true,
        data: {
          actionName: "CROSS_CHAIN_ANALYSIS",
          extractedCriteria: criteria,
          structuredData,
          crossChainAnalysisCompleted: true,
          chainsAnalyzed: structuredData.chainAnalysis.length,
          bridgesFound: structuredData.bridgeOpportunities.length,
          timestamp: Date.now(),
        },
      } as ActionResult;
    } catch (error) {
      const errorMessage = `Failed to analyze cross-chain opportunities: ${error}`;
      logger.error(`[CROSS_CHAIN] ${errorMessage}`);

      if (callback) {
        await callback({
          text: "I encountered an error while analyzing cross-chain opportunities. Please try again.",
          source: "CROSS_CHAIN_ANALYSIS",
        });
      }

      return {
        text: "Error analyzing cross-chain opportunities. Please try again.",
        success: false,
        data: {
          actionName: "CROSS_CHAIN_ANALYSIS",
          error: errorMessage,
          crossChainAnalysisCompleted: false,
          timestamp: Date.now(),
        },
      } as ActionResult;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: { text: "Compare DeFi opportunities on Ethereum vs Arbitrum" },
      },
      {
        name: "assistant",
        content: {
          text: "Here's a comprehensive comparison of DeFi opportunities on Ethereum vs Arbitrum: [detailed analysis]",
          source: "CROSS_CHAIN_ANALYSIS",
        },
      },
    ],
    [
      {
        name: "user",
        content: {
          text: "What are the best bridges to move assets between chains?",
        },
      },
      {
        name: "assistant",
        content: {
          text: "Here are the top bridges for cross-chain asset movement: [bridge recommendations with security analysis]",
          source: "CROSS_CHAIN_ANALYSIS",
        },
      },
    ],
    [
      {
        name: "user",
        content: { text: "Find cross-chain arbitrage opportunities" },
      },
      {
        name: "assistant",
        content: {
          text: "Based on current data, here are potential cross-chain arbitrage opportunities: [arbitrage analysis]",
          source: "CROSS_CHAIN_ANALYSIS",
        },
      },
    ],
  ],
};

// Helper functions for cross-chain data extraction and formatting

function parseMinTvlFromPreference(preference?: string): number {
  switch (preference?.toLowerCase()) {
    case "large":
      return 500000000; // $500M
    case "medium":
      return 50000000; // $50M
    case "small":
      return 5000000; // $5M
    case "any":
      return 1000000; // $1M
    default:
      return 50000000; // Default $50M
  }
}

function extractCrossChainCriteriaLegacy(query: string): CrossChainCriteria {
  const lowerQuery = query.toLowerCase();

  // Extract target chains
  const chains: string[] = [];
  const chainKeywords = {
    ethereum: "Ethereum",
    arbitrum: "Arbitrum",
    optimism: "Optimism",
    polygon: "Polygon",
    avalanche: "Avalanche",
    fantom: "Fantom",
    bsc: "BSC",
    "binance smart chain": "BSC",
  };

  for (const [keyword, chain] of Object.entries(chainKeywords)) {
    if (lowerQuery.includes(keyword)) {
      chains.push(chain);
    }
  }

  // If no specific chains mentioned, include major ones
  if (chains.length === 0) {
    chains.push("Ethereum", "Arbitrum", "Polygon", "Optimism");
  }

  // Determine analysis type
  let analysisType: "comparison" | "arbitrage" | "yield" | "general" =
    "general";
  if (
    lowerQuery.includes("compare") ||
    lowerQuery.includes("comparison") ||
    lowerQuery.includes("vs")
  ) {
    analysisType = "comparison";
  } else if (
    lowerQuery.includes("arbitrage") ||
    lowerQuery.includes("price difference")
  ) {
    analysisType = "arbitrage";
  } else if (
    lowerQuery.includes("yield") ||
    lowerQuery.includes("farming") ||
    lowerQuery.includes("apy")
  ) {
    analysisType = "yield";
  }

  // Extract minimum TVL preference
  let minTvl = 50000000; // Default $50M
  if (lowerQuery.includes("large") || lowerQuery.includes("established")) {
    minTvl = 500000000; // $500M for large protocols
  } else if (lowerQuery.includes("small") || lowerQuery.includes("emerging")) {
    minTvl = 5000000; // $5M for smaller protocols
  }

  // Extract focus categories
  const categories: string[] = [];
  const categoryKeywords = {
    lending: "Lending",
    dex: "Dexs",
    staking: "Liquid Staking",
    bridge: "Bridge",
    yield: "Yield",
  };

  for (const [keyword, category] of Object.entries(categoryKeywords)) {
    if (lowerQuery.includes(keyword)) {
      categories.push(category);
    }
  }

  return {
    targetChains: chains,
    analysisType,
    minTvl,
    focusCategories: categories,
  };
}

function buildCrossChainAnalysis(
  protocols: Array<{
    name: string;
    tvl?: number;
    category: string;
    chain?: string;
  }>,
  chains: Array<{ name: string; tvl?: number }>,
  yields: Array<{
    project: string;
    chain?: string;
    apy: number;
    tvlUsd: number;
  }>,
  bridges: Array<{
    name: string;
    displayName?: string;
    lastDailyVolume?: number;
    chains?: string[];
  }>,
  criteria: CrossChainCriteria,
): StructuredCrossChainData {
  // Filter chains based on criteria (case-insensitive for robustness)
  const targetChainData = chains.filter((chain) =>
    criteria.targetChains.some(
      (targetChain) => targetChain.toLowerCase() === chain.name.toLowerCase(),
    ),
  );

  // Build chain analysis
  const chainAnalysis: ChainAnalysis[] = targetChainData.map((chain) => {
    const chainProtocols = protocols.filter(
      (p) =>
        p.chain &&
        chain.name &&
        p.chain.toLowerCase() === chain.name.toLowerCase() &&
        (p.tvl || 0) >= criteria.minTvl,
    );

    const topProtocols = chainProtocols
      .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
      .slice(0, 5)
      .map((p) => ({
        name: p.name,
        tvl: p.tvl || 0,
        category: p.category,
      }));

    const totalTvl = chainProtocols.reduce((sum, p) => sum + (p.tvl || 0), 0);
    const totalMarketTvl = chains.reduce((sum, c) => sum + (c.tvl || 0), 0);

    return {
      name: chain.name,
      tvl: chain.tvl || 0,
      protocolCount: chainProtocols.length,
      topProtocols,
      dominanceMetrics: {
        totalMarketShare:
          totalMarketTvl > 0 ? ((chain.tvl || 0) / totalMarketTvl) * 100 : 0,
        categoryLeader: topProtocols[0]?.category || "Unknown",
      },
    };
  });

  // Build bridge opportunities (case-insensitive chain matching)
  const bridgeOpportunities: BridgeOpportunity[] = bridges
    .filter((bridge) => {
      if (!bridge.chains) return false;
      return criteria.targetChains.some((targetChain) =>
        bridge.chains!.some(
          (bridgeChain) =>
            bridgeChain.toLowerCase() === targetChain.toLowerCase(),
        ),
      );
    })
    .map((bridge) => ({
      name: bridge.name,
      displayName: bridge.displayName || bridge.name,
      volume24h: bridge.lastDailyVolume || 0,
      supportedChains: bridge.chains || [],
      category: "Bridge",
    }))
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 6);

  // Build cross-chain yields (case-insensitive chain matching)
  const crossChainYields: CrossChainYield[] = yields
    .filter((yieldPool) => {
      if (!yieldPool.chain) return false;
      if (
        !criteria.targetChains.some(
          (targetChain) =>
            targetChain.toLowerCase() === yieldPool.chain!.toLowerCase(),
        )
      )
        return false;
      if (yieldPool.tvlUsd < criteria.minTvl * 0.1) return false; // At least 10% of min TVL
      return true;
    })
    .map((yieldPool) => ({
      protocol: yieldPool.project,
      chain: yieldPool.chain!,
      apy: yieldPool.apy,
      tvl: yieldPool.tvlUsd,
      category: "Yield",
      riskLevel: assessCrossChainYieldRisk(yieldPool),
    }))
    .sort((a, b) => b.apy - a.apy)
    .slice(0, 8);

  // Calculate summary
  const totalTvlAcrossChains = chainAnalysis.reduce(
    (sum, chain) => sum + chain.tvl,
    0,
  );
  const totalProtocols = chainAnalysis.reduce(
    (sum, chain) => sum + chain.protocolCount,
    0,
  );
  const averageYield =
    crossChainYields.length > 0
      ? crossChainYields.reduce((sum, y) => sum + y.apy, 0) /
        crossChainYields.length
      : 0;
  const topChainByTvl =
    chainAnalysis.length > 0
      ? chainAnalysis.sort((a, b) => b.tvl - a.tvl)[0].name
      : "Unknown";

  return {
    analysisType: criteria.analysisType,
    targetChains: criteria.targetChains,
    chainAnalysis,
    bridgeOpportunities,
    crossChainYields,
    summary: {
      totalTvlAcrossChains,
      totalProtocols,
      averageYield,
      topChainByTvl,
    },
  };
}

function assessCrossChainYieldRisk(yieldPool: {
  apy: number;
  tvlUsd: number;
}): "low" | "medium" | "high" {
  let riskScore = 0;

  // APY risk
  if (yieldPool.apy > 50) riskScore += 2;
  else if (yieldPool.apy > 20) riskScore += 1;

  // TVL risk
  if (yieldPool.tvlUsd < 5000000) riskScore += 2;
  else if (yieldPool.tvlUsd < 25000000) riskScore += 1;

  if (riskScore <= 0) return "low";
  if (riskScore <= 2) return "medium";
  return "high";
}
