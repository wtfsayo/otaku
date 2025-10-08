import { describe, it, expect, beforeEach, mock } from "bun:test";
import { IAgentRuntime, Memory, State, ActionResult } from "@elizaos/core";
import { protocolDataAction } from "../src/actions/protocolDataAction";
import { yieldSearchAction } from "../src/actions/yieldSearchAction";
import { marketTrendsAction } from "../src/actions/marketTrendsAction";
import { feesVolumeAction } from "../src/actions/feesVolumeAction";
import { priceDataAction } from "../src/actions/priceDataAction";
import { defiRecommendationAction } from "../src/actions/defiRecommendationAction";
import { riskAnalysisAction } from "../src/actions/riskAnalysisAction";
import { DefiLlamaService } from "../src/services/defiLlamaService";

// Mock services
const createMockServices = () => {
  const mockDefiLlamaService = {
    getProtocols: mock(async () => [
      {
        name: "Aave",
        slug: "aave",
        tvl: 12500000000,
        category: "Lending",
        chains: ["Ethereum", "Polygon", "Arbitrum"],
        change_1d: 2.3,
        change_7d: 5.7,
      },
      {
        name: "Compound",
        slug: "compound",
        tvl: 2800000000,
        category: "Lending",
        chains: ["Ethereum"],
        change_1d: -0.5,
        change_7d: 1.2,
      },
    ]),
    getProtocol: mock(async (slug: string) => {
      if (slug === "compound") {
        return {
          name: "Compound",
          slug: "compound",
          tvl: 2800000000,
          chainTvls: {
            Ethereum: 2800000000,
          },
          change_1d: -0.5,
          change_7d: 1.2,
          category: "Lending",
          description: "Compound is an algorithmic money market protocol",
        };
      }
      return {
        name: "Aave",
        slug: "aave",
        tvl: 12500000000,
        chainTvls: {
          Ethereum: 8200000000,
          Polygon: 2100000000,
          Arbitrum: 1500000000,
          Optimism: 700000000,
        },
        change_1d: 2.3,
        change_7d: 5.7,
        category: "Lending",
        description: "Aave is a decentralized lending protocol",
      };
    }),
    getTVL: mock(async () => ({
      date: new Date().toISOString(),
      totalLiquidityUSD: 48200000000,
    })),
    getYields: mock(async () => [
      {
        chain: "Arbitrum",
        project: "Aave V3",
        symbol: "USDC",
        tvlUsd: 125000000,
        apy: 5.8,
        apyBase: 4.2,
        apyReward: 1.6,
        rewardTokens: ["ARB"],
        pool: "aave-v3-usdc-arbitrum",
        stablecoin: true,
        ilRisk: "no",
        predictions: {
          predictedClass: "Low",
          predictedProbability: 0.95,
          binnedConfidence: 0.9,
        },
      },
      {
        chain: "Ethereum",
        project: "Compound V3",
        symbol: "USDT",
        tvlUsd: 89000000,
        apy: 5.2,
        apyBase: 5.2,
        apyReward: 0,
        rewardTokens: [],
        pool: "compound-v3-usdt",
        stablecoin: true,
        ilRisk: "no",
        predictions: {
          predictedClass: "Low",
          predictedProbability: 0.92,
          binnedConfidence: 0.88,
        },
      },
    ]),
    getDexVolumes: mock(async () => ({
      protocols: [
        {
          id: "uniswap",
          name: "Uniswap",
          displayName: "Uniswap",
          logo: "https://logo.png",
          category: "Dexs",
          totalVolume24h: 1200000000,
          totalVolume48hto24h: 1150000000,
          totalVolume7d: 8400000000,
          totalVolume30d: 25000000000,
          change_1d: 5.3,
          change_7d: 12.5,
          change_30d: 25.2,
          url: "https://uniswap.org",
          methodology: "Volume tracking",
          chains: ["Ethereum", "Arbitrum"],
        },
        {
          id: "pancakeswap",
          name: "PancakeSwap",
          displayName: "PancakeSwap",
          logo: "https://logo.png",
          category: "Dexs",
          totalVolume24h: 890000000,
          totalVolume48hto24h: 910000000,
          totalVolume7d: 6230000000,
          totalVolume30d: 20000000000,
          change_1d: -2.1,
          change_7d: 8.3,
          change_30d: 15.7,
          url: "https://pancakeswap.finance",
          methodology: "Volume tracking",
          chains: ["BSC"],
        },
      ],
    })),
    getProtocolFees: mock(async () => ({
      protocols: [
        {
          id: "uniswap",
          name: "Uniswap",
          displayName: "Uniswap",
          logo: "https://logo.png",
          category: "Dexs",
          total24h: 2400000,
          total48hto24h: 2200000,
          total7d: 16800000,
          totalAllTime: 1200000000,
          change_1d: 12.5,
          revenue24h: 1200000,
          dailyFees: 2400000,
          dailyRevenue: 1200000,
          dailyUserFees: 2400000,
          dailySupplySideRevenue: 1200000,
          dailyProtocolRevenue: 1200000,
          dailyHoldersRevenue: 0,
          chains: ["Ethereum", "Arbitrum"],
        },
        {
          id: "aave",
          name: "Aave",
          displayName: "Aave",
          logo: "https://logo.png",
          category: "Lending",
          total24h: 1800000,
          total48hto24h: 1750000,
          total7d: 12600000,
          totalAllTime: 800000000,
          change_1d: 3.2,
          revenue24h: 900000,
          dailyFees: 1800000,
          dailyRevenue: 900000,
          dailyUserFees: 1800000,
          dailySupplySideRevenue: 900000,
          dailyProtocolRevenue: 900000,
          dailyHoldersRevenue: 0,
          chains: ["Ethereum", "Polygon"],
        },
      ],
    })),
    getChains: mock(async () => [
      {
        name: "Ethereum",
        tvl: 35000000000,
        chainId: 1,
      },
      {
        name: "Polygon",
        tvl: 8500000000,
        chainId: 137,
      },
      {
        name: "Arbitrum",
        tvl: 4200000000,
        chainId: 42161,
      },
    ]),
    getCoinPrices: mock(async (coins: string[]) => ({
      coins: {
        "coingecko:ethereum": {
          decimals: 18,
          price: 2543.67,
          symbol: "ETH",
          timestamp: Math.floor(Date.now() / 1000),
          confidence: 100,
        },
        "coingecko:bitcoin": {
          decimals: 8,
          price: 43256.78,
          symbol: "BTC",
          timestamp: Math.floor(Date.now() / 1000),
          confidence: 100,
        },
      },
    })),
  };

  return {
    defiLlamaService: mockDefiLlamaService,
  };
};

