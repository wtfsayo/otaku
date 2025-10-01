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
import { MorphoMarketData, UserPosition } from "../types";
import { fmtNum, fmtPct, fmtTok, fmtUSD } from "./utils";
import { getEntityWallet } from "../../../../utils/entity";
import { CdpService } from "../../../plugin-cdp/services/cdp.service";
import { privateKeyToAccount } from "viem/accounts";
/* =========================
 * Prompt helper
 * ========================= */
function getPositionXmlPrompt(userMessage: string): string {
  return `<task>Extract an optional Morpho market identifier from the user's message for positions lookup.</task>

<message>
${userMessage}
</message>

<instructions>
Return ONLY the following XML structure. Do not add extra text or explanations:

<request>
    <market>wstETH/WETH</market>
</request>

Rules:
- Leave out <market> if no specific market is mentioned.
- If a pair is mentioned, normalize spaces around the slash to exactly "Collateral/Loan" (single spaces on both sides), keep the original casing (e.g., "wstETH/WETH").
- If a 66-char 0x-hex string is present, use that as <market> (marketId).
</instructions>`;
}

/* =========================
 * Action: GET_MORPHO_MARKET_POSITIONS
 * ========================= */
export const marketPositionsAction: Action = {
  name: "GET_MORPHO_MARKET_POSITIONS",
  similes: [
    "MARKET_POSITIONS",
    "MY_MARKET_POSITIONS",
    "LOAN_POSITIONS",
    "BORROW_SUPPLY_POSITIONS",
    "MORPHO_MARKETS",
    "MORPHO_MARKET_POSITIONS",
  ],
  description:
    "Get your Morpho market positions (borrows/supplies), optionally for a specific market (pair or marketId). This action does not include vaults.",
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
    logger.info("Starting Morpho positions action");

    try {
      logger.info("Handling GET_MORPHO_MARKET_POSITIONS action");

      // Get entity wallet address
      const walletResult = await getEntityWallet(
        runtime,
        message,
        "GET_MORPHO_MARKET_POSITIONS",
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
          "CDP address resolution failed; falling back to entity metadata address",
          e instanceof Error ? e.message : String(e),
        );
      }

      if (!walletAddress) {
        throw new Error("Wallet address not available. Please create or connect a wallet.");
      }

      const userText = message.content.text || "";
      const prompt = getPositionXmlPrompt(userText);
      const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt,
      });
      const parsed = parseKeyValueXml(xmlResponse);
      const params = { market: parsed?.market || undefined };

      const service = runtime.getService(
        MorphoService.serviceType,
      ) as MorphoService;

      // Fetch markets to enrich compact view with borrow rate (if needed)
      // Try to use CDP public client if available
      let publicClient: any | undefined;
      try {
        const cdp = runtime.getService(CdpService.serviceType) as CdpService | undefined;
        if (cdp) {
          const viem = await cdp.getViemClientsForAccount({
            accountName: message.entityId,
            network: service.getChainSlug(),
          });
          publicClient = viem.publicClient;
        }
      } catch {}
      const markets = await service.getMarketData(params.market, publicClient);
      const marketById = new Map<string, MorphoMarketData>();
      for (const m of markets) {
        if (m.marketId) marketById.set(m.marketId, m);
      }

      // Fetch positions (no signing needed) via address for CDP/general wallets
      let positions: UserPosition[] = [];
      try {
        positions = await service.getUserPositionsByAddress(
          walletAddress,
          params.market,
          publicClient
        );
      } catch (err) {
        logger.warn(
          "Could not fetch position data:",
          err instanceof Error ? err.message : String(err),
        );
      }

      let text: string;

      if (params.market) {
        // Expect a single item
        const r = positions[0];
        text = r
          ? formatPositionDetailed(r, service.getChainSlug())
          : [
              `### Your Position`,
              `No position data available for the requested market.`,
            ].join("\n");
      } else {
        const nonEmpty = positions.filter((p) => p?.hasPosition);
        if (!nonEmpty.length) {
          text = [
            `### Your Positions`,
            `You don’t have open positions on this chain.`,
          ].join("\n");
        } else {
          const rows = nonEmpty
            .map((p) => {
              const md = marketById.get(p.marketId);
              return formatPositionCompact(p, {
                borrowRatePct: md?.borrowRate,
              });
            })
            .join("\n");
          text = [`### Your Positions`, rows].join("\n\n");
        }
      }

      const data = {
        actionName: "GET_MORPHO_POSITIONS",
        params,
        markets,
        position: positions,
      };

      if (callback) {
        await callback({
          text,
          actions: ["GET_MORPHO_POSITIONS"],
          source: message.content.source,
          data,
        });
      }

      return {
        text,
        success: true,
        data,
        values: {
          positionsFetched: true,
          positionsCount: positions.length,
          requestedMarket: params.market ?? null,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const text = `❌ Failed to get positions: ${msg}`;
      const data = { actionName: "GET_MORPHO_POSITIONS", error: msg };

      if (callback) {
        await callback({
          text,
          actions: ["GET_MORPHO_POSITIONS"],
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
          positionsFetched: false,
        },
      };
    }
  },
  examples: [
    [
      {
        name: "{{name1}}",
        content: { text: "Show me my market positions" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here are your open market positions...",
          action: "GET_MORPHO_MARKET_POSITIONS",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Do I have a position on wstETH / WETH?" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here is your position on wstETH / WETH...",
          action: "GET_MORPHO_MARKET_POSITIONS",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Check my market position on 0x3a4048c64ba1b375330d376b1ce40e4047d03b47ab4d48af484edec9fec801ba",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here’s your position for the requested market...",
          action: "GET_MORPHO_MARKET_POSITIONS",
        },
      },
    ],
  ],
};

