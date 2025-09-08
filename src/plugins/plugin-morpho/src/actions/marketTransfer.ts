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
import { getEntityWallet } from "../../../../utils/entity";

function getMarketTransferXmlPrompt(userMessage: string): string {
  return `<task>Extract intent, market, amount, and optional parameters for a Morpho market operation.</task>

<message>
${userMessage}
</message>

<instructions>
Return ONLY the following XML structure. Do not add extra text or explanations:

<request>
  <intent>supply</intent>
  <market>WETH/USDC</market>
  <assets>1</assets>
  <fullRepayment>false</fullRepayment>
</request>

Rules:
- <intent> must be one of: "supply", "supplyCollateral", "borrow", "repay", "withdraw", "withdrawCollateral"
- <market> should be in "Collateral/Loan" format (e.g., "WETH/USDC") or a 64-char hex marketId
- <assets> should be a pure number WITHOUT units or symbols (e.g., "1", "0.5", "100")
- <fullRepayment> is only for repay operations, set to "true" for full repayment
- Do NOT invent defaults. If user didn't specify a field, omit that tag.
- IMPORTANT: Extract only the numeric value for <assets>, ignore token symbols like "USDC", "WETH", etc.
- For supply operations: "supply" = lend loan token to earn yield, "supplyCollateral" = provide collateral token
- For withdraw operations: "withdraw" = withdraw loan token, "withdrawCollateral" = withdraw collateral token
- Token mapping: In "WETH/USDC" markets, USDC is loan token (supply/borrow), WETH is collateral token

Examples:
- "Supply 1 USDC to WETH/USDC market" → intent: supply, market: WETH/USDC, assets: 1
- "Provide 0.1 WETH as collateral in WETH/USDC" → intent: supplyCollateral, market: WETH/USDC, assets: 0.1
- "Borrow 100 USDC from WETH/USDC market" → intent: borrow, market: WETH/USDC, assets: 100
- "Repay 2.5 USDC in WETH/USDC" → intent: repay, market: WETH/USDC, assets: 2.5
- "Repay all my debt in WETH/USDC" → intent: repay, market: WETH/USDC, fullRepayment: true
- "Withdraw 0.5 USDC from WETH/USDC" → intent: withdraw, market: WETH/USDC, assets: 0.5
- "Remove 0.05 WETH collateral from WETH/USDC" → intent: withdrawCollateral, market: WETH/USDC, assets: 0.05
</instructions>`;
}

function txUrl(chainSlug: "base" | "base-sepolia", hash: `0x${string}`) {
  if (chainSlug === "base-sepolia")
    return `https://sepolia.basescan.org/tx/${hash}`;
  return `https://basescan.org/tx/${hash}`;
}

function getOperationEmoji(intent: string): string {
  switch (intent) {
    case "supply":
      return "🏦";
    case "supplyCollateral":
      return "🔐";
    case "borrow":
      return "💸";
    case "repay":
      return "💰";
    case "withdraw":
      return "📤";
    case "withdrawCollateral":
      return "🔓";
    default:
      return "⚡";
  }
}

function getOperationDescription(intent: string): string {
  switch (intent) {
    case "supply":
      return "Supply (lend assets to earn yield)";
    case "supplyCollateral":
      return "Supply Collateral (secure borrowing position)";
    case "borrow":
      return "Borrow (borrow assets against collateral)";
    case "repay":
      return "Repay (repay borrowed assets)";
    case "withdraw":
      return "Withdraw (withdraw supplied assets)";
    case "withdrawCollateral":
      return "Withdraw Collateral (remove collateral)";
    default:
      return "Market Operation";
  }
}

