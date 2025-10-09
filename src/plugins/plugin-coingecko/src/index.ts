import type { Plugin } from "@elizaos/core";
import { CoinGeckoService } from "./services/coingecko.service";
import { getTokenMetadataAction } from "./actions/getTokenMetadata.action";

export const coingeckoPlugin: Plugin = {
  name: "plugin-coingecko",
  description: "CoinGecko plugin exposing token metadata lookup",
  actions: [getTokenMetadataAction],
  services: [CoinGeckoService],
  evaluators: [],
  providers: [],
};

export default coingeckoPlugin;

export { CoinGeckoService, getTokenMetadataAction };


