import { describe, it, expect, beforeEach, mock } from "bun:test";
import { IAgentRuntime, Memory } from "@elizaos/core";
import { defiLlamaPlugin } from "../src";
import { DefiLlamaService } from "../src/services/defiLlamaService";

// Mock runtime
const createMockRuntime = (services: Record<string, any> = {}): IAgentRuntime =>
  ({
    getService: (name: string) => services[name],
    generateId: () =>
      `550e8400-e29b-41d4-a716-${Math.random().toString(36).substr(2, 12)}`,
    emit: mock(() => {}),
  }) as any;

const createMockMessage = (text: string, userId = "user123"): Memory =>
  ({
    id: "550e8400-e29b-41d4-a716-446655440000",
    userId,
    agentId: "550e8400-e29b-41d4-a716-446655440002",
    roomId: "550e8400-e29b-41d4-a716-446655440003",
    entityId: "550e8400-e29b-41d4-a716-446655440001",
    content: {
      text,
      source: "test",
    },
    createdAt: Date.now(),
  }) as Memory;

describe("DeFiLlama Plugin Integration", () => {
  let runtime: IAgentRuntime;
  let defiLlamaService: DefiLlamaService;

  beforeEach(async () => {
    runtime = createMockRuntime();
    defiLlamaService = await DefiLlamaService.start(runtime);

    runtime = createMockRuntime({
      defillama: defiLlamaService,
    });
  });

  it("should initialize plugin successfully", async () => {
    const config = {
      RATE_LIMIT_PER_MINUTE: "300",
    };

    const mockRuntime = createMockRuntime();
    await expect(
      defiLlamaPlugin.init!(config, mockRuntime),
    ).resolves.toBeUndefined();
  });

  it("should have all required components", () => {
    expect(defiLlamaPlugin.services).toBeDefined();
    expect(defiLlamaPlugin.actions).toBeDefined();
    expect(defiLlamaPlugin.providers).toBeDefined();
    expect(defiLlamaPlugin.services!.length).toBeGreaterThan(0);
    expect(defiLlamaPlugin.actions!.length).toBeGreaterThan(0);
    expect(defiLlamaPlugin.providers!.length).toBeGreaterThan(0);
  });

  it("should handle service integration", async () => {
    const message = createMockMessage("What is the TVL of Aave?");

    // Test that DeFiLlama service works
    expect(defiLlamaService).toBeDefined();
    expect(typeof defiLlamaService.getProtocols).toBe("function");
  });
});
