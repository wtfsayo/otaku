import {
  type ActionEventPayload,
  asUUID,
  ChannelType,
  composePromptFromState,
  type Content,
  ContentType,
  createUniqueUuid,
  type EntityPayload,
  type EvaluatorEventPayload,
  type EventPayload,
  EventType,
  type IAgentRuntime,
  imageDescriptionTemplate,
  type InvokePayload,
  logger,
  type Media,
  type Memory,
  type MessagePayload,
  type MessageReceivedHandlerParams,
  ModelType,
  parseKeyValueXml,
  type Plugin,
  PluginEvents,
  postCreationTemplate,
  Role,
  type Room,
  shouldRespondTemplate,
  truncateToCompleteSentence,
  type UUID,
  type WorldPayload,
  getLocalServerUrl,
} from '@elizaos/core';
import { v4 } from 'uuid';

import * as actions from './actions/index.ts';
import * as evaluators from './evaluators/index.ts';
import * as providers from './providers/index.ts';

import { TaskService } from './services/task.ts';

export * from './actions/index.ts';
export * from './evaluators/index.ts';
export * from './providers/index.ts';


const messageHandlerTemplate = `<task>Generate dialog and actions for the character {{agentName}}.</task>

<providers>
{{providers}}
</providers>

<instructions>
Write a thought and plan for {{agentName}} and decide what actions to take. Also include the providers that {{agentName}} will use to have the right context for responding and acting, if any.

IMPORTANT ACTION ORDERING RULES:
- Actions are executed in the ORDER you list them - the order MATTERS!
- REPLY should come FIRST to acknowledge the user's request before executing other actions
- Common patterns:
  - For requests requiring tool use: REPLY,CALL_MCP_TOOL (acknowledge first, then gather info)
  - For task execution: REPLY,SEND_MESSAGE or REPLY,EVM_SWAP_TOKENS (acknowledge first, then do the task)
  - For multi-step operations: REPLY,ACTION1,ACTION2 (acknowledge first, then complete all steps)
- REPLY is used to acknowledge and inform the user about what you're going to do
- Follow-up actions execute the actual tasks after acknowledgment
- Use IGNORE only when you should not respond at all
- If you use IGNORE, do not include any other actions. IGNORE should be used alone when you should not respond or take any actions.

IMPORTANT PROVIDER SELECTION RULES:
- Only include providers if they are needed to respond accurately.
- If the message mentions images, photos, pictures, attachments, or visual content, OR if you see "(Attachments:" in the conversation, you MUST include "ATTACHMENTS" in your providers list
- If the message asks about or references specific people, include "ENTITIES" in your providers list  
- If the message asks about relationships or connections between people, include "RELATIONSHIPS" in your providers list
- If the message asks about facts or specific information, include "FACTS" in your providers list
- If the message asks about the environment or world context, include "WORLD" in your providers list
- If no additional context is needed, you may leave the providers list empty.

First, think about what you want to do next and plan your actions. Then, write the next message and include the actions you plan to take.
</instructions>

<keys>
"thought" should be a short description of what the agent is thinking about and planning.
"actions" should be a comma-separated list of the actions {{agentName}} plans to take based on the thought, IN THE ORDER THEY SHOULD BE EXECUTED (if none, use IGNORE, if simply responding with text, use REPLY)
"providers" should be a comma-separated list of the providers that {{agentName}} will use to have the right context for responding and acting (NEVER use "IGNORE" as a provider - use specific provider names like ATTACHMENTS, ENTITIES, FACTS, KNOWLEDGE, etc.)
"text" should be the text of the next message for {{agentName}} which they will send to the conversation.
</keys>

<output>
Do NOT include any thinking, reasoning, or <think> sections in your response. 
Go directly to the XML response format without any preamble or explanation.

Respond using XML format like this:
<response>
    <thought>Your thought here</thought>
    <actions>ACTION1,ACTION2</actions>
    <providers>PROVIDER1,PROVIDER2</providers>
    <text>Your response text here</text>
</response>

IMPORTANT: Your response must ONLY contain the <response></response> XML block above. Do not include any text, thinking, or reasoning before or after this XML block. Start your response immediately with <response> and end with </response>.
</output>`;
/**
 * Represents media data containing a buffer of data and the media type.
 * @typedef {Object} MediaData
 * @property {Buffer} data - The buffer of data.
 * @property {string} mediaType - The type of media.
 */
type MediaData = {
  data: Buffer;
  mediaType: string;
};

const latestResponseIds = new Map<string, Map<string, string>>();

/**
 * Escapes special characters in a string to make it JSON-safe.
 */
