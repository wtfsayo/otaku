import {
  type Action,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type State,
  parseKeyValueXml,
  composePromptFromState,
  elizaLogger,
  ActionResult,
} from '@elizaos/core';
import {
  type Hex,
  formatEther,
  parseEther,
  parseAbi,
  encodeFunctionData,
  parseUnits,
  type Address,
} from 'viem';
import { getToken } from '@lifi/sdk';

import { type WalletProvider, initWalletProvider } from '../providers/wallet';
import { transferTemplate } from '../templates';
import type { Transaction, TransferParams } from '../types';

// Exported for tests
export class TransferAction {
  constructor(private walletProvider: WalletProvider) {}

  async transfer(params: TransferParams): Promise<Transaction> {
    const walletClient = this.walletProvider.getWalletClient(params.fromChain);

    if (!walletClient.account) {
      throw new Error('Wallet account is not available');
    }

    const chainConfig = this.walletProvider.getChainConfigs(params.fromChain);

    try {
      let hash: Hex;
      let to: Address;
      let value: bigint;
      let data: Hex;

      // Check if this is a token transfer or native transfer
      if (
        params.token &&
        params.token !== 'null' &&
        params.token.toUpperCase() !== chainConfig.nativeCurrency.symbol.toUpperCase()
      ) {
        // This is an ERC20 token transfer
        console.log(
          `Processing ${params.token} token transfer of ${params.amount} to ${params.toAddress}`
        );

        // First, resolve the token address
        const tokenAddress = await this.resolveTokenAddress(params.token, chainConfig.id);

        // Check if token was resolved properly
        if (tokenAddress === params.token && !tokenAddress.startsWith('0x')) {
          throw new Error(
            `Token ${params.token} not found on ${params.fromChain}. Please check the token symbol.`
          );
        }

        // Get token decimals
        const decimalsAbi = parseAbi(['function decimals() view returns (uint8)']);
        const decimals = await this.walletProvider.getPublicClient(params.fromChain).readContract({
          address: tokenAddress as Address,
          abi: decimalsAbi,
          functionName: 'decimals',
        });

        // Parse amount with correct decimals
        const amountInTokenUnits = parseUnits(params.amount, decimals);

        // Encode the ERC20 transfer function
        const transferData = encodeFunctionData({
          abi: parseAbi(['function transfer(address to, uint256 amount)']),
          functionName: 'transfer',
          args: [params.toAddress, amountInTokenUnits],
        });

        // For token transfers, we send to the token contract with 0 ETH value
        to = tokenAddress as Address;
        value = 0n;
        data = transferData;
      } else {
        // This is a native ETH transfer
        console.log(
          `Processing native ${chainConfig.nativeCurrency.symbol} transfer of ${params.amount} to ${params.toAddress}`
        );

        to = params.toAddress;
        value = parseEther(params.amount);
        data = params.data || ('0x' as Hex);
      }

      const transactionParams = {
        account: walletClient.account,
        to,
        value,
        data,
        chain: walletClient.chain,
      };

      hash = await walletClient.sendTransaction(transactionParams);
      console.log(`Transaction sent successfully. Hash: ${hash}`);

      return {
        hash,
        from: walletClient.account.address,
        to: params.toAddress, // Always return the recipient address, not the contract
        value: value,
        data: data,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Transfer failed: ${errorMessage}`);
    }
  }

  private async resolveTokenAddress(
    tokenSymbolOrAddress: string,
    chainId: number
  ): Promise<string> {
    // If it's already a valid address (starts with 0x and is 42 chars), return as is
    if (tokenSymbolOrAddress.startsWith('0x') && tokenSymbolOrAddress.length === 42) {
      return tokenSymbolOrAddress;
    }

    // If it's the zero address (native token), return as is
    if (tokenSymbolOrAddress === '0x0000000000000000000000000000000000000000') {
      return tokenSymbolOrAddress;
    }

    try {
      // Use LiFi SDK to resolve token symbol to address
      const token = await getToken(chainId, tokenSymbolOrAddress);
      return token.address;
    } catch (error) {
      elizaLogger.error(
        `Failed to resolve token ${tokenSymbolOrAddress} on chain ${chainId}:`,
        error
      );
      // If LiFi fails, return original value and let downstream handle the error
      return tokenSymbolOrAddress;
    }
  }
}

const buildTransferDetails = async (
  state: State,
  _message: Memory,
  runtime: IAgentRuntime,
  wp: WalletProvider
): Promise<TransferParams> => {
  const chains = wp.getSupportedChains();

  // Add balances to state for better context in template
  const balances = await wp.getWalletBalances();
  state.chainBalances = Object.entries(balances)
    .map(([chain, balance]) => {
      const chainConfig = wp.getChainConfigs(chain as any);
      return `${chain}: ${balance} ${chainConfig.nativeCurrency.symbol}`;
    })
    .join(', ');

  state = await runtime.composeState(_message, ['RECENT_MESSAGES'], true);
  state.supportedChains = chains.join(' | ');

  const context = composePromptFromState({
    state,
    template: transferTemplate,
  });

  const xmlResponse = await runtime.useModel(ModelType.TEXT_SMALL, {
    prompt: context,
  });

  const parsedXml = parseKeyValueXml(xmlResponse);

  if (!parsedXml) {
    throw new Error('Failed to parse XML response from LLM for transfer details.');
  }

  const transferDetails = parsedXml as unknown as TransferParams;

  // Normalize chain name to lowercase to handle case sensitivity issues
  const normalizedChainName = transferDetails.fromChain.toLowerCase();

  // Check if the normalized chain name exists in the supported chains
  const existingChain = wp.chains[normalizedChainName];

  if (!existingChain) {
    throw new Error(
      'The chain ' +
        transferDetails.fromChain +
        ' not configured yet. Add the chain or choose one from configured: ' +
        chains.toString()
    );
  }

  // Update the transferDetails with the normalized chain name
  transferDetails.fromChain = normalizedChainName as any;

  return transferDetails;
};

export const transferAction: Action = {
  name: 'EVM_TRANSFER_TOKENS',
  description:
    'Transfer native tokens (ETH, BNB, etc.) or ERC20 tokens (USDC, USDT, etc.) between addresses on the same chain',
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    _options: any,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    if (!state) {
      state = (await runtime.composeState(message)) as State;
    }

    const walletProvider = await initWalletProvider(runtime);
    const action = new TransferAction(walletProvider);

    // Compose transfer context
    const paramOptions = await buildTransferDetails(state, message, runtime, walletProvider);

    try {
      const transferResp = await action.transfer(paramOptions);

      // Determine token symbol for display
      const chainConfig = walletProvider.getChainConfigs(paramOptions.fromChain);
      const tokenSymbol =
        paramOptions.token &&
        paramOptions.token !== 'null' &&
        paramOptions.token.toUpperCase() !== chainConfig.nativeCurrency.symbol.toUpperCase()
          ? paramOptions.token.toUpperCase()
          : chainConfig.nativeCurrency.symbol;

      const successText =
        `✅ Successfully transferred ${paramOptions.amount} ${tokenSymbol} to ${paramOptions.toAddress}\n` +
        `Transaction Hash: ${transferResp.hash}`;

      if (callback) {
        callback({
          text: `Successfully transferred ${paramOptions.amount} ${tokenSymbol} to ${paramOptions.toAddress}\nTransaction Hash: ${transferResp.hash}`,
          content: {
            success: true,
            hash: transferResp.hash,
            amount: paramOptions.amount,
            token: tokenSymbol,
            recipient: transferResp.to,
            chain: paramOptions.fromChain,
          },
        });
      }
      return {
        success: true,
        text: successText,
        values: {
          transferSucceeded: true,
          tokenTransferred: tokenSymbol,
          recipientAddress: transferResp.to,
        },
        data: {
          actionName: 'EVM_TRANSFER_TOKENS',
          transactionHash: transferResp.hash,
          fromAddress: transferResp.from,
          toAddress: transferResp.to,
          token: tokenSymbol,
          amount: paramOptions.amount,
          chain: paramOptions.fromChain,
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failureText = `❌ Error transferring tokens: ${errorMessage}`;
      console.error('Error during token transfer:', errorMessage);
      if (callback) {
        callback({
          text: `Error transferring tokens: ${errorMessage}`,
          content: { error: errorMessage },
        });
      }
      return {
        success: false,
        text: failureText,
        values: {
          transferSucceeded: false,
          error: true,
          errorMessage,
        },
        data: {
          actionName: 'EVM_TRANSFER_TOKENS',
          error: errorMessage,
        },
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
  validate: async (runtime: IAgentRuntime) => {
    const privateKey = runtime.getSetting('EVM_PRIVATE_KEY');
    return typeof privateKey === 'string' && privateKey.startsWith('0x');
  },
  examples: [
    [
      {
        name: 'assistant',
        content: {
          text: "I'll help you transfer 1 ETH to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
          action: 'EVM_TRANSFER_TOKENS',
        },
      },
      {
        name: 'user',
        content: {
          text: 'Transfer 1 ETH to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
          action: 'EVM_TRANSFER_TOKENS',
        },
      },
    ],
  ],
  similes: ['EVM_TRANSFER', 'EVM_SEND_TOKENS', 'EVM_TOKEN_TRANSFER', 'EVM_MOVE_TOKENS'],
};
