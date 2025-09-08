import * as path from "node:path";
import {
  type IAgentRuntime,
  type Memory,
  type Provider,
  type ProviderResult,
  type State,
  elizaLogger,
  TEEMode,
  ServiceType,
} from "@elizaos/core";
import type {
  Account,
  Address,
  Chain,
  HttpTransport,
  PrivateKeyAccount,
  PublicClient,
  TestClient,
  WalletClient,
} from "viem";
import {
  http,
  createPublicClient,
  createTestClient,
  createWalletClient,
  formatUnits,
  publicActions,
  walletActions,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as viemChains from "viem/chains";

import { EVM_SERVICE_NAME } from "../constants";
import type { SupportedChain } from "../types";

export class WalletProvider {
  private cacheKey = "evm/wallet";
  chains: Record<string, Chain> = {};
  account!: PrivateKeyAccount;
  runtime: IAgentRuntime;
  constructor(
    accountOrPrivateKey: PrivateKeyAccount | `0x${string}`,
    runtime: IAgentRuntime,
    chains?: Record<string, Chain>,
  ) {
    this.setAccount(accountOrPrivateKey);
    if (chains) {
      this.chains = chains;
    }
    this.runtime = runtime;
  }

  getAddress(): Address {
    return this.account.address;
  }

  getPublicClient(
    chainName: SupportedChain,
  ): PublicClient<HttpTransport, Chain, Account | undefined> {
    const transport = this.createHttpTransport(chainName);

    const publicClient = createPublicClient({
      chain: this.chains[chainName],
      transport,
    });
    return publicClient;
  }

  getWalletClient(chainName: SupportedChain): WalletClient {
    const transport = this.createHttpTransport(chainName);

    const walletClient = createWalletClient({
      chain: this.chains[chainName],
      transport,
      account: this.account,
    });

    return walletClient;
  }

  getTestClient(): TestClient {
    return createTestClient({
      chain: viemChains.hardhat,
      mode: "hardhat",
      transport: http(),
    })
      .extend(publicActions)
      .extend(walletActions);
  }

  getChainConfigs(chainName: SupportedChain): Chain {
    const chain = this.chains[chainName];

    if (!chain?.id) {
      throw new Error(`Invalid chain name: ${chainName}`);
    }

    return chain;
  }

  getSupportedChains(): SupportedChain[] {
    return Object.keys(this.chains) as SupportedChain[];
  }

  async getWalletBalances(): Promise<Record<SupportedChain, string>> {
    const cacheKey = path.join(this.cacheKey, "walletBalances");
    const cachedData =
      await this.runtime.getCache<Record<SupportedChain, string>>(cacheKey);
    if (cachedData) {
      elizaLogger.log(`Returning cached wallet balances`);
      return cachedData;
    }

    const balances = {} as Record<SupportedChain, string>;
    const chainNames = this.getSupportedChains();

    await Promise.all(
      chainNames.map(async (chainName) => {
        try {
          const balance = await this.getWalletBalanceForChain(chainName);
          if (balance !== null) {
            balances[chainName] = balance;
          }
        } catch (error) {
          elizaLogger.error(`Error getting balance for ${chainName}:`, error);
        }
      }),
    );

    await this.runtime.setCache(cacheKey, balances);
    elizaLogger.log("Wallet balances cached");
    return balances;
  }

  async getWalletBalanceForChain(
    chainName: SupportedChain,
  ): Promise<string | null> {
    try {
      const client = this.getPublicClient(chainName);
      const balance = await client.getBalance({
        address: this.account.address,
      });
      return formatUnits(balance, 18);
    } catch (error) {
      console.error(`Error getting wallet balance for ${chainName}:`, error);
      return null;
    }
  }

  addChain(chain: Record<string, Chain>) {
    this.addChains(chain);
  }

  private setAccount = (
    accountOrPrivateKey: PrivateKeyAccount | `0x${string}`,
  ) => {
    if (typeof accountOrPrivateKey === "string") {
      this.account = privateKeyToAccount(accountOrPrivateKey);
    } else {
      this.account = accountOrPrivateKey;
    }
  };

  private addChains = (chains?: Record<string, Chain>) => {
    if (!chains) {
      return;
    }
    // Only add the chains that are explicitly provided
    this.chains = { ...this.chains, ...chains };
  };

  private createHttpTransport = (chainName: SupportedChain) => {
    const chain = this.chains[chainName];
    if (!chain) {
      throw new Error(`Chain not found: ${chainName}`);
    }

    if (chain.rpcUrls.custom) {
      return http(chain.rpcUrls.custom.http[0]);
    }
    return http(chain.rpcUrls.default.http[0]);
  };

  static genChainFromName(
    chainName: string,
    customRpcUrl?: string | null,
  ): Chain {
    const baseChain = (viemChains as any)[chainName];

    if (!baseChain?.id) {
      throw new Error("Invalid chain name");
    }

    const viemChain: Chain = customRpcUrl
      ? {
          ...baseChain,
          rpcUrls: {
            ...baseChain.rpcUrls,
            custom: {
              http: [customRpcUrl],
            },
          },
        }
      : baseChain;

    return viemChain;
  }
}

const genChainsFromRuntime = (
  runtime: IAgentRuntime,
): Record<string, Chain> => {
  // Get chains from settings - ONLY use configured chains
  const settings = runtime.character?.settings;
  const configuredChains =
    typeof settings === "object" &&
    settings !== null &&
    "chains" in settings &&
    typeof settings.chains === "object" &&
    settings.chains !== null &&
    "evm" in settings.chains
      ? (settings.chains.evm as SupportedChain[])
      : [];
  // If no chains are configured, default to mainnet and base
  const chainsToUse =
    configuredChains.length > 0 ? configuredChains : ["mainnet", "base"];

  if (!configuredChains.length) {
    elizaLogger.warn(
      "No EVM chains configured in settings, defaulting to mainnet and base",
    );
  }

  const chains: Record<string, Chain> = {};

  for (const chainName of chainsToUse) {
    try {
      // Try to get RPC URL from settings using different formats
      let rpcUrl = runtime.getSetting(
        `ETHEREUM_PROVIDER_${chainName.toUpperCase()}`,
      );

      if (!rpcUrl) {
        rpcUrl = runtime.getSetting(`EVM_PROVIDER_${chainName.toUpperCase()}`);
      }

      // Skip chains that don't exist in viem
      if (!(viemChains as any)[chainName]) {
        elizaLogger.warn(
          `Chain ${chainName} not found in viem chains, skipping`,
        );
        continue;
      }

      const chain = WalletProvider.genChainFromName(chainName, rpcUrl);
      chains[chainName] = chain;
      elizaLogger.log(`Configured chain: ${chainName}`);
    } catch (error) {
      elizaLogger.error(`Error configuring chain ${chainName}:`, error);
    }
  }

  return chains;
};

export const initWalletProvider = async (
  runtime: IAgentRuntime,
  privateKey: string,
) => {
  const chains = genChainsFromRuntime(runtime);

  if (!privateKey) {
    throw new Error("EVM_PRIVATE_KEY is missing");
  }
  return new WalletProvider(privateKey as `0x${string}`, runtime, chains);
};