/* // Removing JSON specific helpers
function escapeForJson(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/```/g, '\\`\\`\\`');
}

function sanitizeJson(rawJson: string): string {
  try {
    // Try parsing directly
    JSON.parse(rawJson);
    return rawJson; // Already valid
  } catch {
    // Continue to sanitization
  }

  // first, replace all newlines with \n
  const sanitized = rawJson
    .replace(/\n/g, '\\n')

    // then, replace all backticks with \\\`
    .replace(/`/g, '\\\`');

  // Regex to find and escape the "text" field
  const fixed = sanitized.replace(/"text"\s*:\s*"([\s\S]*?)"\s*,\s*"simple"/, (_match, group) => {
    const escapedText = escapeForJson(group);
    return `"text": "${escapedText}", "simple"`;
  });

  // Validate that the result is actually parseable
  try {
    JSON.parse(fixed);
    return fixed;
  } catch (e) {
    throw new Error(`Failed to sanitize JSON: ${e.message}`);
  }
}
*/

/**
 * Fetches media data from a list of attachments, supporting both HTTP URLs and local file paths.
 *
 * @param attachments Array of Media objects containing URLs or file paths to fetch media from
 * @returns Promise that resolves with an array of MediaData objects containing the fetched media data and content type
 */
/**
 * Fetches media data from given attachments.
 * @param {Media[]} attachments - Array of Media objects to fetch data from.
 * @returns {Promise<MediaData[]>} - A Promise that resolves with an array of MediaData objects.
 */
