import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger,
} from "@elizaos/core";
import { getEntityWallet } from "../../../utils/entity";
import { CdpService } from "../services/cdp.service";

export const cdpWalletBalance: Action = {
  name: "CDP_WALLET_BALANCE",
  similes: [
    "CHECK_CDP_BALANCE",
    "CDP_BALANCE",
    "CDP_TOKENS",
    "CDP_ASSETS",
    "CDP_LIST_BALANCES",
  ],
  description:
    "List token balances for the user's CDP EVM account using Coinbase CDP",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = message.content.text?.toLowerCase() || "";
    return ["balance", "balances", "tokens", "assets", "cdp", "coinbase"].some(
      (k) => text.includes(k),
    );
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const cdpService = runtime.getService(CdpService.serviceType) as CdpService;

      // Ensure the user has a wallet saved; if not, return a friendly error
      const walletResult = await getEntityWallet(
        runtime,
        message,
        "CDP_WALLET_BALANCE",
        callback,
      );
      if (walletResult.success === false) {
        return walletResult.result;
      }

      // Retrieve account by stable name (entityId) to ensure consistency
      const account = await cdpService.getOrCreateAccount({ name: message.entityId });

      // Determine network; default to entity's chain or sensible default
      const defaultNetwork = walletResult.chain || "base"; // CDP commonly uses base/base-sepolia
      const network = (message.content?.metadata as any)?.network || defaultNetwork;

      const balancesResponse = await account.listTokenBalances({ network });

      const rows = balancesResponse?.balances || [];
      if (!rows.length) {
        const noBalText = `📭 No token balances found on ${network} for your CDP wallet.`;
        callback?.({ text: noBalText, content: { balances: [], network } });
        return {
          text: noBalText,
          success: true,
          data: { balances: [], network },
          values: { hasBalances: false },
        };
      }

      const sanitizeForJson = (value: unknown): any => {
        if (typeof value === "bigint") return value.toString();
        if (Array.isArray(value)) return value.map(sanitizeForJson);
        if (value && typeof value === "object") {
          const out: Record<string, any> = {};
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = sanitizeForJson(v);
          }
          return out;
        }
        return value;
      };

      const safeBalances = sanitizeForJson(rows);

      // Format human-readable amounts using token decimals
      const toIntegerString = (v: unknown): string => {
        if (typeof v === "bigint") return v.toString();
        if (typeof v === "number") return Math.trunc(v).toString();
        if (typeof v === "string") return v;
        return "0";
      };

      const formatUnits = (amountInBaseUnits: string, decimals: number): string => {
        if (!/^-?\d+$/.test(amountInBaseUnits)) return amountInBaseUnits;
        const negative = amountInBaseUnits.startsWith("-");
        const digits = negative ? amountInBaseUnits.slice(1) : amountInBaseUnits;
        const d = Math.max(0, decimals | 0);
        if (d === 0) return (negative ? "-" : "") + digits;
        const padded = digits.padStart(d + 1, "0");
        const i = padded.length - d;
        let head = padded.slice(0, i);
        let tail = padded.slice(i);
        // trim trailing zeros on fractional part
        tail = tail.replace(/0+$/, "");
        if (tail.length === 0) return (negative ? "-" : "") + head;
        // trim leading zeros on integer part
        head = head.replace(/^0+(?=\d)/, "");
        return (negative ? "-" : "") + head + "." + tail;
      };

      const formatted = rows.map((b: any) => {
        const symbol = b?.token?.symbol ?? b?.token?.name ?? "UNKNOWN";
        const raw = toIntegerString(b?.amount?.amount ?? b?.amount ?? "0");
        const decimals = (b?.amount?.decimals ?? b?.token?.decimals ?? 18) as number;
        const value = formatUnits(raw, decimals);
        return { symbol, value, raw, decimals };
      });

      const lines = formatted.map((f) => `- ${f.symbol}: ${f.value}`);

      const header = `💰 CDP Wallet Balances (${network})`;
      const text = `${header}\n\n${lines.join("\n")}`;

      callback?.({
        text,
        content: {
          balances: safeBalances,
          formattedBalances: formatted,
          network,
          address: walletResult.walletAddress,
        },
      });
      return {
        text,
        success: true,
        data: {
          balances: safeBalances,
          formattedBalances: formatted,
          network,
          address: walletResult.walletAddress,
        },
        values: { hasBalances: true },
      };
    } catch (error) {
      logger.error("CDP_WALLET_BALANCE error:", error);
      const msg = "Failed to fetch CDP wallet balances.";
      callback?.({ text: msg, content: { error: "cdp_wallet_balance_failed" } });
      return { text: msg, success: false, error: error as Error };
    }
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "check my cdp balances" } },
      {
        name: "{{agent}}",
        content: { text: "Fetching balances...", action: "CDP_WALLET_BALANCE" },
      },
    ],
    [
      { name: "{{user}}", content: { text: "what tokens are in my coinbase wallet?" } },
      {
        name: "{{agent}}",
        content: { text: "Listing tokens...", action: "CDP_WALLET_BALANCE" },
      },
    ],
  ],
};

export default cdpWalletBalance;


