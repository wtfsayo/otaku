import { createOpenAI } from '@ai-sdk/openai';
import type {
  GenerateTextParams,
  IAgentRuntime,
  ModelTypeName,
  ObjectGenerationParams,
  Plugin,
  TextEmbeddingParams,
} from '@elizaos/core';
import { EventType, logger, ModelType, VECTOR_DIMS } from '@elizaos/core';
import {
  generateObject,
  generateText,
  JSONParseError,
  type JSONValue,
  type LanguageModelUsage,
} from 'ai';
import { fetch } from 'undici';

/**
 * Retrieves a configuration setting from the runtime, falling back to environment variables or a default value if not found.
 *
 * @param key - The name of the setting to retrieve.
 * @param defaultValue - The value to return if the setting is not found in the runtime or environment.
 * @returns The resolved setting value, or {@link defaultValue} if not found.
 */
function getSetting(
  runtime: IAgentRuntime,
  key: string,
  defaultValue?: string
): string | undefined {
  return runtime.getSetting(key) ?? process.env[key] ?? defaultValue;
}

/**
 * Retrieves the EigenAI API base URL from runtime settings, environment variables, or defaults, using provider-aware resolution.
 *
 * @returns The resolved base URL for EigenAI API requests.
 */
function getBaseURL(runtime: IAgentRuntime): string {
  const baseURL = getSetting(runtime, 'EIGENAI_BASE_URL', 'https://api.openai.com/v1') as string;
      logger.debug(`[EigenAI] Default base URL: ${baseURL}`);
  return baseURL;
}

/**
 * Retrieves the EigenAI API base URL for embeddings, falling back to the general base URL.
 *
 * @returns The resolved base URL for EigenAI embedding requests.
 */
function getEmbeddingBaseURL(runtime: IAgentRuntime): string {
  const embeddingURL = getSetting(runtime, 'EIGENAI_EMBEDDING_URL');
  if (embeddingURL) {
    logger.debug(`[EigenAI] Using specific embedding base URL: ${embeddingURL}`);
    return embeddingURL;
  }
  logger.debug('[EigenAI] Falling back to general base URL for embeddings.');
  return getBaseURL(runtime);
}

/**
 * Helper function to get the API key for EigenAI
 *
 * @param runtime The runtime context
 * @returns The configured API key
 */
function getApiKey(runtime: IAgentRuntime): string | undefined {
  return getSetting(runtime, 'EIGENAI_API_KEY');
}

/**
 * Helper function to get the embedding API key for EigenAI, falling back to the general API key if not set.
 *
 * @param runtime The runtime context
 * @returns The configured API key
 */
function getEmbeddingApiKey(runtime: IAgentRuntime): string | undefined {
  const embeddingApiKey = getSetting(runtime, 'EIGENAI_EMBEDDING_API_KEY');
  if (embeddingApiKey) {
    logger.debug(`[EigenAI] Using specific embedding API key: ${embeddingApiKey}`);
    return embeddingApiKey;
  }
  logger.debug('[EigenAI] Falling back to general API key for embeddings.');
  return getApiKey(runtime);
}

/**
 * Helper function to get the small model name with fallbacks
 *
 * @param runtime The runtime context
 * @returns The configured small model name
 */
function getSmallModel(runtime: IAgentRuntime): string {
  return (
    getSetting(runtime, 'EIGENAI_SMALL_MODEL') ??
    (getSetting(runtime, 'SMALL_MODEL', 'gpt-5-nano') as string)
  );
}

/**
 * Helper function to get the large model name with fallbacks
 *
 * @param runtime The runtime context
 * @returns The configured large model name
 */
function getLargeModel(runtime: IAgentRuntime): string {
  return (
    getSetting(runtime, 'EIGENAI_LARGE_MODEL') ??
    (getSetting(runtime, 'LARGE_MODEL', 'gpt-5-mini') as string)
  );
}


