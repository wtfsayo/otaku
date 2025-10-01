import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  ModelType,
  State,
  logger,
  parseKeyValueXml,
} from "@elizaos/core";
import { z } from "zod";
import { TokenDeploySchema } from "../types";
import { ClankerService } from "../services/clanker.service";
import { shortenAddress } from "../utils/format";
import { handleError } from "../utils/errors";
import { getEntityWallet } from "../../../../utils/entity";
import {
  createWalletClient,
  createPublicClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// Utility function to safely serialize objects with BigInt values
function safeStringify(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "bigint") {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map(safeStringify);
  }

  if (typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = safeStringify(value);
    }
    return result;
  }

  return obj;
}

export function getTokenDeployXmlPrompt(userMessage: string): string {
  return `<task>Extract structured token deployment parameters from the user's message.</task>

<message>
${userMessage}
</message>

<instructions>
You MUST extract only the token-related deployment parameters from the message. Return the output using this exact XML format. Do NOT add explanations.

Only include fields that are present or clearly implied in the user's message. All fields are optional EXCEPT for name and symbol, which are REQUIRED.

Respond with:

<deploy>
  <name>Token name (required, max 50 chars)</name>
  <symbol>Token symbol (required, all uppercase, 2–10 chars)</symbol>
  <vanity>true|false (optional)</vanity>
  <image>ipfs://... (optional)</image>
  <description>Token description (optional)</description>
  <socialMediaUrls>
    <url>https://... (optional)</url>
    ...
  </socialMediaUrls>
  <devBuy>0.05</devBuy> <!-- Optional float -->
</deploy>

IMPORTANT:
- Use <vanity>true</vanity> only if the message clearly asks for a vanity/custom address.
- Use <image> only if an IPFS URL is provided.
- Include <devBuy> only if user mentions dev or initial buy ETH amount.
- socialMediaUrls may include website, Twitter, etc. as individual <url> tags.
- Do NOT wrap the entire response in a code block.
- DO NOT include any other tags or explanations — return ONLY the <deploy> block.
</instructions>`;
}

