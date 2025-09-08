import { IAgentRuntime, Service, logger } from "@elizaos/core";
import { EVMWalletService } from "./evmWalletService";
import { getAllChainNames, getMainnetChains } from "../config/chains";
import { EVMWallet } from "../types";

export class EVMChainService extends Service {
  static serviceType = "EVM_CHAIN_SERVICE";
  capabilityDescription = "";
  private walletService: EVMWalletService;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.walletService = new EVMWalletService(runtime);
    logger.log("EVM Chain Service initialized");
  }

  /**
   * Create wallets for all supported mainnet chains
   */
  async createMultiChainWallet(): Promise<Record<string, EVMWallet>> {
    const chains = getMainnetChains();
    const wallets: Record<string, EVMWallet> = {};

    for (const chain of chains) {
      const result = await this.walletService.createWallet(chain);
      if (result.success && result.wallet) {
        wallets[chain] = result.wallet;
        logger.log(`Created wallet for ${chain}: ${result.wallet.address}`);
      } else {
        logger.error(`Failed to create wallet for ${chain}: ${result.error}`);
      }
    }

    return wallets;
  }

  /**
   * Create wallet for a specific chain
   */
  async createWallet(
    chainName: string = "ethereum",
  ): Promise<EVMWallet | null> {
    const result = await this.walletService.createWallet(chainName);
    if (result.success && result.wallet) {
      return result.wallet;
    }
    logger.error(`Failed to create wallet for ${chainName}: ${result.error}`);
    return null;
  }

  /**
   * Import wallet for a specific chain
   */
  async importWallet(
    privateKey: string,
    chainName: string = "ethereum",
  ): Promise<EVMWallet | null> {
    const result = await this.walletService.importWallet(privateKey, chainName);
    if (result.success && result.wallet) {
      return result.wallet;
    }
    logger.error(`Failed to import wallet for ${chainName}: ${result.error}`);
    return null;
  }

  /**
   * Get all supported chains
   */
  getSupportedChains(): string[] {
    return getAllChainNames();
  }

  /**
   * Get mainnet chains only
   */
  getMainnetChains(): string[] {
    return getMainnetChains();
  }

  /**
   * Check if a chain is supported
   */
  isChainSupported(chainName: string): boolean {
    return getAllChainNames().includes(chainName.toLowerCase());
  }

  /**
   * Get wallet balance for an address on a specific chain
   */
  async getWalletBalance(address: string, chainName: string) {
    return this.walletService.getWalletBalance(address, chainName);
  }

  /**
   * Validate private key
   */
  isValidPrivateKey(privateKey: string): boolean {
    return this.walletService.isValidPrivateKey(privateKey);
  }

  /**
   * Validate address
   */
  isValidAddress(address: string): boolean {
    return this.walletService.isValidAddress(address);
  }

  /**
   * Detect private keys from text (similar to Solana service)
   */
  detectPrivateKeysFromString(
    text: string,
  ): Array<{ format: string; match: string; key: string }> {
    const keys: Array<{ format: string; match: string; key: string }> = [];

    // Ethereum private key patterns
    const patterns = [
      // 0x prefixed hex (64 chars)
      /0x[a-fA-F0-9]{64}/g,
      // Plain hex (64 chars)
      /\b[a-fA-F0-9]{64}\b/g,
    ];

    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          const cleanKey = match.startsWith("0x") ? match : `0x${match}`;
          if (this.isValidPrivateKey(cleanKey)) {
            keys.push({
              format: "ethereum_hex",
              match: match,
              key: cleanKey,
            });
          }
        }
      }
    }

    return keys;
  }

  static async start(runtime: IAgentRuntime): Promise<EVMChainService> {
    const service = new EVMChainService(runtime);
    return service;
  }

  async stop(): Promise<void> {}
}
