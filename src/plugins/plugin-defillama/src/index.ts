/**
 * @module plugin-defillama
 * @description DeFiLlama plugin for ElizaOS - provides DeFi market data, analytics, and yield information
 */

import { Plugin, logger } from "@elizaos/core";
import { z } from "zod";

// Services
import { DefiLlamaService } from "./services/defiLlamaService";

// Actions
import { protocolDataAction } from "./actions/protocolDataAction";
import { yieldSearchAction } from "./actions/yieldSearchAction";
import { marketTrendsAction } from "./actions/marketTrendsAction";
import { historicalDataAction } from "./actions/historicalDataAction";
import { crossChainAction } from "./actions/crossChainAction";
import { feesVolumeAction } from "./actions/feesVolumeAction";
import { priceDataAction } from "./actions/priceDataAction";
import { defiRecommendationAction } from "./actions/defiRecommendationAction";
import { riskAnalysisAction } from "./actions/riskAnalysisAction";
import { stablecoinAction } from "./actions/stablecoinAction";

// Providers (Essential context only - Actions handle user interactions via Services)
import { marketDataProvider } from "./providers/marketDataProvider";
import { stablecoinContextProvider } from "./providers/stablecoinContextProvider";
import { protocolSlugsProvider } from "./providers/protocolSlugsProvider";

// Export types for external use
export * from "./types";
export { DefiLlamaService };

/**
 * Configuration schema for the DeFiLlama plugin
 */
const configSchema = z.object({
  DEFILLAMA_API_KEY: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) {
        logger.info("No DeFiLlama API key provided - using public endpoints");
      }
      return val;
    }),
  RATE_LIMIT_PER_MINUTE: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : 300)),
  MAX_CONCURRENT_REQUESTS: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : 10)),
});

/**
 * DeFiLlama plugin for ElizaOS
 *
 * Provides comprehensive DeFi market data, protocol analytics, yield information,
 * and monitoring capabilities through the DeFiLlama API.
 */
export const defiLlamaPlugin: Plugin = {
  name: "plugin-defillama",
  description:
    "DeFiLlama integration for DeFi market data, analytics, and yield information",

  config: {
    DEFILLAMA_API_KEY: process.env.DEFILLAMA_API_KEY,
    RATE_LIMIT_PER_MINUTE: process.env.RATE_LIMIT_PER_MINUTE,
    MAX_CONCURRENT_REQUESTS: process.env.MAX_CONCURRENT_REQUESTS,
  },

  async init(config: Record<string, string>): Promise<void> {
    logger.info("Initializing DeFiLlama plugin");

    try {
      const validatedConfig = await configSchema.parseAsync(config);

      // Set environment variables from validated config
      for (const [key, value] of Object.entries(validatedConfig)) {
        if (value !== undefined) {
          process.env[key] = String(value);
        }
      }

      logger.info(
        `DeFiLlama plugin configuration loaded: rateLimitPerMinute=${validatedConfig.RATE_LIMIT_PER_MINUTE}`,
      );

      // Ensure promise resolves
      return Promise.resolve();
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          `Invalid DeFiLlama plugin configuration: ${error.errors.map((e) => e.message).join(", ")}`,
        );
      }
      throw error;
    }
  },

  services: [DefiLlamaService],

  actions: [
    protocolDataAction,
    yieldSearchAction,
    marketTrendsAction,
    historicalDataAction,
    crossChainAction,
    feesVolumeAction,
    priceDataAction,
    defiRecommendationAction,
    riskAnalysisAction,
    stablecoinAction,
  ],

  providers: [
    marketDataProvider,
    stablecoinContextProvider,
    protocolSlugsProvider,
  ],

  evaluators: [],

  // Plugin metadata
  routes: [],
  events: {},
};

export default defiLlamaPlugin;
