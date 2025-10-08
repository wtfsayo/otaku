import {
  ActionResult,
  IAgentRuntime,
  logger,
  Service,
  ServiceType,
} from "@elizaos/core";
import type {
  APIRequest,
  Bridge,
  Chain,
  Protocol,
  ProtocolDetails,
  YieldPool,
  Stablecoin,
  TVLData,
  HistoricalData,
  RateLimitStatus,
  DefiLlamaConfig,
  DefiLlamaError,
  YieldChartData,
  DexVolume,
  ProtocolFees,
  CoinPrice,
  HistoricalPrice,
} from "../types";

interface QueuedRequest<T> {
  request: APIRequest;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

export class DefiLlamaService extends Service {
  static serviceType = "defillama";
  capabilityDescription =
    "DeFiLlama API integration for DeFi market data and analytics";

  private defiConfig: DefiLlamaConfig;
  private requestQueue: QueuedRequest<any>[] = [];
  private requestCount = 0;
  private resetTime: number;
  private isProcessingQueue = false;
  private rateLimitStatus: RateLimitStatus;
  private queueProcessInterval?: NodeJS.Timeout;
  private rateLimitResetInterval?: NodeJS.Timeout;

  constructor(runtime: IAgentRuntime) {
    super(runtime);

    this.defiConfig = {
      apiBaseUrl: "https://api.llama.fi",
      rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE) || 300,
      maxConcurrentRequests: Number(process.env.MAX_CONCURRENT_REQUESTS) || 10,
      retryAttempts: 3,
      retryDelay: 1000,
    };

    this.resetTime = Date.now() + 60000; // Reset every minute
    this.rateLimitStatus = {
      remaining: this.defiConfig.rateLimitPerMinute,
      resetTime: this.resetTime,
      limit: this.defiConfig.rateLimitPerMinute,
    };
  }

  static async start(runtime: IAgentRuntime): Promise<DefiLlamaService> {
    logger.info("Starting DeFiLlama service");
    const service = new DefiLlamaService(runtime);

    // Start rate limit reset timer
    service.rateLimitResetInterval = setInterval(() => {
      service.requestCount = 0;
      service.resetTime = Date.now() + 60000;
      service.rateLimitStatus.remaining = service.defiConfig.rateLimitPerMinute;
      service.rateLimitStatus.resetTime = service.resetTime;
    }, 60000);

    // Start queue processor
    service.queueProcessInterval = setInterval(
      () => service.processQueue(),
      100,
    );

    return service;
  }

  static async stop(runtime: IAgentRuntime): Promise<void> {
    logger.info("Stopping DeFiLlama service");
    // Cleanup would go here if needed
  }

  async stop(): Promise<void> {
    // Clear intervals
    if (this.queueProcessInterval) {
      clearInterval(this.queueProcessInterval);
    }
    if (this.rateLimitResetInterval) {
      clearInterval(this.rateLimitResetInterval);
    }

    // Clear any pending requests
    this.requestQueue = [];
  }

  // API Methods

  async getProtocols(): Promise<ProtocolDetails[]> {
    return this.makeRequest<ProtocolDetails[]>({
      endpoint: "/protocols",
      priority: "medium",
    });
  }

  async getProtocol(slug: string): Promise<ProtocolDetails> {
    return this.makeRequest<ProtocolDetails>({
      endpoint: `/protocol/${slug}`,
      priority: "high",
    });
  }

  async getTVL(protocol?: string): Promise<TVLData> {
    if (protocol) {
      // Get TVL for specific protocol
      const tvlValue = await this.makeRequest<number>({
        endpoint: `/tvl/${protocol}`,
        priority: "medium",
      });
      return {
        date: new Date().toISOString(),
        totalLiquidityUSD: tvlValue,
      };
    } else {
      // Get total TVL from all chains
      const chains = await this.makeRequest<Chain[]>({
        endpoint: "/v2/chains",
        priority: "medium",
      });
      const totalTVL = chains.reduce((sum, chain) => sum + (chain.tvl || 0), 0);
      return {
        date: new Date().toISOString(),
        totalLiquidityUSD: totalTVL,
      };
    }
  }

