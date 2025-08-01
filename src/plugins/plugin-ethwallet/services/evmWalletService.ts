import { IAgentRuntime, Service, logger } from "@elizaos/core";
import { ethers } from "ethers";
import { EVMWallet, WalletCreationResult, WalletBalance } from "../types";
import { getChainConfig, SUPPORTED_EVM_CHAINS } from "../config/chains";

export class EVMWalletService extends Service {
  static serviceType = "EVM_WALLET_SERVICE";
  capabilityDescription = "";
  constructor(runtime: IAgentRuntime) {
    super(runtime);
    logger.log("EVM Wallet Service initialized");
  }

  /**
   * Create a new EVM wallet for the specified chain
   */
  async createWallet(
    chainName: string = "ethereum"
  ): Promise<WalletCreationResult> {
    try {
      const chainConfig = getChainConfig(chainName);
      if (!chainConfig) {
        return {
          success: false,
          error: `Unsupported chain: ${chainName}. Supported chains: ${Object.keys(SUPPORTED_EVM_CHAINS).join(", ")}`,
        };
      }

      // Generate new wallet
      const wallet = ethers.Wallet.createRandom();

      const evmWallet: EVMWallet = {
        privateKey: wallet.privateKey,
        publicKey: wallet.signingKey.publicKey,
        address: wallet.address,
        chain: chainName,
        type: "generated",
        createdAt: Date.now(),
      };

      logger.log(`Created new ${chainName} wallet: ${wallet.address}`);

      return {
        success: true,
        wallet: evmWallet,
      };
    } catch (error) {
      logger.error("Error creating wallet:", error);
      return {
        success: false,
        error: `Failed to create wallet: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Import an existing wallet from private key
   */
  async importWallet(
    privateKey: string,
    chainName: string = "ethereum"
  ): Promise<WalletCreationResult> {
    try {
      const chainConfig = getChainConfig(chainName);
      if (!chainConfig) {
        return {
          success: false,
          error: `Unsupported chain: ${chainName}`,
        };
      }

      // Validate and import wallet
      const wallet = new ethers.Wallet(privateKey);

      const evmWallet: EVMWallet = {
        privateKey: wallet.privateKey,
        publicKey: wallet.signingKey.publicKey,
        address: wallet.address,
        chain: chainName,
        type: "imported",
        createdAt: Date.now(),
      };

      logger.log(`Imported ${chainName} wallet: ${wallet.address}`);

      return {
        success: true,
        wallet: evmWallet,
      };
    } catch (error) {
      logger.error("Error importing wallet:", error);
      return {
        success: false,
        error: `Failed to import wallet: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get wallet balance for a specific address and chain
   */
  async getWalletBalance(
    address: string,
    chainName: string
  ): Promise<WalletBalance | null> {
    try {
      const chainConfig = getChainConfig(chainName);
      if (!chainConfig) {
        logger.error(`Unsupported chain: ${chainName}`);
        return null;
      }

      const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
      const balanceWei = await provider.getBalance(address);
      const balanceFormatted = ethers.formatEther(balanceWei);

      return {
        address,
        chain: chainName,
        nativeBalance: balanceWei.toString(),
        nativeBalanceFormatted: balanceFormatted,
        tokens: [], // TODO: Implement token balance fetching
      };
    } catch (error) {
      logger.error(
        `Error getting balance for ${address} on ${chainName}:`,
        error
      );
      return null;
    }
  }

  /**
   * Validate if a private key is valid for EVM chains
   */
  isValidPrivateKey(privateKey: string): boolean {
    try {
      new ethers.Wallet(privateKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate if an address is a valid Ethereum address
   */
  isValidAddress(address: string): boolean {
    return ethers.isAddress(address);
  }

  /**
   * Get provider for a specific chain
   */
  getProvider(chainName: string): ethers.JsonRpcProvider | null {
    const chainConfig = getChainConfig(chainName);
    if (!chainConfig) {
      return null;
    }
    return new ethers.JsonRpcProvider(chainConfig.rpcUrl);
  }

  /**
   * Get supported chains
   */
  getSupportedChains(): string[] {
    return Object.keys(SUPPORTED_EVM_CHAINS);
  }

  static async start(runtime: IAgentRuntime): Promise<EVMWalletService> {
    const service = new EVMWalletService(runtime);
    return service;
  }

  async stop(): Promise<void> {}
}
