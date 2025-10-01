import { Service, IAgentRuntime, logger } from "@elizaos/core";
import { Clanker } from "clanker-sdk/v4";
import { Contract, JsonRpcProvider, parseUnits } from "ethers";
import {
  createWalletClient,
  createPublicClient,
  http,
  PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  TokenDeployParams,
  DeployResult,
  TokenInfo,
  ClankerConfig,
  ErrorCode,
  NATIVE_TOKEN_ADDRESSES,
} from "../types";
import { ClankerError } from "../utils/errors";
import { retryTransaction } from "../utils/transactions";
import { loadClankerConfig } from "../utils/config";

const BASE_KNOWN_TOKENS: Record<string, string> = {
  eth: NATIVE_TOKEN_ADDRESSES,
  ethereum: NATIVE_TOKEN_ADDRESSES,
  native: NATIVE_TOKEN_ADDRESSES,
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  usdt: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
} as const;

export class ClankerService extends Service {
  static serviceType = "clanker";
  capabilityDescription = "";
  private provider: JsonRpcProvider | null = null;
  private clankerConfig: ClankerConfig | null = null;
  private tokenCache: Map<string, TokenInfo> = new Map();
  private cacheTimeout = 60000; // 1 minute cache

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  async initialize(runtime: IAgentRuntime): Promise<void> {
    logger.info("Initializing Clanker service...");

    try {
      this.clankerConfig = loadClankerConfig();

      if (!this.clankerConfig) {
        throw new Error("Clanker configuration not found");
      }

      if (!this.clankerConfig.BASE_RPC_URL) {
        throw new Error("BASE_RPC_URL is required for Clanker service");
      }

      // Initialize ethers provider for compatibility
      this.provider = new JsonRpcProvider(this.clankerConfig.BASE_RPC_URL);

      await this.provider.getNetwork();

      logger.info("Clanker service initialized successfully");
    } catch (error) {
      logger.error(
        "Failed to initialize Clanker service:",
        error instanceof Error ? error.message : String(error),
      );
      throw new ClankerError(
        ErrorCode.NETWORK_ERROR,
        "Failed to initialize Clanker service",
        error,
      );
    }
  }

  static async start(runtime: IAgentRuntime): Promise<ClankerService> {
    const service = new ClankerService(runtime);
    await service.initialize(runtime);
    return service;
  }

