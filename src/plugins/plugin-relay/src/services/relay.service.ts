import { IAgentRuntime, Service } from "@elizaos/core";
import type { ProgressData } from "@relayprotocol/relay-sdk";
import {
  convertViemChainToRelayChain,
  createClient,
  getClient,
  MAINNET_RELAY_API,
  TESTNET_RELAY_API
} from "@relayprotocol/relay-sdk";
import { createWalletClient, http, type Address, type Chain, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arbitrum,
  base,
  blast,
  linea,
  mainnet,
  optimism,
  polygon,
  scroll,
  zora
} from "viem/chains";
import type {
  ExecuteCallRequest,
  QuoteRequest,
  RelayChain,
  RelayCurrencyInfo,
  RelayExecuteResult,
  RelayStatus,
  ResolvedBridgeRequest,
  StatusRequest
} from "../types";

export class RelayService extends Service {
  static serviceType = "cross_chain_bridge" as const;

  private apiUrl: string = "";
  private apiKey?: string;
  private walletClient: WalletClient | null = null;
  private isTestnet: boolean = false;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  get capabilityDescription(): string {
    return "Cross-chain bridging and token transfers via Relay Protocol. Supports quote generation, bridge execution, and transaction status tracking across multiple EVM chains including Ethereum, Base, Arbitrum, Polygon, Optimism, and more.";
  }

  static async start(runtime: IAgentRuntime): Promise<RelayService> {
    console.log("[RELAY SERVICE] Starting Relay service");
    const service = new RelayService(runtime);
    await service.initialize(runtime);
    return service;
  }

  async stop(): Promise<void> {
    // Cleanup if needed
    this.walletClient = null;
  }

  async initialize(runtime: IAgentRuntime): Promise<void> {
    console.log("[RELAY SERVICE] Initializing Relay service");
    
    this.isTestnet = runtime.getSetting("RELAY_ENABLE_TESTNET") === "true";
    this.apiUrl = this.isTestnet ? TESTNET_RELAY_API : MAINNET_RELAY_API;
    this.apiKey = runtime.getSetting("RELAY_API_KEY");

    console.log("[RELAY SERVICE] Configuration:", {
      isTestnet: this.isTestnet,
      apiUrl: this.apiUrl,
      hasApiKey: !!this.apiKey,
    });

    // Define supported chains
    const supportedChains: Chain[] = [
      mainnet,
      base,
      arbitrum,
      polygon,
      optimism,
      zora,
      blast,
      scroll,
      linea,
    ];
    console.log("[RELAY SERVICE] Supported chains:", supportedChains.map(c => `${c.name} (${c.id})`).join(", "));

    // Initialize Relay SDK with createClient (singleton)
    try {
      console.log("[RELAY SERVICE] Creating Relay SDK client");
      createClient({
        baseApiUrl: this.apiUrl,
        source: "elizaos-agent",
        chains: supportedChains.map((chain) => convertViemChainToRelayChain(chain)),
        ...(this.apiKey ? { apiKey: this.apiKey } : {}),
      });
      console.log("[RELAY SERVICE] Relay SDK client created successfully");
    } catch (error) {
      // Client may already be initialized; avoid breaking startup
      const err = error as Error;
      console.warn("[RELAY SERVICE] Relay client initialization warning:", err.message);
    }

    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    console.log("[RELAY SERVICE] EVM_PRIVATE_KEY present:", !!privateKey);
    
    try {
      if (privateKey) {
        console.log("[RELAY SERVICE] Creating wallet client from private key");
        const normalizedPk = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
        const account = privateKeyToAccount(normalizedPk as `0x${string}`);
        
        // Get RPC URL from environment or use a default
        const rpcUrl = runtime.getSetting("EVM_RPC_URL") || 
                       runtime.getSetting("BASE_RPC_URL") || 
                       "https://mainnet.base.org";
        console.log("[RELAY SERVICE] Using RPC URL:", rpcUrl);
        
        this.walletClient = createWalletClient({
          account,
          chain: base, // Default to Base chain
          transport: http(rpcUrl),
        });
        console.log("[RELAY SERVICE] Wallet client created, address:", account.address);
      } else {
        console.warn("[RELAY SERVICE] No EVM_PRIVATE_KEY provided - bridge execution will not be available");
      }
    } catch (error) {
      console.error("[RELAY SERVICE] Error creating wallet client:", error);
      console.warn("[RELAY SERVICE] Continuing without wallet client - only quotes will be available");
      this.walletClient = null;
    }
    
    console.log("[RELAY SERVICE] Initialization complete");
  }

