import type { IAgentRuntime, Memory, Provider, State } from "@elizaos/core";

export const walletStateProvider: Provider = {
  name: "WALLET_STATE",
  description: "Indicates whether the user has an active Coinbase CDP wallet and its details",
  dynamic: true,
  get: async (runtime: IAgentRuntime, message: Memory, _state: State) => {
    const entityId = message.entityId;
    let hasWallet = false;
    let walletAddress = "";
    let walletProvider = "";
    let chain = "";

    try {
      const entity: any = await runtime.getEntityById(entityId);
      const wallet = entity?.metadata?.wallet;
      if (wallet && wallet.address) {
        hasWallet = true;
        walletAddress = wallet.address;
        walletProvider = wallet.provider || "cdp";
        chain = wallet.chain || "base";
      }
    } catch (_err) {
      // Swallow and present default values below
    }

    const walletState = hasWallet
      ? `Wallet detected: address ${walletAddress} (provider: ${walletProvider || "cdp"}, chain: ${chain || "base"}).`
      : "No CDP wallet found for this user.";

    const text = hasWallet
      ? `🔐 Wallet is set up and ready. Address: \`${walletAddress}\` (provider: ${walletProvider || "cdp"}, chain: ${chain || "base"}).`
      : "🚀 To use on-chain features, the user needs a Coinbase CDP wallet. Ask to create one with the CDP create wallet action when appropriate.";

    return {
      text,
      data: {
        hasWallet,
        walletAddress,
        walletProvider,
        chain,
      },
      values: {
        walletState,
        hasWallet: String(hasWallet),
        walletAddress,
        walletProvider,
        chain,
      },
    };
  },
};

export default walletStateProvider;


