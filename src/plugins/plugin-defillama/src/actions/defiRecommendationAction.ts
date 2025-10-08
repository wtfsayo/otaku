/**
 * DeFi Recommendation Action
 *
 * Direct investment recommendation tool that suggests DeFi opportunities
 * from DeFiLlama's API. Returns structured data for LLM processing.
 *
 * Features:
 * - Investment criteria extraction from natural language queries using LLM
 * - Yield opportunity and protocol recommendations
 * - Risk-adjusted investment suggestions
 * - Smart filtering by APY, TVL, and safety metrics using LLM and fallback patterns
 * - Clean data structuring for LLM response generation
 *
 * Process:
 * 1. Extract investment preferences from user query using LLM
 * 2. Fetch protocol and yield data from DeFiLlama
 * 3. Return structured recommendations for LLM to process
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

interface InvestmentCriteria {
  targetApy: number;
  riskTolerance: "low" | "medium" | "high";
  minTvl: number;
  chains: string[];
  categories: string[];
}

interface YieldOpportunity {
  project: string;
  symbol: string;
  apy: number;
  tvlUsd: number;
  chain: string;
  category: string;
  riskLevel: "low" | "medium" | "high";
}

interface ProtocolRecommendation {
  name: string;
  tvl: number;
  category: string;
  chain: string;
  reason: string;
  riskLevel: "low" | "medium" | "high";
}

interface StructuredRecommendations {
  investmentCriteria: InvestmentCriteria;
  yieldOpportunities: YieldOpportunity[];
  protocolRecommendations: ProtocolRecommendation[];
  summary: {
    totalOpportunities: number;
    averageApy: number;
    totalTvl: number;
    riskDistribution: { low: number; medium: number; high: number };
  };
}

const extractRecommendationTemplate = `# Extract DeFi investment recommendation parameters

## Conversation Context
{{recentMessages}}

IMPORTANT: Follow DeFiLlama API specification exactly:
- /protocols endpoint returns protocol data with tvl, category, chains
- /pools endpoint returns yield data with {status: "success", data: [{apy, tvlUsd, project, symbol, chain}]}
- Protocol categories: "Dexs", "Lending", "Liquid Staking", "Derivatives", "Yield", "CDP", "Bridge"
- Chain names in proper case: "Ethereum", "Polygon", "Arbitrum", "Optimism", "BSC", "Avalanche"
- Risk assessment based on TVL, APY levels, and protocol maturity

The user might express investment requests in various ways:
- "Good DeFi yield farming opportunities" → targetApy: 10, category: "Yield", riskTolerance: "medium"
- "Where should I invest $10k for moderate risk?" → investmentAmount: 10000, riskTolerance: "medium"
- "Best low-risk DeFi protocols for beginners" → riskTolerance: "low", categories: ["Lending", "Liquid Staking"]
- "High yield opportunities above 15%" → targetApy: 15, riskTolerance: "high"
- "Safe stablecoin farming on Ethereum" → chains: ["Ethereum"], targetApy: 5, riskTolerance: "low"
- "Conservative DeFi with $100k" → investmentAmount: 100000, riskTolerance: "low", minTvl: 1000000000
- "Aggressive yield strategies" → riskTolerance: "high", targetApy: 20

Respond with parameters in this exact format:
<response>
  <targetApy>8</targetApy>
  <riskTolerance>low/medium/high</riskTolerance>
  <investmentAmount>0</investmentAmount>
  <minTvl>10000000</minTvl>
  <chains>Ethereum,Polygon,Arbitrum,Optimism,BSC,Avalanche</chains>
  <categories>Dexs,Lending,Liquid Staking,Derivatives,Yield,CDP</categories>
  <timeHorizon>short/medium/long</timeHorizon>
  <strategy>conservative/balanced/aggressive/yield_focused</strategy>
  <excludeRisky>true/false</excludeRisky>
  <diversified>true/false</diversified>
</response>`;

export const defiRecommendationAction: Action = {
  name: "DEFI_RECOMMENDATIONS",
  similes: [
    "investment advice",
    "recommendations",
    "suggest protocols",
    "yield farming",
    "best opportunities",
    "where to invest",
    "defi strategies",
    "portfolio suggestions",
    "investment ideas",
    "yield opportunities",
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
    "Use this action when the user asks for DeFi investment options or strategy recommendations.",
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: Record<string, unknown>,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("[DEFI_RECOMMENDATIONS] Starting recommendation analysis");

    try {
      const userQuestion = message.content.text || "";

      // Extract investment criteria using LLM first, with fallback to regex
      let extractedParams: any;

      // Check if we have explicit params in options
      if (options?.recommendationParams) {
        extractedParams = options.recommendationParams;
      } else {
        // Use LLM to extract criteria from recent messages context
        const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
        const prompt = composePromptFromState({ state: composedState, template: extractRecommendationTemplate });

        const response = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });

        if (response) {
          try {
            const parsed = parseKeyValueXml(response);

            if (!parsed) {
              throw new Error("Failed to parse XML response");
            }

            extractedParams = {
              targetApy: parsed.targetApy ? parseFloat(parsed.targetApy) : 8,
              riskTolerance: parsed.riskTolerance || "medium",
              investmentAmount: parsed.investmentAmount ? parseFloat(parsed.investmentAmount) : 0,
              minTvl:
                parsed.minTvl ? parseFloat(parsed.minTvl) :
                (parsed.riskTolerance === "low"
                  ? 100000000
                  : parsed.riskTolerance === "high"
                    ? 1000000
                    : 10000000),
              chains: parsed.chains ? parsed.chains.split(',').map((s: string) => s.trim()) : [],
              categories: parsed.categories ? parsed.categories.split(',').map((s: string) => s.trim()) : [],
              timeHorizon: parsed.timeHorizon || "medium",
              strategy: parsed.strategy || "balanced",
              excludeRisky: parsed.excludeRisky === 'true',
              diversified: parsed.diversified === 'true',
            };

            logger.info(
              `[DEFI_RECOMMENDATIONS] LLM extracted params: ${JSON.stringify(extractedParams)}`,
            );
          } catch (parseError) {
            logger.warn(
              "Failed to parse LLM response, falling back to regex:",
              parseError instanceof Error ? parseError.message : String(parseError),
            );
            // Fallback to regex-based extraction
            extractedParams = extractInvestmentCriteriaLegacy(userQuestion);
          }
        } else {
          logger.warn(
            "[DEFI_RECOMMENDATIONS] No LLM response received, falling back to regex",
          );
          // Fallback to regex-based extraction
          extractedParams = extractInvestmentCriteriaLegacy(userQuestion);
        }
      }

      logger.info(
        `[DEFI_RECOMMENDATIONS] Analyzing with criteria: ${JSON.stringify(extractedParams)}`,
      );

      // Fetch recommendation data
      const defiLlamaService = runtime.getService<DefiLlamaService>(
        DefiLlamaService.serviceType,
      );

      if (!defiLlamaService) {
        throw new Error("DeFiLlama service not available");
      }

      const [protocols, yields] = await Promise.all([
        defiLlamaService.getProtocols(),
        defiLlamaService.getYields(),
      ]);

      // Structure recommendations using LLM extracted parameters
      const structuredData = buildRecommendationsLLM(
        protocols,
        yields,
        extractedParams,
      );

      logger.info(
        "[DEFI_RECOMMENDATIONS] Recommendations generated successfully",
      );

      // Generate response using LLM
      const response = await runtime.useModel(ModelType.LARGE, {
        prompt: `Respond concisely with investment recommendations based on data: ${JSON.stringify(structuredData)}

Question: ${userQuestion}

Provide insights on:
- Top yield opportunities matching user criteria
- Protocol recommendations with risk assessment
- Strategic investment suggestions
- Risk management considerations

Keep response focused, practical, and under 150 words.`,
        temperature: 0.7,
        stop: ["<END>"],
      });

      if (callback) {
        await callback({
          text: response || "Unable to generate recommendations at this time.",
          actions: ['DEFI_RECOMMENDATIONS'],
          source: message.content.source,
        });
      }

      return {
        text: response || "Investment recommendations generated",
        success: true,
        data: {
          actionName: "DEFI_RECOMMENDATIONS",
          extractedParams,
          structuredData,
          recommendationsGenerated: true,
          opportunitiesFound: structuredData.yieldOpportunities.length,
          protocolsRecommended: structuredData.protocolRecommendations.length,
          timestamp: Date.now(),
        },
      } as ActionResult;
    } catch (error) {
      const errorMessage = `Failed to generate recommendations: ${error}`;
      logger.error(`[DEFI_RECOMMENDATIONS] ${errorMessage}`);

      if (callback) {
        await callback({
          text: "I encountered an error while generating recommendations. Please try again.",
          source: "DEFI_RECOMMENDATIONS",
        });
      }

      return {
        text: "Error generating recommendations. Please try again.",
        success: false,
        data: {
          actionName: "DEFI_RECOMMENDATIONS",
          error: errorMessage,
          recommendationsGenerated: false,
          timestamp: Date.now(),
        },
      } as ActionResult;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Recommend some good DeFi yield farming opportunities",
        },
      },
      {
        name: "assistant",
        content: {
          text: "Here are the top DeFi yield farming opportunities based on current market conditions: [analysis with recommendations]",
          source: "DEFI_RECOMMENDATIONS",
        },
      },
    ],
    [
      {
        name: "user",
        content: {
          text: "Where should I invest $10k for moderate risk and good returns?",
        },
      },
      {
        name: "assistant",
        content: {
          text: "For $10k with moderate risk tolerance, here are my top protocol recommendations: [detailed investment strategy]",
          source: "DEFI_RECOMMENDATIONS",
        },
      },
    ],
    [
      {
        name: "user",
        content: {
          text: "What are the best low-risk DeFi protocols for beginners?",
        },
      },
      {
        name: "assistant",
        content: {
          text: "For beginners seeking low-risk DeFi exposure, I recommend these established protocols: [beginner-friendly recommendations]",
          source: "DEFI_RECOMMENDATIONS",
        },
      },
    ],
  ],
};

// Helper functions for recommendation data extraction and formatting

function buildRecommendationsLLM(
  protocols: Array<{
    name: string;
    tvl?: number;
    category: string;
    chain?: string;
  }>,
  yields: Array<{
    project: string;
    symbol: string;
    apy: number;
    tvlUsd: number;
    chain?: string;
    stablecoin?: boolean;
  }>,
  params: any,
): StructuredRecommendations {
  // Convert LLM parameters to legacy format for compatibility
  const criteria: InvestmentCriteria = {
    targetApy: params.targetApy,
    riskTolerance: params.riskTolerance,
    minTvl: params.minTvl,
    chains: params.chains,
    categories: params.categories,
  };

  // Filter and score yield opportunities
  const yieldOpportunities: YieldOpportunity[] = yields
    .filter((pool) => {
      // APY filtering based on target and risk tolerance
      const minApyThreshold =
        params.riskTolerance === "low"
          ? params.targetApy * 0.3
          : params.targetApy * 0.5;
      if (pool.apy < minApyThreshold) return false;

      // TVL filtering based on risk tolerance and minimum requirements
      const minTvlThreshold =
        params.riskTolerance === "low"
          ? params.minTvl * 0.5
          : params.minTvl * 0.1;
      if (pool.tvlUsd < minTvlThreshold) return false;

      // Chain filtering
      if (
        params.chains.length > 0 &&
        pool.chain &&
        !params.chains.includes(pool.chain)
      )
        return false;

      // Exclude risky pools if requested
      if (params.excludeRisky && pool.apy > 50) return false;

      return true;
    })
    .map((pool) => ({
      project: pool.project,
      symbol: pool.symbol,
      apy: pool.apy,
      tvlUsd: pool.tvlUsd,
      chain: pool.chain || "Multi-chain",
      category: "Yield",
      riskLevel: assessYieldRiskLLM(pool, params),
    }))
    .sort((a, b) => {
      // Enhanced scoring based on strategy
      if (params.strategy === "conservative") {
        return b.tvlUsd - a.tvlUsd; // Prioritize TVL for safety
      } else if (params.strategy === "yield_focused") {
        return b.apy - a.apy; // Prioritize highest APY
      } else {
        // Balanced scoring by APY and TVL
        const scoreA = a.apy * Math.log(a.tvlUsd + 1);
        const scoreB = b.apy * Math.log(b.tvlUsd + 1);
        return scoreB - scoreA;
      }
    })
    .slice(0, params.diversified ? 8 : 5);

  // Filter and recommend protocols
  const protocolRecommendations: ProtocolRecommendation[] = protocols
    .filter((protocol) => {
      const protocolTvl = protocol.tvl || 0;
      if (protocolTvl < params.minTvl) return false;

      // Category filtering
      if (
        params.categories.length > 0 &&
        !params.categories.includes(protocol.category)
      )
        return false;

      // Chain filtering
      if (
        params.chains.length > 0 &&
        protocol.chain &&
        !params.chains.includes(protocol.chain)
      )
        return false;

      // Risk filtering
      if (params.excludeRisky) {
        const highRiskCategories = [
          "Derivatives",
          "Cross Chain",
          "Algo-Stables",
        ];
        if (highRiskCategories.includes(protocol.category)) return false;
      }

      return true;
    })
    .map((protocol) => ({
      name: protocol.name,
      tvl: protocol.tvl || 0,
      category: protocol.category,
      chain: protocol.chain || "Multi-chain",
      reason: generateRecommendationReasonLLM(protocol, params),
      riskLevel: assessProtocolRiskLLM(protocol, params),
    }))
    .sort((a, b) => {
      // Sort based on strategy
      if (params.strategy === "conservative") {
        return b.tvl - a.tvl;
      } else {
        // Consider both TVL and category fit
        const scoreA =
          a.tvl + (params.categories.includes(a.category) ? a.tvl * 0.2 : 0);
        const scoreB =
          b.tvl + (params.categories.includes(b.category) ? b.tvl * 0.2 : 0);
        return scoreB - scoreA;
      }
    })
    .slice(0, params.diversified ? 6 : 4);

  // Calculate summary statistics
  const totalOpportunities =
    yieldOpportunities.length + protocolRecommendations.length;
  const averageApy =
    yieldOpportunities.length > 0
      ? yieldOpportunities.reduce((sum, op) => sum + op.apy, 0) /
        yieldOpportunities.length
      : 0;
  const totalTvl = protocolRecommendations.reduce(
    (sum, rec) => sum + rec.tvl,
    0,
  );

  const riskDistribution = { low: 0, medium: 0, high: 0 };
  [...yieldOpportunities, ...protocolRecommendations].forEach((item) => {
    riskDistribution[item.riskLevel]++;
  });

  return {
    investmentCriteria: criteria,
    yieldOpportunities,
    protocolRecommendations,
    summary: {
      totalOpportunities,
      averageApy,
      totalTvl,
      riskDistribution,
    },
  };
}

function assessYieldRiskLLM(
  pool: { apy: number; tvlUsd: number; stablecoin?: boolean },
  params: any,
): "low" | "medium" | "high" {
  let riskScore = 0;

  // APY risk assessment
  if (pool.apy > 100) riskScore += 3;
  else if (pool.apy > 50) riskScore += 2;
  else if (pool.apy > 20) riskScore += 1;

  // TVL risk assessment
  if (pool.tvlUsd < 1000000) riskScore += 3;
  else if (pool.tvlUsd < 10000000) riskScore += 2;
  else if (pool.tvlUsd < 50000000) riskScore += 1;

  // Stablecoin bonus
  if (pool.stablecoin) riskScore -= 1;

  // User risk tolerance adjustment
  if (params.riskTolerance === "low") riskScore += 1;
  else if (params.riskTolerance === "high") riskScore -= 1;

  if (riskScore <= 1) return "low";
  if (riskScore <= 3) return "medium";
  return "high";
}

function assessProtocolRiskLLM(
  protocol: { tvl?: number; category: string },
  params: any,
): "low" | "medium" | "high" {
  let riskScore = 0;

  // TVL risk
  const protocolTvl = protocol.tvl || 0;
  if (protocolTvl < 10000000) riskScore += 3;
  else if (protocolTvl < 100000000) riskScore += 2;
  else if (protocolTvl < 1000000000) riskScore += 1;

  // Category risk
  const highRiskCategories = ["Derivatives", "Cross Chain", "Algo-Stables"];
  const lowRiskCategories = ["Lending", "Liquid Staking", "CDP"];

  if (highRiskCategories.includes(protocol.category)) riskScore += 2;
  else if (lowRiskCategories.includes(protocol.category)) riskScore -= 1;

  // User risk tolerance adjustment
  if (params.riskTolerance === "low") riskScore += 1;
  else if (params.riskTolerance === "high") riskScore -= 1;

  if (riskScore <= 1) return "low";
  if (riskScore <= 3) return "medium";
  return "high";
}

function generateRecommendationReasonLLM(
  protocol: { name: string; tvl?: number; category: string },
  params: any,
): string {
  const reasons = [];

  const protocolTvl = protocol.tvl || 0;
  if (protocolTvl > 5000000000) {
    reasons.push("Massive TVL provides exceptional security");
  } else if (protocolTvl > 1000000000) {
    reasons.push("High TVL provides strong security");
  }

  if (protocol.category === "Lending" && params.riskTolerance === "low") {
    reasons.push("Established lending protocol with proven track record");
  }

  if (protocol.category === "Dexs" && params.strategy === "yield_focused") {
    reasons.push("DEX with strong liquidity and yield opportunities");
  }

  if (protocol.category === "Liquid Staking" && params.timeHorizon === "long") {
    reasons.push("Liquid staking ideal for long-term strategies");
  }

  if (params.categories.includes(protocol.category)) {
    reasons.push(`Matches your ${protocol.category.toLowerCase()} preference`);
  }

  return reasons.length > 0 ? reasons[0] : "Solid protocol fundamentals";
}

function extractInvestmentCriteriaLegacy(query: string): any {
  const lowerQuery = query.toLowerCase();

  // Extract target APY
  let targetApy = 8; // Default 8% APY
  const apyMatch = lowerQuery.match(/(\d+)%?\s*(apy|yield|return)/);
  if (apyMatch) {
    targetApy = parseInt(apyMatch[1]);
  } else if (
    lowerQuery.includes("high yield") ||
    lowerQuery.includes("high return")
  ) {
    targetApy = 15;
  } else if (
    lowerQuery.includes("conservative") ||
    lowerQuery.includes("safe")
  ) {
    targetApy = 5;
  }

  // Extract risk tolerance
  let riskTolerance: "low" | "medium" | "high" = "medium";
  if (
    lowerQuery.includes("conservative") ||
    lowerQuery.includes("safe") ||
    lowerQuery.includes("low risk")
  ) {
    riskTolerance = "low";
  } else if (
    lowerQuery.includes("aggressive") ||
    lowerQuery.includes("high risk") ||
    lowerQuery.includes("risky")
  ) {
    riskTolerance = "high";
  }

  // Extract minimum TVL preference
  let minTvl = 10000000; // Default $10M
  if (riskTolerance === "low") {
    minTvl = 100000000; // $100M for conservative
  } else if (riskTolerance === "high") {
    minTvl = 1000000; // $1M for aggressive
  }

  // Extract chain preferences
  const chains: string[] = [];
  const chainKeywords = {
    ethereum: "Ethereum",
    polygon: "Polygon",
    arbitrum: "Arbitrum",
    optimism: "Optimism",
    avalanche: "Avalanche",
    bsc: "BSC",
  };

  for (const [keyword, chain] of Object.entries(chainKeywords)) {
    if (lowerQuery.includes(keyword)) {
      chains.push(chain);
    }
  }

  // Extract category preferences
  const categories: string[] = [];
  const categoryKeywords = {
    lending: "Lending",
    dex: "Dexs",
    "yield farming": "Yield",
    staking: "Liquid Staking",
    stablecoin: "Stablecoins",
  };

  for (const [keyword, category] of Object.entries(categoryKeywords)) {
    if (lowerQuery.includes(keyword)) {
      categories.push(category);
    }
  }

  return {
    targetApy,
    riskTolerance,
    minTvl,
    chains,
    categories,
    strategy: "balanced",
    excludeRisky: riskTolerance === "low",
    diversified: true,
  };
}
