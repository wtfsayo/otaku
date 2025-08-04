import type { Plugin } from "@elizaos/core";

// Actions
import { ethWalletCreate } from "./actions/act_eth_wallet_create";
// import { ethWalletImport } from "./actions/act_eth_wallet_import";
// import { ethWalletList } from "./actions/act_eth_wallet_list";
import { ethWalletInfo } from "./actions/act_eth_wallet_info";

// Providers
// import { ethWalletProvider } from "./providers/ethWallet";
// import { ethWalletBalanceProvider } from "./providers/ethWalletBalance";
import { walletStatusProvider } from "./providers/walletStatusProvider";

// Services
import { EVMChainService } from "./services/evmChainService";
import { EVMWalletService } from "./services/evmWalletService";

export const ethWalletPlugin: Plugin = {
  name: "eth-wallet",
  description:
    "Ethereum and EVM chain wallet plugin for creating and managing ETH wallets",
  evaluators: [],
  providers: [walletStatusProvider],
  actions: [
    ethWalletCreate,
    // ethWalletImport,
    // ethWalletList,
    ethWalletInfo,
  ],
  services: [EVMChainService, EVMWalletService],
};

export default ethWalletPlugin;