export async function fetchMediaData(attachments: Media[]): Promise<MediaData[]> {
  return Promise.all(
    attachments.map(async (attachment: Media) => {
      if (/^(http|https):\/\//.test(attachment.url)) {
        // Handle HTTP URLs
        const response = await fetch(attachment.url);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${attachment.url}`);
        }
        const mediaBuffer = Buffer.from(await response.arrayBuffer());
        const mediaType = attachment.contentType || 'image/png';
        return { data: mediaBuffer, mediaType };
      }
      // if (fs.existsSync(attachment.url)) {
      //   // Handle local file paths
      //   const mediaBuffer = await fs.promises.readFile(path.resolve(attachment.url));
      //   const mediaType = attachment.contentType || 'image/png';
      //   return { data: mediaBuffer, mediaType };
      // }
      throw new Error(`File not found: ${attachment.url}. Make sure the path is correct.`);
    })
  );
}

/**
 * Processes attachments by generating descriptions for supported media types.
 * Currently supports image description generation.
 *
 * @param {Media[]} attachments - Array of attachments to process
 * @param {IAgentRuntime} runtime - The agent runtime for accessing AI models
 * @returns {Promise<Media[]>} - Returns a new array of processed attachments with added description, title, and text properties
 */
export async function processAttachments(
  attachments: Media[],
  runtime: IAgentRuntime
): Promise<Media[]> {
  if (!attachments || attachments.length === 0) {
    return [];
  }
  logger.debug(`[Bootstrap] Processing ${attachments.length} attachment(s)`);

  const processedAttachments: Media[] = [];

  for (const attachment of attachments) {
    try {
      // Start with the original attachment
      const processedAttachment: Media = { ...attachment };

      const isRemote = /^(http|https):\/\//.test(attachment.url);
      const url = isRemote ? attachment.url : getLocalServerUrl(attachment.url);
      // Only process images that don't already have descriptions
      if (attachment.contentType === ContentType.IMAGE && !attachment.description) {
        logger.debug(`[Bootstrap] Generating description for image: ${attachment.url}`);

        let imageUrl = url;

        if (!isRemote) {
          // Only convert local/internal media to base64
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Failed to fetch image: ${res.statusText}`);

          const arrayBuffer = await res.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const contentType = res.headers.get('content-type') || 'application/octet-stream';
          imageUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
        }

        try {
          const response = await runtime.useModel(ModelType.IMAGE_DESCRIPTION, {
            prompt: imageDescriptionTemplate,
            imageUrl,
          });

          if (typeof response === 'string') {
            // Parse XML response
            const parsedXml = parseKeyValueXml(response);

            if (parsedXml?.description && parsedXml?.text) {
              processedAttachment.description = parsedXml.description;
              processedAttachment.title = parsedXml.title || 'Image';
              processedAttachment.text = parsedXml.text;

              logger.debug(
                `[Bootstrap] Generated description: ${processedAttachment.description?.substring(0, 100)}...`
              );
            } else {
              logger.warn(`[Bootstrap] Failed to parse XML response for image description`);
            }
          } else if (response && typeof response === 'object' && 'description' in response) {
            // Handle object responses for backwards compatibility
            processedAttachment.description = response.description;
            processedAttachment.title = response.title || 'Image';
            processedAttachment.text = response.description;

            logger.debug(
              `[Bootstrap] Generated description: ${processedAttachment.description?.substring(0, 100)}...`
            );
          } else {
            logger.warn(`[Bootstrap] Unexpected response format for image description`);
          }
        } catch (error) {
          logger.error(`[Bootstrap] Error generating image description:`, error);
          // Continue processing without description
        }
      } else if (attachment.contentType === ContentType.DOCUMENT && !attachment.text) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch document: ${res.statusText}`);

        const contentType = res.headers.get('content-type') || '';
        const isPlainText = contentType.startsWith('text/plain');

        if (isPlainText) {
          logger.debug(`[Bootstrap] Processing plain text document: ${attachment.url}`);

          const textContent = await res.text();
          processedAttachment.text = textContent;
          processedAttachment.title = processedAttachment.title || 'Text File';

          logger.debug(
            `[Bootstrap] Extracted text content (first 100 chars): ${processedAttachment.text?.substring(0, 100)}...`
          );
        } else {
          logger.warn(`[Bootstrap] Skipping non-plain-text document: ${contentType}`);
        }
      }

      processedAttachments.push(processedAttachment);
    } catch (error) {
      logger.error(`[Bootstrap] Failed to process attachment ${attachment.url}:`, error);
      // Add the original attachment if processing fails
      processedAttachments.push(attachment);
    }
  }

  return processedAttachments;
}

/**
 * Determines whether to skip the shouldRespond logic based on room type and message source.
 * Supports both default values and runtime-configurable overrides via env settings.
 */
export function shouldBypassShouldRespond(
  runtime: IAgentRuntime,
  room?: Room,
  source?: string
): boolean {
  if (!room) return false;

  function normalizeEnvList(value: unknown): string[] {
    if (!value || typeof value !== 'string') return [];

    const cleaned = value.trim().replace(/^\[|\]$/g, '');
    return cleaned
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  const defaultBypassTypes = [
    ChannelType.DM,
    ChannelType.VOICE_DM,
    ChannelType.SELF,
    ChannelType.API,
  ];

  const defaultBypassSources = ['client_chat'];

  const bypassTypesSetting = normalizeEnvList(runtime.getSetting('SHOULD_RESPOND_BYPASS_TYPES'));
  const bypassSourcesSetting = normalizeEnvList(
    runtime.getSetting('SHOULD_RESPOND_BYPASS_SOURCES')
  );

  const bypassTypes = new Set(
    [...defaultBypassTypes.map((t) => t.toString()), ...bypassTypesSetting].map((s: string) =>
      s.trim().toLowerCase()
    )
  );

  const bypassSources = [...defaultBypassSources, ...bypassSourcesSetting].map((s: string) =>
    s.trim().toLowerCase()
  );

  const roomType = room.type?.toString().toLowerCase();
  const sourceStr = source?.toLowerCase() || '';

  return bypassTypes.has(roomType) || bypassSources.some((pattern) => sourceStr.includes(pattern));
}

/**
 * Handles incoming messages and generates responses based on the provided runtime and message information.
 *
 * @param {MessageReceivedHandlerParams} params - The parameters needed for message handling, including runtime, message, and callback.
 * @returns {Promise<void>} - A promise that resolves once the message handling and response generation is complete.
 */
const messageReceivedHandler = async ({
  runtime,
  message,
  callback,
  onComplete,
}: MessageReceivedHandlerParams): Promise<void> => {
  // Set up timeout monitoring
  const timeoutDuration = 60 * 60 * 1000; // 1 hour
  let timeoutId: NodeJS.Timeout | undefined = undefined;

  try {
    logger.info(`[Bootstrap] Message received from ${message.entityId} in room ${message.roomId}`);
    // Generate a new response ID
    const responseId = v4();
    // Get or create the agent-specific map
    if (!latestResponseIds.has(runtime.agentId)) {
      latestResponseIds.set(runtime.agentId, new Map<string, string>());
    }
    const agentResponses = latestResponseIds.get(runtime.agentId);
    if (!agentResponses) {
      throw new Error('Agent responses map not found');
    }

    // Set this as the latest response ID for this agent+room
    agentResponses.set(message.roomId, responseId);

    // Use runtime's run tracking for this message processing
    const runId = runtime.startRun();
    const startTime = Date.now();

    // Emit run started event
    await runtime.emitEvent(EventType.RUN_STARTED, {
      runtime,
      runId,
      messageId: message.id,
      roomId: message.roomId,
      entityId: message.entityId,
      startTime,
      status: 'started',
      source: 'messageHandler',
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(async () => {
        await runtime.emitEvent(EventType.RUN_TIMEOUT, {
          runtime,
          runId,
          messageId: message.id,
          roomId: message.roomId,
          entityId: message.entityId,
          startTime,
          status: 'timeout',
          endTime: Date.now(),
          duration: Date.now() - startTime,
          error: 'Run exceeded 60 minute timeout',
          source: 'messageHandler',
        });
        reject(new Error('Run exceeded 60 minute timeout'));
      }, timeoutDuration);
    });

    const processingPromise = (async () => {
      try {
        if (message.entityId === runtime.agentId) {
          logger.debug(`[Bootstrap] Skipping message from self (${runtime.agentId})`);
          throw new Error('Message is from the agent itself');
        }

        logger.debug(
          `[Bootstrap] Processing message: ${truncateToCompleteSentence(message.content.text || '', 50)}...`
        );

        // First, save the incoming message
        logger.debug('[Bootstrap] Saving message to memory and embeddings');
        await Promise.all([
          runtime.addEmbeddingToMemory(message),
          runtime.createMemory(message, 'messages'),
        ]);

        const agentUserState = await runtime.getParticipantUserState(
          message.roomId,
          runtime.agentId
        );

        if (
          agentUserState === 'MUTED' &&
          !message.content.text?.toLowerCase().includes(runtime.character.name.toLowerCase())
        ) {
          logger.debug(`[Bootstrap] Ignoring muted room ${message.roomId}`);
          return;
        }

        let state = await runtime.composeState(
          message,
          ['ANXIETY', 'SHOULD_RESPOND', 'ENTITIES', 'CHARACTER', 'RECENT_MESSAGES', 'ACTIONS'],
          true
        );

        // Skip shouldRespond check for DM and VOICE_DM channels
        const room = await runtime.getRoom(message.roomId);

        const shouldSkipShouldRespond = shouldBypassShouldRespond(
          runtime,
          room ?? undefined,
          message.content.source
        );

        if (message.content.attachments && message.content.attachments.length > 0) {
          message.content.attachments = await processAttachments(
            message.content.attachments,
            runtime
          );
          if (message.id) {
            await runtime.updateMemory({
              id: message.id,
              content: message.content,
            });
          }
        }

        let shouldRespond = true;

        // Handle shouldRespond
        if (!shouldSkipShouldRespond) {
          const shouldRespondPrompt = composePromptFromState({
            state,
            template: runtime.character.templates?.shouldRespondTemplate || shouldRespondTemplate,
          });

          logger.debug(
            `[Bootstrap] Evaluating response for ${runtime.character.name}\nPrompt: ${shouldRespondPrompt}`
          );

          const response = await runtime.useModel(ModelType.TEXT_SMALL, {
            prompt: shouldRespondPrompt,
          });

          logger.debug(
            `[Bootstrap] Response evaluation for ${runtime.character.name}:\n${response}`
          );
          logger.debug(`[Bootstrap] Response type: ${typeof response}`);

          // Try to preprocess response by removing code blocks markers if present
          // let processedResponse = response.replace('```json', '').replaceAll('```', '').trim(); // No longer needed for XML

          const responseObject = parseKeyValueXml(response);
          logger.debug('[Bootstrap] Parsed response:', responseObject);

          // If an action is provided, the agent intends to respond in some way
          // Only exclude explicit non-response actions
          const nonResponseActions = ['IGNORE', 'NONE'];
          shouldRespond =
            responseObject?.action &&
            !nonResponseActions.includes(responseObject.action.toUpperCase());
        } else {
          logger.debug(
            `[Bootstrap] Skipping shouldRespond check for ${runtime.character.name} because ${room?.type} ${room?.source}`
          );
          shouldRespond = true;
        }

        let responseMessages: Memory[] = [];

        console.log('shouldRespond is', shouldRespond);
        console.log('shouldSkipShouldRespond', shouldSkipShouldRespond);

        if (shouldRespond) {
          state = await runtime.composeState(message, ['ACTIONS']);
          if (!state.values.actionNames) {
            logger.warn('actionNames data missing from state, even though it was requested');
          }

          const prompt = composePromptFromState({
            state,
            template: runtime.character.templates?.messageHandlerTemplate || messageHandlerTemplate,
          });

          let responseContent: Content | null = null;

          // Retry if missing required fields
          let retries = 0;
          const maxRetries = 3;

          while (retries < maxRetries && (!responseContent?.thought || !responseContent?.actions)) {
            let response = await runtime.useModel(ModelType.TEXT_LARGE, {
              prompt,
            });

            logger.debug('[Bootstrap] *** Raw LLM Response ***\n', response);

            // Attempt to parse the XML response
            const parsedXml = parseKeyValueXml(response);
            logger.debug('[Bootstrap] *** Parsed XML Content ***\n', parsedXml);

            // Map parsed XML to Content type, handling potential missing fields
            if (parsedXml) {
              responseContent = {
                ...parsedXml,
                thought: parsedXml.thought || '',
                actions: parsedXml.actions || ['IGNORE'],
                providers: parsedXml.providers || [],
                text: parsedXml.text || '',
                simple: parsedXml.simple || false,
              };
            } else {
              responseContent = null;
            }

            retries++;
            if (!responseContent?.thought || !responseContent?.actions) {
              logger.warn(
                '[Bootstrap] *** Missing required fields (thought or actions), retrying... ***\n',
                response,
                parsedXml,
                responseContent
              );
            }
          }

          // Check if this is still the latest response ID for this agent+room
          const currentResponseId = agentResponses.get(message.roomId);
          if (currentResponseId !== responseId) {
            logger.info(
              `Response discarded - newer message being processed for agent: ${runtime.agentId}, room: ${message.roomId}`
            );
            return;
          }

          if (responseContent && message.id) {
            responseContent.inReplyTo = createUniqueUuid(runtime, message.id);

            // --- LLM IGNORE/REPLY ambiguity handling ---
            // Sometimes the LLM outputs actions like ["REPLY", "IGNORE"], which breaks isSimple detection
            // and triggers unnecessary large LLM calls. We clarify intent here:
            // - If IGNORE is present with other actions:
            //    - If text is empty, we assume the LLM intended to IGNORE and drop all other actions.
            //    - If text is present, we assume the LLM intended to REPLY and remove IGNORE from actions.
            // This ensures consistent, clear behavior and preserves reply speed optimizations.
            if (responseContent.actions && responseContent.actions.length > 1) {
              // Helper function to safely check if an action is IGNORE
              const isIgnoreAction = (action: unknown): boolean => {
                return typeof action === 'string' && action.toUpperCase() === 'IGNORE';
              };

              // Check if any action is IGNORE
              const hasIgnoreAction = responseContent.actions.some(isIgnoreAction);

              if (hasIgnoreAction) {
                if (!responseContent.text || responseContent.text.trim() === '') {
                  // No text, truly meant to IGNORE
                  responseContent.actions = ['IGNORE'];
                } else {
                  // Text present, LLM intended to reply, remove IGNORE
                  const filteredActions = responseContent.actions.filter(
                    (action) => !isIgnoreAction(action)
                  );

                  // Ensure we don't end up with an empty actions array when text is present
                  // If all actions were IGNORE, default to REPLY
                  if (filteredActions.length === 0) {
                    responseContent.actions = ['REPLY'];
                  } else {
                    responseContent.actions = filteredActions;
                  }
                }
              }
            }

            // Automatically determine if response is simple based on providers and actions
            // Simple = REPLY action with no providers used
            const isSimple =
              responseContent.actions?.length === 1 &&
              typeof responseContent.actions[0] === 'string' &&
              responseContent.actions[0].toUpperCase() === 'REPLY' &&
              (!responseContent.providers || responseContent.providers.length === 0);

            responseContent.simple = isSimple;

            const responseMessage = {
              id: asUUID(v4()),
              entityId: runtime.agentId,
              agentId: runtime.agentId,
              content: responseContent,
              roomId: message.roomId,
              createdAt: Date.now(),
            };

            responseMessages = [responseMessage];
          }

          // Clean up the response ID
          agentResponses.delete(message.roomId);
          if (agentResponses.size === 0) {
            latestResponseIds.delete(runtime.agentId);
          }

          if (responseContent?.providers?.length && responseContent?.providers?.length > 0) {
            state = await runtime.composeState(message, responseContent?.providers || []);
          }

          if (responseContent && responseContent.simple && responseContent.text) {
            // Log provider usage for simple responses
            if (responseContent.providers && responseContent.providers.length > 0) {
              logger.debug('[Bootstrap] Simple response used providers', responseContent.providers);
            }

            // without actions there can't be more than one message
            await callback(responseContent);
          } else {
            await runtime.processActions(message, responseMessages, state, callback);
          }
          await runtime.evaluate(message, state, shouldRespond, callback, responseMessages);
        } else {
          // Handle the case where the agent decided not to respond
          logger.debug('[Bootstrap] Agent decided not to respond (shouldRespond is false).');

          // Check if we still have the latest response ID
          const currentResponseId = agentResponses.get(message.roomId);
          if (currentResponseId !== responseId) {
            logger.info(
              `Ignore response discarded - newer message being processed for agent: ${runtime.agentId}, room: ${message.roomId}`
            );
            return; // Stop processing if a newer message took over
          }

          if (!message.id) {
            logger.error('[Bootstrap] Message ID is missing, cannot create ignore response.');
            return;
          }

          // Construct a minimal content object indicating ignore, include a generic thought
          const ignoreContent: Content = {
            thought: 'Agent decided not to respond to this message.',
            actions: ['IGNORE'],
            simple: true, // Treat it as simple for callback purposes
            inReplyTo: createUniqueUuid(runtime, message.id), // Reference original message
          };

          // Call the callback directly with the ignore content
          await callback(ignoreContent);

          // Also save this ignore action/thought to memory
          const ignoreMemory = {
            id: asUUID(v4()),
            entityId: runtime.agentId,
            agentId: runtime.agentId,
            content: ignoreContent,
            roomId: message.roomId,
            createdAt: Date.now(),
          };
          await runtime.createMemory(ignoreMemory, 'messages');
          logger.debug('[Bootstrap] Saved ignore response to memory', {
            memoryId: ignoreMemory.id,
          });

          // Clean up the response ID since we handled it
          agentResponses.delete(message.roomId);
          if (agentResponses.size === 0) {
            latestResponseIds.delete(runtime.agentId);
          }

          // Optionally, evaluate the decision to ignore (if relevant evaluators exist)
          // await runtime.evaluate(message, state, shouldRespond, callback, []);
        }

        // Emit run ended event on successful completion
        await runtime.emitEvent(EventType.RUN_ENDED, {
          runtime,
          runId,
          messageId: message.id,
          roomId: message.roomId,
          entityId: message.entityId,
          startTime,
          status: 'completed',
          endTime: Date.now(),
          duration: Date.now() - startTime,
          source: 'messageHandler',
        });
      } catch (error: any) {
        console.error('error is', error);
        // Emit run ended event with error
        await runtime.emitEvent(EventType.RUN_ENDED, {
          runtime,
          runId,
          messageId: message.id,
          roomId: message.roomId,
          entityId: message.entityId,
          startTime,
          status: 'error',
          endTime: Date.now(),
          duration: Date.now() - startTime,
          error: error.message,
          source: 'messageHandler',
        });
      }
    })();

    await Promise.race([processingPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
    onComplete?.();
  }
};

/**
 * Handles the receipt of a reaction message and creates a memory in the designated memory manager.
 *
 * @param {Object} params - The parameters for the function.
 * @param {IAgentRuntime} params.runtime - The agent runtime object.
 * @param {Memory} params.message - The reaction message to be stored in memory.
 * @returns {void}
 */
const reactionReceivedHandler = async ({
  runtime,
  message,
}: {
  runtime: IAgentRuntime;
  message: Memory;
}) => {
  try {
    await runtime.createMemory(message, 'messages');
  } catch (error: any) {
    if (error.code === '23505') {
      logger.warn('[Bootstrap] Duplicate reaction memory, skipping');
      return;
    }
    logger.error('[Bootstrap] Error in reaction handler:', error);
  }
};

/**
 * Handles message deletion events by removing the corresponding memory from the agent's memory store.
 *
 * @param {Object} params - The parameters for the function.
 * @param {IAgentRuntime} params.runtime - The agent runtime object.
 * @param {Memory} params.message - The message memory that was deleted.
 * @returns {void}
 */
const messageDeletedHandler = async ({
  runtime,
  message,
}: {
  runtime: IAgentRuntime;
  message: Memory;
}) => {
  try {
    if (!message.id) {
      logger.error('[Bootstrap] Cannot delete memory: message ID is missing');
      return;
    }

    logger.info('[Bootstrap] Deleting memory for message', message.id, 'from room', message.roomId);
    await runtime.deleteMemory(message.id);
    logger.debug('[Bootstrap] Successfully deleted memory for message', message.id);
  } catch (error: unknown) {
    logger.error('[Bootstrap] Error in message deleted handler:', error);
  }
};

/**
 * Handles channel cleared events by removing all message memories from the specified room.
 *
 * @param {Object} params - The parameters for the function.
 * @param {IAgentRuntime} params.runtime - The agent runtime object.
 * @param {UUID} params.roomId - The room ID to clear message memories from.
 * @param {string} params.channelId - The original channel ID.
 * @param {number} params.memoryCount - Number of memories found.
 * @returns {void}
 */
const channelClearedHandler = async ({
  runtime,
  roomId,
  channelId,
  memoryCount,
}: {
  runtime: IAgentRuntime;
  roomId: UUID;
  channelId: string;
  memoryCount: number;
}) => {
  try {
    logger.info(
      `[Bootstrap] Clearing ${memoryCount} message memories from channel ${channelId} -> room ${roomId}`
    );

    // Get all message memories for this room
    const memories = await runtime.getMemoriesByRoomIds({
      tableName: 'messages',
      roomIds: [roomId],
    });

    // Delete each message memory
    let deletedCount = 0;
    for (const memory of memories) {
      if (memory.id) {
        try {
          await runtime.deleteMemory(memory.id);
          deletedCount++;
        } catch (error) {
          logger.warn(`[Bootstrap] Failed to delete message memory ${memory.id}:`, error);
        }
      }
    }

    logger.info(
      `[Bootstrap] Successfully cleared ${deletedCount}/${memories.length} message memories from channel ${channelId}`
    );
  } catch (error: unknown) {
    logger.error('[Bootstrap] Error in channel cleared handler:', error);
  }
};

/**
 * Syncs a single user into an entity
 */
/**
 * Asynchronously sync a single user with the specified parameters.
 *
 * @param {UUID} entityId - The unique identifier for the entity.
 * @param {IAgentRuntime} runtime - The runtime environment for the agent.
 * @param {any} user - The user object to sync.
 * @param {string} serverId - The unique identifier for the server.
 * @param {string} channelId - The unique identifier for the channel.
 * @param {ChannelType} type - The type of channel.
 * @param {string} source - The source of the user data.
 * @returns {Promise<void>} A promise that resolves once the user is synced.
 */
const syncSingleUser = async (
  entityId: UUID,
  runtime: IAgentRuntime,
  serverId: string,
  channelId: string,
  type: ChannelType,
  source: string
) => {
  try {
    const entity = await runtime.getEntityById(entityId);
    logger.info(`[Bootstrap] Syncing user: ${entity?.metadata?.username || entityId}`);

    // Ensure we're not using WORLD type and that we have a valid channelId
    if (!channelId) {
      logger.warn(`[Bootstrap] Cannot sync user ${entity?.id} without a valid channelId`);
      return;
    }

    const roomId = createUniqueUuid(runtime, channelId);
    const worldId = createUniqueUuid(runtime, serverId);

    // Create world with ownership metadata for DM connections (onboarding)
    const worldMetadata =
      type === ChannelType.DM
        ? {
            ownership: {
              ownerId: entityId,
            },
            roles: {
              [entityId]: Role.OWNER,
            },
            settings: {}, // Initialize empty settings for onboarding
          }
        : undefined;

    logger.info(
      `[Bootstrap] syncSingleUser - type: ${type}, isDM: ${type === ChannelType.DM}, worldMetadata: ${JSON.stringify(worldMetadata)}`
    );

    await runtime.ensureConnection({
      entityId,
      roomId,
      name: (entity?.metadata?.name || entity?.metadata?.username || `User${entityId}`) as
        | undefined
        | string,
      source,
      channelId,
      serverId,
      type,
      worldId,
      metadata: worldMetadata,
    });

    // Verify the world was created with proper metadata
    try {
      const createdWorld = await runtime.getWorld(worldId);
      logger.info(
        `[Bootstrap] Created world check - ID: ${worldId}, metadata: ${JSON.stringify(createdWorld?.metadata)}`
      );
    } catch (error) {
      logger.error(`[Bootstrap] Failed to verify created world: ${error}`);
    }

    logger.success(`[Bootstrap] Successfully synced user: ${entity?.id}`);
  } catch (error) {
    logger.error(
      `[Bootstrap] Error syncing user: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/**
 * Handles standardized server data for both WORLD_JOINED and WORLD_CONNECTED events
 */
const handleServerSync = async ({
  runtime,
  world,
  rooms,
  entities,
  source,
  onComplete,
}: WorldPayload) => {
  logger.debug(`[Bootstrap] Handling server sync event for server: ${world.name}`);
  try {
    await runtime.ensureConnections(entities, rooms, source, world);
    logger.debug(`Successfully synced standardized world structure for ${world.name}`);
    onComplete?.();
  } catch (error) {
    logger.error(
      `Error processing standardized server data: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/**
 * Handles control messages for enabling or disabling UI elements in the frontend
 * @param {Object} params - Parameters for the handler
 * @param {IAgentRuntime} params.runtime - The runtime instance
 * @param {Object} params.message - The control message
 * @param {string} params.source - Source of the message
 */
const controlMessageHandler = async ({
  runtime,
  message,
}: {
  runtime: IAgentRuntime;
  message: {
    type: 'control';
    payload: {
      action: 'enable_input' | 'disable_input';
      target?: string;
    };
    roomId: UUID;
  };
  source: string;
}) => {
  try {
    logger.debug(
      `[controlMessageHandler] Processing control message: ${message.payload.action} for room ${message.roomId}`
    );

    // Here we would use a WebSocket service to send the control message to the frontend
    // This would typically be handled by a registered service with sendMessage capability

    // Get any registered WebSocket service
    const serviceNames = Array.from(runtime.getAllServices().keys()) as string[];
    const websocketServiceName = serviceNames.find(
      (name: string) =>
        name.toLowerCase().includes('websocket') || name.toLowerCase().includes('socket')
    );

    if (websocketServiceName) {
      const websocketService = runtime.getService(websocketServiceName);
      if (websocketService && 'sendMessage' in websocketService) {
        // Send the control message through the WebSocket service
        await (websocketService as any).sendMessage({
          type: 'controlMessage',
          payload: {
            action: message.payload.action,
            target: message.payload.target,
            roomId: message.roomId,
          },
        });

        logger.debug(
          `[controlMessageHandler] Control message ${message.payload.action} sent successfully`
        );
      } else {
        logger.error('[controlMessageHandler] WebSocket service does not have sendMessage method');
      }
    } else {
      logger.error('[controlMessageHandler] No WebSocket service found to send control message');
    }
  } catch (error) {
    logger.error(`[controlMessageHandler] Error processing control message: ${error}`);
  }
};

const events = {
  [EventType.MESSAGE_RECEIVED]: [
    async (payload: MessagePayload) => {
      if (!payload.callback) {
        logger.error('No callback provided for message');
        return;
      }
      await messageReceivedHandler({
        runtime: payload.runtime,
        message: payload.message,
        callback: payload.callback,
        onComplete: payload.onComplete,
      });
    },
  ],

  [EventType.VOICE_MESSAGE_RECEIVED]: [
    async (payload: MessagePayload) => {
      if (!payload.callback) {
        logger.error('No callback provided for voice message');
        return;
      }
      await messageReceivedHandler({
        runtime: payload.runtime,
        message: payload.message,
        callback: payload.callback,
        onComplete: payload.onComplete,
      });
    },
  ],

  [EventType.REACTION_RECEIVED]: [
    async (payload: MessagePayload) => {
      await reactionReceivedHandler({
        runtime: payload.runtime,
        message: payload.message,
      });
    },
  ],

  [EventType.MESSAGE_SENT]: [
    async (payload: MessagePayload) => {
      logger.debug(`[Bootstrap] Message sent: ${payload.message.content.text}`);
    },
  ],

  [EventType.MESSAGE_DELETED]: [
    async (payload: MessagePayload) => {
      await messageDeletedHandler({
        runtime: payload.runtime,
        message: payload.message,
      });
    },
  ],

  [EventType.CHANNEL_CLEARED]: [
    async (payload: EventPayload & { roomId: UUID; channelId: string; memoryCount: number }) => {
      await channelClearedHandler({
        runtime: payload.runtime,
        roomId: payload.roomId,
        channelId: payload.channelId,
        memoryCount: payload.memoryCount,
      });
    },
  ],

  [EventType.WORLD_JOINED]: [
    async (payload: WorldPayload) => {
      await handleServerSync(payload);
    },
  ],

  [EventType.WORLD_CONNECTED]: [
    async (payload: WorldPayload) => {
      await handleServerSync(payload);
    },
  ],

  [EventType.ENTITY_JOINED]: [
    async (payload: EntityPayload) => {
      logger.debug(`[Bootstrap] ENTITY_JOINED event received for entity ${payload.entityId}`);

      if (!payload.worldId) {
        logger.error('[Bootstrap] No worldId provided for entity joined');
        return;
      }
      if (!payload.roomId) {
        logger.error('[Bootstrap] No roomId provided for entity joined');
        return;
      }
      if (!payload.metadata?.type) {
        logger.error('[Bootstrap] No type provided for entity joined');
        return;
      }

      await syncSingleUser(
        payload.entityId,
        payload.runtime,
        payload.worldId,
        payload.roomId,
        payload.metadata.type,
        payload.source
      );
    },
  ],

  [EventType.ENTITY_LEFT]: [
    async (payload: EntityPayload) => {
      try {
        // Update entity to inactive
        const entity = await payload.runtime.getEntityById(payload.entityId);
        if (entity) {
          entity.metadata = {
            ...entity.metadata,
            status: 'INACTIVE',
            leftAt: Date.now(),
          };
          await payload.runtime.updateEntity(entity);
        }
        logger.info(`[Bootstrap] User ${payload.entityId} left world ${payload.worldId}`);
      } catch (error: any) {
        logger.error(`[Bootstrap] Error handling user left: ${error.message}`);
      }
    },
  ],

  [EventType.ACTION_STARTED]: [
    async (payload: ActionEventPayload) => {
      logger.debug(`[Bootstrap] Action started: ${payload.actionName} (${payload.actionId})`);
    },
  ],

  [EventType.ACTION_COMPLETED]: [
    async (payload: ActionEventPayload) => {
      const status = payload.error ? `failed: ${payload.error.message}` : 'completed';
      logger.debug(`[Bootstrap] Action ${status}: ${payload.actionName} (${payload.actionId})`);
    },
  ],

  [EventType.EVALUATOR_STARTED]: [
    async (payload: EvaluatorEventPayload) => {
      logger.debug(
        `[Bootstrap] Evaluator started: ${payload.evaluatorName} (${payload.evaluatorId})`
      );
    },
  ],

  [EventType.EVALUATOR_COMPLETED]: [
    async (payload: EvaluatorEventPayload) => {
      const status = payload.error ? `failed: ${payload.error.message}` : 'completed';
      logger.debug(
        `[Bootstrap] Evaluator ${status}: ${payload.evaluatorName} (${payload.evaluatorId})`
      );
    },
  ],

  CONTROL_MESSAGE: [controlMessageHandler],
};

export const bootstrapPlugin: Plugin = {
  name: 'bootstrap',
  description: 'Agent bootstrap with basic actions and evaluators',
  actions: [
    actions.replyAction,
    actions.ignoreAction,
  ],
  // this is jank, these events are not valid
  events: events as any as PluginEvents,
  evaluators: [evaluators.reflectionEvaluator],
  providers: [
    providers.evaluatorsProvider,
    providers.timeProvider,
    providers.providersProvider,
    providers.actionsProvider,
    providers.actionStateProvider,
    providers.characterProvider,
    providers.recentMessagesProvider,
  ],
  services: [TaskService],
};

export default bootstrapPlugin;
