import { IAgentRuntime, Service, logger } from "@elizaos/core";
import { CdpClient, EvmServerAccount } from "@coinbase/cdp-sdk";
import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { toAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { z } from "zod";
import { type CdpSwapNetwork } from "../types";

const cdpConfigSchema = z.object({
  apiKeyId: z.string().min(1, "COINBASE_API_KEY_NAME must be a non-empty string"),
  apiKeySecret: z.string().min(1, "COINBASE_PRIVATE_KEY must be a non-empty string"),
  walletSecret: z.string().min(1, "COINBASE_WALLET_SECRET must be a non-empty string"),
});

type CdpConfig = z.infer<typeof cdpConfigSchema>;

export class CdpService extends Service {
  static serviceType = "CDP_SERVICE";
  capabilityDescription = "Provides authenticated access to Coinbase CDP SDK";

  private client: CdpClient | null = null;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime): Promise<CdpService> {
    const svc = new CdpService(runtime);
    await svc.initClient();
    return svc;
  }

  async stop(): Promise<void> {}

  private async initClient(): Promise<void> {
    try {
      const apiKeyId = process.env.COINBASE_API_KEY_NAME || process.env.CDP_API_KEY_ID;
      const apiKeySecret = process.env.COINBASE_PRIVATE_KEY || process.env.CDP_API_KEY_SECRET;
      const walletSecret = process.env.COINBASE_WALLET_SECRET;

      if (!apiKeyId || !apiKeySecret) {
        logger.warn(
          "CDP_SERVICE: Missing required env vars (COINBASE_API_KEY_NAME, COINBASE_PRIVATE_KEY)",
        );
        this.client = null;
        return;
      }

      if (!walletSecret) {
        logger.warn(
          "CDP_SERVICE: COINBASE_WALLET_SECRET is required for wallet operations. Generate one with: openssl rand -hex 32",
        );
        this.client = null;
        return;
      }

      // Validate configuration with Zod schema
      const validationResult = cdpConfigSchema.safeParse({
        apiKeyId,
        apiKeySecret,
        walletSecret,
      });

      if (!validationResult.success) {
        const errors = validationResult.error.issues
          .map((issue: z.ZodIssue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ");
        logger.error(`CDP_SERVICE: Configuration validation failed - ${errors}`);
        this.client = null;
        return;
      }

      const config: CdpConfig = validationResult.data;

      this.client = new CdpClient({
        apiKeyId: config.apiKeyId,
        apiKeySecret: config.apiKeySecret,
        walletSecret: config.walletSecret,
      });
      
      logger.info("CDP_SERVICE initialized successfully with validated configuration");
    } catch (error) {
      logger.error("CDP_SERVICE init error:", error);
      this.client = null;
    }
  }

  async createEvmAccount(): Promise<EvmServerAccount> {
    if (!this.client) {
      throw new Error("CDP is not authenticated");
    }
    return this.client.evm.createAccount();
  }

  async getOrCreateAccount(options: { name: string }): Promise<EvmServerAccount> {
    if (!this.client) {
      throw new Error("CDP is not authenticated");
    }
    return this.client.evm.getOrCreateAccount(options);
  }

  getClient(): CdpClient | null {
    return this.client;
  }

  /**
   * Execute a swap using CDP SDK.
   * 
   * Note: CDP SDK's account.swap() automatically handles all required steps including:
   * - Token approval for Permit2 contract
   * - Nonce management
   * - Transaction signing and submission
   * 
   * We don't need to manually approve tokens - the SDK handles everything internally.
   * 
   * Reference: https://docs.cdp.coinbase.com/trade-api/quickstart#3-execute-a-swap
   */
  async swap(options: {
    accountName: string;
    network: CdpSwapNetwork;
    fromToken: `0x${string}`;
    toToken: `0x${string}`;
    fromAmount: bigint;
    slippageBps?: number;
  }): Promise<{ transactionHash: string }> {
    if (!this.client) {
      throw new Error("CDP is not authenticated");
    }

    const account = await this.getOrCreateAccount({ name: options.accountName });
    
    logger.debug(`CDP account address: ${account.address}`);
    logger.info(`Executing swap: ${options.fromAmount.toString()} tokens on ${options.network}`);
    
    // Execute the swap - CDP SDK handles token approval and nonce management automatically
    logger.info("Executing swap transaction (CDP SDK will handle approvals automatically)...");
    const result = await account.swap({
      network: options.network,
      fromToken: options.fromToken,
      toToken: options.toToken,
      fromAmount: options.fromAmount,
      slippageBps: options.slippageBps ?? 100,
    });

    logger.info(`Swap executed successfully - transaction hash: ${result.transactionHash}`);

    if (!result.transactionHash) {
      throw new Error("Swap execution did not return a transaction hash");
    }

    return { transactionHash: result.transactionHash };
  }

  /**
   * Returns viem wallet/public clients backed by a CDP EVM account.
   * Uses viem's toAccount() wrapper as per CDP SDK documentation.
   * @see https://github.com/coinbase/cdp-sdk/blob/main/typescript/README.md#sending-transactions
   */
  async getViemClientsForAccount(options: {
    accountName: string;
    network?: "base" | "base-sepolia";
    rpcUrl?: string;
  }): Promise<{
    address: `0x${string}`;
    walletClient: WalletClient;
    publicClient: PublicClient;
  }> {
    if (!this.client) {
      throw new Error("CDP is not authenticated");
    }

    const network = options.network ?? "base";
    const chain = network === "base" ? base : baseSepolia;
    const rpcUrl = options.rpcUrl || process.env.BASE_RPC_URL || "https://mainnet.base.org";

    const account = await this.getOrCreateAccount({ name: options.accountName });
    const address = account.address as `0x${string}`;

    // Wrap CDP EvmServerAccount with viem's toAccount() as shown in CDP docs
    const publicClient = createPublicClient({ 
      chain, 
      transport: http(rpcUrl) 
    }) as PublicClient;
    
    const walletClient = createWalletClient({ 
      account: toAccount(account), 
      chain, 
      transport: http(rpcUrl) 
    });

    return { address, walletClient, publicClient };
  }
}


