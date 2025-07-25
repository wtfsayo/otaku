import { type IAgentRuntime, Service, logger } from '@elizaos/core';
import {
  CACHE_REFRESH_INTERVAL_MS,
  EVM_SERVICE_NAME,
  EVM_WALLET_DATA_CACHE_KEY,
} from './constants';
import { type WalletProvider, initWalletProvider } from './providers/wallet';
import type { SupportedChain } from './types';

export interface EVMWalletData {
  address: string;
  chains: {
    chainName: string;
    name: string;
    balance: string;
    symbol: string;
    chainId: number;
  }[];
  timestamp: number;
}

export class EVMService extends Service {
  static serviceType: string = EVM_SERVICE_NAME;
  capabilityDescription = 'EVM blockchain wallet access';

  private walletProvider: WalletProvider | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;
  private lastRefreshTimestamp = 0;

  constructor(protected runtime: IAgentRuntime) {
    super();
  }

  static async start(runtime: IAgentRuntime): Promise<EVMService> {
    logger.log('Initializing EVMService');

    const evmService = new EVMService(runtime);

    // Initialize wallet provider
    evmService.walletProvider = await initWalletProvider(runtime);

    // Fetch data immediately on initialization
    await evmService.refreshWalletData();

    // Set up refresh interval
    if (evmService.refreshInterval) {
      clearInterval(evmService.refreshInterval);
    }

    evmService.refreshInterval = setInterval(
      () => evmService.refreshWalletData(),
      CACHE_REFRESH_INTERVAL_MS
    );

    logger.log('EVM service initialized');
    return evmService;
  }

  static async stop(runtime: IAgentRuntime) {
    const service = runtime.getService(EVM_SERVICE_NAME);
    if (!service) {
      logger.error('EVMService not found');
      return;
    }
    await service.stop();
  }

  async stop(): Promise<void> {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    logger.log('EVM service shutdown');
  }

  async refreshWalletData(): Promise<void> {
    try {
      if (!this.walletProvider) {
        this.walletProvider = await initWalletProvider(this.runtime);
      }

      const address = this.walletProvider.getAddress();
      const balances = await this.walletProvider.getWalletBalances();

      // Format balances for all chains
      const chainDetails = Object.entries(balances)
        .map(([chainName, balance]) => {
          try {
            const chain = this.walletProvider!.getChainConfigs(chainName as SupportedChain);
            return {
              chainName,
              balance,
              symbol: chain.nativeCurrency.symbol,
              chainId: chain.id,
              name: chain.name,
            };
          } catch (error) {
            logger.error(`Error formatting chain ${chainName}:`, error);
            return null;
          }
        })
        .filter(Boolean);

      const walletData: EVMWalletData = {
        address,
        chains: chainDetails as EVMWalletData['chains'],
        timestamp: Date.now(),
      };

      // Cache the wallet data
      await this.runtime.setCache(EVM_WALLET_DATA_CACHE_KEY, walletData);
      this.lastRefreshTimestamp = walletData.timestamp;

      logger.log(
        'EVM wallet data refreshed for chains:',
        chainDetails.map((c) => c?.chainName).join(', ')
      );
    } catch (error) {
      logger.error('Error refreshing EVM wallet data:', error);
    }
  }

  async getCachedData(): Promise<EVMWalletData | undefined> {
    try {
      const cachedData = await this.runtime.getCache<EVMWalletData>(EVM_WALLET_DATA_CACHE_KEY);

      const now = Date.now();
      // If data is stale or doesn't exist, refresh it
      if (!cachedData || now - cachedData.timestamp > CACHE_REFRESH_INTERVAL_MS) {
        logger.log('EVM wallet data is stale, refreshing...');
        await this.refreshWalletData();
        const refreshedData = await this.runtime.getCache<EVMWalletData>(EVM_WALLET_DATA_CACHE_KEY);
        return refreshedData || undefined;
      }

      return cachedData;
    } catch (error) {
      logger.error('Error getting cached EVM wallet data:', error);
      return undefined;
    }
  }

  async forceUpdate(): Promise<EVMWalletData | undefined> {
    await this.refreshWalletData();
    return this.getCachedData();
  }
}
