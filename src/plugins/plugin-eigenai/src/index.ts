import { createOpenAI } from '@ai-sdk/openai';
import type {
  DetokenizeTextParams,
  GenerateTextParams,
  IAgentRuntime,
  ImageDescriptionParams,
  ModelTypeName,
  ObjectGenerationParams,
  Plugin,
  TextEmbeddingParams,
  TokenizeTextParams,
} from '@elizaos/core';
import { EventType, logger, ModelType, VECTOR_DIMS } from '@elizaos/core';
import {
  generateObject,
  generateText,
  JSONParseError,
  type JSONValue,
  type LanguageModelUsage,
} from 'ai';
import { encodingForModel, type TiktokenModel } from 'js-tiktoken';
import { fetch, FormData } from 'undici';

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
 * Retrieves the OpenAI API base URL from runtime settings, environment variables, or defaults, using provider-aware resolution.
 *
 * @returns The resolved base URL for OpenAI API requests.
 */
function getBaseURL(runtime: IAgentRuntime): string {
  const baseURL = getSetting(runtime, 'OPENAI_BASE_URL', 'https://api.openai.com/v1') as string;
      logger.debug(`[EigenAI] Default base URL: ${baseURL}`);
  return baseURL;
}

/**
 * Retrieves the OpenAI API base URL for embeddings, falling back to the general base URL.
 *
 * @returns The resolved base URL for OpenAI embedding requests.
 */
function getEmbeddingBaseURL(runtime: IAgentRuntime): string {
  const embeddingURL = getSetting(runtime, 'OPENAI_EMBEDDING_URL');
  if (embeddingURL) {
    logger.debug(`[EigenAI] Using specific embedding base URL: ${embeddingURL}`);
    return embeddingURL;
  }
  logger.debug('[EigenAI] Falling back to general base URL for embeddings.');
  return getBaseURL(runtime);
}

/**
 * Helper function to get the API key for OpenAI
 *
 * @param runtime The runtime context
 * @returns The configured API key
 */
function getApiKey(runtime: IAgentRuntime): string | undefined {
  return getSetting(runtime, 'OPENAI_API_KEY');
}

/**
 * Helper function to get the embedding API key for OpenAI, falling back to the general API key if not set.
 *
 * @param runtime The runtime context
 * @returns The configured API key
 */
function getEmbeddingApiKey(runtime: IAgentRuntime): string | undefined {
  const embeddingApiKey = getSetting(runtime, 'OPENAI_EMBEDDING_API_KEY');
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
    getSetting(runtime, 'OPENAI_SMALL_MODEL') ??
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
    getSetting(runtime, 'OPENAI_LARGE_MODEL') ??
    (getSetting(runtime, 'LARGE_MODEL', 'gpt-5-mini') as string)
  );
}

/**
 * Helper function to get the image description model name with fallbacks
 *
 * @param runtime The runtime context
 * @returns The configured image description model name
 */
function getImageDescriptionModel(runtime: IAgentRuntime): string {
  return getSetting(runtime, 'OPENAI_IMAGE_DESCRIPTION_MODEL', 'gpt-5-nano') ?? 'gpt-5-nano';
}

/**
 * Helper function to get experimental telemetry setting
 *
 * @param runtime The runtime context
 * @returns Whether experimental telemetry is enabled
 */
