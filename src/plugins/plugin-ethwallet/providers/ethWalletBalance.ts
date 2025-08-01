import {
  type IAgentRuntime,
  type Memory,
  type Provider,
  type State,
} from '@elizaos/core';

export const ethWalletBalanceProvider: Provider = {
  name: 'ETH_WALLET_BALANCE_PROVIDER',
  description: 'Provides dynamic balance information for Ethereum addresses mentioned in messages',
  dynamic: true,
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const evmChainService = runtime.getService('EVM_CHAIN_SERVICE') as any;
    
    if (!evmChainService) {
      return {
        data: {},
        values: {},
        text: ''
      };
    }

    const messageText = message.content.text || '';
    
    // Look for Ethereum addresses in the message (0x followed by 40 hex chars)
    const addressMatches = messageText.match(/0x[a-fA-F0-9]{40}/g);
    
    if (!addressMatches || addressMatches.length === 0) {
      return {
        data: {},
        values: {},
        text: ''
      };
    }

    // For simplicity, check the first address found
    const address = addressMatches[0];
    
    // Determine chain from message context (default to ethereum)
    let targetChain = 'ethereum';
    const supportedChains = evmChainService.getSupportedChains();
    
    for (const chain of supportedChains) {
      if (messageText.toLowerCase().includes(chain)) {
        targetChain = chain;
        break;
      }
    }

    try {
      const balance = await evmChainService.getWalletBalance(address, targetChain);
      
      if (!balance) {
        return {
          data: { address, chain: targetChain, error: 'Unable to fetch balance' },
          values: {},
          text: ''
        };
      }

      const nativeSymbol = targetChain === 'polygon' ? 'MATIC' : 'ETH';
      
      return {
        data: {
          address,
          chain: targetChain,
          balance: balance.nativeBalanceFormatted,
          nativeSymbol,
          rawBalance: balance.nativeBalance
        },
        values: {
          hasBalance: true,
          balanceValue: balance.nativeBalanceFormatted,
          addressFound: address,
          chainUsed: targetChain
        },
        text: `💰 Balance for ${address} on ${targetChain}: ${balance.nativeBalanceFormatted} ${nativeSymbol}`
      };
    } catch (error) {
      return {
        data: { address, chain: targetChain, error: 'Failed to fetch balance' },
        values: {},
        text: ''
      };
    }
  }
}; 