  async getYields(): Promise<YieldPool[]> {
    const response = await this.makeRequest<{
      status: string;
      data: YieldPool[];
    }>({
      endpoint: "/pools",
      priority: "medium",
    });
    return response.data || [];
  }

  async getChains(): Promise<Chain[]> {
    return this.makeRequest<Chain[]>({
      endpoint: "/v2/chains",
      priority: "low",
    });
  }

  async getHistoricalTVL(
    protocol: string,
    period: string,
  ): Promise<HistoricalData[]> {
    const endpoint = `/protocol/${protocol}`;
    const data = await this.makeRequest<{
      chainTvls: Record<
        string,
        {
          tvl: Array<{
            date: number;
            totalLiquidityUSD: number;
          }>;
        }
      >;
    }>({
      endpoint,
      priority: "medium",
    });

    // Filter based on period
    const now = Date.now() / 1000;
    const periodSeconds = this.parsePeriod(period);
    const startTime = now - periodSeconds;

    // Aggregate all chain TVL data into a single array
    const allTvlData: HistoricalData[] = [];
    const dateMap = new Map<number, number>();

    // Combine TVL data from all chains
    for (const chain of Object.values(data.chainTvls)) {
      if (chain.tvl) {
        for (const tvlPoint of chain.tvl) {
          if (tvlPoint.date >= startTime) {
            const existingValue = dateMap.get(tvlPoint.date) || 0;
            dateMap.set(
              tvlPoint.date,
              existingValue + tvlPoint.totalLiquidityUSD,
            );
          }
        }
      }
    }

    // Convert map to array and sort by date
    for (const [date, totalLiquidityUSD] of dateMap) {
      allTvlData.push({ date, totalLiquidityUSD });
    }

    return allTvlData.sort((a, b) => a.date - b.date);
  }

  async getBridges(params?: { includeChains?: boolean }): Promise<Bridge[]> {
    const queryParams = params
      ? { includeChains: String(params.includeChains) }
      : undefined;
    const response = await this.makeRequest<{ bridges: Bridge[] }>({
      endpoint: "/bridges",
      priority: "low",
      params: queryParams as Record<string, string>,
    });
    return response.bridges || [];
  }

  async getStablecoins(params?: {
    includePrices?: boolean;
  }): Promise<Stablecoin[]> {
    const queryParams = params
      ? { includePrices: String(params.includePrices) }
      : undefined;
    const response = await this.makeRequest<{ peggedAssets: Stablecoin[] }>({
      endpoint: "/stablecoins",
      priority: "medium",
      params: queryParams as Record<string, string>,
    });
    return response.peggedAssets;
  }

  async getStablecoinChains(): Promise<Record<string, any>> {
    return this.makeRequest<Record<string, any>>({
      endpoint: "/stablecoinchains",
      priority: "low",
    });
  }

  // Additional endpoints based on DeFiLlama API specification

  async getYieldChart(poolId: string): Promise<YieldChartData[]> {
    return this.makeRequest<YieldChartData[]>({
      endpoint: `/chart/${poolId}`,
      priority: "medium",
    });
  }

  async getDexVolumes(params?: {
    excludeTotalDataChart?: boolean;
    excludeTotalDataChartBreakdown?: boolean;
  }): Promise<DexVolume[]> {
    return this.makeRequest<DexVolume[]>({
      endpoint: "/overview/dexs",
      priority: "medium",
      params: params as Record<string, string>,
    });
  }

  async getDexVolumesByChain(
    chain: string,
    params?: {
      excludeTotalDataChart?: boolean;
      excludeTotalDataChartBreakdown?: boolean;
    },
  ): Promise<DexVolume[]> {
    return this.makeRequest<DexVolume[]>({
      endpoint: `/overview/dexs/${chain}`,
      priority: "medium",
      params: params as Record<string, string>,
    });
  }