/* =========================
 * Formatting helpers (local)
 * ========================= */
function formatPositionDetailed(r: UserPosition, chainSlug?: string): string {
  if (!r?.hasPosition) {
    const link =
      r?.marketId && chainSlug
        ? `https://app.morpho.org/${chainSlug}/market/${r.marketId}/`
        : "";
    return [
      `### ${r?.pairLabel ?? "Position"} — Your Position`,
      `You don’t have an open position in this market.`,
      link ? `🔗 **Open in Morpho:** ${link}` : ``,
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Borrowing position formatting
  const loanUsd = r.amounts.loanUsd != null ? fmtUSD(r.amounts.loanUsd) : "—";
  const loanTok =
    r.amounts.loanTokens != null
      ? fmtTok(r.amounts.loanTokens, r.symbols.loan)
      : "—";

  const collUsd =
    r.amounts.collateralUsd != null ? fmtUSD(r.amounts.collateralUsd) : "—";
  const collTok =
    r.amounts.collateralTokens != null
      ? fmtTok(r.amounts.collateralTokens, r.symbols.collateral)
      : "—";

  // Supply position formatting (NEW!)
  const suppliedUsd =
    r.amounts.suppliedUsd != null ? fmtUSD(r.amounts.suppliedUsd) : "—";
  const suppliedTok =
    r.amounts.suppliedTokens != null
      ? fmtTok(r.amounts.suppliedTokens, r.symbols.loan)
      : "—";
  const withdrawableTok =
    r.amounts.withdrawableTokens != null
      ? fmtTok(r.amounts.withdrawableTokens, r.symbols.loan)
      : "—";

  const ltvStr = r.risk.ltvPct != null ? fmtPct(r.risk.ltvPct) : "—";
  const lltvStr = fmtPct(r.risk.lltvPct, 0);

  const liqPriceStr = r.prices.liquidationLoanPerCollateral
    ? fmtNum(r.prices.liquidationLoanPerCollateral, 2)
    : "—";

  const bufferStr =
    typeof r.risk.dropToLiquidationPct === "number" &&
    isFinite(r.risk.dropToLiquidationPct)
      ? fmtPct(r.risk.dropToLiquidationPct, 2)
      : "—";

  // Build sections
  const sections = [`### ${r.pairLabel} — Your Position`, ``];

  // Borrowing section
  if (
    parseFloat(r.amounts.loanTokens) > 0 ||
    parseFloat(r.amounts.collateralTokens) > 0
  ) {
    sections.push(
      `**📋 Borrowing Position**`,
      `**Loan**       ·  ${loanUsd}  ·  ${loanTok}`,
      `**Collateral** ·  ${collUsd}  ·  ${collTok}`,
      `**LTV / LLTV** ·  ${ltvStr} / ${lltvStr}`,
      `**Liq. Price** ·  ${r.symbols.collateral} / ${r.symbols.loan}: ${liqPriceStr}`,
      `**Buffer**     ·  ${bufferStr} to liquidation`,
    );
  }

  // Supply section (NEW!)
  if (r.supply?.hasSupplied) {
    sections.push(
      ``,
      `**🏦 Supply Position (Lending)**`,
      `**Supplied**    ·  ${suppliedUsd}  ·  ${suppliedTok}`,
      `**Withdrawable** ·  ${withdrawableTok}`,
      `**APY**         ·  ${r.supply.currentApy ? fmtPct(r.supply.currentApy) : "—"}`,
      `**Earned**      ·  ${r.supply.earnedInterest ? fmtTok(r.supply.earnedInterest, r.symbols.loan) : "—"}`,
    );
  }

  return sections.join("\n");
}

/** Compact single-line bullet for positions list (optionally includes borrow rate) */
function formatPositionCompact(
  r: UserPosition,
  opts?: { borrowRatePct?: number | null },
): string {
  const loanTok =
    r.amounts.loanTokens != null
      ? fmtTok(r.amounts.loanTokens, r.symbols.loan)
      : "—";
  const collTok =
    r.amounts.collateralTokens != null
      ? fmtTok(r.amounts.collateralTokens, r.symbols.collateral)
      : "—";
  const ltvStr = r.risk.ltvPct != null ? fmtPct(r.risk.ltvPct) : "—";
  const lltvStr = fmtPct(r.risk.lltvPct, 0);

  const bufferStr =
    typeof r.risk.dropToLiquidationPct === "number" &&
    isFinite(r.risk.dropToLiquidationPct)
      ? fmtPct(r.risk.dropToLiquidationPct, 2)
      : "—";

  // Add supply info to compact view (NEW!)
  const suppliedTok =
    r.amounts.suppliedTokens != null
      ? fmtTok(r.amounts.suppliedTokens, r.symbols.loan)
      : "—";

  const parts = [
    `• **${r.pairLabel}** — Loan ${loanTok} · Collateral ${collTok} · Supplied ${suppliedTok} · LTV/LLTV ${ltvStr}/${lltvStr} · Buffer ${bufferStr}`,
  ];

  if (opts?.borrowRatePct != null && isFinite(opts.borrowRatePct)) {
    parts.push(` · Borrow ${fmtPct(opts.borrowRatePct)}`);
  }

  // Add supply APY if available
  if (r.supply?.hasSupplied && r.supply.currentApy != null) {
    parts.push(` · Supply ${fmtPct(r.supply.currentApy)}`);
  }

  return parts.join("");
}
