import {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  ModelType,
  parseKeyValueXml,
} from '@elizaos/core';
import { formatUnits, parseAbi, type Address } from 'viem';
import { getToken } from '@lifi/sdk';
import { initWalletProvider } from './wallet';
import type { SupportedChain } from '../types';

const tokenBalanceTemplate = `Extract the token ticker and blockchain from the user's message.

User message: "{{userMessage}}"

Return the token symbol and chain name in this format:
<response>
<token>TOKEN_SYMBOL</token>
<chain>CHAIN_NAME</chain>
</response>

If no token is mentioned or it's not a balance inquiry, return:
<response>
<error>Not a token balance request</error>
</response>`;

/**
 * Simple token balance provider that extracts token info from messages
 * and retrieves balances for transfer/swap/bridge operations
 */
export const tokenBalanceProvider: Provider = {
  name: 'TOKEN_BALANCE',
  description:
    'Token balance indicates specific erc20 token balance when onchain actions are requested e.g. transfer, swap, bridge',
  dynamic: true,
  get: async (runtime: IAgentRuntime, message: Memory): Promise<ProviderResult> => {
    try {
      // Extract token and chain using XML format
      const prompt = tokenBalanceTemplate.replace('{{userMessage}}', message.content.text || '');

      const response = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
        maxTokens: 100,
      });

      const parsed = parseKeyValueXml(response);

      if (!parsed || parsed.error || !parsed.token || !parsed.chain) {
        return { text: '', data: {}, values: {} };
      }

      const token = parsed.token.toUpperCase();
      const chain = parsed.chain.toLowerCase();

      // Get wallet provider and check chain support
      const walletProvider = await initWalletProvider(runtime);
      const chainConfig = walletProvider.getChainConfigs(chain as SupportedChain);
      const address = walletProvider.getAddress();

      // Get token info from LiFi
      const tokenData = await getToken(chainConfig.id, token);

      // Get balance
      const publicClient = walletProvider.getPublicClient(chain as SupportedChain);
      const balanceAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);

      const balance = await publicClient.readContract({
        address: tokenData.address as Address,
        abi: balanceAbi,
        functionName: 'balanceOf',
        args: [address],
      });

      const formattedBalance = formatUnits(balance, tokenData.decimals);

      return {
        text: `${token} balance on ${chain} for ${address}: ${formattedBalance}`,
        data: {
          token: tokenData.symbol,
          chain: chain,
          balance: formattedBalance,
          decimals: tokenData.decimals,
          address: tokenData.address,
          hasBalance: parseFloat(formattedBalance) > 0,
        },
        values: {
          token: tokenData.symbol,
          chain: chain,
          balance: formattedBalance,
          hasBalance: (parseFloat(formattedBalance) > 0).toString(),
        },
      };
    } catch (error) {
      return { text: '', data: {}, values: {} };
    }
  },
};