  /**
   * Get a quote for cross-chain transaction
   */
  async getQuote(request: QuoteRequest) {
    console.log("[RELAY SERVICE] getQuote called with request:", JSON.stringify(request, null, 2));
    
    try {
      const client = getClient();
      if (!client) {
        console.error("[RELAY SERVICE] Relay client not initialized");
        throw new Error("Relay client not initialized. Please call initialize() first.");
      }
      console.log("[RELAY SERVICE] Relay client retrieved successfully");

      // Validate request
      if (!request.user || !request.chainId || !request.toChainId) {
        console.error("[RELAY SERVICE] Missing required fields:", { 
          hasUser: !!request.user, 
          hasChainId: !!request.chainId, 
          hasToChainId: !!request.toChainId 
        });
        throw new Error("Missing required fields: user, chainId, toChainId");
      }

      if (!request.amount || BigInt(request.amount) <= 0n) {
        console.error("[RELAY SERVICE] Invalid amount:", request.amount);
        throw new Error("Invalid amount: must be greater than 0");
      }

      const options = {
        user: request.user as Address,
        chainId: request.chainId,
        toChainId: request.toChainId,
        currency: request.currency as Address,
        toCurrency: (request.toCurrency || request.currency) as Address,
        amount: request.amount,
        recipient: (request.recipient || request.user) as Address,
        tradeType: request.tradeType || "EXACT_INPUT",
        ...(request.referrer && { referrer: request.referrer as Address }),
      };
      console.log("[RELAY SERVICE] Calling Relay API with options:", JSON.stringify(options, null, 2));

      const quote = await client.actions.getQuote(options);
      console.log("[RELAY SERVICE] Quote received from Relay API");

      if (!quote) {
        console.error("[RELAY SERVICE] No quote returned from Relay API");
        throw new Error("No quote returned from Relay API");
      }

      return quote;
    } catch (error) {
      console.error("[RELAY SERVICE] getQuote error:", error);
      const err = error as Error;
      throw new Error(`Failed to get quote: ${err.message}`);
    }
  }

  /**
   * Execute a bridge transaction
   * Accepts a resolved bridge request with chain IDs
   */
  async executeBridge(
    request: ResolvedBridgeRequest,
    onProgress?: (data: ProgressData) => void
  ): Promise<string> {
    console.log("[RELAY SERVICE] executeBridge called with request:", JSON.stringify(request, null, 2));
    
    try {
      const client = getClient();
      if (!client) {
        console.error("[RELAY SERVICE] Relay client not initialized");
        throw new Error("Relay client not initialized. Please call initialize() first.");
      }
      console.log("[RELAY SERVICE] Relay client retrieved successfully");

      if (!this.walletClient) {
        console.error("[RELAY SERVICE] Wallet not initialized - no EVM_PRIVATE_KEY");
        throw new Error("Wallet not initialized. Please set EVM_PRIVATE_KEY environment variable.");
      }
      console.log("[RELAY SERVICE] Wallet client available");

      // Validate request
      if (!request.user || !request.originChainId || !request.destinationChainId) {
        console.error("[RELAY SERVICE] Missing required fields:", { 
          hasUser: !!request.user, 
          hasOriginChainId: !!request.originChainId, 
          hasDestinationChainId: !!request.destinationChainId 
        });
        throw new Error("Missing required fields: user, originChainId, destinationChainId");
      }

      if (!request.amount || BigInt(request.amount) <= 0n) {
        console.error("[RELAY SERVICE] Invalid amount:", request.amount);
        throw new Error("Invalid amount: must be greater than 0");
      }

      // First get a quote using the new API parameter names
      // Note: If toCurrency is not in the request, we need to resolve the same currency symbol on destination chain
      console.log("[RELAY SERVICE] Getting quote before execution");
      const quote = await this.getQuote({
        user: request.user,
        chainId: request.originChainId,
        toChainId: request.destinationChainId,
        currency: request.currency,
        toCurrency: request.toCurrency || request.currency,
        amount: request.amount,
        recipient: request.recipient,
        tradeType: request.useExactInput ? "EXACT_INPUT" : "EXACT_OUTPUT",
        referrer: request.referrer,
      });
      console.log("[RELAY SERVICE] Quote obtained, executing bridge");

      // Execute with the quote
      const result = await client.actions.execute({
        quote,
        wallet: this.walletClient,
        onProgress: (data: ProgressData) => {
          console.log("[RELAY SERVICE] Progress callback:", JSON.stringify(data, null, 2));
          if (onProgress) {
            onProgress(data);
          }
        },
        
      });
      console.log("[RELAY SERVICE] Bridge execution result received");

      // Extract request ID from the execution result
      // The SDK returns the execution data which includes the request details
      const requestId = (result as RelayExecuteResult)?.data?.request?.id ||
        (result as RelayExecuteResult)?.requestId ||
        "pending";
      console.log("[RELAY SERVICE] Bridge request ID:", requestId);

      return requestId;
    } catch (error) {
      console.error("[RELAY SERVICE] executeBridge error:", error);
      const err = error as Error;
      throw new Error(`Failed to execute bridge: ${err.message}`);
    }
  }

