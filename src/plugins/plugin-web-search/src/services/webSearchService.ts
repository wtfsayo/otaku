import { IAgentRuntime, logger, Service } from "@elizaos/core";
import { tavily } from "@tavily/core";
import type { IWebSearchService, SearchOptions, SearchResponse } from "../types";

export type TavilyClient = ReturnType<typeof tavily>; // declaring manually because original package does not export its types

export class WebSearchService extends Service implements IWebSearchService {
    static serviceType = "WEB_SEARCH" as const;

    // Tavily client instance
    private tavilyClient!: TavilyClient;

    constructor(runtime: IAgentRuntime) {
        super(runtime);
    }

    static async start(runtime: IAgentRuntime): Promise<WebSearchService> {
        const service = new WebSearchService(runtime);
        await service.initialize(runtime);
        return service;
    }

    async initialize(runtime: IAgentRuntime): Promise<void> {
        const apiKey = runtime.getSetting("TAVILY_API_KEY") as string;
        if (!apiKey) {
            throw new Error("TAVILY_API_KEY is not set");
        }
        this.tavilyClient = tavily({ apiKey });
    }

    get capabilityDescription(): string {
        return "Web search via Tavily API. Supports answer synthesis and result listing with optional images.";
    }

    async stop(): Promise<void> {
        // No persistent connections to close for Tavily client
    }

    async search(
        query: string,
        options?: SearchOptions,
    ): Promise<SearchResponse> {
        try {
            if (!this.tavilyClient) {
                throw new Error("WebSearchService not initialized");
            }

            const response = await this.tavilyClient.search(query, {
                includeAnswer: options?.includeAnswer ?? true,
                maxResults: options?.limit ?? 3,
                topic: options?.type ?? "general",
                searchDepth: options?.searchDepth ?? "basic",
                includeImages: options?.includeImages ?? false,
                days: options?.days ?? 3,
            });

            return response;
        } catch (error) {
            logger.error(`Web search error: ${(error as Error).message}`);
            throw error;
        }
    }
}