function getExperimentalTelemetry(runtime: IAgentRuntime): boolean {
  const setting = getSetting(runtime, 'OPENAI_EXPERIMENTAL_TELEMETRY', 'false');
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
 * Asynchronously tokenizes the given text based on the specified model and prompt.
 *
 * @param {ModelTypeName} model - The type of model to use for tokenization.
 * @param {string} prompt - The text prompt to tokenize.
 * @returns {number[]} - An array of tokens representing the encoded prompt.
 */
async function tokenizeText(model: ModelTypeName, prompt: string) {
  const modelName =
    model === ModelType.TEXT_SMALL
      ? (process.env.OPENAI_SMALL_MODEL ?? process.env.SMALL_MODEL ?? 'gpt-5-nano')
      : (process.env.LARGE_MODEL ?? 'gpt-5-mini');
  const encoding = encodingForModel(modelName as TiktokenModel);
  const tokens = encoding.encode(prompt);
  return tokens;
}

/**
 * Detokenize a sequence of tokens back into text using the specified model.
 *
 * @param {ModelTypeName} model - The type of model to use for detokenization.
 * @param {number[]} tokens - The sequence of tokens to detokenize.
 * @returns {string} The detokenized text.
 */
async function detokenizeText(model: ModelTypeName, tokens: number[]) {
  const modelName =
    model === ModelType.TEXT_SMALL
      ? (process.env.OPENAI_SMALL_MODEL ?? process.env.SMALL_MODEL ?? 'gpt-5-nano')
      : (process.env.OPENAI_LARGE_MODEL ?? process.env.LARGE_MODEL ?? 'gpt-5-mini');
  const encoding = encodingForModel(modelName as TiktokenModel);
  return encoding.decode(tokens);
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
      experimental_repairText: getJsonRepairFunction(),
    });

    if (usage) {
      emitModelUsageEvent(runtime, modelType as ModelTypeName, params.prompt, usage);
    }
    return object;
  } catch (error: unknown) {
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
        } catch (repairParseError: unknown) {
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
  error: unknown;
}) => Promise<string | null> {
  return async ({ text, error }: { text: string; error: unknown }) => {
    try {
      if (error instanceof JSONParseError) {
        const cleanedText = text.replace(/```json\n|\n```|```/g, '');
        JSON.parse(cleanedText);
        return cleanedText;
      }
      return null;
    } catch (jsonError: unknown) {
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
 * function for text-to-speech
 */
async function fetchTextToSpeech(runtime: IAgentRuntime, text: string) {
  const apiKey = getApiKey(runtime);
  const model = getSetting(runtime, 'OPENAI_TTS_MODEL', 'gpt-4o-mini-tts');
  const voice = getSetting(runtime, 'OPENAI_TTS_VOICE', 'nova');
  const instructions = getSetting(runtime, 'OPENAI_TTS_INSTRUCTIONS', '');
  const baseURL = getBaseURL(runtime);

  try {
    const res = await fetch(`${baseURL}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        ...(instructions && { instructions }),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`EigenAI TTS error ${res.status}: ${err}`);
    }

    return res.body;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch speech from EigenAI TTS: ${message}`);
  }
}

/**
 * Defines the EigenAI plugin with its name, description, and configuration options.
 * @type {Plugin}
 */
export const eigenAIPlugin: Plugin = {
  name: 'eigenAI',
  description: 'EigenAI plugin',
  config: {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_SMALL_MODEL: process.env.OPENAI_SMALL_MODEL,
    OPENAI_LARGE_MODEL: process.env.OPENAI_LARGE_MODEL,
    SMALL_MODEL: process.env.SMALL_MODEL,
    LARGE_MODEL: process.env.LARGE_MODEL,
    OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
    OPENAI_EMBEDDING_API_KEY: process.env.OPENAI_EMBEDDING_API_KEY,
    OPENAI_EMBEDDING_URL: process.env.OPENAI_EMBEDDING_URL,
    OPENAI_EMBEDDING_DIMENSIONS: process.env.OPENAI_EMBEDDING_DIMENSIONS,
    OPENAI_IMAGE_DESCRIPTION_MODEL: process.env.OPENAI_IMAGE_DESCRIPTION_MODEL,
    OPENAI_IMAGE_DESCRIPTION_MAX_TOKENS: process.env.OPENAI_IMAGE_DESCRIPTION_MAX_TOKENS,
    OPENAI_EXPERIMENTAL_TELEMETRY: process.env.OPENAI_EXPERIMENTAL_TELEMETRY,
    EIGENAI_SEED: process.env.EIGENAI_SEED || '42',
  },
  async init(_config, runtime) {
    // do check in the background
    new Promise<void>(async (resolve) => {
      resolve();
      try {
        if (!getApiKey(runtime)) {
          logger.warn(
            'OPENAI_API_KEY is not set in environment - EigenAI functionality will be limited'
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
        } catch (fetchError: unknown) {
          const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
          logger.warn(`Error validating EigenAI API key: ${message}`);
          logger.warn('EigenAI functionality will be limited until a valid API key is provided');
        }
      } catch (error: unknown) {
        const message =
          (error as { errors?: Array<{ message: string }> })?.errors
            ?.map((e) => e.message)
            .join(', ') || (error instanceof Error ? error.message : String(error));
        logger.warn(
          `EigenAI plugin configuration issue: ${message} - You need to configure the OPENAI_API_KEY in your environment variables`
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
        'OPENAI_EMBEDDING_MODEL',
        'text-embedding-3-small'
      );
      const embeddingDimension = Number.parseInt(
        getSetting(runtime, 'OPENAI_EMBEDDING_DIMENSIONS', '1536') || '1536',
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

        const responseClone = response.clone();
        const rawResponseBody = await responseClone.text();

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
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Error generating embedding: ${message}`);
        const errorVector = Array(embeddingDimension).fill(0);
        errorVector[0] = 0.6;
        return errorVector;
      }
    },
    [ModelType.TEXT_TOKENIZER_ENCODE]: async (
      _runtime,
      { prompt, modelType = ModelType.TEXT_LARGE }: TokenizeTextParams
    ) => {
      return await tokenizeText(modelType ?? ModelType.TEXT_LARGE, prompt);
    },
    [ModelType.TEXT_TOKENIZER_DECODE]: async (
      _runtime,
      { tokens, modelType = ModelType.TEXT_LARGE }: DetokenizeTextParams
    ) => {
      return await detokenizeText(modelType ?? ModelType.TEXT_LARGE, tokens);
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
        experimental_telemetry: {
          isEnabled: experimentalTelemetry,
        },
      });

      if (usage) {
        emitModelUsageEvent(runtime, ModelType.TEXT_LARGE, prompt, usage);
      }

      return openaiResponse;
    },
    [ModelType.IMAGE]: async (
      runtime: IAgentRuntime,
      params: {
        prompt: string;
        n?: number;
        size?: string;
      }
    ) => {
      const n = params.n || 1;
      const size = params.size || '1024x1024';
      const prompt = params.prompt;
      const modelName = 'dall-e-3'; // Default DALL-E model
      logger.log(`[EigenAI] Using IMAGE model: ${modelName}`);

      const baseURL = getBaseURL(runtime);
      const apiKey = getApiKey(runtime);

      if (!apiKey) {
        throw new Error('EigenAI API key not configured');
      }

      try {
        const response = await fetch(`${baseURL}/images/generations`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: prompt,
            n: n,
            size: size,
          }),
        });

        const responseClone = response.clone();
        const rawResponseBody = await responseClone.text();

        if (!response.ok) {
          throw new Error(`Failed to generate image: ${response.statusText}`);
        }

        const data = await response.json();
        const typedData = data as { data: { url: string }[] };

        return typedData.data;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw error;
      }
    },
    [ModelType.IMAGE_DESCRIPTION]: async (
      runtime: IAgentRuntime,
      params: ImageDescriptionParams | string
    ) => {
      let imageUrl: string;
      let promptText: string | undefined;
      const modelName = getImageDescriptionModel(runtime);
      logger.log(`[EigenAI] Using IMAGE_DESCRIPTION model: ${modelName}`);
      const maxTokens = Number.parseInt(
        getSetting(runtime, 'OPENAI_IMAGE_DESCRIPTION_MAX_TOKENS', '8192') || '8192',
        10
      );

      if (typeof params === 'string') {
        imageUrl = params;
        promptText = 'Please analyze this image and provide a title and detailed description.';
      } else {
        imageUrl = params.imageUrl;
        promptText =
          params.prompt ||
          'Please analyze this image and provide a title and detailed description.';
      }

      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ];

      const baseURL = getBaseURL(runtime);
      const apiKey = getApiKey(runtime);

      if (!apiKey) {
        logger.error('EigenAI API key not set');
        return {
          title: 'Failed to analyze image',
          description: 'API key not configured',
        };
      }

      try {
        const requestBody: Record<string, any> = {
          model: modelName,
          messages: messages,
          max_tokens: maxTokens,
        };

        const response = await fetch(`${baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        const responseClone = response.clone();
        const rawResponseBody = await responseClone.text();

        if (!response.ok) {
          throw new Error(`EigenAI API error: ${response.status}`);
        }

        const result: unknown = await response.json();

        type OpenAIResponseType = {
          choices?: Array<{
            message?: { content?: string };
            finish_reason?: string;
          }>;
          usage?: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
          };
        };

        const typedResult = result as OpenAIResponseType;
        const content = typedResult.choices?.[0]?.message?.content;

        if (typedResult.usage) {
          emitModelUsageEvent(
            runtime,
            ModelType.IMAGE_DESCRIPTION,
            typeof params === 'string' ? params : params.prompt || '',
            {
              promptTokens: typedResult.usage.prompt_tokens,
              completionTokens: typedResult.usage.completion_tokens,
              totalTokens: typedResult.usage.total_tokens,
            }
          );
        }

        if (!content) {
          return {
            title: 'Failed to analyze image',
            description: 'No response from API',
          };
        }

        // Check if a custom prompt was provided (not the default prompt)
        const isCustomPrompt =
          typeof params === 'object' &&
          params.prompt &&
          params.prompt !==
            'Please analyze this image and provide a title and detailed description.';

        // If custom prompt is used, return the raw content
        if (isCustomPrompt) {
          return content;
        }

        // Otherwise, maintain backwards compatibility with object return
        const titleMatch = content.match(/title[:\s]+(.+?)(?:\n|$)/i);
        const title = titleMatch?.[1]?.trim() || 'Image Analysis';
        const description = content.replace(/title[:\s]+(.+?)(?:\n|$)/i, '').trim();

        const processedResult = { title, description };
        return processedResult;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Error analyzing image: ${message}`);
        return {
          title: 'Failed to analyze image',
          description: `Error: ${message}`,
        };
      }
    },
    [ModelType.TRANSCRIPTION]: async (runtime: IAgentRuntime, audioBuffer: Buffer) => {
      logger.log({ audioBuffer }, 'audioBuffer');

      const modelName = 'whisper-1';
      logger.log(`[EigenAI] Using TRANSCRIPTION model: ${modelName}`);

      const baseURL = getBaseURL(runtime);
      const apiKey = getApiKey(runtime);

      if (!apiKey) {
        throw new Error('EigenAI API key not configured - Cannot make request');
      }
      if (!audioBuffer || audioBuffer.length === 0) {
        throw new Error('Audio buffer is empty or invalid for transcription');
      }

      const formData = new FormData();
      formData.append('file', new Blob([audioBuffer]), 'recording.mp3');
      formData.append('model', 'whisper-1');

      try {
        const response = await fetch(`${baseURL}/audio/transcriptions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: formData,
        });

        const responseClone = response.clone();
        const rawResponseBody = await responseClone.text();

        logger.log({ response }, 'response');

        if (!response.ok) {
          throw new Error(`Failed to transcribe audio: ${response.statusText}`);
        }

        const data = (await response.json()) as { text: string };
        const processedText = data.text;

        return processedText;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw error;
      }
    },
    [ModelType.TEXT_TO_SPEECH]: async (runtime: IAgentRuntime, text: string) => {
      const ttsModelName = getSetting(runtime, 'OPENAI_TTS_MODEL', 'gpt-4o-mini-tts');
      logger.log(`[EigenAI] Using TEXT_TO_SPEECH model: ${ttsModelName}`);
      try {
        const speechStream = await fetchTextToSpeech(runtime, text);
        return speechStream;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw error;
      }
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
            } catch (error: unknown) {
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
            } catch (error: unknown) {
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
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              logger.error(`Error in test_text_small: ${message}`);
              throw error;
            }
          },
        },
        {
          name: 'eigenAI_test_image_generation',
          fn: async (runtime: IAgentRuntime) => {
            logger.log('eigenAI_test_image_generation');
            try {
              const image = await runtime.useModel(ModelType.IMAGE, {
                prompt: 'A beautiful sunset over a calm ocean',
                n: 1,
                size: '1024x1024',
              });
              logger.log({ image }, 'generated with test_image_generation');
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              logger.error(`Error in test_image_generation: ${message}`);
              throw error;
            }
          },
        },
        {
          name: 'image-description',
          fn: async (runtime: IAgentRuntime) => {
            try {
              logger.log('eigenAI_test_image_description');
              try {
                const result = await runtime.useModel(
                  ModelType.IMAGE_DESCRIPTION,
                  'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/Vitalik_Buterin_TechCrunch_London_2015_%28cropped%29.jpg/537px-Vitalik_Buterin_TechCrunch_London_2015_%28cropped%29.jpg'
                );

                if (
                  result &&
                  typeof result === 'object' &&
                  'title' in result &&
                  'description' in result
                ) {
                  logger.log({ result }, 'Image description');
                } else {
                  logger.error('Invalid image description result format:', result);
                }
              } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                logger.error(`Error in image description test: ${message}`);
              }
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : String(e);
              logger.error(`Error in eigenAI_test_image_description: ${message}`);
            }
          },
        },
        {
          name: 'eigenAI_test_transcription',
          fn: async (runtime: IAgentRuntime) => {
            logger.log('eigenAI_test_transcription');
            try {
              const response = await fetch(
                'https://upload.wikimedia.org/wikipedia/en/4/40/Chris_Benoit_Voice_Message.ogg'
              );
              const arrayBuffer = await response.arrayBuffer();
              const transcription = await runtime.useModel(
                ModelType.TRANSCRIPTION,
                Buffer.from(new Uint8Array(arrayBuffer))
              );
              logger.log({ transcription }, 'generated with test_transcription');
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              logger.error(`Error in test_transcription: ${message}`);
              throw error;
            }
          },
        },
        {
          name: 'eigenAI_test_text_tokenizer_encode',
          fn: async (runtime: IAgentRuntime) => {
            const prompt = 'Hello tokenizer encode!';
            const tokens = await runtime.useModel(ModelType.TEXT_TOKENIZER_ENCODE, { prompt });
            if (!Array.isArray(tokens) || tokens.length === 0) {
              throw new Error('Failed to tokenize text: expected non-empty array of tokens');
            }
            logger.log({ tokens }, 'Tokenized output');
          },
        },
        {
          name: 'eigenAI_test_text_tokenizer_decode',
          fn: async (runtime: IAgentRuntime) => {
            const prompt = 'Hello tokenizer decode!';
            const tokens = await runtime.useModel(ModelType.TEXT_TOKENIZER_ENCODE, { prompt });
            const decodedText = await runtime.useModel(ModelType.TEXT_TOKENIZER_DECODE, { tokens });
            if (decodedText !== prompt) {
              throw new Error(
                `Decoded text does not match original. Expected "${prompt}", got "${decodedText}"`
              );
            }
            logger.log({ decodedText }, 'Decoded text');
          },
        },
        {
          name: 'eigenAI_test_text_to_speech',
          fn: async (runtime: IAgentRuntime) => {
            try {
              const text = 'Hello, this is a test for text-to-speech.';
              const response = await fetchTextToSpeech(runtime, text);
              if (!response) {
                throw new Error('Failed to generate speech');
              }
              logger.log('Generated speech successfully');
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              logger.error(`Error in eigenAI_test_text_to_speech: ${message}`);
              throw error;
            }
          },
        },
      ],
    },
  ],
};
export default eigenAIPlugin;