  /**
   * Execute a cross-chain call with custom transactions
   */
  async executeCall(
    request: ExecuteCallRequest,
    onProgress?: (data: ProgressData) => void
  ): Promise<string> {
    try {
      const client = getClient();
      if (!client) {
        throw new Error("Relay client not initialized. Please call initialize() first.");
      }

      if (!this.walletClient) {
        throw new Error("Wallet not initialized. Please set EVM_PRIVATE_KEY environment variable.");
      }

      // Validate request
      if (!request.user || !request.originChainId || !request.destinationChainId) {
        throw new Error("Missing required fields: user, originChainId, destinationChainId");
      }

      if (!request.txs || request.txs.length === 0) {
        throw new Error("No transactions provided for cross-chain call");
      }

      // First get a quote
      const quote = await this.getQuote({
        user: request.user,
        chainId: request.originChainId,
        toChainId: request.destinationChainId,
        currency: request.originCurrency,
        amount: request.amount,
        recipient: request.recipient,
        tradeType: "EXACT_INPUT",
      });

      // Execute the call with SDK
      const result = await client.actions.execute({
        quote,
        wallet: this.walletClient,
        onProgress: (data: ProgressData) => {
          if (onProgress) {
            onProgress(data);
          }
        },
      });

      // Extract request ID from the execution result
      const requestId: string = (result as import("../types").RelayExecuteResult)?.data?.request?.id ||
        (result as import("../types").RelayExecuteResult)?.requestId ||
        "pending";

      return requestId;
    } catch (error) {
      console.error("Relay executeCall error:", error);
      const err = error as Error;
      throw new Error(`Failed to execute call: ${err.message}`);
    }
  }

  /**
   * Get status of a transaction
   */
  async getStatus(request: StatusRequest): Promise<RelayStatus[]> {
    try {
      // Validate at least one identifier is provided
      if (!request.requestId && !request.txHash && !request.user) {
        throw new Error("At least one of requestId, txHash, or user must be provided");
      }

      const params = new URLSearchParams();
      if (request.requestId) params.append("id", request.requestId);
      if (request.txHash) params.append("hash", request.txHash);
      if (request.user) params.append("user", request.user);

      const response = await fetch(`${this.apiUrl}/requests/v2?${params.toString()}`, {
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey && { "x-api-key": this.apiKey }),
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get status: ${response.status} ${errorText}`);
      }

      const data: any = await response.json();
      return data.requests || [];
    } catch (error: unknown) {
      console.error("Relay getStatus error:", error);
      const err = error as Error;
      throw new Error(`Failed to get status: ${err.message}`);
    }
  }

  /**
   * Get supported chains
   */
  async getChains(): Promise<RelayChain[]> {
    try {
      const response = await fetch(`${this.apiUrl}/chains`, {
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey && { "x-api-key": this.apiKey }),
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get chains: ${response.status} ${errorText}`);
      }

      const data: any = await response.json();
      return data.chains || [];
    } catch (error: unknown) {
      console.error("Relay getChains error:", error);
      const err = error as Error;
      throw new Error(`Failed to get chains: ${err.message}`);
    }
  }

  /**
   * Get supported currencies for a chain
   */
  async getCurrencies(chainId: number): Promise<RelayCurrencyInfo[]> {
    try {
      if (!chainId || chainId <= 0) {
        throw new Error("Invalid chainId provided");
      }

      const response = await fetch(`${this.apiUrl}/currencies?chainId=${chainId}`, {
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey && { "x-api-key": this.apiKey }),
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get currencies: ${response.status} ${errorText}`);
      }

      const data: any = await response.json();
      return data.currencies || [];
    } catch (error: any) {
      console.error("Relay getCurrencies error:", error);
      throw new Error(`Failed to get currencies: ${error.message}`);
    }
  }

  /**
   * Index a transaction for faster processing
   */
  async indexTransaction(txHash: string, chainId: number): Promise<void> {
    try {
      if (!txHash || !chainId) {
        throw new Error("Both txHash and chainId are required");
      }

      const response = await fetch(`${this.apiUrl}/transactions/index`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey && { "x-api-key": this.apiKey }),
        },
        body: JSON.stringify({
          txHash,
          chainId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`Failed to index transaction: ${response.status} ${errorText}`);
      }
    } catch (error: unknown) {
      // Don't throw, just log - indexing is optional
      const err = error as Error;
      console.warn(`Failed to index transaction: ${err.message}`);
    }
  }
}

export default RelayService;
