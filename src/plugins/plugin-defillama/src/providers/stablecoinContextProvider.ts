import {
  Provider,
  IAgentRuntime,
  Memory,
  State,
  ProviderResult,
  logger,
} from "@elizaos/core";
import { DefiLlamaService } from "../services/defiLlamaService";

export const stablecoinContextProvider: Provider = {
  name: "STABLECOIN_CONTEXT_PROVIDER",
  description:
    "Use this provider when you need a stablecoin market overview.",
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

      // Get stablecoin market data
      const stablecoins = await defiLlamaService.getStablecoins();

      if (!stablecoins || stablecoins.length === 0) {
        return {
          text: "",
          values: {},
          data: {},
        };
      }

      // Process stablecoin data
      const processedStables = stablecoins.map((coin: any) => {
        const current = Object.values(coin.circulating || {}).reduce<number>(
          (total: number, value: unknown) =>
            total + (typeof value === "number" ? value : 0),
          0,
        );
        const prevDay = Object.values(coin.circulatingPrevDay || {}).reduce<number>(
          (total: number, value: unknown) =>
            total + (typeof value === "number" ? value : 0),
          0,
        );
        const change24h =
          prevDay > 0 ? ((current - prevDay) / prevDay) * 100 : 0;

        return {
          symbol: coin.symbol,
          name: coin.name,
          mcap: current,
          change24h,
          pegType: coin.pegType || "USD",
          mechanism: coin.pegMechanism || "Collateralized",
        };
      });

      const topStables = processedStables
        .sort((a, b) => b.mcap - a.mcap)
        .slice(0, 6);

      const totalStableMarket = topStables.reduce((sum, s) => sum + s.mcap, 0);

      // Calculate dominance and health metrics
      const usdtDominance =
        topStables.find((s) => s.symbol === "USDT")?.mcap || 0;
      const usdcShare = topStables.find((s) => s.symbol === "USDC")?.mcap || 0;
      const dominanceRatio =
        ((usdtDominance + usdcShare) / totalStableMarket) * 100;

      const contextText = `Stablecoin Market Context:

Total Market Cap: $${formatNumber(totalStableMarket)}
Market Concentration: ${dominanceRatio.toFixed(1)}% (USDT+USDC)

Top Stablecoins:
${topStables
  .map((s, i) => {
    const share = ((s.mcap / totalStableMarket) * 100).toFixed(1);
    const change = s.change24h ? formatChange(s.change24h) : "N/A";
    return `${i + 1}. ${s.symbol}: $${formatNumber(s.mcap)} (${share}%) ${change}`;
  })
  .join("\n")}

Market Health: ${getStableMarketHealth(dominanceRatio, topStables.length)}
Peg Mechanisms: Diverse (Collateralized, Algorithmic, Hybrid)
Risk Assessment: ${getRiskAssessment(dominanceRatio)}`;

      return {
        text: contextText,
        values: {
          totalMarketCap: totalStableMarket,
          dominanceRatio,
          topStablecoins: topStables,
        },
        data: {
          stablecoins: processedStables,
          marketHealth: getStableMarketHealth(
            dominanceRatio,
            topStables.length,
          ),
          riskAssessment: getRiskAssessment(dominanceRatio),
        },
      };
    } catch (error) {
      logger.error(
        "Error in stablecoin context provider:",
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

function formatNumber(num: number): string {
  if (num >= 1e9) return (num / 1e9).toFixed(1) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(1) + "M";
  if (num >= 1e3) return (num / 1e3).toFixed(1) + "K";
  return num.toFixed(0);
}

function formatChange(change: number): string {
  const sign = change >= 0 ? "+" : "";
  return `(${sign}${change.toFixed(2)}%)`;
}

function getStableMarketHealth(
  dominance: number,
  totalStables: number,
): string {
  if (dominance > 95) return "Highly Concentrated";
  if (dominance > 85) return "Moderately Concentrated";
  if (dominance > 75) return "Balanced";
  return "Decentralized";
}

function getRiskAssessment(dominance: number): string {
  if (dominance > 90) return "High concentration risk";
  if (dominance > 80) return "Moderate concentration risk";
  return "Well-distributed risk";
}
