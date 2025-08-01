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

function getTransferXmlPrompt(userMessage: string): string {
  return `<task>Extract an intent (deposit or withdraw), vault, and amount for a Morpho vault transfer.</task>

<message>
${userMessage}
</message>

<instructions>
Return ONLY the following XML. Do not add any extra text.

<request>
  <intent>deposit</intent>
  <vault>Spark USDC Vault</vault>
  <assets>1</assets>
</request>

Rules:
- <intent> must be either "deposit" or "withdraw".
- Do NOT invent defaults. If the user didn't specify a field, omit that tag.
- If a 0x-address is present for the vault, keep it as-is. Otherwise use the name/substring.
- <assets> should be a pure number WITHOUT units or symbols (e.g., "1", "0.5", "100").
- IMPORTANT: Extract only the numeric value for <assets>, ignore token symbols like "USDC", "WETH", etc.

Examples:
- "Deposit 1 USDC into Spark USDC Vault" → intent: deposit, vault: Spark USDC Vault, assets: 1
- "Withdraw 2.5 usdc from vault" → intent: withdraw, vault: vault, assets: 2.5
- "Deposit 0.1 into 0x123..." → intent: deposit, vault: 0x123..., assets: 0.1
</instructions>`;
}

function txUrl(chainSlug: "base" | "base-sepolia", hash: `0x${string}`) {
  if (chainSlug === "base-sepolia")
    return `https://sepolia.basescan.org/tx/${hash}`;
  return `https://basescan.org/tx/${hash}`;
}

export const vaultTransferAction: Action = {
  name: "MORPHO_VAULT_TRANSFER",
  similes: [
    "VAULT_TRANSFER",
    "MORPHO_DEPOSIT",
    "MORPHO_WITHDRAW",
    "DEPOSIT_TO_VAULT",
    "WITHDRAW_FROM_VAULT",
  ],
  description:
    "Deposit to or withdraw from a Morpho ERC-4626 vault by name or address.",
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
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    logger.info("Starting MORPHO_VAULT_TRANSFER");

    // helper to return + callback with a failure reason
    const fail = async (reason: string): Promise<ActionResult> => {
      const text =
        `❌ Vault transfer failed: ${reason}\n\n` +
        `**How to use (specify pure numbers without units):** e.g. \`Deposit 1 into Spark USDC Vault\` or \`Withdraw 2.5 from vault\``;
      const data = { actionName: "MORPHO_VAULT_TRANSFER", error: reason };

      if (callback) {
        await callback({
          text,
          actions: ["MORPHO_VAULT_TRANSFER"],
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
      logger.info("Handling MORPHO_VAULT_TRANSFER action");

      // Get entity wallet address
      const walletResult = await getEntityWallet(
        runtime,
        message,
        "MORPHO_VAULT_TRANSFER",
        callback
      );
      if (!walletResult.success) {
        return walletResult.result;
      }
      const walletPrivateKey = walletResult.walletPrivateKey;

      const userText = message.content.text || "";
      const prompt = getTransferXmlPrompt(userText);
      const xml = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
      const parsed = parseKeyValueXml(xml) || {};

      const rawIntent = parsed.intent?.toString().trim().toLowerCase();
      const rawVault = parsed.vault?.toString().trim();
      const rawAssets = parsed.assets?.toString().trim();

      // 1) Validate intent
      if (!rawIntent) {
        return await fail(
          'Missing intent. Please specify "deposit" or "withdraw".'
        );
      }
      if (rawIntent !== "deposit" && rawIntent !== "withdraw") {
        return await fail(
          `Invalid intent "${rawIntent}". Use "deposit" or "withdraw".`
        );
      }

      // 2) Validate vault
      if (!rawVault) {
        return await fail(
          'Missing vault. Provide a vault name (e.g., "Spark USDC Vault") or a 0x-address.'
        );
      }

      // 3) Validate assets (must be a positive numeric string)
      if (!rawAssets) {
        return await fail(
          'Missing amount. Provide a pure number without units (e.g., "1", "0.5", "100").'
        );
      }
      const amountNum = Number(rawAssets);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        return await fail(
          `Invalid amount "${rawAssets}". Use a positive number without units (e.g., "1", "2.5").`
        );
      }

      const service = runtime.getService(
        MorphoService.serviceType
      ) as MorphoService;
      const chainSlug = service.getChainSlug(); // 'base' | 'base-sepolia'

      let hashes: `0x${string}`[] = [];
      if (rawIntent === "withdraw") {
        hashes = await service.withdrawFromVault(
          {
            vault: rawVault,
            assets: rawAssets,
          },
          walletPrivateKey
        );
      } else {
        hashes = await service.depositToVault(
          {
            vault: rawVault,
            assets: rawAssets,
            approveAmount: "max",
          },
          walletPrivateKey
        );
      }

      const urls = (hashes || []).map((h) => txUrl(chainSlug, h));
      const list = urls.length
        ? urls.map((u) => `• ${u}`).join("\n")
        : "• (no hash returned)";

      const text =
        `✅ **${rawIntent.toUpperCase()}** submitted for **${rawAssets}** in **${rawVault}**.\n\n` +
        `**Transaction${hashes.length > 1 ? "s" : ""}:**\n${list}`;

      const data = {
        actionName: "MORPHO_VAULT_TRANSFER",
        intent: rawIntent,
        params: { vault: rawVault, assets: rawAssets },
        txHashes: hashes,
        txUrls: urls,
        chain: chainSlug,
      };

      if (callback) {
        await callback({
          text,
          actions: ["MORPHO_VAULT_TRANSFER"],
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
          vault: rawVault,
          assets: rawAssets,
          txCount: hashes.length,
        },
      };
    } catch (error: any) {
      const msg = error?.shortMessage || error?.message || String(error);
      const text = `❌ Vault transfer failed: ${msg}`;
      const data = { actionName: "MORPHO_VAULT_TRANSFER", error: msg };

      if (callback) {
        await callback({
          text,
          actions: ["MORPHO_VAULT_TRANSFER"],
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
        name: "{{user1}}",
        content: { text: "Deposit 1 USDC into Spark USDC Vault" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Submitting your deposit...",
          action: "MORPHO_VAULT_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Withdraw 1 from Spark USDC Vault" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Submitting your withdrawal...",
          action: "MORPHO_VAULT_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: {
          text: "Deposit into 0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A amount 2",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Submitting your deposit...",
          action: "MORPHO_VAULT_TRANSFER",
        },
      },
    ],
  ],
};
