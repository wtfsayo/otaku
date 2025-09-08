import { IAgentRuntime, Service, logger } from "@elizaos/core";
import { ethers } from "ethers";
import {
  EVMWallet,
  WalletCreationResult,
  WalletBalance,
  TokenBalance,
} from "../types";
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
    chainName: string = "ethereum",
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
    chainName: string = "ethereum",
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
    chainName: string,
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

      // Fetch token balances using Alchemy approach (like clanker service)
      const tokens = await this.getAllTokensInWallet(
        address,
        chainConfig.rpcUrl,
      );

      return {
        address,
        chain: chainName,
        nativeBalance: balanceWei.toString(),
        nativeBalanceFormatted: balanceFormatted,
        tokens,
      };
    } catch (error) {
      logger.error(
        `Error getting balance for ${address} on ${chainName}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Get ALL tokens in wallet using Alchemy API (copied from clanker service)
   */
  async getAllTokensInWallet(
    walletAddress: string,
    rpcUrl: string,
  ): Promise<TokenBalance[]> {
    try {
      // Check if this is an Alchemy endpoint
      if (!rpcUrl.includes("alchemy.com")) {
        logger.debug("Not an Alchemy endpoint, skipping token balance fetch");
        return [];
      }

      // Step 1: Fetch token balances via Alchemy
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "alchemy_getTokenBalances",
          params: [walletAddress],
        }),
      });

      const json = (await response.json()) as any;
      const balances = json?.result?.tokenBalances || [];

      if (!Array.isArray(balances)) {
        logger.debug("Unexpected response format from Alchemy");
        return [];
      }

      const tokenBalances: TokenBalance[] = [];

      // Step 2: Loop and enrich token info (only non-zero balances)
      for (const { contractAddress, tokenBalance } of balances) {
        try {
          // Only process tokens with non-zero balance
          if (BigInt(tokenBalance) > 0n) {
            const tokenInfo = await this.getTokenInfo(contractAddress, rpcUrl);
            if (tokenInfo) {
              const balanceFormatted = ethers.formatUnits(
                tokenBalance,
                tokenInfo.decimals,
              );

              tokenBalances.push({
                contractAddress,
                symbol: tokenInfo.symbol,
                name: tokenInfo.name,
                balance: tokenBalance,
                balanceFormatted,
                decimals: tokenInfo.decimals,
              });
            }
          }
        } catch (err) {
          logger.debug(`⚠️ Skipping token ${contractAddress}:`, err);
        }
      }

      logger.info(
        `✅ Found ${tokenBalances.length} tokens with non-zero balance`,
      );
      return tokenBalances;
    } catch (error) {
      logger.debug("Failed to fetch wallet tokens from Alchemy:", error);
      return [];
    }
  }

  /**
   * Get token info for a specific contract address
   */
  async getTokenInfo(
    address: string,
    rpcUrl: string,
  ): Promise<{
    symbol: string;
    name: string;
    decimals: number;
  } | null> {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      // Query token contract directly
      const tokenAbi = [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)",
      ];

      const token = new ethers.Contract(address, tokenAbi, provider);

      const [name, symbol, decimals] = await Promise.all([
        token.name(),
        token.symbol(),
        token.decimals(),
      ]);

      return {
        name,
        symbol,
        decimals,
      };
    } catch (error) {
      logger.debug("Failed to get token info:", error);
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
