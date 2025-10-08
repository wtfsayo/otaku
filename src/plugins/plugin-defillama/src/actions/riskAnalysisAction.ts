/**
 * Risk Analysis Action
 *
 * Direct risk assessment tool that analyzes DeFi protocol safety
 * from DeFiLlama's API. Returns structured data for LLM processing.
 *
 * Features:
 * - Protocol/asset risk evaluation from natural language queries using LLM
 * - Smart contract, liquidity, and market risk assessment
 * - Multi-protocol risk comparison
 * - Risk category identification using LLM extraction and fallback patterns
 * - Clean data structuring for LLM response generation
 *
 * Process:
 * 1. Extract protocols and risk concerns from user query using LLM
 * 2. Fetch protocol data from DeFiLlama
 * 3. Return structured risk data for LLM to process
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
} from "@elizaos/core";
import { DefiLlamaService } from "../services/defiLlamaService";

interface ProtocolInfo {
  tvl?: number;
  category?: string;
  chains?: string[];
  audits?: string;
  audit_links?: string[] | null;
  audit_note?: string;
  listedAt?: number;
  twitter?: string;
  oracles?: string[];
  governanceID?: string | null;
}

interface RiskProtocolData {
  protocol: string;
  protocolInfo: ProtocolInfo;
}

interface RiskAssessmentFactors {
  overall: string;
  factors: {
    smart_contract: string;
    liquidity: string;
    market: string;
    governance: string;
  };
  confidence: string;
}

interface ProtocolRiskAssessment {
  name: string;
  currentTvl: number;
  category: string;
  chain: string;
  auditStatus: string;
  riskAssessment: RiskAssessmentFactors;
  governance: string;
  timeActive: string;
}

interface MarketRiskData {
  protocols: Array<{
    name: string;
    tvl: number;
    category: string;
    riskLevel: string;
  }>;
  marketTrends: {
    totalTvl: number;
    protocolCount: number;
    categories: string[];
  };
}

interface StructuredRiskData {
  targetProtocols: string[] | string;
  riskCategories: string[];
  protocolRisks: ProtocolRiskAssessment[];
  marketRisks: MarketRiskData | null;
  summary: {
    totalProtocols: number;
    riskLevels: { Low: number; Medium: number; High: number };
    analysisScope: string;
  };
}

interface RiskDataCollection {
  protocols?: RiskProtocolData[];
}

const extractRiskAnalysisTemplate = `# Extract risk analysis parameters for DeFi protocol safety assessment

## Conversation Context
{{recentMessages}}

IMPORTANT: Follow DeFiLlama API specification exactly:
- /protocol/{protocol} endpoint returns protocol data with tvl, category, chains (array), audits, audit_note
- Protocol categories: "Dexs", "Lending", "Liquid Staking", "Derivatives", "Yield", "CDP", "Bridge"
- Chain names in proper case: "Ethereum", "Polygon", "Arbitrum", "Optimism", "BSC", "Avalanche"
- Risk assessment based on TVL, audit status, time active, and category characteristics

The user might express risk analysis requests in various ways:
- "Is Aave safe to use?" → protocols: ["Aave"], riskCategories: ["smart_contract", "liquidity", "governance"]
- "Smart contract risks in DeFi lending" → analysisScope: "category", category: "Lending", riskCategories: ["smart_contract"]
- "Compare risk levels of Uniswap vs SushiSwap" → protocols: ["Uniswap", "SushiSwap"], analysisType: "comparison"
- "Liquidity risks in small cap protocols" → riskCategories: ["liquidity"], tvlFilter: "low", analysisScope: "market"
- "What are the governance risks in DeFi?" → riskCategories: ["governance"], analysisScope: "general"
- "Security audit status of top protocols" → riskCategories: ["smart_contract"], analysisScope: "market", focus: "audits"
- "Risk assessment for yield farming" → category: "Yield", riskCategories: ["smart_contract", "market"]

Extract and return ONLY a JSON object following DeFiLlama API format:
{
  "protocols": ["Protocol names if mentioned: Aave/Uniswap/Compound/Curve"],
  "riskCategories": ["smart_contract/liquidity/market/governance/regulatory/operational/technical"],
  "analysisScope": "specific/category/market/general (scope of analysis)",
  "analysisType": "assessment/comparison/overview/audit_review",
  "category": "Dexs/Lending/Liquid Staking/Derivatives if mentioned",
  "chains": ["Chain names if specified: Ethereum/Polygon/Arbitrum/Optimism/BSC/Avalanche"],
  "riskTolerance": "conservative/moderate/aggressive (user's risk preference)",
  "focus": "audits/tvl/governance/technical if specific focus mentioned",
  "timeframe": "current/historical if mentioned",
  "severity": "low/medium/high/all (level of risks to focus on)"
}

Return only the JSON object, no other text.`;

export const riskAnalysisAction: Action = {
  name: "RISK_ANALYSIS",
  similes: [
    "risk assessment",
    "safety analysis",
    "security review",
    "protocol risks",
    "smart contract risks",
    "liquidity risks",
    "investment safety",
    "due diligence",
    "risk evaluation",
    "security audit",
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
    "Use this action when you need to assess protocol or sector risks.",
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: any,
    options: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("[RISK_ANALYSIS] Starting risk analysis");

    try {
      const userQuestion = message.content.text || "";

      // Extract risk analysis criteria using LLM first, with fallback to regex
      let extractedParams: any;

      // Check if we have explicit params in options
      if (options?.riskParams) {
        extractedParams = options.riskParams;
      } else {
        // Use LLM to extract criteria from recent messages context
        const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
        const prompt = composePromptFromState({ state: composedState, template: extractRiskAnalysisTemplate });

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
              riskCategories: parsed.riskCategories || [
                "smart_contract",
                "liquidity",
                "market",
              ],
              analysisScope: parsed.analysisScope || "specific",
              analysisType: parsed.analysisType || "assessment",
              category: parsed.category || undefined,
              chains: parsed.chains || [],
              riskTolerance: parsed.riskTolerance || "moderate",
              focus: parsed.focus || undefined,
              timeframe: parsed.timeframe || "current",
              severity: parsed.severity || "all",
            };

            logger.info(
              `[RISK_ANALYSIS] LLM extracted params: ${JSON.stringify(extractedParams)}`,
            );
          } catch (parseError) {
            logger.warn(
              "Failed to parse LLM response, falling back to regex:",
              parseError instanceof Error ? parseError.message : String(parseError),
            );
            // Fallback to regex-based extraction
            const targetProtocols =
              extractProtocolsFromQueryLegacy(userQuestion);
            const riskCategories =
              extractRiskCategoriesFromQueryLegacy(userQuestion);
            extractedParams = {
              protocols: targetProtocols,
              riskCategories: riskCategories,
              analysisScope:
                targetProtocols.length > 0 ? "specific" : "general",
              analysisType: "assessment",
              category: undefined,
              chains: [],
              riskTolerance: "moderate",
              focus: undefined,
              timeframe: "current",
              severity: "all",
            };
          }
        } else {
          logger.warn(
            "[RISK_ANALYSIS] No LLM response received, falling back to regex",
          );
          // Fallback to regex-based extraction
          const targetProtocols = extractProtocolsFromQueryLegacy(userQuestion);
          const riskCategories =
            extractRiskCategoriesFromQueryLegacy(userQuestion);
          extractedParams = {
            protocols: targetProtocols,
            riskCategories: riskCategories,
            analysisScope: targetProtocols.length > 0 ? "specific" : "general",
            analysisType: "assessment",
            category: undefined,
            chains: [],
            riskTolerance: "moderate",
            focus: undefined,
            timeframe: "current",
            severity: "all",
          };
        }
      }

      logger.info(
        `[RISK_ANALYSIS] Analyzing risks for protocols: ${extractedParams.protocols.join(", ") || "general"}, categories: ${extractedParams.riskCategories.join(", ")}`,
      );

      // Fetch protocol data for risk analysis
      const defiLlamaService = runtime.getService<DefiLlamaService>(
        DefiLlamaService.serviceType,
      );

      if (!defiLlamaService) {
        throw new Error("DeFiLlama service not available");
      }

      let riskData: RiskDataCollection = {};

      if (extractedParams.protocols.length > 0) {
        // Fetch specific protocol data for risk analysis
        const protocolDataPromises = extractedParams.protocols.map(
          async (protocol: string) => {
            try {
              const protocolSlug = protocol.toLowerCase().replace(/\s+/g, "-");
              const protocolInfo =
                await defiLlamaService.getProtocol(protocolSlug);
              return { protocol, protocolInfo };
            } catch (error) {
              logger.warn(
                `[RISK_ANALYSIS] Failed to fetch data for ${protocol}: ${error}`,
              );
              return null;
            }
          },
        );

        const protocolResults = await Promise.allSettled(protocolDataPromises);
        riskData = {
          protocols: protocolResults
            .filter(
              (
                result,
              ): result is PromiseFulfilledResult<{
                protocol: string;
                protocolInfo: any;
              }> => result.status === "fulfilled" && result.value !== null,
            )
            .map((result) => result.value),
        };
      } else {
        // Fetch general market data for risk assessment
        const [protocols, chains] = await Promise.all([
          defiLlamaService.getProtocols(),
          defiLlamaService.getChains(),
        ]);

        // Filter by category if specified
        let filteredProtocols = protocols;
        if (extractedParams.category) {
          filteredProtocols = protocols.filter(
            (p: any) => p.category === extractedParams.category,
          );
        }

        riskData = {
          protocols: filteredProtocols.slice(0, 10).map((protocol) => ({
            protocol: protocol.name,
            protocolInfo: protocol,
          })),
        };
      }

      // Structure data for risk analysis using LLM extracted parameters
      const structuredData = buildRiskAnalysisDataLLM(
        riskData.protocols || [],
        extractedParams,
      );

      logger.info(
        "[RISK_ANALYSIS] Risk data fetched and structured successfully",
      );

      // Generate response using LLM
      const response = await runtime.useModel(ModelType.LARGE, {
        prompt: `Respond concisely with risk analysis based on data: ${JSON.stringify(structuredData)}

Question: ${userQuestion}

Provide insights on:
- Key risk factors and security concerns
- Protocol maturity and audit status
- Liquidity and market risks
- Smart contract risks and governance
- Recommendations for risk mitigation

Keep response focused, practical, and under 150 words.`,
        temperature: 0.7,
        stop: ["<END>"],
      });

      if (callback) {
        await callback({
          text: response || "Unable to analyze risks at this time.",
          actions: ['RISK_ANALYSIS'],
          source: message.content.source,
        });
      }

      return {
        text: response || "Risk analysis completed",
        success: true,
        data: {
          actionName: "RISK_ANALYSIS",
          extractedParams,
          structuredData,
          riskAnalysisCompleted: true,
          protocolsAnalyzed:
            extractedParams.protocols.length || "market overview",
          riskCategoriesUsed:
            extractedParams.riskCategories.join(", ") || "general",
          timestamp: Date.now(),
        },
      } as ActionResult;
    } catch (error) {
      const errorMessage = `Failed to analyze risks: ${error}`;
      logger.error(`[RISK_ANALYSIS] ${errorMessage}`);

      if (callback) {
        await callback({
          text: "I encountered an error while analyzing risks. Please try again.",
          source: "RISK_ANALYSIS",
        });
      }

      return {
        text: "Error analyzing risks. Please try again.",
        success: false,
        data: {
          actionName: "RISK_ANALYSIS",
          error: errorMessage,
          riskAnalysisCompleted: false,
          timestamp: Date.now(),
        },
      } as ActionResult;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: { text: "Is Aave safe to use? What are the main risks?" },
      },
      {
        name: "assistant",
        content: {
          text: "Here's a comprehensive risk analysis of Aave: [analysis based on latest protocol data]",
          source: "RISK_ANALYSIS",
        },
      },
    ],
    [
      {
        name: "user",
        content: {
          text: "What are the smart contract risks in DeFi lending protocols?",
        },
      },
      {
        name: "assistant",
        content: {
          text: "Here are the key smart contract risks in DeFi lending: [detailed risk breakdown]",
          source: "RISK_ANALYSIS",
        },
      },
    ],
    [
      {
        name: "user",
        content: { text: "Compare the risk levels of Uniswap vs SushiSwap" },
      },
      {
        name: "assistant",
        content: {
          text: "Here's a comparative risk analysis of Uniswap vs SushiSwap: [risk comparison]",
          source: "RISK_ANALYSIS",
        },
      },
    ],
  ],
};

// Helper functions for risk analysis data extraction and formatting

function buildRiskAnalysisDataLLM(
  data: RiskProtocolData[],
  params: any,
): StructuredRiskData {
  const result: StructuredRiskData = {
    targetProtocols:
      params.protocols.length > 0 ? params.protocols : "market overview",
    riskCategories: params.riskCategories,
    protocolRisks: [],
    marketRisks: null,
    summary: {
      totalProtocols: 0,
      riskLevels: { Low: 0, Medium: 0, High: 0 },
      analysisScope: params.analysisScope,
    },
  };

  if (data.length > 0) {
    if (params.protocols.length > 0) {
      // Process specific protocol risk data
      result.protocolRisks = data.map((item) => {
        const protocolInfo = item.protocolInfo;
        return {
          name: item.protocol,
          currentTvl: protocolInfo?.tvl || 0,
          category: protocolInfo?.category || "Unknown",
          chain: protocolInfo?.chains?.join(", ") || "Multi-chain",
          auditStatus:
            protocolInfo?.audits || protocolInfo?.audit_links?.length
              ? "Audited"
              : "Unknown",
          riskAssessment: assessProtocolRiskLLM(protocolInfo, params),
          governance: protocolInfo?.governanceID || "Not Available",
          timeActive: calculateTimeActiveLLM(protocolInfo?.listedAt || 0),
        };
      });
    } else {
      // Process market risk overview
      result.marketRisks = {
        protocols: data.slice(0, 10).map((protocol) => ({
          name: protocol.protocol,
          tvl: protocol.protocolInfo?.tvl || 0,
          category: protocol.protocolInfo?.category || "Unknown",
          riskLevel: assessGeneralRiskLLM(protocol.protocolInfo, params),
        })),
        marketTrends: {
          totalTvl: data.reduce(
            (sum: number, p) => sum + (p.protocolInfo?.tvl || 0),
            0,
          ),
          protocolCount: data.length,
          categories: [
            ...new Set(
              data
                .map((p) => p.protocolInfo?.category)
                .filter((cat): cat is string => Boolean(cat)),
            ),
          ],
        },
      };
    }

    result.summary.totalProtocols = data.length;
    result.summary.riskLevels = calculateRiskDistributionLLM(data, params);
  }

  return result;
}

function assessProtocolRiskLLM(
  protocolInfo: ProtocolInfo,
  params: any,
): RiskAssessmentFactors {
  const riskFactors = {
    smart_contract: "Medium", // Default
    liquidity: "Medium",
    market: "Medium",
    governance: "Medium",
  };

  // Assess smart contract risk with enhanced criteria
  if (protocolInfo?.audits || protocolInfo?.audit_links?.length) {
    riskFactors.smart_contract = "Low";
  } else if (
    protocolInfo?.listedAt &&
    Date.now() / 1000 - protocolInfo.listedAt > 365 * 24 * 3600
  ) {
    riskFactors.smart_contract = "Medium"; // Time-tested
  } else {
    riskFactors.smart_contract = "High";
  }

  // Enhanced liquidity risk assessment
  const tvl = protocolInfo?.tvl || 0;
  if (tvl > 5e9) {
    riskFactors.liquidity = "Low";
  } else if (tvl > 1e9) {
    riskFactors.liquidity = "Medium";
  } else if (tvl > 1e8) {
    riskFactors.liquidity =
      params.riskTolerance === "conservative" ? "High" : "Medium";
  } else {
    riskFactors.liquidity = "High";
  }

  // Enhanced market risk based on category and user tolerance
  const category = protocolInfo?.category?.toLowerCase() || "";
  if (category.includes("derivatives") || category.includes("leverage")) {
    riskFactors.market = "High";
  } else if (
    category.includes("lending") ||
    category.includes("liquid staking")
  ) {
    riskFactors.market =
      params.riskTolerance === "conservative" ? "Medium" : "Low";
  } else if (category.includes("dex")) {
    riskFactors.market = "Medium";
  } else {
    riskFactors.market = "Medium";
  }

  // Enhanced governance risk assessment using actual API data
  if (protocolInfo?.governanceID) {
    // Protocol has governance ID - suggests formal governance structure
    riskFactors.governance = "Low";
  } else if (protocolInfo?.oracles && protocolInfo.oracles.length > 0) {
    // Multiple oracles suggest better decentralization
    riskFactors.governance =
      protocolInfo.oracles.length >= 2 ? "Low" : "Medium";
  } else if (
    protocolInfo?.listedAt &&
    Date.now() / 1000 - protocolInfo.listedAt > 2 * 365 * 24 * 3600
  ) {
    // Long-standing protocols likely have better governance
    riskFactors.governance = "Medium";
  } else {
    riskFactors.governance =
      params.riskTolerance === "conservative" ? "High" : "Medium";
  }

  return {
    overall: calculateOverallRiskLLM(riskFactors, params),
    factors: riskFactors,
    confidence:
      (protocolInfo?.audits || protocolInfo?.audit_links?.length) && tvl > 1e9
        ? "High"
        : tvl > 1e8
          ? "Medium"
          : "Low",
  };
}

function assessGeneralRiskLLM(protocolInfo: ProtocolInfo, params: any): string {
  const tvl = protocolInfo?.tvl || 0;
  const category = protocolInfo?.category?.toLowerCase() || "";

  // Enhanced risk assessment based on user tolerance
  if (params.riskTolerance === "conservative") {
    if (tvl > 10e9 && !category.includes("derivatives")) return "Low";
    if (tvl > 2e9 && (category.includes("lending") || category.includes("dex")))
      return "Medium";
    return "High";
  } else if (params.riskTolerance === "aggressive") {
    if (tvl > 1e9) return "Low";
    if (tvl > 1e8) return "Medium";
    return "High";
  } else {
    // Moderate tolerance
    if (tvl > 5e9) return "Low";
    if (tvl > 1e9 && !category.includes("derivatives")) return "Medium";
    if (tvl > 1e8) return "Medium";
    return "High";
  }
}

function calculateTimeActiveLLM(listedAt: number): string {
  if (!listedAt) return "Unknown";

  const daysSince = (Date.now() / 1000 - listedAt) / 86400;

  if (daysSince > 730) return `${Math.floor(daysSince / 365)} years`;
  if (daysSince > 365) return `${Math.floor(daysSince / 365)} year`;
  if (daysSince > 60) return `${Math.floor(daysSince / 30)} months`;
  if (daysSince > 30) return `${Math.floor(daysSince / 30)} month`;
  return `${Math.floor(daysSince)} days`;
}

function calculateOverallRiskLLM(riskFactors: any, params: any): string {
  // Adjust weights based on user focus
  let weights = {
    smart_contract: 0.4,
    liquidity: 0.3,
    market: 0.2,
    governance: 0.1,
  };

  if (params.focus === "audits") {
    weights.smart_contract = 0.6;
    weights.liquidity = 0.2;
    weights.market = 0.1;
    weights.governance = 0.1;
  } else if (params.focus === "tvl") {
    weights.liquidity = 0.5;
    weights.smart_contract = 0.3;
    weights.market = 0.1;
    weights.governance = 0.1;
  } else if (params.focus === "governance") {
    weights.governance = 0.4;
    weights.smart_contract = 0.3;
    weights.liquidity = 0.2;
    weights.market = 0.1;
  }

  const riskScores = {
    Low: 1,
    Medium: 2,
    High: 3,
  };

  let weightedScore = 0;
  for (const [factor, risk] of Object.entries(riskFactors)) {
    const weight = weights[factor as keyof typeof weights] || 0.1;
    const score = riskScores[risk as keyof typeof riskScores] || 2;
    weightedScore += weight * score;
  }

  // Adjust thresholds based on user risk tolerance
  if (params.riskTolerance === "conservative") {
    if (weightedScore <= 1.3) return "Low";
    if (weightedScore <= 2.0) return "Medium";
    return "High";
  } else if (params.riskTolerance === "aggressive") {
    if (weightedScore <= 1.8) return "Low";
    if (weightedScore <= 2.7) return "Medium";
    return "High";
  } else {
    if (weightedScore <= 1.5) return "Low";
    if (weightedScore <= 2.5) return "Medium";
    return "High";
  }
}

function calculateRiskDistributionLLM(
  protocols: RiskProtocolData[],
  params: any,
): { Low: number; Medium: number; High: number } {
  const distribution = { Low: 0, Medium: 0, High: 0 };

  protocols.forEach((protocol) => {
    const risk = assessGeneralRiskLLM(protocol.protocolInfo, params);
    distribution[risk as keyof typeof distribution]++;
  });

  return distribution;
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
    gmx: "GMX",
    dydx: "dYdX",
  };

  for (const [keyword, protocol] of Object.entries(protocolKeywords)) {
    if (lowerQuery.includes(keyword)) {
      protocols.push(protocol);
    }
  }

  return protocols;
}

function extractRiskCategoriesFromQueryLegacy(query: string): string[] {
  const categories: string[] = [];
  const lowerQuery = query.toLowerCase();

  const riskCategoryKeywords = {
    smart_contract: [
      "smart contract",
      "contract risk",
      "code risk",
      "bug",
      "exploit",
    ],
    liquidity: ["liquidity", "liquidity risk", "slippage", "depth"],
    market: ["market risk", "price risk", "volatility", "correlation"],
    governance: ["governance", "governance risk", "centralization", "admin"],
    regulatory: ["regulatory", "compliance", "legal", "regulation"],
    operational: ["operational", "team risk", "founder", "development"],
    technical: ["technical", "infrastructure", "oracle", "bridge"],
  };

  for (const [category, keywords] of Object.entries(riskCategoryKeywords)) {
    if (keywords.some((keyword) => lowerQuery.includes(keyword))) {
      categories.push(category);
    }
  }

  // If no specific categories found, default to common ones
  if (categories.length === 0) {
    categories.push("smart_contract", "liquidity", "market");
  }

  return categories;
}
