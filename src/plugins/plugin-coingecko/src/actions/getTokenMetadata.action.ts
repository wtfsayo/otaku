import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
  ModelType,
  composePromptFromState,
  parseKeyValueXml,
  logger,
} from "@elizaos/core";
import { CoinGeckoService } from "../services/coingecko.service";
function getTokenIdsXmlTemplate(): string {
    return `<task>
Identify the token identifiers mentioned by the user from the conversation context.
</task>

## Conversation Context
{{recentMessages}}

<instructions>
Return only this exact XML:

<response>
  <ids>TOKEN_ID1, TOKEN_ID2</ids>
</response>

Rules:
- Extract the tokens exactly as the user stated (symbols, names, or ids).
- Do NOT transform, expand, or guess CoinGecko ids.
- Use comma-separated values without extra text.
- Do NOT include contract addresses unless the user explicitly provided them.
</instructions>`;
}
export const getTokenMetadataAction: Action = {
  name: "GET_TOKEN_METADATA",
  similes: [
    "TOKEN_METADATA",
    "COINGECKO_TOKEN_METADATA",
    "GET_COIN_INFO",
    "TOKEN_INFO",
  ],
  description: "Fetch token metadata by CoinGecko coin id using CoinGecko API (Pro if key configured)",

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    const svc = runtime.getService(CoinGeckoService.serviceType) as CoinGeckoService | undefined;
    if (!svc) {
      logger.error("CoinGeckoService not available");
      return false;
    }
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const svc = runtime.getService(CoinGeckoService.serviceType) as CoinGeckoService | undefined;
      if (!svc) throw new Error("CoinGeckoService not available");

      const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
      const prompt = composePromptFromState({ state: composedState, template: getTokenIdsXmlTemplate() });
      const raw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
      const parsed = parseKeyValueXml(raw);
      
      const idsRaw: string = parsed?.ids || "";
      if (!idsRaw) throw new Error("No token ids found in user message");

      const ids = idsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!ids.length) throw new Error("No valid token ids parsed from message");

      const results: any[] = [];
      for (const id of ids) {
        try {
          const meta = await svc.getTokenMetadata(id);
          results.push(meta);
        } catch (e) {
          logger.warn(`[GET_TOKEN_METADATA] Failed to fetch id ${id}:`, e instanceof Error ? e.message : String(e));
        }
      }

      if (results.length === 0) throw new Error("No metadata fetched for provided ids");

      if (callback) {
        await callback({
          text: `Fetched metadata for ${results.length} token(s)`,
          actions: ["GET_TOKEN_METADATA"],
          content: results as any,
          source: message.content.source,
        });
      }

      return {
        text: `Fetched metadata for ${results.length} token(s)`,
        success: true,
        data: results,
        values: results,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_TOKEN_METADATA] ${msg}`);
      return {
        text: `Failed: ${msg}`,
        success: false,
        error: error as Error,
      };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Get metadata for eigenlayer and aster-2" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Fetched metadata for 2 token(s)",
          actions: ["GET_TOKEN_METADATA"],
        },
      },
    ],
  ],
};