  async getProtocolFees(params?: {
    excludeTotalDataChart?: boolean;
    excludeTotalDataChartBreakdown?: boolean;
    dataType?: string;
  }): Promise<ProtocolFees[]> {
    return this.makeRequest<ProtocolFees[]>({
      endpoint: "/overview/fees",
      priority: "medium",
      params: params as Record<string, string>,
    });
  }

  async getProtocolFeesByChain(
    chain: string,
    params?: {
      excludeTotalDataChart?: boolean;
      excludeTotalDataChartBreakdown?: boolean;
      dataType?: string;
    },
  ): Promise<ProtocolFees[]> {
    return this.makeRequest<ProtocolFees[]>({
      endpoint: `/overview/fees/${chain}`,
      priority: "medium",
      params: params as Record<string, string>,
    });
  }

  async getProtocolFeesById(protocolId: string): Promise<ProtocolFees> {
    return this.makeRequest<ProtocolFees>({
      endpoint: `/summary/fees/${protocolId}`,
      priority: "high",
    });
  }

  async getCoinPrices(
    coins: string[],
    searchWidth?: string,
  ): Promise<{ coins: Record<string, CoinPrice> }> {
    const params: Record<string, string> = {};
    if (searchWidth) {
      params.searchWidth = searchWidth;
    }

    return this.makeRequest<{ coins: Record<string, CoinPrice> }>({
      endpoint: `/prices/current/${coins.join(",")}`,
      params,
      priority: "high",
    });
  }

  async getHistoricalPrices(
    coins: string[],
    timestamp: number,
  ): Promise<{ coins: Record<string, HistoricalPrice> }> {
    return this.makeRequest<{ coins: Record<string, HistoricalPrice> }>({
      endpoint: `/prices/historical/${timestamp}/${coins.join(",")}`,
      priority: "medium",
    });
  }

  async getBatchHistoricalPrices(
    coins: string[],
    searchWidth?: string,
  ): Promise<Record<string, { price: number; timestamp: number }>> {
    const params: Record<string, string> = {
      coins: coins.join(","),
    };
    if (searchWidth) {
      params.searchWidth = searchWidth;
    }

    return this.makeRequest<
      Record<string, { price: number; timestamp: number }>
    >({
      endpoint: "/batchHistorical",
      params,
      priority: "medium",
    });
  }

  async getFirstPrices(
    coins: string[],
  ): Promise<{ coins: Record<string, { price: number; timestamp: number }> }> {
    return this.makeRequest<{
      coins: Record<string, { price: number; timestamp: number }>;
    }>({
      endpoint: `/prices/first/${coins.join(",")}`,
      priority: "low",
    });
  }

  // Rate Limiting Methods

  async getRateLimitStatus(): Promise<RateLimitStatus> {
    return this.rateLimitStatus;
  }

  async batchRequests<T>(requests: APIRequest[]): Promise<T[]> {
    // Sort by priority
    const sortedRequests = requests.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    const results = await Promise.all(
      sortedRequests.map((req) => this.makeRequest<T>(req)),
    );

    return results;
  }

  // Private Methods

