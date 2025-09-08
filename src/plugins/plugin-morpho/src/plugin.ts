import type { Plugin, IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { z } from "zod";

// Import services
import { MorphoService } from "./services";

// Import actions
import {
  marketInfoAction,
  marketPositionsAction,
  marketTransferAction,
  vaultPositionsAction,
  vaultInfoAction,
  vaultTransferAction,
} from "./actions";

// Import providers
// import { marketDataProvider, positionProvider } from './providers';

// Configuration schema
const configSchema = z.object({
  MORPHO_API_KEY: z
    .string()
    .optional()
    .describe("API key for Morpho protocol access"),

  BASE_RPC_URL: z
    .string()
    .min(1, "Base RPC URL is required")
    .describe("Base L2 RPC endpoint URL"),

  MORPHO_NETWORK: z
    .enum(["base", "base-sepolia"])
    .optional()
    .default("base")
    .describe("Network to use (base or base-sepolia)"),

  MAX_GAS_FOR_MATCHING: z
    .string()
    .optional()
    .default("500000")
    .describe("Maximum gas to spend on P2P matching"),

  MATCHING_EFFICIENCY_THRESHOLD: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.7)
    .describe("Minimum efficiency threshold for P2P matching"),

  RATE_IMPROVEMENT_THRESHOLD: z
    .number()
    .min(0)
    .optional()
    .default(0.1)
    .describe("Minimum rate improvement threshold"),

  MAX_GAS_PRICE: z
    .string()
    .optional()
    .default("50000000000")
    .describe("Maximum gas price in wei"),

  RETRY_ATTEMPTS: z
    .number()
    .min(0)
    .max(10)
    .optional()
    .default(3)
    .describe("Number of retry attempts for failed operations"),

  MONITORING_INTERVAL: z
    .number()
    .min(0)
    .optional()
    .default(60000)
    .describe("Position monitoring interval in milliseconds"),
});

type MorphoPluginConfig = z.infer<typeof configSchema>;

export const morphoPlugin: Plugin = {
  name: "plugin-morpho",
  description:
    "Morpho protocol integration for optimized lending and borrowing through peer-to-peer matching",

  config: {
    MORPHO_API_KEY: process.env.MORPHO_API_KEY,
    BASE_RPC_URL: process.env.BASE_RPC_URL,
    MORPHO_NETWORK: process.env.MORPHO_NETWORK,
    MAX_GAS_FOR_MATCHING: process.env.MAX_GAS_FOR_MATCHING,
    MATCHING_EFFICIENCY_THRESHOLD: process.env.MATCHING_EFFICIENCY_THRESHOLD
      ? parseFloat(process.env.MATCHING_EFFICIENCY_THRESHOLD)
      : undefined,
    RATE_IMPROVEMENT_THRESHOLD: process.env.RATE_IMPROVEMENT_THRESHOLD
      ? parseFloat(process.env.RATE_IMPROVEMENT_THRESHOLD)
      : undefined,
    MAX_GAS_PRICE: process.env.MAX_GAS_PRICE,
    RETRY_ATTEMPTS: process.env.RETRY_ATTEMPTS
      ? parseInt(process.env.RETRY_ATTEMPTS, 10)
      : undefined,
    MONITORING_INTERVAL: process.env.MONITORING_INTERVAL
      ? parseInt(process.env.MONITORING_INTERVAL, 10)
      : undefined,
  },

  async init(config: Record<string, any>): Promise<void> {
    logger.info("Initializing Morpho plugin...");

    try {
      // Validate configuration
      const validatedConfig = await configSchema.parseAsync(config);

      // Set all environment variables at once
      for (const [key, value] of Object.entries(validatedConfig)) {
        if (value !== undefined && value !== null) {
          process.env[key] = String(value);
        }
      }

      logger.info("Morpho plugin configuration validated successfully");
      logger.info(`Network: ${validatedConfig.MORPHO_NETWORK}`);
      logger.info(`RPC URL: ${validatedConfig.BASE_RPC_URL}`);
      logger.info(
        `Matching threshold: ${validatedConfig.MATCHING_EFFICIENCY_THRESHOLD}`,
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ");
        throw new Error(
          `Invalid Morpho plugin configuration: ${errorMessages}`,
        );
      }
      throw error;
    }
  },

  // Services that manage state and external integrations
  services: [MorphoService],

  // Actions that handle user commands
  actions: [
    marketInfoAction,
    marketPositionsAction,
    marketTransferAction,
    vaultPositionsAction,
    vaultInfoAction,
    vaultTransferAction,
  ],

  // Providers that supply read-only context
  providers: [
    // marketDataProvider,
    // positionProvider
  ],

  // Evaluators for post-interaction analysis
  evaluators: [],
};

export default morphoPlugin;