export const marketTransferAction: Action = {
  name: "MORPHO_MARKET_TRANSFER",
  similes: [
    "MARKET_TRANSFER",
    "MORPHO_SUPPLY",
    "MORPHO_BORROW",
    "MORPHO_REPAY",
    "MORPHO_WITHDRAW",
    "SUPPLY_MARKET",
    "BORROW_MARKET",
    "REPAY_MARKET",
    "WITHDRAW_MARKET",
    "SUPPLY_COLLATERAL",
    "WITHDRAW_COLLATERAL",
    "LEND_ASSETS",
    "PROVIDE_COLLATERAL",
  ],
  description:
    "Perform market operations on Morpho Blue: supply, supplyCollateral, borrow, repay, withdraw, or withdrawCollateral",
  validate: async (runtime: IAgentRuntime) => {
    const svc = runtime.getService(MorphoService.serviceType) as MorphoService;
    if (!svc) {
      logger.error("MorphoService not available");
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
    logger.info("Starting MORPHO_MARKET_TRANSFER");

    // Helper to return + callback with a failure reason
    const fail = async (reason: string): Promise<ActionResult> => {
      const text =
        `❌ Market operation failed: ${reason}\n\n` +
        `**How to use (specify pure numbers with token symbols):** \n` +
        `• **Supply**: \`Supply 1 USDC to WETH/USDC market\` (lend USDC to earn yield)\n` +
        `• **Supply Collateral**: \`Provide 0.1 WETH as collateral in WETH/USDC\` (collateralize WETH)\n` +
        `• **Borrow**: \`Borrow 100 USDC from WETH/USDC market\` (borrow USDC against WETH)\n` +
        `• **Repay**: \`Repay 2.5 USDC in WETH/USDC\` or \`Repay all debt in WETH/USDC\`\n` +
        `• **Withdraw**: \`Withdraw 0.5 USDC from WETH/USDC\` (withdraw supplied USDC)\n` +
        `• **Withdraw Collateral**: \`Remove 0.05 WETH collateral from WETH/USDC\` (remove WETH collateral)\n\n` +
        `**Note**: In WETH/USDC markets, USDC is typically the loan asset (supply/borrow) and WETH is the collateral asset.`;
      const data = { actionName: "MORPHO_MARKET_TRANSFER", error: reason };

      if (callback) {
        await callback({
          text,
          actions: ["MORPHO_MARKET_TRANSFER"],
          source: message.content.source,
          data,
        });
      }
      return {
        text,
        success: false,
        error: new Error(reason),
        data,
        values: { error: true },
      };
    };

    try {
      logger.info("Handling MORPHO_MARKET_TRANSFER action");

      // Get entity wallet address
      const walletResult = await getEntityWallet(
        runtime,
        message,
        "MORPHO_MARKET_TRANSFER",
        callback,
      );
      if (!walletResult.success) {
        return walletResult.result;
      }
      const walletPrivateKey = walletResult.walletPrivateKey;

      const userText = message.content.text || "";
      const prompt = getMarketTransferXmlPrompt(userText);
      const xml = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
      const parsed = parseKeyValueXml(xml) || {};

      const rawIntent = parsed.intent?.toString().trim().toLowerCase();
      const rawMarket = parsed.market?.toString().trim();
      const rawAssets = parsed.assets?.toString().trim();
      const rawFullRepayment =
        parsed.fullRepayment?.toString().trim().toLowerCase() === "true";

      // 1) Validate intent
      const validIntents = [
        "supply",
        "supplycollateral",
        "borrow",
        "repay",
        "withdraw",
        "withdrawcollateral",
      ];
      if (!rawIntent) {
        return await fail(
          "Missing operation. Please specify supply, supplyCollateral, borrow, repay, withdraw, or withdrawCollateral.",
        );
      }
      if (!validIntents.includes(rawIntent)) {
        return await fail(
          `Invalid operation "${rawIntent}". Use: supply, supplyCollateral, borrow, repay, withdraw, or withdrawCollateral.`,
        );
      }

      // 2) Validate market
      if (!rawMarket) {
        return await fail(
          'Missing market. Provide a market pair (e.g., "WETH/USDC") or marketId.',
        );
      }

      // 3) Validate assets (required for all operations except full repayment)
      if (!rawFullRepayment && !rawAssets) {
        return await fail(
          'Missing amount. Provide a pure number without units (e.g., "1", "0.5", "100").',
        );
      }

      let amountNum = 0;
      if (rawAssets) {
        amountNum = Number(rawAssets);
        if (!Number.isFinite(amountNum) || amountNum <= 0) {
          return await fail(
            `Invalid amount "${rawAssets}". Use a positive number without units (e.g., "1", "2.5").`,
          );
        }
      }

      const service = runtime.getService(
        MorphoService.serviceType,
      ) as MorphoService;
      const chainSlug = service.getChainSlug();

      // Execute the appropriate operation
      let hashes: `0x${string}`[] = [];
      let operationParams: any = { market: rawMarket };

      switch (rawIntent) {
        case "supply":
          operationParams.assets = rawAssets;
          hashes = await service.supply(operationParams, walletPrivateKey);
          break;

        case "supplycollateral":
          operationParams.assets = rawAssets;
          hashes = await service.supplyCollateral(
            operationParams,
            walletPrivateKey,
          );
          break;

        case "borrow":
          operationParams.assets = rawAssets;
          hashes = await service.borrow(operationParams, walletPrivateKey);
          break;

        case "repay":
          if (rawFullRepayment) {
            operationParams.fullRepayment = true;
          } else {
            operationParams.assets = rawAssets;
          }
          hashes = await service.repay(operationParams, walletPrivateKey);
          break;

        case "withdraw":
          operationParams.assets = rawAssets;
          hashes = await service.withdraw(operationParams, walletPrivateKey);
          break;

        case "withdrawcollateral":
          operationParams.assets = rawAssets;
          hashes = await service.withdrawCollateral(
            operationParams,
            walletPrivateKey,
          );
          break;

        default:
          return await fail(`Unsupported operation: ${rawIntent}`);
      }

      const urls = (hashes || []).map((h) => txUrl(chainSlug, h));
      const list = urls.length
        ? urls.map((u) => `• ${u}`).join("\n")
        : "• (no hash returned)";

      const emoji = getOperationEmoji(rawIntent);
      const description = getOperationDescription(rawIntent);
      const amountText = rawFullRepayment ? "full debt" : `${rawAssets} assets`;

      const text =
        `${emoji} **${description.toUpperCase()}** submitted for **${amountText}** in **${rawMarket}**.\n\n` +
        `**Transaction${hashes.length > 1 ? "s" : ""}:**\n${list}`;

      const data = {
        actionName: "MORPHO_MARKET_TRANSFER",
        intent: rawIntent,
        params: operationParams,
        txHashes: hashes,
        txUrls: urls,
        chain: chainSlug,
      };

      if (callback) {
        await callback({
          text,
          actions: ["MORPHO_MARKET_TRANSFER"],
          source: message.content.source,
          data,
        });
      }

      return {
        text,
        success: true,
        data,
        values: {
          intent: rawIntent,
          market: rawMarket,
          assets: rawAssets || "full",
          txCount: hashes.length,
          fullRepayment: rawFullRepayment,
        },
      };
    } catch (error: any) {
      const msg = error?.shortMessage || error?.message || String(error);
      const text = `❌ Market operation failed: ${msg}`;
      const data = { actionName: "MORPHO_MARKET_TRANSFER", error: msg };

      if (callback) {
        await callback({
          text,
          actions: ["MORPHO_MARKET_TRANSFER"],
          source: message.content.source,
          data,
        });
      }

      return {
        text,
        success: false,
        error: new Error(msg),
        data,
        values: { error: true },
      };
    }
  },
  examples: [
    [
      {
        name: "{{name1}}",
        content: { text: "Supply 1 USDC to WETH/USDC market" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "🏦 Supplying 1 USDC to earn yield in WETH/USDC market...",
          action: "MORPHO_MARKET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Provide 0.1 WETH as collateral in WETH/USDC" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "🔐 Providing 0.1 WETH as collateral in WETH/USDC market...",
          action: "MORPHO_MARKET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Borrow 100 USDC from WETH/USDC market" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "💸 Borrowing 100 USDC against WETH collateral...",
          action: "MORPHO_MARKET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Repay all my USDC debt in WETH/USDC" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "💰 Repaying all USDC debt in WETH/USDC market...",
          action: "MORPHO_MARKET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Withdraw 0.5 USDC from WETH/USDC" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "📤 Withdrawing 0.5 USDC from supply position...",
          action: "MORPHO_MARKET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Remove 0.05 WETH collateral from WETH/USDC" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "🔓 Removing 0.05 WETH collateral from WETH/USDC market...",
          action: "MORPHO_MARKET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Repay 50 USDC in WETH/USDC market" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "💰 Repaying 50 USDC debt in WETH/USDC market...",
          action: "MORPHO_MARKET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Lend 2 USDC to earn yield in WETH/USDC" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "🏦 Lending 2 USDC to earn yield in WETH/USDC market...",
          action: "MORPHO_MARKET_TRANSFER",
        },
      },
    ],
  ],
};
