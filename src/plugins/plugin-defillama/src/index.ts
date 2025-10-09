import type { Plugin } from "@elizaos/core";
import { DefiLlamaService } from "./services/defillama.service";
import { getProtocolTvlAction } from "./actions/getProtocolTvl.action";

export const defiLlamaPlugin: Plugin = {
  name: "plugin-defillama",
  description: "DeFiLlama integration: protocol lookups by name/symbol",
  actions: [getProtocolTvlAction],
  evaluators: [],
  providers: [],
  services: [DefiLlamaService],
};

export default defiLlamaPlugin;
export { DefiLlamaService, getProtocolTvlAction };


