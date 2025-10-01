import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
} from "@elizaos/core";
import { getEntityWallet } from "../../../utils/entity";
import { CdpService } from "../services/cdp.service";

export const cdpWalletInfo: Action = {
  name: "CDP_WALLET_INFO",
  similes: ["CDP_WALLET_DETAILS", "CDP_ADDRESS", "COINBASE_WALLET_INFO"],
  description: "Show saved Coinbase CDP wallet info for the current user",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = message.content.text?.toLowerCase() || "";
    return ["wallet", "info", "address", "cdp", "coinbase"].some((k) =>
      text.includes(k),
    );
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    const wallet = await getEntityWallet(
      runtime,
      message,
      "CDP_WALLET_INFO",
      callback,
    );

    if (wallet.success === false) {
      return wallet.result;
    }

    const address = wallet.walletAddress;
    const chain = wallet.chain ?? "base";

    const text =
      `🏦 CDP Wallet Info\n\n` +
      `Address: \`${address}\`\n` +
      `Chain: ${chain}`;

    callback?.({ text, content: { address, chain } });
    return { text, success: true, data: { address, chain } };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "show my cdp wallet info" } },
      { name: "{{agent}}", content: { text: "Fetching...", action: "CDP_WALLET_INFO" } },
    ],
  ],
};

export default cdpWalletInfo;


