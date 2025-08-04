import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger,
} from "@elizaos/core";

export const ethWalletList: Action = {
  name: "ETH_WALLET_LIST",
  similes: [
    "LIST_ETH_WALLETS",
    "SHOW_ETH_WALLETS",
    "MY_ETH_WALLETS",
    "ETH_WALLET_INFO",
  ],
  description: "List all Ethereum/EVM wallets and their information",
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const text = message.content.text?.toLowerCase() || "";
    const keywords = [
      "list",
      "show",
      "wallets",
      "my wallets",
      "wallet list",
      "eth wallets",
    ];

    return keywords.some((keyword) => text.includes(keyword));
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.log("ETH_WALLET_LIST handler started");

      const evmChainService = runtime.getService("EVM_CHAIN_SERVICE") as any;
      if (!evmChainService) {
        const errorText = "EVM wallet service is not available.";
        callback?.({
          text: errorText,
          content: { error: "Service not available" },
        });
        return {
          text: errorText,
          success: false,
          values: { walletsListed: false, error: true },
          data: {
            actionName: "ETH_WALLET_LIST",
            error: "Service not available",
          },
          error: new Error("Service not available"),
        };
      }

      // For this demo, we'll show supported chains and instructions
      // In a real implementation, you'd fetch user's stored wallets from a database
      const supportedChains = evmChainService.getSupportedChains();

      let responseText = "📋 **EVM Wallet Information**\n\n";
      responseText += "**Supported Chains:**\n";

      supportedChains.forEach((chain: string, index: number) => {
        responseText += `${index + 1}. ${chain.charAt(0).toUpperCase() + chain.slice(1)}\n`;
      });

      responseText += "\n**Available Commands:**\n";
      responseText +=
        "• `create ethereum wallet` - Create new Ethereum wallet\n";
      responseText += "• `create base wallet` - Create new Base wallet\n";
      responseText +=
        "• `create all wallets` - Create wallets for all chains\n";
      responseText +=
        "• `import wallet [private_key]` - Import existing wallet\n";
      responseText +=
        "• `check balance [address] [chain]` - Check wallet balance\n\n";

      responseText +=
        "💡 **Tip:** You can specify any supported chain when creating or importing wallets!";

      callback?.({
        text: responseText,
        content: {
          action: "wallet_list",
          supportedChains,
          totalChains: supportedChains.length,
        },
      });

      return {
        text: responseText,
        success: true,
        values: {
          walletsListed: true,
          supportedChainsCount: supportedChains.length,
        },
        data: {
          actionName: "ETH_WALLET_LIST",
          supportedChains,
          totalChains: supportedChains.length,
        },
      };
    } catch (error) {
      logger.error("Error in ETH_WALLET_LIST handler:", error);
      const errorText =
        "Sorry, there was an error listing wallets. Please try again.";
      callback?.({
        text: errorText,
        content: { error: "Handler error" },
      });
      return {
        text: errorText,
        success: false,
        values: { walletsListed: false, error: true },
        data: {
          actionName: "ETH_WALLET_LIST",
          error: error instanceof Error ? error.message : String(error),
        },
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "List my ETH wallets",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here are your wallet options and supported chains!",
          action: "ETH_WALLET_LIST",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Show wallet information",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "I'll show you the available wallet information!",
          action: "ETH_WALLET_LIST",
        },
      },
    ],
  ],
};
