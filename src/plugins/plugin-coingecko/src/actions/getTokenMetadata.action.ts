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
function getTokenIdsXmlTemplate(userText: string): string {
    return `<task>
Identify the token identifiers requested by the user, using recent context to disambiguate, but selecting only what the latest user request asks to fetch now.
</task>

## Recent Conversation
{{recentMessages}}

## Latest User Message
${userText}

<instructions>
Return only this exact XML (no extra text):

<response>
  <ids>TOKEN_ID1, TOKEN_ID2</ids>
</response>

Rules:
- Focus on the latest user message intent; extract only the tokens the user is asking to fetch now.
- Use earlier messages only to resolve pronouns or vague references (e.g., "those", "same ones").
- Extract exactly as stated (symbols, names, CoinGecko ids, or contract addresses like EVM 0x... or Solana Base58).
- Do NOT add tokens mentioned earlier unless the latest message refers to them implicitly.
- Use comma-separated values, no explanations.
- Remove duplicates while preserving order of mention.
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
  description:
    "Use this action when the user asks about a specific token/coin or wants core token details or high-level market info. Examples: 'what is <token>?', symbol/name/contract lookups, decimals, logo, networks/addresses, current price, market cap, volume, ATH/ATL, and basic performance. Not for portfolio balances, swaps/trades, or protocol-level TVL. Accepts CoinGecko id, symbol, name, or a contract address (EVM 0x..., Solana Base58).",

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
      const userText = message.content.text || "";
      const prompt = composePromptFromState({ state: composedState, template: getTokenIdsXmlTemplate(userText) });
      const raw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
      const parsed = parseKeyValueXml(raw);

      const idsRaw: string = parsed?.ids || "";
      if (!idsRaw) throw new Error("No token ids found in user message");

      const ids = idsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!ids.length) throw new Error("No valid token ids parsed from message");

      const serviceResults = await svc.getTokenMetadata(ids);
      const successes = serviceResults.filter((r) => r.success);
      const failures = serviceResults.filter((r) => !r.success);

      const text = `Fetched metadata for ${successes.length} token(s)` + (failures.length ? `, ${failures.length} failed` : "");

      if (callback) {
        await callback({
          text,
          actions: ["GET_TOKEN_METADATA"],
          content: serviceResults as any,
          source: message.content.source,
        });
      }

      return {
        text,
        success: successes.length > 0,
        data: serviceResults,
        values: serviceResults,
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
        content: { text: "Get metadata for aster, HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC, and 0x2081ab0d9ec9e4303234ab26d86b20b3367946ee" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Fetched metadata for 3 token(s)",
          actions: ["GET_TOKEN_METADATA"],
        },
      },
    ],
  ],
};