/**
 * Helper function to get experimental telemetry setting
 *
 * @param runtime The runtime context
 * @returns Whether experimental telemetry is enabled
 */
function getExperimentalTelemetry(runtime: IAgentRuntime): boolean {
  const setting = getSetting(runtime, 'EIGENAI_EXPERIMENTAL_TELEMETRY', 'false');
  // Convert to string and check for truthy values
  const normalizedSetting = String(setting).toLowerCase();
  const result = normalizedSetting === 'true';
  logger.debug(
    `[EigenAI] Experimental telemetry in function: "${setting}" (type: ${typeof setting}, normalized: "${normalizedSetting}", result: ${result})`
  );
  return result;
}

/**
 * Helper function to get the EigenAI seed value
 *
 * @param runtime The runtime context
 * @returns The configured seed value as a number
 */
function getEigenAISeed(runtime: IAgentRuntime): number {
  const seedStr = getSetting(runtime, 'EIGENAI_SEED', '42');
  const seed = Number.parseInt(seedStr || '42', 10);
  return Number.isNaN(seed) ? 42 : seed;
}

/**
 * Create an OpenAI client with proper configuration
 *
 * @param runtime The runtime context
 * @returns Configured OpenAI client
 */
function createOpenAIClient(runtime: IAgentRuntime) {
  return createOpenAI({
    apiKey: getApiKey(runtime),
    baseURL: getBaseURL(runtime),
  });
}


/**
 * Helper function to generate objects using specified model type
 */
async function generateObjectByModelType(
  runtime: IAgentRuntime,
  params: ObjectGenerationParams,
  modelType: string,
  getModelFn: (runtime: IAgentRuntime) => string
): Promise<JSONValue> {
  const openai = createOpenAIClient(runtime);
  const modelName = getModelFn(runtime);
  logger.log(`[EigenAI] Using ${modelType} model: ${modelName}`);
  const temperature = params.temperature ?? 0;
  const schemaPresent = !!params.schema;

  if (schemaPresent) {
    logger.info(
      `Using ${modelType} without schema validation (schema provided but output=no-schema)`
    );
  }

  try {
    const { object, usage } = await generateObject({
      model: openai.languageModel(modelName),
      output: 'no-schema',
      prompt: params.prompt,
      temperature: temperature,
      seed: getEigenAISeed(runtime),
    });

    if (usage) {
      emitModelUsageEvent(runtime, modelType as ModelTypeName, params.prompt, usage);
    }
    return object as JSONValue;
  } catch (error) {
    if (error instanceof JSONParseError) {
      logger.error(`[generateObject] Failed to parse JSON: ${error.message}`);

      const repairFunction = getJsonRepairFunction();
      const repairedJsonString = await repairFunction({
        text: error.text,
        error,
      });

      if (repairedJsonString) {
        try {
          const repairedObject = JSON.parse(repairedJsonString);
          logger.info('[generateObject] Successfully repaired JSON.');
          return repairedObject;
        } catch (repairParseError) {
          const message =
            repairParseError instanceof Error ? repairParseError.message : String(repairParseError);
          logger.error(`[generateObject] Failed to parse repaired JSON: ${message}`);
          throw repairParseError;
        }
      } else {
        logger.error('[generateObject] JSON repair failed.');
        throw error;
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[generateObject] Unknown error: ${message}`);
      throw error;
    }
  }
}

/**
 * Returns a function to repair JSON text
 */
function getJsonRepairFunction(): (params: {
  text: string;
  error: Error | JSONParseError;
}) => Promise<string | null> {
  return async ({ text, error }: { text: string; error: Error | JSONParseError }) => {
    try {
      if (error instanceof JSONParseError) {
        const cleanedText = text.replace(/```json\n|\n```|```/g, '');
        JSON.parse(cleanedText);
        return cleanedText;
      }
      return null;
    } catch (jsonError) {
      const message = jsonError instanceof Error ? jsonError.message : String(jsonError);
      logger.warn(`Failed to repair JSON text: ${message}`);
      return null;
    }
  };
}

