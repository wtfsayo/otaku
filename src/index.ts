import {
  logger,
  type IAgentRuntime,
  type Project,
  type ProjectAgent,
} from "@elizaos/core";
import { character } from "./character.ts";
import evmPlugin from "./plugin-evm/src/index.ts";


const initCharacter = ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info("Initializing character");
  logger.info("Name: ", character.name);
};

export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => await initCharacter({ runtime }),
  plugins: [evmPlugin],
};
const project: Project = {
  agents: [projectAgent],
};

// Export test suites for the test runner
export { character } from "./character.ts";

export default project;
