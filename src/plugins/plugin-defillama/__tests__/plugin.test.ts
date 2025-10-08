import { describe, it, expect, mock } from "bun:test";
import { defiLlamaPlugin } from "../src";

describe("DeFiLlama Plugin", () => {
  it("should have correct plugin metadata", () => {
    expect(defiLlamaPlugin.name).toBe("plugin-defillama");
    expect(defiLlamaPlugin.description).toContain("DeFiLlama");
  });

  it("should export all required services", () => {
    expect(defiLlamaPlugin.services).toBeDefined();
    expect(defiLlamaPlugin.services!).toHaveLength(1);

    const serviceTypes = defiLlamaPlugin.services!.map((s) => s.serviceType);
    expect(serviceTypes).toContain("defillama");
  });

  it("should export all required actions", () => {
    expect(defiLlamaPlugin.actions).toBeDefined();
    expect(defiLlamaPlugin.actions!).toHaveLength(9);

    const actionNames = defiLlamaPlugin.actions!.map((a) => a.name);
    expect(actionNames).toContain("PROTOCOL_DATA");
    expect(actionNames).toContain("YIELD_SEARCH");
    expect(actionNames).toContain("MARKET_TRENDS");
    expect(actionNames).toContain("HISTORICAL_DATA");
    expect(actionNames).toContain("CROSS_CHAIN_ANALYSIS");
    expect(actionNames).toContain("FEES_VOLUME_DATA");
    expect(actionNames).toContain("PRICE_DATA");
    expect(actionNames).toContain("DEFI_RECOMMENDATION");
    expect(actionNames).toContain("DEFI_RISK_ANALYSIS");
  });

  it("should export providers", () => {
    expect(defiLlamaPlugin.providers).toBeDefined();
    expect(defiLlamaPlugin.providers!).toHaveLength(3);

    // Note: Providers may not have name properties, so we test the array length
    // and verify that all providers are properly exported
    expect(defiLlamaPlugin.providers).toBeDefined();
    expect(Array.isArray(defiLlamaPlugin.providers)).toBe(true);

    // Test that providers have the expected structure
    defiLlamaPlugin.providers!.forEach((provider) => {
      expect(provider).toBeDefined();
      expect(typeof provider.get).toBe("function");
    });
  });

  it("should export evaluators", () => {
    expect(defiLlamaPlugin.evaluators).toHaveLength(0);
  });

  it("should initialize with valid config", async () => {
    const config = {
      RATE_LIMIT_PER_MINUTE: "500",
    };

    const mockRuntime = {} as any;
    await expect(
      defiLlamaPlugin.init!(config, mockRuntime),
    ).resolves.toBeUndefined();

    // Verify environment variables were set
    expect(process.env.RATE_LIMIT_PER_MINUTE).toBe("500");
  });

  it("should handle invalid config gracefully", async () => {
    const invalidConfig = {
      CACHE_TTL: "not-a-number",
    };

    // This should parse but use default for invalid value
    const mockRuntime = {} as any;
    await expect(
      defiLlamaPlugin.init!(invalidConfig, mockRuntime),
    ).resolves.toBeUndefined();
  });

  it("should register event handlers", () => {
    expect(defiLlamaPlugin.events).toBeDefined();
    expect(typeof defiLlamaPlugin.events).toBe("object");
  });
});