/**
 * Emits a model usage event
 * @param runtime The runtime context
 * @param type The model type
 * @param prompt The prompt used
 * @param usage The LLM usage data
 */
function emitModelUsageEvent(
  runtime: IAgentRuntime,
  type: ModelTypeName,
  prompt: string,
  usage: LanguageModelUsage
) {
  runtime.emitEvent(EventType.MODEL_USED, {
    provider: 'eigenAI',
    type,
    prompt,
    tokens: {
      prompt: usage.promptTokens,
      completion: usage.completionTokens,
      total: usage.totalTokens,
    },
  });
}


/**
 * Defines the EigenAI plugin with its name, description, and configuration options.
 * @type {Plugin}
 */
export const eigenAIPlugin: Plugin = {
  name: 'eigenAI',
  description: 'EigenAI plugin',
  config: {
    EIGENAI_API_KEY: process.env.EIGENAI_API_KEY,
    EIGENAI_BASE_URL: process.env.EIGENAI_BASE_URL,
    EIGENAI_SMALL_MODEL: process.env.EIGENAI_SMALL_MODEL,
    EIGENAI_LARGE_MODEL: process.env.EIGENAI_LARGE_MODEL,
    SMALL_MODEL: process.env.SMALL_MODEL,
    LARGE_MODEL: process.env.LARGE_MODEL,
    EIGENAI_EMBEDDING_MODEL: process.env.EIGENAI_EMBEDDING_MODEL,
    EIGENAI_EMBEDDING_API_KEY: process.env.EIGENAI_EMBEDDING_API_KEY,
    EIGENAI_EMBEDDING_URL: process.env.EIGENAI_EMBEDDING_URL,
    EIGENAI_EMBEDDING_DIMENSIONS: process.env.EIGENAI_EMBEDDING_DIMENSIONS,
    EIGENAI_EXPERIMENTAL_TELEMETRY: process.env.EIGENAI_EXPERIMENTAL_TELEMETRY,
    EIGENAI_SEED: process.env.EIGENAI_SEED || '42',
  },
  async init(_config, runtime) {
    // do check in the background
    new Promise<void>(async (resolve) => {
      resolve();
      try {
        if (!getApiKey(runtime)) {
          logger.warn(
            'EIGENAI_API_KEY is not set in environment - EigenAI functionality will be limited'
          );
          return;
        }
        try {
          const baseURL = getBaseURL(runtime);
          const response = await fetch(`${baseURL}/models`, {
            headers: { Authorization: `Bearer ${getApiKey(runtime)}` },
          });
          if (!response.ok) {
            logger.warn(`EigenAI API key validation failed: ${response.statusText}`);
            logger.warn('EigenAI functionality will be limited until a valid API key is provided');
          } else {
            logger.log('EigenAI API key validated successfully');
          }
        } catch (fetchError) {
          const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
          logger.warn(`Error validating EigenAI API key: ${message}`);
          logger.warn('EigenAI functionality will be limited until a valid API key is provided');
        }
      } catch (error) {
        const message =
          (error as { errors?: Array<{ message: string }> })?.errors
            ?.map((e) => e.message)
            .join(', ') || (error instanceof Error ? error.message : String(error));
        logger.warn(
          `EigenAI plugin configuration issue: ${message} - You need to configure the EIGENAI_API_KEY in your environment variables`
        );
      }
    });
  },

  models: {
    [ModelType.TEXT_EMBEDDING]: async (
      runtime: IAgentRuntime,
      params: TextEmbeddingParams | string | null
    ): Promise<number[]> => {
      const embeddingModelName = getSetting(
        runtime,
        'EIGENAI_EMBEDDING_MODEL',
        'text-embedding-3-small'
      );
      const embeddingDimension = Number.parseInt(
        getSetting(runtime, 'EIGENAI_EMBEDDING_DIMENSIONS', '1536') || '1536',
        10
      ) as (typeof VECTOR_DIMS)[keyof typeof VECTOR_DIMS];

      if (!Object.values(VECTOR_DIMS).includes(embeddingDimension)) {
        const errorMsg = `Invalid embedding dimension: ${embeddingDimension}. Must be one of: ${Object.values(VECTOR_DIMS).join(', ')}`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }
      if (params === null) {
        logger.debug('Creating test embedding for initialization'); 
        const testVector = Array(embeddingDimension).fill(0);
        testVector[0] = 0.1;
        return testVector;
      }
      let text: string;
      if (typeof params === 'string') {
        text = params;
      } else if (typeof params === 'object' && params.text) {
        text = params.text;
      } else {
        logger.warn('Invalid input format for embedding');
        const fallbackVector = Array(embeddingDimension).fill(0);
        fallbackVector[0] = 0.2;
        return fallbackVector;
      }
      if (!text.trim()) {
        logger.warn('Empty text for embedding');
        const emptyVector = Array(embeddingDimension).fill(0);
        emptyVector[0] = 0.3;
        return emptyVector;
      }

      const embeddingBaseURL = getEmbeddingBaseURL(runtime);
      const apiKey = getEmbeddingApiKey(runtime);

      if (!apiKey) {
        throw new Error('EigenAI API key not configured');
      }

      try {
        const response = await fetch(`${embeddingBaseURL}/embeddings`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: embeddingModelName,
            input: text,
          }),
        });


        if (!response.ok) {
          logger.error(`EigenAI API error: ${response.status} - ${response.statusText}`);
          const errorVector = Array(embeddingDimension).fill(0);
          errorVector[0] = 0.4;
          return errorVector;
        }

        const data = (await response.json()) as {
          data: [{ embedding: number[] }];
          usage?: { prompt_tokens: number; total_tokens: number };
        };

        if (!data?.data?.[0]?.embedding) {
          logger.error('API returned invalid structure');
          const errorVector = Array(embeddingDimension).fill(0);
          errorVector[0] = 0.5;
          return errorVector;
        }

        const embedding = data.data[0].embedding;

        if (data.usage) {
          const usage = {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: 0,
            totalTokens: data.usage.total_tokens,
          };

          emitModelUsageEvent(runtime, ModelType.TEXT_EMBEDDING, text, usage);
        }

        logger.log(`Got valid embedding with length ${embedding.length}`);
        return embedding;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Error generating embedding: ${message}`);
        const errorVector = Array(embeddingDimension).fill(0);
        errorVector[0] = 0.6;
        return errorVector;
      }
    },
    [ModelType.TEXT_SMALL]: async (
      runtime: IAgentRuntime,
      {
        prompt,
        stopSequences = [],
        maxTokens = 8192,
        temperature = 0.7,
        frequencyPenalty = 0.7,
        presencePenalty = 0.7,
      }: GenerateTextParams
    ) => {
      const openai = createOpenAIClient(runtime);
      const modelName = getSmallModel(runtime);
      const experimentalTelemetry = getExperimentalTelemetry(runtime);

      logger.log(`[EigenAI] Using TEXT_SMALL model: ${modelName}`);
      logger.log(prompt);

      const { text: openaiResponse, usage } = await generateText({
        model: openai.languageModel(modelName),
        prompt: prompt,
        system: runtime.character.system ?? undefined,
        temperature: temperature,
        maxTokens: maxTokens,
        frequencyPenalty: frequencyPenalty,
        presencePenalty: presencePenalty,   
        stopSequences: stopSequences,
        seed: getEigenAISeed(runtime),
        experimental_telemetry: {
          isEnabled: experimentalTelemetry,
        },
      });

      if (usage) {
        emitModelUsageEvent(runtime, ModelType.TEXT_SMALL, prompt, usage);
      }

      return openaiResponse;
    },
    [ModelType.TEXT_LARGE]: async (
      runtime: IAgentRuntime,
      {
        prompt,
        stopSequences = [],
        maxTokens = 8192,
        temperature = 0.7,
        frequencyPenalty = 0.7,
        presencePenalty = 0.7,
      }: GenerateTextParams
    ) => {
      const openai = createOpenAIClient(runtime);
      const modelName = getLargeModel(runtime);
      const experimentalTelemetry = getExperimentalTelemetry(runtime);

      logger.log(`[EigenAI] Using TEXT_LARGE model: ${modelName}`);
      logger.log(prompt);

      const { text: openaiResponse, usage } = await generateText({
        model: openai.languageModel(modelName),
        prompt: prompt,
        system: runtime.character.system ?? undefined,
        temperature: temperature,
        maxTokens: maxTokens,
        frequencyPenalty: frequencyPenalty,
        presencePenalty: presencePenalty,
        stopSequences: stopSequences,
        seed: getEigenAISeed(runtime),
        experimental_telemetry: {
          isEnabled: experimentalTelemetry,
        },
      });

      if (usage) {
        emitModelUsageEvent(runtime, ModelType.TEXT_LARGE, prompt, usage);
      }

      return openaiResponse;
    },
    [ModelType.OBJECT_SMALL]: async (runtime: IAgentRuntime, params: ObjectGenerationParams) => {
      return generateObjectByModelType(runtime, params, ModelType.OBJECT_SMALL, getSmallModel);
    },
    [ModelType.OBJECT_LARGE]: async (runtime: IAgentRuntime, params: ObjectGenerationParams) => {
      return generateObjectByModelType(runtime, params, ModelType.OBJECT_LARGE, getLargeModel);
    },
  },
  tests: [
    {
      name: 'eigenAI_plugin_tests',
      tests: [
        {
          name: 'eigenAI_test_url_and_api_key_validation',
          fn: async (runtime: IAgentRuntime) => {
            const baseURL = getBaseURL(runtime);
            const response = await fetch(`${baseURL}/models`, {
              headers: {
                Authorization: `Bearer ${getApiKey(runtime)}`,
              },
            });
            const data = await response.json();
            logger.log(
              { data: (data as { data?: unknown[] })?.data?.length ?? 'N/A' },
              'Models Available'
            );
            if (!response.ok) {
              throw new Error(`Failed to validate EigenAI API key: ${response.statusText}`);
            }
          },
        },
        {
          name: 'eigenAI_test_text_embedding',
          fn: async (runtime: IAgentRuntime) => {
            try {
              const embedding = await runtime.useModel(ModelType.TEXT_EMBEDDING, {
                text: 'Hello, world!',
              });
              logger.log({ embedding }, 'embedding');
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger.error(`Error in test_text_embedding: ${message}`);
              throw error;
            }
          },
        },
        {
          name: 'eigenAI_test_text_large',
          fn: async (runtime: IAgentRuntime) => {
            try {
              const text = await runtime.useModel(ModelType.TEXT_LARGE, {
                prompt: 'What is the nature of reality in 10 words?',
              });
              if (text.length === 0) {
                throw new Error('Failed to generate text');
              }
              logger.log({ text }, 'generated with test_text_large');
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger.error(`Error in test_text_large: ${message}`);
              throw error;
            }
          },
        },
        {
          name: 'eigenAI_test_text_small',
          fn: async (runtime: IAgentRuntime) => {
            try {
              const text = await runtime.useModel(ModelType.TEXT_SMALL, {
                prompt: 'What is the nature of reality in 10 words?',
              });
              if (text.length === 0) {
                throw new Error('Failed to generate text');
              }
              logger.log({ text }, 'generated with test_text_small');
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger.error(`Error in test_text_small: ${message}`);
              throw error;
            }
          },
        },
      ],
    },
  ],
};
export default eigenAIPlugin;