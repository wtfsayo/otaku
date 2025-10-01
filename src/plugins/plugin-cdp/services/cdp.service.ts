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

// Network types based on CDP SDK support (from EvmSwapsNetwork and related types)
type CdpSwapNetwork = "base" | "ethereum" | "arbitrum" | "optimism";
type CdpNetwork = CdpSwapNetwork | "base-sepolia" | "ethereum-sepolia" | "ethereum-hoodi" | "polygon" | "polygon-mumbai" | "arbitrum-sepolia" | "optimism-sepolia";

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
      const apiKeyId = process.env.COINBASE_API_KEY_NAME as string;
      const apiKeySecret = process.env.COINBASE_PRIVATE_KEY as string;
      const walletSecret = process.env.COINBASE_WALLET_SECRET as string;

      if (!apiKeyId || !apiKeySecret || !walletSecret) {
        logger.warn(
          "CDP_SERVICE: Missing env vars (COINBASE_API_KEY_NAME, COINBASE_PRIVATE_KEY, COINBASE_WALLET_SECRET)",
        );
        this.client = null;
        return;
      }

      this.client = new CdpClient({
        apiKeyId,
        apiKeySecret,
        walletSecret,
      });
      logger.info("CDP_SERVICE initialized");
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
    const result = await account.swap({
      network: options.network,
      fromToken: options.fromToken,
      toToken: options.toToken,
      fromAmount: options.fromAmount,
      slippageBps: options.slippageBps ?? 100,
    });

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


