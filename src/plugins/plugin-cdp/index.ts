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
import { cdpWalletTransfer } from "./actions/cdp-wallet-transfer";

export const cdpPlugin: Plugin = {
  name: "cdp",
  description:
    "Coinbase Developer Platform plugin providing authenticated EVM account creation, token transfers, and swaps via CDP SDK",
  evaluators: [],
  providers: [],
  actions: [cdpCreateWallet, cdpWalletInfo, cdpWalletBalance, cdpWalletSwap, cdpWalletTransfer],
  services: [CdpService],
};

export default cdpPlugin;


