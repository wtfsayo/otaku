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
    try {
      // Check if services are available
      const cdpService = _runtime.getService(
        CdpService.serviceType,
      ) as CdpService;

      if (!cdpService) {
        logger.warn("Required services not available for token deployment");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "Error validating token deployment action:",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
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

      // Define all supported mainnet networks for CDP listTokenBalances API
      // Note: Currently CDP only supports base and ethereum for token balance queries
      const mainnetNetworks = ["ethereum", "base"] as const;

      // Collect balances from all mainnets
      type NetworkBalances = {
        network: typeof mainnetNetworks[number];
        balances: Array<any>;
      };
      
      const balancePromises = mainnetNetworks.map(async (network) => {
        try {
          const balancesResponse = await account.listTokenBalances({ network });
          const balances = balancesResponse?.balances || [];
          
          if (balances.length > 0) {
            return { network, balances };
          }
          return null;
        } catch (error) {
          logger.warn(`Failed to fetch balances for ${network}:`, error);
          return null;
        }
      });
      
      const results = await Promise.all(balancePromises);
      
      const allNetworkBalances: NetworkBalances[] = results.filter(
        (result): result is NetworkBalances => result !== null
      );

      if (allNetworkBalances.length === 0) {
        const noBalText = `📭 No token balances found across any mainnets for your CDP wallet.`;
        callback?.({ text: noBalText, content: { balances: [], networks: mainnetNetworks } });
        return {
          text: noBalText,
          success: true,
          data: { balances: [], networks: mainnetNetworks },
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

      const formatBalancesForNetwork = (balances: Array<any>) => {
        return balances.map((b: any) => {
          const symbol = b?.token?.symbol ?? b?.token?.name ?? "UNKNOWN";
          const raw = toIntegerString(b?.amount?.amount ?? b?.amount ?? "0");
          const decimals = (b?.amount?.decimals ?? b?.token?.decimals ?? 18) as number;
          const value = formatUnits(raw, decimals);
          return { symbol, value, raw, decimals };
        });
      };

      // Format balances for all networks
      const formattedByNetwork = allNetworkBalances.map(({ network, balances }) => {
        const formatted = formatBalancesForNetwork(balances);
        const lines = formatted.map((f) => `  - ${f.symbol}: ${f.value}`);
        return {
          network,
          text: `\n💰 ${network.toUpperCase()}\n${lines.join("\n")}`,
          formatted,
          balances: sanitizeForJson(balances),
        };
      });

      const header = `💰 CDP Wallet Balances Across All Mainnets`;
      const networkSections = formattedByNetwork.map((n) => n.text).join("\n");
      const text = `${header}\n${networkSections}`;

      const allFormattedBalances = formattedByNetwork.flatMap((n) => 
        n.formatted.map((f) => ({ ...f, network: n.network }))
      );
      const allSafeBalances = formattedByNetwork.flatMap((n) => n.balances);

      callback?.({
        text,
        content: {
          balancesByNetwork: formattedByNetwork,
          balances: allSafeBalances,
          formattedBalances: allFormattedBalances,
          networks: allNetworkBalances.map((n) => n.network),
          address: walletResult.walletAddress,
        },
      });
      return {
        text,
        success: true,
        data: {
          balancesByNetwork: formattedByNetwork,
          balances: allSafeBalances,
          formattedBalances: allFormattedBalances,
          networks: allNetworkBalances.map((n) => n.network),
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


