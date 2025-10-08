import {
    type Action,
    type ActionResult,
    composePromptFromState,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    ModelType,
    parseKeyValueXml,
    type State,
    logger,
} from "@elizaos/core";
import { encodingForModel, type TiktokenModel } from "js-tiktoken";
import { WebSearchService } from "../services/webSearchService";
import type { SearchResult } from "../types";

const DEFAULT_MAX_WEB_SEARCH_TOKENS = 4000;
const DEFAULT_MODEL_ENCODING = "gpt-3.5-turbo";

const webSearchTemplate = `# Web Search Request

## Conversation Context
{{recentMessages}}

## Instructions
- Determine the user's intended web search query from the conversation context.
- If applicable, include optional parameters. Keep them simple and only when clearly requested by the user.

Respond ONLY with the following XML format:
<response>
    <query>the exact query to search</query>
    <type>news|general</type>
    <limit>3</limit>
    <includeImages>false</includeImages>
    <searchDepth>basic</searchDepth>
    <days>3</days>
    <includeAnswer>true</includeAnswer>
</response>`;

function getTotalTokensFromString(
    str: string,
    encodingName: TiktokenModel = DEFAULT_MODEL_ENCODING
) {
    const encoding = encodingForModel(encodingName);
    return encoding.encode(str).length;
}

function MaxTokens(
    data: string,
    maxTokens: number = DEFAULT_MAX_WEB_SEARCH_TOKENS
): string {
    if (getTotalTokensFromString(data) >= maxTokens) {
        return data.slice(0, maxTokens);
    }
    return data;
}

export const webSearch: Action = {
    name: "WEB_SEARCH",
    similes: [
        "SEARCH_WEB",
        "INTERNET_SEARCH",
        "LOOKUP",
        "QUERY_WEB",
        "FIND_ONLINE",
        "SEARCH_ENGINE",
        "WEB_LOOKUP",
        "ONLINE_SEARCH",
        "FIND_INFORMATION",
    ],
    suppressInitialMessage: true,
    description:
        "Use this action when other actions/providers can’t provide accurate or current info, or when facts must be confirmed via the web.",
    validate: async (
        runtime: IAgentRuntime,
        _message: Memory,
        _state?: State
    ) => {
        try {
            const service = runtime.getService<WebSearchService>(WebSearchService.serviceType);
            return !!service;
        } catch (err) {
            logger.warn("WebSearchService not available:", (err as Error).message);
            return false;
        }
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State,
        _options?: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<ActionResult> => {
        try {
            const webSearchService = runtime.getService<WebSearchService>(WebSearchService.serviceType);
            if (!webSearchService) {
                throw new Error("WebSearchService not initialized");
            }

            // Build query via template + XML parsing
            const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
            const context = composePromptFromState({ state: composedState, template: webSearchTemplate });
            const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, { prompt: context });
            const parsed = parseKeyValueXml(xmlResponse || "");

            const query = parsed?.query?.trim();
            if (!query) {
                const emptyResult: ActionResult = {
                    text: "Please specify what to search for.",
                    success: false,
                    error: "empty_query",
                };
                if (callback) {
                    callback({ text: emptyResult.text, content: { error: "empty_query" } });
                }
                return emptyResult;
            }

            logger.info("WEB_SEARCH query (from template):", query);

            const limit = parsed?.limit ? Number(parsed.limit) : undefined;
            const type = (parsed?.type as "news" | "general" | undefined) ?? undefined;
            const includeImages = typeof parsed?.includeImages === "string" ? parsed.includeImages.toLowerCase() === "true" : undefined;
            const days = parsed?.days ? Number(parsed.days) : undefined;
            const searchDepth = (parsed?.searchDepth as "basic" | "advanced" | undefined) ?? undefined;
            const includeAnswer = typeof parsed?.includeAnswer === "string" ? parsed.includeAnswer.toLowerCase() === "true" : undefined;

            const searchResponse = await webSearchService.search(query, {
                limit,
                type,
                includeImages,
                days,
                searchDepth,
                includeAnswer,
            });

            if (searchResponse && searchResponse.results.length) {
                const responseList = searchResponse.answer
                    ? `${searchResponse.answer}${
                          Array.isArray(searchResponse.results) &&
                          searchResponse.results.length > 0
                              ? `\n\nFor more details, you can check out these resources:\n${searchResponse.results
                                    .map(
                                        (result: SearchResult, index: number) =>
                                            `${index + 1}. [${result.title}](${result.url})`
                                    )
                                    .join("\n")}`
                              : ""
                      }`
                    : "";

                const result: ActionResult = {
                    text: MaxTokens(responseList, DEFAULT_MAX_WEB_SEARCH_TOKENS),
                    success: true,
                    data: searchResponse,
                };

                if (callback) {
                    callback({ text: result.text, actions: ["WEB_SEARCH"], data: result.data });
                }

                return result;
            }

            const noResult: ActionResult = {
                text: "I couldn't find relevant results for that query.",
                success: false,
            };

            if (callback) {
                callback({ text: noResult.text });
            }
            return noResult;
        } catch (error) {
            const errMsg = (error as Error).message;
            logger.error("WEB_SEARCH failed:", errMsg);
            const errorResult: ActionResult = {
                text: `Web search failed: ${errMsg}`,
                success: false,
                error: errMsg,
            };
            if (callback) {
                callback({ text: errorResult.text, content: { error: "web_search_failed", details: errMsg } });
            }
            return errorResult;
        }
    },
    examples: [
        [
            {
                name: "{{user}}",
                content: {
                    text: "Find the latest news about SpaceX launches.",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here is the latest news about SpaceX launches:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "Can you find details about the iPhone 16 release?",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here are the details I found about the iPhone 16 release:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "What is the schedule for the next FIFA World Cup?",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here is the schedule for the next FIFA World Cup:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: { text: "Check the latest stock price of Tesla." },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here is the latest stock price of Tesla I found:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "What are the current trending movies in the US?",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here are the current trending movies in the US:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "What is the latest score in the NBA finals?",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here is the latest score from the NBA finals:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: { text: "When is the next Apple keynote event?" },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here is the information about the next Apple keynote event:",
                    action: "WEB_SEARCH",
                },
            },
        ],
    ],
} as Action;