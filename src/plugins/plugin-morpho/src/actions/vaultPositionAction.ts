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
import type { UserVaultPosition } from "../types";
import { fmtNum, fmtPct } from "./utils";
import BigNumber from "bignumber.js";
import { getEntityWallet } from "../../../../utils/entity";
import { CdpService } from "../../../plugin-cdp/services/cdp.service";
import { privateKeyToAccount } from "viem/accounts";

/* =========================
 * Prompt helper (optional single vault filter)
 * ========================= */
function getVaultPositionXmlPrompt(userMessage: string): string {
  return `<task>Extract an optional vault identifier from the user's message for VAULT positions lookup.</task>
  
  <message>
  ${userMessage}
  </message>
  
  <instructions>
  Return ONLY the following XML structure. Do not add extra text or explanations:
  
  <request>
      <vault>Spark USDC Vault</vault>
  </request>
  
  Rules:
  - Leave out <vault> if the user did not specify a particular vault.
  - If an on-chain address (0x + 40 hex chars) is provided, return that address as <vault>.
  - Otherwise, return the provided name/substring as-is (e.g., "Spark USDC Vault").
  </instructions>`;
}

/* =========================
 * Action: GET_MORPHO_VAULT_POSITIONS
 * ========================= */
export const vaultPositionsAction: Action = {
  name: "GET_MORPHO_VAULT_POSITIONS",
  similes: [
    "VAULT_POSITIONS",
    "MY_VAULT_POSITIONS",
    "YIELD_VAULTS",
    "MORPHO_VAULTS",
    "MORPHO_VAULT_POSITIONS",
  ],
  description:
    "Get your Morpho vault positions (deposit balances and APYs). Supports an optional vault filter by name or address. This action does not include markets.",
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
    logger.info("Starting Morpho VAULT positions action");

    try {
      logger.info("Handling GET_MORPHO_VAULT_POSITIONS action");

      // Get entity wallet address
      const walletResult = await getEntityWallet(
        runtime,
        message,
        "GET_MORPHO_VAULT_POSITIONS",
        callback,
      );
      if (!walletResult.success) {
        return walletResult.result;
      }

      let walletAddress: `0x${string}` | undefined;

      try {
        const cdp = runtime.getService(CdpService.serviceType) as CdpService | undefined;
        if (cdp) {
          const acct = await cdp.getOrCreateAccount({ name: message.entityId });
          walletAddress = acct.address as `0x${string}`;
        }
      } catch (e) {
        logger.warn(
          "CDP address resolution failed; using entity metadata address",
          e instanceof Error ? e.message : String(e),
        );
      }

      if (!walletAddress) {
        throw new Error("Wallet address not available. Please create or connect a wallet.");
      }

      const userText = message.content.text || "";
      const prompt = getVaultPositionXmlPrompt(userText);
      const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt,
      });
      const parsed = parseKeyValueXml(xmlResponse);
      const params = { vault: parsed?.vault || undefined }; // address or name-substring

      const service = runtime.getService(
        MorphoService.serviceType,
      ) as MorphoService;

      let vaults: UserVaultPosition[] = [];
      try {
        vaults = await service.getUserVaultPositionsByAddress(walletAddress);
      } catch (err) {
        logger.warn(
          "Could not fetch vault positions:",
          err instanceof Error ? err.message : String(err),
        );
      }

      // Optional filter by vault name substring or exact address
      const q = (params.vault ?? "").trim().toLowerCase();
      const isAddr = /^0x[a-fA-F0-9]{40}$/.test(q);
      const filtered = q
        ? vaults.filter((v) =>
            isAddr
              ? (v.vault.address ?? "").toLowerCase() === q
              : (v.vault.name ?? "").toLowerCase().includes(q),
          )
        : vaults;

      let text: string;
      if (!filtered.length) {
        text = `### Your Vaults\n\nNo vault balances found.`;
      } else {
        text = formatVaultTable(filtered);
      }

      const data = {
        actionName: "GET_MORPHO_VAULT_POSITIONS",
        params,
        vaultPositions: filtered,
      };

      if (callback) {
        await callback({
          text,
          actions: ["GET_MORPHO_VAULT_POSITIONS"],
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
          vaultsCount: filtered.length,
          requestedVault: params.vault ?? null,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const text = `❌ Failed to get vault positions: ${msg}`;
      const data = { actionName: "GET_MORPHO_VAULT_POSITIONS", error: msg };

      if (callback) {
        await callback({
          text,
          actions: ["GET_MORPHO_VAULT_POSITIONS"],
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
        content: { text: "Show my vaults" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here are your vault balances and APYs...",
          action: "GET_MORPHO_VAULT_POSITIONS",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Vault positions only" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here are your vault positions...",
          action: "GET_MORPHO_VAULT_POSITIONS",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "What’s my balance in the Spark USDC Vault?" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here is your Spark USDC Vault token balance and APYs...",
          action: "GET_MORPHO_VAULT_POSITIONS",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Show the vault at 0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here is your position in that vault...",
          action: "GET_MORPHO_VAULT_POSITIONS",
        },
      },
    ],
  ],
};

function normalizeUnitsFromApi(raw: string | number, decimals: number): string {
  const s = typeof raw === "number" ? String(raw) : (raw ?? "0");
  return new BigNumber(s).div(new BigNumber(10).pow(decimals)).toString(10);
}

function pctOrDash(n?: number | null, digits = 2) {
  return typeof n === "number" && isFinite(n) ? fmtPct(n * 100, digits) : "—";
}

export function formatVaultTable(vaults: UserVaultPosition[]): string {
  if (!vaults.length) return `### Your Vaults\n\nNo vault balances found.`;

  const header = [
    `### Your Vaults`,
    ``,
    `| Vault | Total Deposits | 1D APY | 7D APY | 30D APY | Year APY |`,
    `|:--|--:|--:|--:|--:|--:|`,
  ];

  const rows = vaults.map((v) => {
    const name = v.vault?.name ?? "—";
    const sym = v.vault?.asset?.symbol ?? "?";
    const dec = Number(v.vault?.asset?.decimals ?? 18);

    const tokenAmt = normalizeUnitsFromApi(v.assets, dec);
    const amountStr = `${fmtNum(tokenAmt)} ${sym}`;

    const apy1 = pctOrDash(v.vault?.state?.dailyApy);
    const apy7 = pctOrDash(v.vault?.state?.weeklyApy);
    const apy30 = pctOrDash(v.vault?.state?.monthlyApy);
    const apyY = pctOrDash(v.vault?.state?.yearlyApy);

    return `| ${name} | ${amountStr} | ${apy1} | ${apy7} | ${apy30} | ${apyY} |`;
  });

  return [...header, ...rows].join("\n");
}
