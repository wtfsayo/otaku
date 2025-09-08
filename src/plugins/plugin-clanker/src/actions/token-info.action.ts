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
import { ClankerService } from "../services/clanker.service";
import { formatTokenInfo } from "../utils/format";
import { handleError } from "../utils/errors";
import {
  getEntityWallet,
  EntityWalletResponse,
} from "../../../../utils/entity";
import { NATIVE_TOKEN_ADDRESSES } from "../types";

export const tokenInfoAction: Action = {
  name: "TOKEN_INFO",
  similes: ["GET_TOKEN_INFO", "CHECK_TOKEN", "TOKEN_DETAILS", "TOKEN_STATS"],
  description:
    "Get TOKEN MARKET DATA and statistics including price, liquidity, market cap, trading volume, and holder information. This action is for TOKEN-SPECIFIC queries (not wallet balance/holdings). Use when users ask about token prices, market data, or trading statistics. Supports multiple tokens and token addresses.",

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
  ): Promise<boolean> => {
    try {
      // Check if service is available
      const clankerService = runtime.getService(
        ClankerService.serviceType,
      ) as ClankerService;
      if (!clankerService) {
        logger.warn("Clanker service not available for token info");
        return false;
      }

      return true;
    } catch (error) {
      logger.error("Error validating token info action:", error);
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
      // Get entity wallet address
      const walletResult = (await getEntityWallet(
        runtime,
        message,
        "DEPLOY_TOKEN",
        callback,
      )) as EntityWalletResponse;
      if (!walletResult.success) {
        return walletResult.result;
      }
      const walletAddress = walletResult.walletAddress;
      logger.info("Handling TOKEN_INFO action");

      // Get service
      const clankerService = runtime.getService(
        ClankerService.serviceType,
      ) as ClankerService;
      if (!clankerService) {
        throw new Error("Clanker service not available");
      }

      const text = message.content.text || "";
      const prompt = getTokenInfoXmlPrompt(text);
      const rawResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt,
      });
      const parsed = parseKeyValueXml(rawResponse);
      const tokensRaw: string = parsed?.tokens || "";

      if (!tokensRaw) throw new Error("No tokens found in user message");

      const tokens = tokensRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      if (!tokens.length)
        throw new Error("No valid tokens parsed from message");

      let responseText = "📊 Token Information\n\n";

      for (const tokenInput of tokens) {
        try {
          const address = await resolveTokenInput(
            tokenInput,
            clankerService,
            walletAddress,
          );
          const tokenInfo = await clankerService.getTokenInfo(address);

          responseText += formatTokenInfo(tokenInfo);

          // Only show BaseScan link for actual contract tokens, not native ETH
          const isNativeEth = address === NATIVE_TOKEN_ADDRESSES;
          if (!isNativeEth) {
            responseText += `\nView on BaseScan: https://basescan.org/token/${address}\n\n`;
          } else {
            responseText += `\nView on BaseScan: https://basescan.org/\n\n`;
          }
        } catch (err) {
          logger.warn(`Failed to fetch info for token: ${tokenInput}`, err);
          responseText += `❌ Could not retrieve info for ${tokenInput}\n\n`;
        }
      }

      if (callback) {
        await callback({
          text: responseText,
          actions: ["TOKEN_INFO"],
          source: message.content.source,
        });
      }

      return {
        text: responseText,
        success: true,
        values: { tokenInfoFetched: true },
        data: { actionName: "TOKEN_INFO", tokens },
      };
    } catch (error) {
      logger.error("Error in TOKEN_INFO action:", error);
      const errorResponse = handleError(error);

      if (callback) {
        await callback({
          text: `❌ Failed to get token information: ${errorResponse.message}`,
          actions: ["TOKEN_INFO"],
          source: message.content.source,
        });
      }

      return {
        text: `❌ Failed to get token information: ${errorResponse.message}`,
        success: false,
        values: {
          tokenInfoFetched: false,
          error: true,
          errorMessage: errorResponse.message,
        },
        data: {
          actionName: "TOKEN_INFO",
          error: error instanceof Error ? error.message : String(error),
        },
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "Get info for token 0x1234567890abcdef1234567890abcdef12345678",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "📊 Token Information\n\nToken: Example Token (EXT)\nAddress: 0x1234...5678\nPrice: $0.50\nMarket Cap: $5,000,000\nLiquidity: $500,000\nHolders: 1,234\n24h Volume: $250,000",
          actions: ["TOKEN_INFO"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "What is the price and liquidity of 0xabcdef1234567890abcdef1234567890abcdef12?",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "📊 Token Information\n\nToken: Based Token (BASE)\nAddress: 0xabcd...ef12\nPrice: $0.001\nMarket Cap: $100,000\nLiquidity: $50,000\nHolders: 500\n24h Volume: $10,000",
          actions: ["TOKEN_INFO"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Give me info for PEPE and USDC" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "📊 Token Information\n\nToken: PEPE...\nToken: USDC...",
          actions: ["TOKEN_INFO"],
        },
      },
    ],
  ],
};

function getTokenInfoXmlPrompt(userMessage: string): string {
  return `<task>
Extract the tokens the user wants information about from their message.
</task>

<message>
${userMessage}
</message>

<instructions>
Return only this XML structure:

<info>
  <tokens>ETH, USDC</tokens>
</info>

Use comma-separated token names, symbols, or addresses mentioned explicitly in the message.
Do NOT include any explanations, only the XML format above.
</instructions>`;
}

async function resolveTokenInput(
  input: string,
  clankerService: ClankerService,
  walletAddress: string,
): Promise<string> {
  if (input.startsWith("0x")) return input;
  const resolved = await clankerService.resolveTokenAddressBySymbol(
    input,
    walletAddress,
  );
  if (!resolved) {
    throw new Error(`Unknown token symbol: ${input}`);
  }
  return resolved;
}
