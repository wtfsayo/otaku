import type { Plugin } from "@elizaos/core";

// Services
import { CdpService } from "./services/cdp.service";

// Actions
import { cdpWalletBalance } from "./actions/cdp-wallet-balance";
import { cdpCreateWallet } from "./actions/cdp-wallet-create";
import { cdpWalletInfo } from "./actions/cdp-wallet-info";
import { cdpWalletSwap } from "./actions/cdp-wallet-swap";
import { cdpWalletTransfer } from "./actions/cdp-wallet-transfer";

// Types
export type { CdpNetwork, CdpSwapNetwork, CdpTransferNetwork } from "./types";

export const cdpPlugin: Plugin = {
  name: "cdp",
  description:
    "Coinbase Developer Platform plugin providing authenticated EVM account creation, token transfers, and swaps via CDP SDK",
  evaluators: [],
  providers: [],
  actions: [cdpCreateWallet, cdpWalletInfo, cdpWalletBalance, cdpWalletSwap, cdpWalletTransfer, ],
  services: [CdpService],
};

export default cdpPlugin;