export const tokenDeployAction: Action = {
  name: "DEPLOY_TOKEN",
  similes: ["CREATE_TOKEN", "LAUNCH_TOKEN", "MINT_TOKEN"],
  description: "Deploy a new token on Base L2 using Clanker protocol",

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
  ): Promise<boolean> => {
    try {
      // Check if services are available
      const clankerService = runtime.getService(
        ClankerService.serviceType,
      ) as ClankerService;

      if (!clankerService) {
        logger.warn("Required services not available for token deployment");
        return false;
      }

      // Extract text content
      const text = message.content.text?.toLowerCase() || "";

      // Check for deployment keywords
      const deploymentKeywords = [
        "deploy",
        "create",
        "launch",
        "mint",
        "token",
      ];
      const hasDeploymentIntent = deploymentKeywords.some((keyword) =>
        text.includes(keyword),
      );

      return hasDeploymentIntent;
    } catch (error) {
      logger.error(
        "Error validating token deployment action:",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: any,
    callback?: HandlerCallback,
    _responses?: Memory[],
  ): Promise<ActionResult> => {
    try {
      logger.info("Handling DEPLOY_TOKEN action");

      // Get entity wallet address
      const walletResult = await getEntityWallet(
        runtime,
        message,
        "DEPLOY_TOKEN",
        callback,
      );
      if (!walletResult.success) {
        return walletResult.result;
      }

      // Get services
      const clankerService = runtime.getService(
        ClankerService.serviceType,
      ) as ClankerService;

      if (!clankerService) {
        throw new Error("Required services not available");
      }

      // Parse parameters from message
      const text = message.content.text || "";
      const prompt = getTokenDeployXmlPrompt(text);
      const response = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });

      logger.info(`Model response for token deployment: ${response}`);

      const parsed = parseKeyValueXml(response);

      if (!parsed) {
        logger.error(
          `Failed to parse token deployment parameters from message. Parsed: ${JSON.stringify(parsed)}, Response: ${response}, Text: ${text}`,
        );
        throw new Error(
          "Failed to parse token deployment parameters from message. Please provide token name and symbol clearly.",
        );
      }

      logger.info("Parsed token deployment parameters:", safeStringify(parsed));

      const params = mapXmlDeployFields(parsed);

      // Validate parameters
      const validation = TokenDeploySchema.safeParse(params);
      if (!validation.success) {
        const errors = validation.error.issues
          .map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`)
          .join(", ");
        throw new Error(`Invalid parameters: ${errors}`);
      }

      const deployParams = validation.data;

      // Build viem clients (CDP or private key), then deploy via a single method
      let walletClient: any;
      let publicClient: any;

      
      const cdpService: any = runtime.getService("CDP_SERVICE" as any);
      if (!cdpService || typeof cdpService.getViemClientsForAccount !== "function") {
        throw new Error("CDP not available");
      }
      const viemClient = await cdpService.getViemClientsForAccount({
        accountName: message.entityId,
        network: "base",
      });
      walletClient = viemClient.walletClient;
      publicClient = viemClient.publicClient;
     

      const result = await clankerService.deployTokenWithClient(
        {
          name: deployParams.name,
          symbol: deployParams.symbol,
          vanity: deployParams.vanity,
          image: deployParams.image,
          metadata: deployParams.metadata,
          context: deployParams.context,
          pool: deployParams.pool,
          fees: deployParams.fees,
          rewards: deployParams.rewards,
          vault: deployParams.vault,
          devBuy: deployParams.devBuy,
        },
        walletClient,
        publicClient,
      );

      // Prepare response
      const responseText =
        `✅ Token deployed successfully!\n\n` +
        `Token: ${deployParams.name} (${deployParams.symbol})\n` +
        `Contract: ${shortenAddress(result.contractAddress)}\n` +
        `Total Supply: 1,000,000,000 ${deployParams.symbol} (1B tokens)\n` +
        `Transaction: ${shortenAddress(result.transactionHash)}\n` +
        `View on Clanker World: https://clanker.world/clanker/${result.contractAddress}\n` +
        `View on BaseScan: https://basescan.org/token/${result.contractAddress}`;

      if (callback) {
        await callback({
          text: responseText,
          actions: ["DEPLOY_TOKEN"],
          source: message.content.source,
        });
      }

      return {
        text: responseText,
        success: true,
        values: {
          tokenDeployed: true,
          contractAddress: result.contractAddress,
        },
        data: safeStringify({
          actionName: "DEPLOY_TOKEN",
          contractAddress: result.contractAddress,
          transactionHash: result.transactionHash,
          tokenId: result.tokenId,
          deploymentCost: result.deploymentCost,
          result: result,
        }),
      };
    } catch (error) {
      logger.error(
        "Error in DEPLOY_TOKEN action:",
        error instanceof Error ? error.message : String(error),
      );
      const errorResponse = handleError(error);

      if (callback) {
        await callback({
          text: `❌ Token deployment failed: ${errorResponse.message}`,
          actions: ["DEPLOY_TOKEN"],
          source: message.content.source,
        });
      }

      return {
        text: `❌ Token deployment failed: ${errorResponse.message}`,
        success: false,
        values: {
          tokenDeployed: false,
          error: true,
          errorMessage: errorResponse.message,
        },
        data: safeStringify({
          actionName: "DEPLOY_TOKEN",
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        }),
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: 'Deploy a new token called "Based Token" with symbol BASE and 1 million supply',
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "✅ Token deployed successfully!\n\nToken: Based Token (BASE)\nContract: 0x1234...5678\nTotal Supply: 1,000,000,000 BASE (1B tokens)\nTransaction: 0xabcd...ef01\nView on Clanker World: https://clanker.world/clanker/0x1234...5678",
          actions: ["DEPLOY_TOKEN"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Create a memecoin called PEPE with 69 billion tokens",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "✅ Token deployed successfully!\n\nToken: PEPE (PEPE)\nContract: 0x5678...1234\nTotal Supply: 1,000,000,000 PEPE (1B tokens)\nTransaction: 0xef01...abcd\nView on Clanker World: https://clanker.world/clanker/0x5678...1234",
          actions: ["DEPLOY_TOKEN"],
        },
      },
    ],
  ],
};

function mapXmlDeployFields(parsed: any): any {
  if (!parsed) {
    throw new Error("Parsed data is null or undefined");
  }

  const rawUrls: string[] = [];

  if (parsed?.socialMediaUrls?.url) {
    if (Array.isArray(parsed.socialMediaUrls.url)) {
      rawUrls.push(...parsed.socialMediaUrls.url);
    } else if (typeof parsed.socialMediaUrls.url === "string") {
      rawUrls.push(parsed.socialMediaUrls.url);
    }
  } else if (typeof parsed?.url === "string") {
    rawUrls.push(parsed?.url); // fallback support
  }

  // According to Clanker SDK v4.0.0, socialMediaUrls should be an array of strings
  const socialMediaUrls = rawUrls;

  return {
    name: parsed.name,
    symbol: parsed.symbol,
    vanity: parsed.vanity === "true",
    image: parsed.image || undefined,
    metadata: {
      description: parsed.description || undefined,
      socialMediaUrls: socialMediaUrls.length > 0 ? socialMediaUrls : undefined,
      auditUrls: [], // Add empty auditUrls array as per v4.0.0 API
    },
    devBuy: parsed.devBuy
      ? { ethAmount: parseFloat(parsed.devBuy) }
      : undefined,
  };
}