  // TODO: remove this function
  async deployToken(
    params: TokenDeployParams,
    walletPrivateKey: string,
  ): Promise<DeployResult> {
    if (!this.clankerConfig) {
      throw new ClankerError(
        ErrorCode.PROTOCOL_ERROR,
        "Service not initialized",
      );
    }

    // Initialize viem clients
    const account = privateKeyToAccount(walletPrivateKey as `0x${string}`);

    const publicClient = createPublicClient({
      chain: base,
      transport: http(this.clankerConfig.BASE_RPC_URL),
    }) as PublicClient;

    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(this.clankerConfig.BASE_RPC_URL),
    });

    const clanker = new Clanker({
      wallet: walletClient as any,
      publicClient: publicClient as any,
    });

    // Test connections
    await publicClient.getChainId();

    try {
      // Validate parameters
      if (!params.name || params.name.length > 50) {
        throw new ClankerError(
          ErrorCode.VALIDATION_ERROR,
          "Invalid token name - must be 1-50 characters",
        );
      }

      if (!params.symbol || params.symbol.length > 10) {
        throw new ClankerError(
          ErrorCode.VALIDATION_ERROR,
          "Invalid token symbol - must be 1-10 characters",
        );
      }

      // Prepare Clanker token configuration according to v4.0.0 API
      const tokenConfig: any = {
        name: params.name,
        symbol: params.symbol,
        tokenAdmin: walletClient.account?.address || params.tokenAdmin,
        vanity: params.vanity || false,
      };

      // Add optional image if provided
      if (params.image) {
        tokenConfig.image = params.image;
      }

      // Add metadata if provided
      if (params.metadata) {
        tokenConfig.metadata = {
          description: params.metadata.description || "",
          socialMediaUrls: params.metadata.socialMediaUrls || [],
          auditUrls: params.metadata.auditUrls || [],
        };
      }

      // Add context if provided (required for social provenance)
      tokenConfig.context = {
        interface: params.context?.interface || "Clanker SDK",
        platform: params.context?.platform || "",
        messageId: params.context?.messageId || "",
        id: params.context?.id || "",
      };

      // Add pool configuration if provided, otherwise use standard positions
      if (params.pool) {
        tokenConfig.pool = params.pool;
      }

      // Add fee configuration if provided, otherwise use dynamic basic
      if (params.fees) {
        tokenConfig.fees = params.fees;
      }

      // Add rewards configuration if provided
      if (params.rewards) {
        tokenConfig.rewards = params.rewards;
      }

      // Add vault configuration if provided
      if (params.vault) {
        tokenConfig.vault = params.vault;
      }

      // Add dev buy configuration if provided
      if (params.devBuy) {
        tokenConfig.devBuy = {
          ethAmount: params.devBuy.ethAmount,
        };
      }

      // Deploy the token using Clanker SDK
      const deployResult = await retryTransaction(async () => {
        logger.info(
          "Deploying token with config:",
          JSON.stringify(tokenConfig, null, 2),
        );

        const { txHash, waitForTransaction, error } =
          await clanker!.deploy(tokenConfig);

        // The deploy function attempts to not throw and instead return an error
        // for you to decide how to handle
        if (error) {
          logger.error(
            `Clanker deploy error: ${error.message || String(error)}`,
          );
          throw error;
        }

        if (!txHash) {
          throw new Error("No transaction hash returned from deployment");
        }

        logger.info("Token deployment transaction submitted:", txHash);

        // Wait for transaction to complete - this may also return an error
        const { address, error: waitError } = await waitForTransaction();
        if (waitError) {
          logger.error(
            `Clanker waitForTransaction error: ${waitError.message || String(waitError)}`,
          );
          throw waitError;
        }

        if (!address) {
          throw new Error("No contract address returned from deployment");
        }

        logger.info("Token deployed successfully to address:", address);

        return {
          contractAddress: address,
          transactionHash: txHash,
          deploymentCost: parseUnits("0", 18), // Clanker handles fees internally
          tokenId: `clanker_${params.symbol.toLowerCase()}_${Date.now()}`,
        };
      }, this.clankerConfig.RETRY_ATTEMPTS || 3);

      logger.info(
        `Token deployed successfully: ${JSON.stringify(deployResult)}`,
      );

      // Cache the token info
      this.tokenCache.set(deployResult.contractAddress, {
        address: deployResult.contractAddress,
        name: params.name,
        symbol: params.symbol,
        decimals: 18, // Clanker tokens are 18 decimals by default
        totalSupply: parseUnits("1000000000", 18), // 1B tokens default
        createdAt: Date.now(),
      });

      return deployResult;
    } catch (error) {
      logger.error(
        "Token deployment failed:",
        error instanceof Error ? error.message : String(error),
      );
      if (error instanceof ClankerError) throw error;

      throw new ClankerError(
        ErrorCode.PROTOCOL_ERROR,
        "Token deployment failed",
        error,
      );
    }
  }

  async deployTokenWithClient(
    params: TokenDeployParams,
    walletClient: ReturnType<typeof createWalletClient>,
    publicClient: PublicClient,
  ): Promise<DeployResult> {
    if (!this.clankerConfig) {
      throw new ClankerError(
        ErrorCode.PROTOCOL_ERROR,
        "Service not initialized",
      );
    }

    const clanker = new Clanker({ wallet: walletClient as any, publicClient: publicClient as any });

    // Test connections
    await publicClient.getChainId();

    try {
      // Validate parameters
      if (!params.name || params.name.length > 50) {
        throw new ClankerError(
          ErrorCode.VALIDATION_ERROR,
          "Invalid token name - must be 1-50 characters",
        );
      }

      if (!params.symbol || params.symbol.length > 10) {
        throw new ClankerError(
          ErrorCode.VALIDATION_ERROR,
          "Invalid token symbol - must be 1-10 characters",
        );
      }

      const tokenConfig: any = {
        name: params.name,
        symbol: params.symbol,
        tokenAdmin: (walletClient as any).account?.address || params.tokenAdmin,
        vanity: params.vanity || false,
      };

      if (params.image) tokenConfig.image = params.image;
      if (params.metadata) {
        tokenConfig.metadata = {
          description: params.metadata.description || "",
          socialMediaUrls: params.metadata.socialMediaUrls || [],
          auditUrls: params.metadata.auditUrls || [],
        };
      }
      tokenConfig.context = {
        interface: params.context?.interface || "Clanker SDK",
        platform: params.context?.platform || "",
        messageId: params.context?.messageId || "",
        id: params.context?.id || "",
      };
      if (params.pool) tokenConfig.pool = params.pool;
      if (params.fees) tokenConfig.fees = params.fees;
      if (params.rewards) tokenConfig.rewards = params.rewards;
      if (params.vault) tokenConfig.vault = params.vault;
      if (params.devBuy) tokenConfig.devBuy = { ethAmount: params.devBuy.ethAmount };

      const deployResult = await retryTransaction(async () => {
        logger.info(
          "Deploying token with config:",
          JSON.stringify(tokenConfig, null, 2),
        );

        const { txHash, waitForTransaction, error } = await clanker!.deploy(tokenConfig);
        if (error) {
          logger.error(`Clanker deploy error: ${error.message || String(error)}`);
          throw error;
        }
        if (!txHash) throw new Error("No transaction hash returned from deployment");
        logger.info("Token deployment transaction submitted:", txHash);

        const { address, error: waitError } = await waitForTransaction();
        if (waitError) {
          logger.error(
            `Clanker waitForTransaction error: ${waitError.message || String(waitError)}`,
          );
          throw waitError;
        }
        if (!address) throw new Error("No contract address returned from deployment");
        logger.info("Token deployed successfully to address:", address);
        return {
          contractAddress: address,
          transactionHash: txHash,
          deploymentCost: parseUnits("0", 18),
          tokenId: `clanker_${params.symbol.toLowerCase()}_${Date.now()}`,
        };
      }, this.clankerConfig.RETRY_ATTEMPTS || 3);

      this.tokenCache.set(deployResult.contractAddress, {
        address: deployResult.contractAddress,
        name: params.name,
        symbol: params.symbol,
        decimals: 18,
        totalSupply: parseUnits("1000000000", 18),
        createdAt: Date.now(),
      });

      return deployResult;
    } catch (error) {
      logger.error(
        "Token deployment failed:",
        error instanceof Error ? error.message : String(error),
      );
      if (error instanceof ClankerError) throw error;
      throw new ClankerError(
        ErrorCode.PROTOCOL_ERROR,
        "Token deployment failed",
        error,
      );
    }
  }

  async fetchDexScreenerData(tokenAddress: string): Promise<{
    priceUsd: number;
    liquidityUsd: number;
    volumeUsd24h: number;
    marketCap: number;
  } | null> {
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      const response = await fetch(url);

      if (!response.ok) {
        logger.warn(`DEX Screener request failed: ${response.status}`);
        return null;
      }

      const data: any = await response.json();
      const firstPair = data?.pairs?.[0];

      if (!firstPair) return null;

      return {
        priceUsd: parseFloat(firstPair.priceUsd || "0"),
        liquidityUsd: parseFloat(firstPair.liquidity?.usd || "0"),
        volumeUsd24h: parseFloat(firstPair.volume?.h24 || "0"),
        marketCap: parseFloat(firstPair.fdv || "0"),
      };
    } catch (error) {
      logger.warn(
        "Failed to fetch from DEX Screener:",
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  async getTokenInfo(address: string): Promise<TokenInfo> {
    logger.info("Getting token info for:", address);

    if (!this.provider || !this.clankerConfig) {
      throw new ClankerError(
        ErrorCode.PROTOCOL_ERROR,
        "Service not initialized",
      );
    }

    // Check cache first
    const cached = this.getCachedTokenInfo(address);
    if (cached && Date.now() - (cached.createdAt || 0) < this.cacheTimeout) {
      return cached;
    }

    if (address === NATIVE_TOKEN_ADDRESSES) {
      return await this.getNativeEthInfo();
    }

    try {
      // Query token contract directly
      const tokenAbi = [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)",
        "function totalSupply() view returns (uint256)",
        "function balanceOf(address) view returns (uint256)",
      ];

      const token = new Contract(address, tokenAbi, this.provider);

      const [name, symbol, decimals, totalSupply] = await Promise.all([
        token.name(),
        token.symbol(),
        token.decimals(),
        token.totalSupply(),
      ]);

      const dexData = await this.fetchDexScreenerData(address);

      const priceUsd = dexData?.priceUsd || 0;
      const liquidity = dexData?.liquidityUsd || 0;
      const volume24h = dexData?.volumeUsd24h || 0;
      const marketCap = dexData?.marketCap || 0;

      const tokenInfo: TokenInfo = {
        address,
        name,
        symbol,
        decimals,
        totalSupply,
        price: priceUsd,
        priceUsd,
        liquidity,
        volume24h,
        marketCap,
        // holders: 0, // TODO: hook to indexer
        createdAt: Date.now(),
      };

      // Update cache
      this.tokenCache.set(address, tokenInfo);

      return tokenInfo;
    } catch (error) {
      logger.error(
        "Failed to get token info:",
        error instanceof Error ? error.message : String(error),
      );
      throw new ClankerError(
        ErrorCode.NETWORK_ERROR,
        "Failed to retrieve token information",
        error,
      );
    }
  }

  async getNativeEthInfo(): Promise<TokenInfo> {
    const url = "https://api.coingecko.com/api/v3/coins/ethereum";
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }

        const data = (await response.json()) as any;

        if (
          !data ||
          typeof data.symbol !== "string" ||
          !data.market_data ||
          typeof data.market_data.current_price?.usd !== "number" ||
          typeof data.market_data.total_volume?.usd !== "number" ||
          typeof data.market_data.market_cap?.usd !== "number"
        ) {
          throw new Error("Unexpected API response structure");
        }

        return {
          address: NATIVE_TOKEN_ADDRESSES,
          name: data.name || "Ethereum",
          symbol: data.symbol.toUpperCase(),
          decimals: 18,
          totalSupply: BigInt(0), // Not available
          price: data.market_data.current_price.usd,
          priceUsd: data.market_data.current_price.usd,
          liquidity: 0, // Not applicable for native
          volume24h: data.market_data.total_volume.usd,
          marketCap: data.market_data.market_cap.usd,
          createdAt: Date.now(),
        };
      } catch (error) {
        logger.warn(
          `Attempt ${attempt} failed to fetch ETH info:`,
          error instanceof Error ? error.message : String(error),
        );

        if (attempt === maxRetries) {
          logger.error("All retries failed. Giving up.");
          throw new ClankerError(
            ErrorCode.NETWORK_ERROR,
            "Failed to fetch ETH metadata",
            error,
          );
        }

        // Exponential backoff with jitter (up to 1 second max delay)
        const delay = Math.min(
          1000,
          Math.pow(2, attempt) * 100 + Math.random() * 100,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new ClankerError(
      ErrorCode.NETWORK_ERROR,
      "Unreachable retry failure",
    );
  }

  async getAllTokensInWallet(walletAddress: string): Promise<TokenInfo[]> {
    // ⚠️ This function is only supported if using Alchemy.
    // We assume the user is using Alchemy if ALCHEMY_API_KEY is present,
    // and that clankerConfig.BASE_RPC_URL is set to:
    // https://base-mainnet.g.alchemy.com/v2/<API_KEY>
    if (!this.clankerConfig) {
      throw new ClankerError(
        ErrorCode.PROTOCOL_ERROR,
        "Wallet not initialized",
      );
    }

    try {
      // Step 1: Fetch token balances via Alchemy
      const response = await fetch(this.clankerConfig.BASE_RPC_URL, {
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
        throw new Error("Unexpected response format from Alchemy");
      }

      const tokenInfos: TokenInfo[] = [];

      // Step 2: Loop and enrich token info
      for (const { contractAddress, tokenBalance } of balances) {
        try {
          const info = await this.getTokenInfo(contractAddress);
          if (info && BigInt(tokenBalance) > 0n) {
            tokenInfos.push(info);
          }
        } catch (err) {
          logger.warn(
            `⚠️ Skipping token ${contractAddress}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      logger.info(`✅ Found ${tokenInfos.length} tokens with non-zero balance`);
      return tokenInfos;
    } catch (error) {
      logger.error(
        "Failed to fetch wallet tokens from Alchemy:",
        error instanceof Error ? error.message : String(error),
      );
      throw new ClankerError(
        ErrorCode.NETWORK_ERROR,
        "Could not retrieve token balances from Alchemy",
        error,
      );
    }
  }

  async resolveTokenAddressBySymbol(
    symbolOrName: string,
    walletAddress: string,
  ): Promise<string | null> {
    const query = symbolOrName.toLowerCase();

    // 1. Check known tokens
    if (BASE_KNOWN_TOKENS[query]) {
      return BASE_KNOWN_TOKENS[query];
    }

    // 2. Check cache
    const cachedMatch = [...this.tokenCache.values()].find(
      (token) =>
        token.symbol.toLowerCase() === query ||
        token.name.toLowerCase() === query,
    );

    if (cachedMatch) {
      return cachedMatch.address;
    }

    // 3. Fallback: query all wallet tokens from Alchemy
    try {
      const allTokens = await this.getAllTokensInWallet(walletAddress);

      const match = allTokens.find(
        (token) =>
          token.symbol.toLowerCase() === query ||
          token.name.toLowerCase() === query,
      );

      return match?.address || null;
    } catch (err) {
      logger.warn(
        "resolveTokenAddressBySymbol fallback failed:",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  getCachedTokenInfo(address: string): TokenInfo | null {
    return this.tokenCache.get(address) || null;
  }

  async stop(): Promise<void> {
    logger.info("Stopping Clanker service...");
    this.tokenCache.clear();
    this.provider = null;
    this.clankerConfig = null;
  }
}
