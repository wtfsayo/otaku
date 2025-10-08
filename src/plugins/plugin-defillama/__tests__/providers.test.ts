import { describe, it, expect, beforeEach, mock } from "bun:test";
import { IAgentRuntime, Memory } from "@elizaos/core";
import { marketDataProvider } from "../src/providers/marketDataProvider";
import { stablecoinContextProvider } from "../src/providers/stablecoinContextProvider";
import { protocolSlugsProvider } from "../src/providers/protocolSlugsProvider";

// Mock services
const createMockServices = () => {
  const mockDefiLlamaService = {
    getProtocols: mock(async () => [
      {
        id: "aave",
        name: "Aave",
        slug: "aave",
        tvl: 12500000000,
        category: "Lending",
        chains: ["Ethereum", "Polygon", "Arbitrum"],
        change_1d: 2.3,
        change_7d: 5.7,
      },
      {
        id: "compound",
        name: "Compound",
        slug: "compound",
        tvl: 2800000000,
        category: "Lending",
        chains: ["Ethereum"],
        change_1d: -0.5,
        change_7d: 1.2,
      },
      {
        id: "sky-lending",
        name: "Sky Lending",
        slug: "sky-lending",
        tvl: 6200000000,
        category: "Lending",
        chains: ["Ethereum"],
        change_1d: 1.8,
        change_7d: 4.2,
      },
      {
        id: "uniswap",
        name: "Uniswap",
        slug: "uniswap",
        tvl: 5800000000,
        category: "Dexs",
        chains: ["Ethereum", "Polygon", "Arbitrum"],
        change_1d: 1.2,
        change_7d: 3.5,
      },
    ]),
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
    getTVL: mock(async () => ({
      totalLiquidityUSD: 48200000000,
    })),
    getStablecoins: mock(async () => [
      {
        id: "tether",
        name: "Tether",
        symbol: "USDT",
        circulating: { total: 89200000000 },
        circulatingPrevDay: { total: 89000000000 },
      },
      {
        id: "usd-coin",
        name: "USD Coin",
        symbol: "USDC",
        circulating: { total: 28400000000 },
        circulatingPrevDay: { total: 28300000000 },
      },
    ]),
    getBridges: mock(async () => [
      {
        id: 1,
        name: "Multichain",
        displayName: "Multichain",
        currentDayVolume: 45000000,
        chains: ["Ethereum", "BSC", "Polygon"],
      },
      {
        id: 2,
        name: "Hop Protocol",
        displayName: "Hop",
        currentDayVolume: 12000000,
        chains: ["Ethereum", "Arbitrum", "Optimism"],
      },
    ]),
    getDexVolumes: mock(async () => ({
      protocols: [
        {
          id: "uniswap",
          displayName: "Uniswap",
          total24h: 1200000000,
          change_1d: 5.3,
        },
        {
          id: "curve",
          displayName: "Curve",
          total24h: 650000000,
          change_1d: 8.7,
        },
      ],
    })),
    getProtocolFees: mock(async () => ({
      protocols: [
        {
          id: "uniswap",
          displayName: "Uniswap",
          total24h: 2400000,
          revenue24h: 1200000,
          change_1d: 12.5,
        },
        {
          id: "aave",
          displayName: "Aave",
          total24h: 1800000,
          revenue24h: 900000,
          change_1d: 3.2,
        },
      ],
    })),
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
        "coingecko:usd-coin": {
          decimals: 6,
          price: 1.0001,
          symbol: "USDC",
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

describe("marketDataProvider", () => {
  let runtime: IAgentRuntime;
  let services: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    services = createMockServices();
    runtime = createMockRuntime({
      defillama: services.defiLlamaService,
    });
  });

  it("should provide comprehensive market context", async () => {
    const message = createMockMessage("test");
    const context = await marketDataProvider.get(runtime, message, {
      values: {},
      data: {},
      text: "",
    });

    expect(context.text).toContain("DeFi Market Context");
    expect(context.text).toContain("Total DeFi TVL: $48.2B");
    expect(context.text).toContain("Active Protocols: 4");
    expect(context.text).toContain("Top 5 Protocols by TVL");
    expect(context.text).toContain("Aave: $12.5B");
    expect(context.text).toContain("Top 5 Chains by TVL");
    expect(context.text).toContain("Ethereum: $35.0B");
  });

  it("should handle service failures gracefully", async () => {
    const badRuntime = createMockRuntime({});
    const message = createMockMessage("test");
    const context = await marketDataProvider.get(badRuntime, message, {
      values: {},
      data: {},
      text: "",
    });

    expect(context.text).toBe("");
  });
});

describe("stablecoinContextProvider", () => {
  let runtime: IAgentRuntime;
  let services: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    services = createMockServices();
    runtime = createMockRuntime({
      defillama: services.defiLlamaService,
    });
  });

  it("should provide stablecoin market context", async () => {
    const message = createMockMessage("test");
    const context = await stablecoinContextProvider.get(runtime, message, {
      values: {},
      data: {},
      text: "",
    });

    expect(context.text).toContain("Stablecoin Market Context");
    expect(context.text).toContain("Total Market Cap");
    expect(context.text).toContain("Top Stablecoins");
    expect(context.text).toContain("USDT:");
    expect(context.text).toContain("USDC:");
    expect(context.text).toContain("Market Health");
  });
});

describe("protocolSlugsProvider", () => {
  let runtime: IAgentRuntime;
  let services: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    services = createMockServices();
    runtime = createMockRuntime({
      defillama: services.defiLlamaService,
    });
  });

  it("should provide protocol slug mappings", async () => {
    const message = createMockMessage("test");
    const context = await protocolSlugsProvider.get(runtime, message, {
      values: {},
      data: {},
      text: "",
    });

    expect(context.text).toContain("available protocols: 4");
    expect(context.text).toContain("Top 20 Available Protocols");
    expect(context.values.availableProtocols).toBe(4);
    expect(context.data.nameToSlug).toBeDefined();
    expect(context.data.slugToName).toBeDefined();
    expect(context.data.aliasToSlug).toBeDefined();
  });

  it("should detect protocol matches in message", async () => {
    const message = createMockMessage("What is the TVL of makerdao?");
    const context = await protocolSlugsProvider.get(runtime, message, {
      values: {},
      data: {},
      text: "",
    });

    expect(context.text).toContain("Protocol Matches Found");
    expect(context.values.hasMatches).toBe(true);
    expect(context.values.foundProtocols).toBeDefined();
    expect(Array.isArray(context.values.foundProtocols)).toBe(true);
  });

  it("should handle aave protocol detection", async () => {
    const message = createMockMessage("Show me aave data");
    const context = await protocolSlugsProvider.get(runtime, message, {
      values: {},
      data: {},
      text: "",
    });

    expect(context.text).toContain("Protocol Matches Found");
    expect(context.values.hasMatches).toBe(true);
    const foundProtocols = context.values.foundProtocols as any[];
    expect(foundProtocols.some(p => p.slug === "aave")).toBe(true);
  });

  it("should handle service failures gracefully", async () => {
    const badRuntime = createMockRuntime({});
    const message = createMockMessage("test");
    const context = await protocolSlugsProvider.get(badRuntime, message, {
      values: {},
      data: {},
      text: "",
    });

    expect(context.text).toBe("");
  });
});