  private async makeRequest<T>(request: APIRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        request,
        resolve,
        reject,
        timestamp: Date.now(),
      });

      // Start processing queue
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      const now = Date.now();

      // Reset counter if time window passed
      if (now >= this.resetTime) {
        this.requestCount = 0;
        this.resetTime = now + 60000;
        this.rateLimitStatus.remaining = this.defiConfig.rateLimitPerMinute;
        this.rateLimitStatus.resetTime = this.resetTime;
      }

      // Process requests up to rate limit
      const availableSlots =
        this.defiConfig.rateLimitPerMinute - this.requestCount;
      const requestsToProcess = Math.min(
        availableSlots,
        this.defiConfig.maxConcurrentRequests,
        this.requestQueue.length,
      );

      if (requestsToProcess <= 0) {
        return;
      }

      // Sort queue by priority and timestamp
      this.requestQueue.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const priorityDiff =
          priorityOrder[a.request.priority] - priorityOrder[b.request.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return a.timestamp - b.timestamp;
      });

      // Process batch
      const batch = this.requestQueue.splice(0, requestsToProcess);
      this.requestCount += batch.length;
      this.rateLimitStatus.remaining =
        this.defiConfig.rateLimitPerMinute - this.requestCount;

      await Promise.all(
        batch.map(async (item) => {
          try {
            const result = await this.executeRequest(item.request);
            item.resolve(result);
          } catch (error) {
            item.reject(error as Error);
          }
        }),
      );
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async executeRequest(request: APIRequest): Promise<any> {
    // Determine the correct base URL based on endpoint
    let url: string;
    if (
      request.endpoint.startsWith("/stablecoins") ||
      request.endpoint.startsWith("/stablecoin")
    ) {
      url = `https://stablecoins.llama.fi${request.endpoint}`;
    } else if (
      request.endpoint.startsWith("/pools") ||
      request.endpoint.startsWith("/chart/")
    ) {
      url = `https://yields.llama.fi${request.endpoint}`;
    } else if (request.endpoint.startsWith("/bridges")) {
      url = `https://bridges.llama.fi${request.endpoint}`;
    } else if (
      request.endpoint.startsWith("/prices/") ||
      request.endpoint === "/batchHistorical"
    ) {
      url = `https://coins.llama.fi${request.endpoint}`;
    } else if (request.endpoint.startsWith("https://")) {
      url = request.endpoint;
    } else {
      url = `${this.defiConfig.apiBaseUrl}${request.endpoint}`;
    }

    const params = new URLSearchParams(request.params || {});
    const fullUrl = params.toString() ? `${url}?${params}` : url;

    for (let attempt = 0; attempt < this.defiConfig.retryAttempts; attempt++) {
      try {
        logger.debug(`DeFiLlama API request: ${fullUrl}`);

        // Add timeout to the fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        const response = await fetch(fullUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "ElizaOS-DeFiLlama-Plugin/1.0",
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // Check if this is a retryable error
          const shouldRetry = this.shouldRetryError(response.status);
          if (!shouldRetry && attempt === 0) {
          }

          throw new Error(
            `API request failed: ${response.status} ${response.statusText}`,
          );
        }

        const data = await response.json();
        return data;
      } catch (error) {
        logger.error(`DeFiLlama API error (attempt ${attempt + 1}):`, (error as Error).message);

        // Check if this is the last attempt or if we shouldn't retry this error
        const isLastAttempt = attempt >= this.defiConfig.retryAttempts - 1;
        const isRetryableError =
          error instanceof Error &&
          (error.name === "AbortError" || // Timeout
            error.message.includes("500") || // Server error
            error.message.includes("502") || // Bad Gateway
            error.message.includes("503") || // Service Unavailable
            error.message.includes("429")); // Rate limit

        if (!isLastAttempt && isRetryableError) {
          // Calculate exponential backoff with jitter
          const baseDelay = this.defiConfig.retryDelay * Math.pow(2, attempt);
          const jitter = Math.random() * 1000; // Add up to 1 second of jitter
          const delay = baseDelay + jitter;

          logger.debug(`Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          const defiError: DefiLlamaError = {
            code: "API_ERROR",
            message: "Failed to fetch data from DeFiLlama API",
            details: error,
            suggestions: [
              "Try again later",
              "Check your internet connection",
              error instanceof Error && error.message.includes("404")
                ? "The requested resource may not exist"
                : "This may be a temporary service issue",
            ],
            fallbackAvailable: false,
          };

          throw new Error(JSON.stringify(defiError));
        }
      }
    }
  }

  private shouldRetryError(statusCode: number): boolean {
    // Don't retry client errors (4xx) except rate limiting
    if (statusCode >= 400 && statusCode < 500) {
      return statusCode === 429; // Only retry rate limit errors
    }

    // Retry server errors (5xx)
    if (statusCode >= 500) {
      return true;
    }

    return false;
  }

  private parsePeriod(period: string): number {
    const units: Record<string, number> = {
      "1d": 86400,
      "7d": 604800,
      "30d": 2592000,
      "90d": 7776000,
      "1y": 31536000,
    };

    return units[period] || 604800; // Default to 7 days
  }
}
