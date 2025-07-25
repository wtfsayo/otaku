export * from './actions/bridge';
export * from './actions/swap';
export * from './actions/transfer';
export * from './providers/wallet';
export * from './providers/get-balance';
export * from './service';
export * from './types';

import type { Plugin } from '@elizaos/core';
import { bridgeAction } from './actions/bridge';
import { swapAction } from './actions/swap';
import { transferAction } from './actions/transfer';
import { evmWalletProvider } from './providers/wallet';
import { tokenBalanceProvider } from './providers/get-balance';
import { EVMService } from './service';

export const evmPlugin: Plugin = {
  name: 'evm',
  description: 'EVM blockchain integration plugin',
  providers: [evmWalletProvider, tokenBalanceProvider],
  evaluators: [],
  services: [EVMService],
  actions: [transferAction, bridgeAction, swapAction],
};

export default evmPlugin;
