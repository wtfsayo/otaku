import {
  logger,
  type IAgentRuntime,
  type Project,
  type ProjectAgent,
} from "@elizaos/core";
import { character } from "./character.ts";
import clankerPlugin from "./plugins//plugin-clanker/src/plugin.ts";
import evmPlugin from "./plugins/plugin-evm/src/index.ts";
import morphoPlugin from "./plugins/plugin-morpho/src/plugin.ts";
import ethWalletPlugin from "./plugins/plugin-ethwallet/index.ts";
import bootstrapPlugin from "./plugins/plugin-bootstrap/src/index.ts";

const initCharacter = ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info("Initializing character");
  logger.info("Name: ", character.name);
};

export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => await initCharacter({ runtime }),
  plugins: [
    bootstrapPlugin,
    evmPlugin,
    clankerPlugin,
    morphoPlugin,
    ethWalletPlugin,
  ],
};
const project: Project = {
  agents: [projectAgent],
};

// Export test suites for the test runner
export { character } from "./character.ts";

export default project;
