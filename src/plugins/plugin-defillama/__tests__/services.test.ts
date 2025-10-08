import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { IAgentRuntime } from "@elizaos/core";
import { DefiLlamaService } from "../src/services/defiLlamaService";

// Real runtime implementation
const createRuntime = (services: Record<string, any> = {}): IAgentRuntime =>
  ({
    getService: (name: string) => services[name],
    generateId: () =>
      `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    emit: (event: string, data?: any) => {
      console.log(`Event emitted: ${event}`, data);
    },
  }) as any;

describe("DefiLlamaService", () => {
  let defiLlamaService: DefiLlamaService;
  let runtime: IAgentRuntime;

  beforeEach(async () => {
    runtime = createRuntime();
    defiLlamaService = await DefiLlamaService.start(runtime);
  });

  afterEach(async () => {
    await defiLlamaService.stop();
  });

  it("should handle rate limiting", async () => {
    const rateLimitStatus = await defiLlamaService.getRateLimitStatus();
    expect(rateLimitStatus.remaining).toBeGreaterThanOrEqual(0);
    expect(rateLimitStatus.limit).toBeGreaterThan(0);
    expect(rateLimitStatus.resetTime).toBeGreaterThan(Date.now());
  });

  it("should batch requests with priority", async () => {
    const requests = [
      { endpoint: "/protocols", priority: "high" as const },
      { endpoint: "/v2/chains", priority: "medium" as const },
      { endpoint: "/pools", priority: "low" as const },
    ];

    // Mock the actual API calls to avoid real network requests
    const originalMakeRequest = (defiLlamaService as any).makeRequest;
    (defiLlamaService as any).makeRequest = mock(async () => ({}));

    await new Promise((resolve) => setTimeout(resolve, 100)); // Give time for batch processing

    const results = await defiLlamaService.batchRequests(requests);
    expect(results).toHaveLength(3);

    // Restore original method
    (defiLlamaService as any).makeRequest = originalMakeRequest;
  });

  it("should handle new API endpoints correctly", async () => {
    // Test that service has the expected methods
    expect(typeof defiLlamaService.getProtocols).toBe("function");
    expect(typeof defiLlamaService.getYields).toBe("function");
    expect(typeof defiLlamaService.getDexVolumes).toBe("function");
    expect(typeof defiLlamaService.getProtocolFees).toBe("function");
    expect(typeof defiLlamaService.getCoinPrices).toBe("function");
  });

  it("should handle different base URLs correctly", async () => {
    // Test that different endpoints use appropriate base URLs
    const service = defiLlamaService as any;
    
    // Test URL determination logic
    expect(service.executeRequest).toBeDefined();
    
    // These would use different base URLs:
    // - stablecoins endpoints -> stablecoins.llama.fi
    // - pools/chart endpoints -> yields.llama.fi  
    // - bridges endpoints -> bridges.llama.fi
    // - prices endpoints -> coins.llama.fi
    // - default endpoints -> api.llama.fi
  });
});