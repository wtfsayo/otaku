import {
  Provider,
  IAgentRuntime,
  Memory,
  State,
  ProviderResult,
  logger,
} from "@elizaos/core";
import { DefiLlamaService } from "../services/defiLlamaService";

export const marketDataProvider: Provider = {
  name: "MARKET_DATA_PROVIDER",
  description:
    "Use this provider when you need overall DeFi context (TVL, chains, sectors).",
  dynamic: true,
  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
  ): Promise<ProviderResult> => {
    try {
      const defiLlamaService = runtime.getService(
        "defillama",
      ) as DefiLlamaService;

      if (!defiLlamaService) {
        return {
          text: "",
          values: {},
          data: {},
        };
      }

      // Get comprehensive market data
      const [protocols, chains, tvlData] = await Promise.all([
        defiLlamaService.getProtocols(),
        defiLlamaService.getChains(),
        defiLlamaService.getTVL(),
      ]);

      // Process data for context
      const topProtocols = (protocols as any[])
        .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
        .slice(0, 10);

      const topChains = (chains as any[])
        .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
        .slice(0, 8);

      // Calculate sector distribution
      const sectors: Record<string, { tvl: number; count: number }> = {};
      for (const protocol of protocols as any[]) {
        const category = protocol.category || "Other";
        if (!sectors[category]) {
          sectors[category] = { tvl: 0, count: 0 };
        }
        sectors[category].tvl += protocol.tvl || 0;
        sectors[category].count++;
      }

      const topSectors = Object.entries(sectors)
        .sort(([, a], [, b]) => b.tvl - a.tvl)
        .slice(0, 6);

      const totalTvl = tvlData.totalLiquidityUSD || 0;

      const contextText = `DeFi Market Context:

Total DeFi TVL: $${formatNumber(totalTvl)}
Active Protocols: ${protocols.length}
Supported Chains: ${chains.length}

Top 5 Protocols by TVL:
${topProtocols.map((p, i) => `${i + 1}. ${p.name}: $${formatNumber(p.tvl || 0)}`).join("\n")}

Top 5 Chains by TVL:
${topChains.map((c, i) => `${i + 1}. ${c.name}: $${formatNumber(c.tvl || 0)}`).join("\n")}

Top Sectors by TVL:
${topSectors.map(([sector, data], i) => `${i + 1}. ${sector}: $${formatNumber(data.tvl)} (${data.count} protocols)`).join("\n")}

Market Health: ${getMarketHealth(protocols)}
Recent Activity: Active trading and liquidity flows across chains`;

      return {
        text: contextText,
        values: {
          totalTvl,
          protocolCount: protocols.length,
          chainCount: chains.length,
          topProtocols: topProtocols.slice(0, 5),
          topChains: topChains.slice(0, 5),
          topSectors: topSectors.slice(0, 3),
        },
        data: {
          protocols: topProtocols,
          chains: topChains,
          sectors: topSectors,
          marketHealth: getMarketHealth(protocols),
        },
      };
    } catch (error) {
      logger.error(
        "Error in market data provider:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        text: "",
        values: {},
        data: {},
      };
    }
  },
};

function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) return "N/A";
  if (num >= 1e9) return (num / 1e9).toFixed(1) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(1) + "M";
  if (num >= 1e3) return (num / 1e3).toFixed(1) + "K";
  return num.toFixed(0);
}

function getMarketHealth(protocols: any[]): string {
  if (protocols.length < 50) return "Limited";
  if (protocols.length < 200) return "Developing";
  if (protocols.length < 500) return "Healthy";
  return "Mature";
}
