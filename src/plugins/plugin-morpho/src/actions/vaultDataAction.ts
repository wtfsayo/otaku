import {
  Action,
  IAgentRuntime,
  Memory,
  logger,
  State,
  HandlerCallback,
  ActionResult,
  ModelType,
  parseKeyValueXml,
} from "@elizaos/core";
import { MorphoService } from "../services";
import {
  fmtPct,
  fmtUSD,
  fmtNum,
  shortHex,
  fmtTokCompact,
  formatDataList,
  formatItemDetails,
} from "./utils";
import type { MorphoVaultData } from "../types";

/* =========================
 * Prompt helper (vault)
 * ========================= */
function getVaultXmlPrompt(userMessage: string): string {
  return `<task>Extract an optional Morpho vault identifier from the user's message.</task>
  
  <message>
  ${userMessage}
  </message>
  
  <instructions>
  Return ONLY the following XML structure. Do not add extra text or explanations:
  
  <request>
      <vault>Spark USDC Vault</vault>
  </request>
  
  Rules:
  - Leave out <vault> if no specific vault is mentioned.
  - If a 0x-address (40 hex chars) is present, use that as <vault>.
  - Otherwise, keep the provided name/substring as-is (e.g., "Spark USDC Vault").
  </instructions>`;
}

/* =========================
 * Action: GET_MORPHO_VAULT_INFO
 * ========================= */
export const vaultInfoAction: Action = {
  name: "GET_MORPHO_VAULT_INFO",
  similes: [
    "VAULT_INFO",
    "VAULT_DATA",
    "MORPHO_VAULT_INFO",
    "MORPHO_VAULTS",
    "YIELD_VAULTS",
  ],
  description:
    "Get current data for Morpho vaults (no positions): totals and APYs. Supports an optional vault filter by name or address.",
  validate: async (runtime: IAgentRuntime) => {
    const morphoService = runtime.getService(
      MorphoService.serviceType,
    ) as MorphoService;
    if (!morphoService) {
      logger.error("Required services not available");
      return false;
    }
    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("Starting Morpho vault info action");

    try {
      const userText = message.content.text || "";
      const prompt = getVaultXmlPrompt(userText);
      const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt,
      });
      const parsed = parseKeyValueXml(xmlResponse);
      const params = { vault: parsed?.vault || undefined };

      const service = runtime.getService(
        MorphoService.serviceType,
      ) as MorphoService;
      const vaults = await service.getVaultData(params.vault);

      if (!vaults.length) {
        const errorText = `❌ No vault data${params.vault ? ` for ${params.vault}` : ""} found.`;
        const data = {
          actionName: "GET_MORPHO_VAULT_INFO",
          params,
          vaults: [],
        };
        if (callback) {
          await callback({
            text: errorText,
            actions: ["GET_MORPHO_VAULT_INFO"],
            source: message.content.source,
            data,
          });
        }
        return {
          text: errorText,
          success: false,
          data,
          values: {
            vaultsFetched: false,
            vaultsCount: 0,
            requestedVault: params.vault ?? null,
          },
        };
      }

      const text = params.vault
        ? vaults.map((v) => formatDetailedVaultView(v, service)).join("\n\n")
        : formatVaultsList(vaults);

      const data = { actionName: "GET_MORPHO_VAULT_INFO", params, vaults };

      if (callback) {
        await callback({
          text,
          actions: ["GET_MORPHO_VAULT_INFO"],
          source: message.content.source,
          data,
        });
      }

      return {
        text,
        success: true,
        data,
        values: {
          vaultsFetched: true,
          vaultsCount: vaults.length,
          requestedVault: params.vault ?? null,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const text = `❌ Failed to get vault info: ${msg}`;
      const data = { actionName: "GET_MORPHO_VAULT_INFO", error: msg };

      if (callback) {
        await callback({
          text,
          actions: ["GET_MORPHO_VAULT_INFO"],
          source: message.content.source,
          data,
        });
      }

      return {
        text,
        success: false,
        error: new Error(msg),
        data,
        values: {
          error: true,
          vaultsFetched: false,
        },
      };
    }
  },
  examples: [
    [
      {
        name: "{{name1}}",
        content: { text: "Show vault data" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here is the complete vault overview...",
          action: "GET_MORPHO_VAULT_INFO",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Show data for Metronome msETH Vault" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here is the data for Metronome msETH Vault...",
          action: "GET_MORPHO_VAULT_INFO",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Check this vault: 0x43Cd00De63485618A5CEEBE0de364cD6cBeB26E7",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here’s the current data for the requested vault...",
          action: "GET_MORPHO_VAULT_INFO",
        },
      },
    ],
  ],
};

/* =========================
 * Formatting helpers (local)
 * ========================= */
function apyCell(n?: number | null) {
  // APYs from API are decimals (e.g., 0.0465 → 4.65%)
  return typeof n === "number" && isFinite(n) ? fmtPct(n * 100, 2) : "—";
}

function fmtTokenAmount(x: any, symbol: string) {
  // x may be a BigNumber or number; fmtNum handles decimal strings nicely
  const s = typeof x?.toString === "function" ? x.toString() : String(x ?? "0");
  return `${fmtNum(s)} ${symbol}`;
}

function pctFromFraction(x?: number | null, decimals = 2) {
  return typeof x === "number" && isFinite(x) ? fmtPct(x * 100, decimals) : "—";
}

function formatDetailedVaultView(
  v: MorphoVaultData,
  service: MorphoService,
): string {
  const chain = service.getChainSlug(); // mirror of market action
  const address = v.address ?? "";
  const link = address
    ? `https://app.morpho.org/${chain}/vault/${address}/`
    : "";

  const totalTokens =
    typeof v.totalDepositsTokens?.toString === "function"
      ? v.totalDepositsTokens.toString()
      : String(v.totalDepositsTokens ?? "0");

  const amountStr = fmtTokCompact(totalTokens, v.asset.symbol, 1);
  const usdAmount =
    v.totalDepositsUsd != null ? fmtUSD(v.totalDepositsUsd) : "—";

  const data = {
    Asset: v.asset.symbol,
    Address: `\`${shortHex(address)}\``,
    "Total Deposits": `${amountStr} (${usdAmount})`,
    "APY 1D": pctFromFraction(v.apy.daily),
    "APY 7D": pctFromFraction(v.apy.weekly),
    "APY 30D": pctFromFraction(v.apy.monthly),
    "APY Year": pctFromFraction(v.apy.yearly),
  };

  return formatItemDetails(`${v.name} - Vault`, data, link);
}

/** Clean list for multiple vaults */
function formatVaultsList(vaults: MorphoVaultData[]): string {
  if (!vaults.length) return "No vaults found.";

  const items = vaults.map((v) => {
    const tokenAmt = fmtTokCompact(v.totalDepositsTokens, v.asset.symbol, 1);
    const usdAmt =
      v.totalDepositsUsd != null ? fmtUSD(v.totalDepositsUsd) : "—";

    return {
      name: `${v.name} (${v.asset.symbol})`,
      data: {
        Deposits: `${tokenAmt} (${usdAmt})`,
        APY: apyCell(v.apy.daily),
      },
    };
  });

  return formatDataList("All Morpho Vaults", items);
}
