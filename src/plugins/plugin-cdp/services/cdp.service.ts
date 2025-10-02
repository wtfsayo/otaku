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
import {
  base,
  baseSepolia,
  mainnet,
  arbitrum,
  polygon,
  type Chain,
} from "viem/chains";
import { z } from "zod";
import { type CdpNetwork, DEFAULT_RPC_URLS } from "../types";

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
   * Execute a swap with automatic token approval handling.
   * Steps:
   * 1. Approve token for Permit2 contract (if needed)
   * 2. Execute the swap using account.swap()
   * 
   * Reference: https://docs.cdp.coinbase.com/trade-api/quickstart#3-execute-a-swap
   */
  async swap(options: {
    accountName: string;
    network: CdpNetwork;
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
    
    const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as `0x${string}`;
    
    try {
      // Try swap first - CDP SDK will check approvals
      logger.info("Attempting swap...");
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
    } catch (error) {
      // Check if error is about token approval
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("allowance") && errorMessage.includes("Permit2")) {
        logger.info("Token approval needed for Permit2, approving now...");
        
        // Use Viem (wrapped CDP account) for approval transaction
        // This uses the same CDP account but through Viem's client
        const { walletClient, publicClient } = await this.getViemClientsForAccount({
          accountName: options.accountName,
          network: options.network === "base" ? "base" : "base-sepolia",
        });
        
        // ERC20 approve ABI
        const approveAbi = [{
          name: "approve",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" }
          ],
          outputs: [{ type: "bool" }]
        }] as const;
        
        // Approve max uint256 for Permit2
        logger.info("Sending Permit2 approval transaction...");
        const approvalHash = await walletClient.writeContract({
          address: options.fromToken,
          abi: approveAbi,
          functionName: "approve",
          args: [
            PERMIT2_ADDRESS,
            BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
          ],
          chain: walletClient.chain,
        } as any);
        
        logger.info(`Permit2 approval sent: ${approvalHash}`);
        
        // Wait for approval confirmation on-chain
        logger.info("Waiting for approval confirmation...");
        const receipt = await publicClient.waitForTransactionReceipt({ 
          hash: approvalHash,
          timeout: 60_000,
        });
        logger.info(`Approval confirmed in block ${receipt.blockNumber}`);
        
        // CRITICAL: Wait for CDP SDK's internal nonce tracker to sync with on-chain state
        // CDP SDK caches nonces, and our Viem transaction incremented the on-chain nonce.
        // We need to give CDP SDK time to refresh its cache before retrying the swap.
        logger.info("Waiting 8 seconds for CDP SDK nonce cache to sync...");
        await new Promise(resolve => setTimeout(resolve, 8000));
        
        // Retry swap after approval - CDP SDK should now have fresh nonce
        logger.info("Retrying swap after approval...");
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
      
      // Re-throw if not an approval error
      throw error;
    }
  }

  /**
   * Execute a token transfer via CDP account on a specified network
   */
  async transfer(options: {
    accountName: string;
    network: CdpNetwork;
    to: `0x${string}`;
    token: `0x${string}` | "usdc" | "eth";
    amount: bigint;
  }): Promise<{ transactionHash: string }> {
    if (!this.client) {
      throw new Error("CDP is not authenticated");
    }

    const account = await this.getOrCreateAccount({ name: options.accountName });
    const networkAccount = await account.useNetwork(options.network);

    logger.info(
      `Executing transfer on ${options.network}: to=${options.to}, token=${options.token}, amount=${options.amount.toString()}`,
    );

    const result = await networkAccount.transfer({
      to: options.to,
      amount: options.amount,
      token: options.token,
    });

    if (!result.transactionHash) {
      throw new Error("Transfer execution did not return a transaction hash");
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
    network?: CdpNetwork;
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
    const NETWORK_CONFIG: Record<CdpNetwork, { chain: Chain; envVar: string }> = {
      base: { chain: base, envVar: "BASE_RPC_URL" },
      "base-sepolia": { chain: baseSepolia, envVar: "BASE_SEPOLIA_RPC_URL" },
      ethereum: { chain: mainnet, envVar: "ETHEREUM_RPC_URL" },
      arbitrum: { chain: arbitrum, envVar: "ARBITRUM_RPC_URL" },
      polygon: { chain: polygon, envVar: "POLYGON_RPC_URL" },
    };

    const cfg = NETWORK_CONFIG[network] ?? NETWORK_CONFIG.base;
    const defaultRpcFromMap = DEFAULT_RPC_URLS[cfg.chain.id];
    const rpcUrl = options.rpcUrl || process.env[cfg.envVar] || defaultRpcFromMap;
    const chain = cfg.chain;

    const account = await this.getOrCreateAccount({ name: options.accountName });
    const address = account.address as `0x${string}`;

    // Wrap CDP EvmServerAccount with viem's toAccount() as shown in CDP docs
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    }) as PublicClient;
    
    const walletClient = createWalletClient({
      account: toAccount(account),
      chain,
      transport: http(rpcUrl),
    });

    return { address, walletClient, publicClient };
  }
}