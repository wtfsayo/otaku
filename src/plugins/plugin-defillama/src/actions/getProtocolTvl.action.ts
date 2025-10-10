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
import { DefiLlamaService } from "../services/defillama.service";

function getProtocolNamesXmlTemplate(userText: string): string {
  return `<task>
Identify the DeFi protocol names or symbols requested by the user, using recent context to disambiguate, but selecting only what the latest user request asks to fetch now.
</task>

## Recent Conversation
{{recentMessages}}

## Latest User Message
${userText}

<instructions>
Return only this exact XML (no extra text):

<response>
  <names>PROTOCOL1, PROTOCOL2</names>
</response>

Rules:
- Focus on the latest user message intent; extract only the protocols the user is asking to fetch or compare now (e.g., "Compare EIGEN/MORPHO TVL").
- Use earlier messages only to resolve pronouns or vague references (e.g., "those", "same ones").
- Extract DeFi protocol names or tickers/symbols (e.g., MORPHO, EIGEN, Aave, Curve). Do NOT extract token contract addresses here.
- Use comma-separated values, no explanations.
- Remove duplicates while preserving order of mention.
</instructions>`;
}

export const getProtocolTvlAction: Action = {
  name: "GET_PROTOCOL_TVL",
  similes: [
    "PROTOCOL_TVL",
    "COMPARE_TVL",
    "DEFILLAMA_PROTOCOL_TVL",
    "TVL",
  ],
  description:
    "Use this action to fetch DeFi protocol TVL and change metrics by protocol name or symbol.",

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    const svc = runtime.getService(DefiLlamaService.serviceType) as DefiLlamaService | undefined;
    if (!svc) {
      logger.error("DefiLlamaService not available");
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
      const svc = runtime.getService(DefiLlamaService.serviceType) as DefiLlamaService | undefined;
      if (!svc) throw new Error("DefiLlamaService not available");

      const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
      const userText = message.content.text || "";
      const prompt = composePromptFromState({ state: composedState, template: getProtocolNamesXmlTemplate(userText) });
      const raw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
      const parsed = parseKeyValueXml(raw);

      const namesRaw: string = parsed?.names || "";
      if (!namesRaw) throw new Error("No protocol names found in user message");

      const names = namesRaw
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      if (!names.length) throw new Error("No valid protocol names parsed from message");

      const results = await svc.getProtocolsByNames(names);
      if (!Array.isArray(results) || results.length === 0) {
        throw new Error("No protocols matched the provided names");
      }

      const successes = results.filter((r: any) => r && r.success && r.data);
      const failed = results.filter((r: any) => !r || !r.success);
      if (successes.length === 0) {
        throw new Error("No protocols matched the provided names");
      }

      const messageText = failed.length > 0
        ? `Fetched TVL for ${successes.length} protocol(s); ${failed.length} not matched`
        : `Fetched TVL for ${successes.length} protocol(s)`;

      if (callback) {
        await callback({
          text: messageText,
          actions: ["GET_PROTOCOL_TVL"],
          content: results as any, // include successes and failures with error messages
          source: message.content.source,
        });
      }

      return {
        text: messageText,
        success: true,
        data: results, // full per-input results including errors
        values: successes.map((r: any) => r.data), // successful shaped protocols only
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_PROTOCOL_TVL] ${msg}`);
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
        content: { text: "Compare EIGEN/MORPHO TVL" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Fetched TVL for 2 protocol(s)",
          actions: ["GET_PROTOCOL_TVL"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "What is the TVL of Aave and Curve right now?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Fetched TVL for 2 protocol(s)",
          actions: ["GET_PROTOCOL_TVL"],
        },
      },
    ],
  ],
};


