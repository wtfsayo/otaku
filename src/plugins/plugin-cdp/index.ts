import type { Plugin } from "@elizaos/core";

// Services
import { CdpService } from "./services/cdp.service";

// Providers
// no providers (auth removed)

// Actions
import { cdpCreateWallet } from "./actions/cdp-wallet-create";
import { cdpWalletInfo } from "./actions/cdp-wallet-info";
import { cdpWalletBalance } from "./actions/cdp-wallet-balance";
import { cdpWalletSwap } from "./actions/cdp-wallet-swap";

export const cdpPlugin: Plugin = {
  name: "cdp",
  description:
    "Coinbase Developer Platform plugin providing authenticated EVM account creation and token swaps via CDP SDK",
  evaluators: [],
  providers: [],
  actions: [cdpCreateWallet, cdpWalletInfo, cdpWalletBalance, cdpWalletSwap],
  services: [CdpService],
};

export default cdpPlugin;