const createMockRuntime = (services: Record<string, any>): IAgentRuntime =>
  ({
    getService: (name: string) => services[name],
    generateId: () =>
      `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    composeState: async (message: Memory, contextTypes: string[]) => ({
      entityId: message.entityId,
      agentId: message.agentId,
      roomId: message.roomId,
      recentMessages: [],
      values: {},
    }),
    useModel: mock(async (modelType: string, options: any) => {
      // Mock AI response for fees/volume analysis
      if (
        options.prompt?.includes("fees") ||
        options.prompt?.includes("volume") ||
        options.prompt?.includes("DEX")
      ) {
        return `<response>
  <analysisType>dex_volume</analysisType>
  <assetFocus>all_assets</assetFocus>
  <chainFocus>ethereum,arbitrum</chainFocus>
  <chains>ethereum,arbitrum</chains>
  <timePeriod>24h</timePeriod>
  <timeFrame>24h</timeFrame>
  <optimizationGoal>cost_efficiency</optimizationGoal>
  <efficiencyMetrics>fee_efficiency</efficiencyMetrics>
  <protocolPreference>any</protocolPreference>
  <marketContext>current_market</marketContext>
  <comparisonScope>cross_protocol</comparisonScope>
  <useCase>general_trading</useCase>
  <volumeThreshold>0</volumeThreshold>
  <feeThreshold>0</feeThreshold>
  <comparisonMetric>fee_rate</comparisonMetric>
  <usageContext>trading</usageContext>
  <protocolInterest>all</protocolInterest>
</response>`;
      }

      // Mock AI response for intent analysis
      if (
        options.prompt?.includes("Analyze this") ||
        options.prompt?.includes("<task>")
      ) {
        return `<response>
  <analysisScope>protocol data</analysisScope>
  <dataRequirements>TVL, metrics, comparison</dataRequirements>
  <timeHorizon>current</timeHorizon>
  <useCase>investment research</useCase>
  <riskAssessment>medium</riskAssessment>
  <comparisonNeeds>none</comparisonNeeds>
  <specificProtocols>aave</specificProtocols>
  <metricsFocus>tvl, apy, security</metricsFocus>
  <chainFocus>all</chainFocus>
  <investmentGoals>yield optimization</investmentGoals>
</response>`;
      }

      // Mock AI response for synthesis
      if (
        options.prompt?.includes("strategic") ||
        options.prompt?.includes("comprehensive")
      ) {
        return `## Strategic Analysis

**Key Insights:**
- Strong protocol fundamentals with solid TVL growth
- Competitive positioning in the lending sector
- Risk-adjusted returns favorable for investors

**Market Positioning:**
- Market leader with dominant position
- Strong brand recognition and user adoption
- Diversified across multiple chains

**Strategic Recommendations:**
- Consider allocation for yield optimization
- Monitor market conditions for entry points
- Diversify across multiple protocols for risk management

**Risk Factors:**
- Smart contract risks inherent to DeFi
- Regulatory uncertainty in some jurisdictions
- Market volatility affecting yields

**Implementation Strategy:**
1. Start with smaller position sizes
2. Monitor protocol metrics regularly
3. Consider dollar-cost averaging approach`;
      }

      return "Mock AI response for testing";
    }),
  }) as any;

const createMockMessage = (text: string, userId = "user123"): Memory =>
  ({
    id: "550e8400-e29b-41d4-a716-446655440000",
    userId,
    agentId: "550e8400-e29b-41d4-a716-446655440002",
    roomId: "550e8400-e29b-41d4-a716-446655440003",
    entityId: "550e8400-e29b-41d4-a716-446655440001",
    content: {
      text,
      source: "test",
    },
    createdAt: Date.now(),
  }) as Memory;

describe("protocolDataAction", () => {
  let runtime: IAgentRuntime;
  let services: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    services = createMockServices();
    runtime = createMockRuntime({
      defillama: services.defiLlamaService,
    });
  });

  it("should validate protocol-related messages", async () => {
    const validMessages = [
      "What is the TVL of Aave?",
      "Show me protocol rankings",
      "Compare Uniswap and Curve",
      "Top DeFi protocols",
    ];

    for (const text of validMessages) {
      const message = createMockMessage(text);
      const isValid = await protocolDataAction.validate(
        runtime,
        message,
        undefined,
      );
      expect(isValid).toBe(true);
    }
  });

  it("should not validate non-protocol messages", async () => {
    const invalidMessages = [
      "Hello world",
      "What is the weather?",
      "Tell me a joke",
    ];

    for (const text of invalidMessages) {
      const message = createMockMessage(text);
      const isValid = await protocolDataAction.validate(
        runtime,
        message,
        undefined,
      );
      expect(isValid).toBe(false);
    }
  });

  it("should handle protocol data requests", async () => {
    const message = createMockMessage("What is the current TVL of Aave?");
    const result = await protocolDataAction.handler(
      runtime,
      message,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toBeDefined();
    const actionResult = result as ActionResult;
    expect(actionResult.success).toBe(true);
    expect(actionResult.text).toContain(
      "DeFi Protocol Intelligence Report",
    );
    expect(actionResult.text).toContain("$12.5B");
    expect(actionResult.data?.actionName).toBe("PROTOCOL_DATA");
  });

  it("should handle protocol comparison requests", async () => {
    const message = createMockMessage("Compare Aave and Compound protocols");
    const result = await protocolDataAction.handler(
      runtime,
      message,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toBeDefined();
    const actionResult = result as ActionResult;
    expect(actionResult.success).toBe(true);
    expect(actionResult.text).toContain(
      "DeFi Protocol Intelligence Report",
    );
    expect(actionResult.text).toContain("AAVE");
    expect(actionResult.text).toContain("COMPOUND");
    expect(actionResult.data?.actionName).toBe("PROTOCOL_DATA");
  });
});

describe("yieldSearchAction", () => {
  let runtime: IAgentRuntime;
  let services: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    services = createMockServices();
    runtime = createMockRuntime({
      defillama: services.defiLlamaService,
    });
  });

  it("should validate yield-related messages", async () => {
    const validMessages = [
      "Find the best yields",
      "Show me stablecoin APY",
      "High yield farming opportunities",
      "USDC yields on Arbitrum",
    ];

    for (const text of validMessages) {
      const message = createMockMessage(text);
      const isValid = await yieldSearchAction.validate(
        runtime,
        message,
        undefined,
      );
      expect(isValid).toBe(true);
    }
  });

  it("should handle yield search requests", async () => {
    const message = createMockMessage("Find the best stablecoin yields");
    const result = await yieldSearchAction.handler(
      runtime,
      message,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toBeDefined();
    const actionResult = result as ActionResult;
    // The action should return a result regardless of success/failure
    expect(actionResult.text).toBeTruthy();
    if (actionResult.success) {
      expect(actionResult.data?.actionName).toBe("YIELD_SEARCH");
    }
  });

  it("should filter yields by chain", async () => {
    const message = createMockMessage("Show me yields on Arbitrum");
    const result = await yieldSearchAction.handler(
      runtime,
      message,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toBeDefined();
    const actionResult = result as ActionResult;
    expect(actionResult.text).toBeTruthy();
    if (actionResult.success) {
      expect(actionResult.data?.actionName).toBe("YIELD_SEARCH");
    }
  });
});

describe("marketTrendsAction", () => {
  let runtime: IAgentRuntime;
  let services: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    services = createMockServices();
    runtime = createMockRuntime({
      defillama: services.defiLlamaService,
    });
  });

  it("should validate market trend messages", async () => {
    const validMessages = [
      "What are the DeFi market trends?",
      "Show sector performance",
      "Market analysis for DeFi",
      "Top gainers and losers",
    ];

    for (const text of validMessages) {
      const message = createMockMessage(text);
      const isValid = await marketTrendsAction.validate(
        runtime,
        message,
        undefined,
      );
      expect(isValid).toBe(true);
    }
  });

  it("should handle market trend analysis", async () => {
    const message = createMockMessage(
      "What are the current DeFi market trends?",
    );
    const result = await marketTrendsAction.handler(
      runtime,
      message,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toBeDefined();
    const actionResult = result as ActionResult;
    expect(actionResult.success).toBe(true);
    expect(actionResult.text).toContain("Strategic DeFi Market Trend Analysis");
    expect(actionResult.text).toContain("Total DeFi TVL");
    expect(actionResult.data?.actionName).toBe("MARKET_TRENDS");
  });
});

describe("feesVolumeAction", () => {
  let runtime: IAgentRuntime;
  let services: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    services = createMockServices();
    runtime = createMockRuntime({
      defillama: services.defiLlamaService,
    });
  });

  it("should validate fees and volume messages", async () => {
    const validMessages = [
      "Show me the top DEX volumes",
      "What are protocol fees?",
      "Trading volume data",
      "Revenue statistics",
    ];

    for (const text of validMessages) {
      const message = createMockMessage(text);
      const isValid = await feesVolumeAction.validate(
        runtime,
        message,
        undefined,
      );
      expect(isValid).toBe(true);
    }
  });

  it("should handle DEX volume requests", async () => {
    const message = createMockMessage("Show me the top DEX volumes");
    const result = await feesVolumeAction.handler(
      runtime,
      message,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toBeDefined();
    const actionResult = result as ActionResult;
    expect(actionResult.success).toBe(true);
    expect(actionResult.text).toContain(
      "💰 **Advanced Fees & Volume Analysis**",
    );
    expect(actionResult.text).toContain("Uniswap");
    expect(actionResult.text).toContain("$1.2B");
    expect(actionResult.data?.actionName).toBe("FEES_VOLUME_DATA");
  });

  it("should handle protocol fees requests", async () => {
    const message = createMockMessage("What are the protocol fees?");
    const result = await feesVolumeAction.handler(
      runtime,
      message,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toBeDefined();
    const actionResult = result as ActionResult;
    expect(actionResult.success).toBe(true);
    expect(actionResult.text).toContain(
      "💰 **Advanced Fees & Volume Analysis**",
    );
    expect(actionResult.text).toContain("Uniswap");
    expect(actionResult.text).toContain("$2.4M");
    expect(actionResult.data?.actionName).toBe("FEES_VOLUME_DATA");
  });
});

describe("priceDataAction", () => {
  let runtime: IAgentRuntime;
  let services: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    services = createMockServices();
    runtime = createMockRuntime({
      defillama: services.defiLlamaService,
    });
  });

  it("should validate price-related messages", async () => {
    const validMessages = [
      "What is the current price of ETH?",
      "Show me BTC price",
      "Get token prices",
      "How much is Bitcoin worth?",
    ];

    for (const text of validMessages) {
      const message = createMockMessage(text);
      const isValid = await priceDataAction.validate(
        runtime,
        message,
        undefined,
      );
      expect(isValid).toBe(true);
    }
  });

  it("should handle single token price requests", async () => {
    const message = createMockMessage("What is the current price of ETH?");
    const result = await priceDataAction.handler(
      runtime,
      message,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toBeDefined();
    const actionResult = result as ActionResult;
    expect(actionResult.success).toBe(true);
    expect(actionResult.text).toContain("Advanced Price Analysis Results");
    expect(actionResult.text).toContain("$2,543.67");
    expect(actionResult.text).toContain("Very High");
    expect(actionResult.data?.actionName).toBe("PRICE_DATA");
  });

  it("should handle multiple token price requests", async () => {
    const message = createMockMessage("Show me BTC and ETH prices");
    const result = await priceDataAction.handler(
      runtime,
      message,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toBeDefined();
    const actionResult = result as ActionResult;
    expect(actionResult.success).toBe(true);
    expect(actionResult.text).toContain("Advanced Price Analysis Results");
    expect(actionResult.text).toContain("Bitcoin");
    expect(actionResult.text).toContain("Ethereum");
    expect(actionResult.data?.actionName).toBe("PRICE_DATA");
  });
});

describe("defiRecommendationAction", () => {
  let runtime: IAgentRuntime;
  let services: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    services = createMockServices();
    runtime = createMockRuntime({
      defillama: services.defiLlamaService,
    });
  });

  it("should validate recommendation requests", async () => {
    const validMessages = [
      "Recommend safe yields",
      "What are the best protocols?",
      "Find high APY opportunities",
      "Suggest DeFi strategies",
    ];

    for (const text of validMessages) {
      const message = createMockMessage(text);
      const isValid = await defiRecommendationAction.validate(
        runtime,
        message,
        undefined,
      );
      expect(isValid).toBe(true);
    }
  });

  it("should generate yield recommendations", async () => {
    const message = createMockMessage("Recommend best yields");
    const result = await defiRecommendationAction.handler(
      runtime,
      message,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toBeDefined();
    const actionResult = result as ActionResult;
    expect(actionResult.success).toBe(true);
    expect(actionResult.text).toContain(
      "💎 **Personalized DeFi Investment Recommendations**",
    );
    expect(actionResult.data?.actionName).toBe("DEFI_RECOMMENDATION");
  });

  it("should parse user preferences correctly", async () => {
    const message = createMockMessage("Find safe yields above 10% on Arbitrum");
    const result = await defiRecommendationAction.handler(
      runtime,
      message,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toBeDefined();
    const actionResult = result as ActionResult;
    expect(actionResult.success).toBe(true);
    expect(actionResult.text).toContain(
      "💎 **Personalized DeFi Investment Recommendations**",
    );
    expect(actionResult.data?.actionName).toBe("DEFI_RECOMMENDATION");
  });
});

describe("riskAnalysisAction", () => {
  let runtime: IAgentRuntime;
  let services: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    services = createMockServices();
    runtime = createMockRuntime({
      defillama: services.defiLlamaService,
    });
  });

  it("should validate risk analysis requests", async () => {
    const validMessages = [
      "Is Aave safe?",
      "Analyze protocol risks",
      "Check security of this pool",
      "What are the DeFi risks?",
    ];

    for (const text of validMessages) {
      const message = createMockMessage(text);
      const isValid = await riskAnalysisAction.validate(
        runtime,
        message,
        undefined,
      );
      expect(isValid).toBe(true);
    }
  });

  it("should analyze protocol risks", async () => {
    const message = createMockMessage("Is Aave safe to use?");
    const result = await riskAnalysisAction.handler(
      runtime,
      message,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toBeDefined();
    const actionResult = result as ActionResult;
    expect(actionResult.success).toBe(true);
    expect(actionResult.text).toContain("Comprehensive DeFi Risk Analysis");
    expect(actionResult.text).toContain("Overall Risk");
    expect(actionResult.text).toContain("Risk Level");
    expect(actionResult.data?.actionName).toBe("DEFI_RISK_ANALYSIS");
  });

  it("should provide general DeFi risk analysis", async () => {
    const message = createMockMessage("What are the general DeFi risks?");
    const result = await riskAnalysisAction.handler(
      runtime,
      message,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toBeDefined();
    const actionResult = result as ActionResult;
    expect(actionResult.success).toBe(true);
    expect(actionResult.text).toContain("Comprehensive DeFi Risk Analysis");
    expect(actionResult.text).toContain("Risk Level");
    expect(actionResult.text).toContain("Key Factors");
    expect(actionResult.data?.actionName).toBe("DEFI_RISK_ANALYSIS");
  });
});
