// action: SEND_MESSAGE
// send message to a user or room (other than this room we are in)

import {
  type Action,
  type ActionExample,
  composePromptFromState,
  findEntityByName,
  type HandlerCallback,
  type IAgentRuntime,
  logger,
  type Memory,
  ModelType,
  parseKeyValueXml,
  type State,
  type ActionResult,
} from '@elizaos/core';

/**
 * Task: Extract Target and Source Information
 *
 * Recent Messages:
 * {{recentMessages}}
 *
 * Instructions:
 * Analyze the conversation to identify:
 * 1. The target type (user or room)
 * 2. The target platform/source (e.g. telegram, discord, etc)
 * 3. Any identifying information about the target
 *
 * Return an XML response with:
 * <response>
 *   <targetType>user|room</targetType>
 *   <source>platform-name</source>
 *   <identifiers>
 *     <username>username_if_applicable</username>
 *     <roomName>room_name_if_applicable</roomName>
 *     <!-- Add other relevant identifiers as needed -->
 *   </identifiers>
 * </response>
 *
 * Example outputs:
 * For "send a message to @dev_guru on telegram":
 * <response>
 *   <targetType>user</targetType>
 *   <source>telegram</source>
 *   <identifiers>
 *     <username>dev_guru</username>
 *   </identifiers>
 * </response>
 *
 * For "post this in #announcements":
 * <response>
 *   <targetType>room</targetType>
 *   <source>discord</source>
 *   <identifiers>
 *     <roomName>announcements</roomName>
 *   </identifiers>
 * </response>
 */
const targetExtractionTemplate = `# Task: Extract Target and Source Information

# Recent Messages:
{{recentMessages}}

# Instructions:
Analyze the conversation to identify:
1. The target type (user or room)
2. The target platform/source (e.g. telegram, discord, etc)
3. Any identifying information about the target

Do NOT include any thinking, reasoning, or <think> sections in your response. 
Go directly to the XML response format without any preamble or explanation.

Return an XML response with:
<response>
  <targetType>user|room</targetType>
  <source>platform-name</source>
  <identifiers>
    <username>username_if_applicable</username>
    <roomName>room_name_if_applicable</roomName>
  </identifiers>
</response>

Example outputs:
1. For "send a message to @dev_guru on telegram":
<response>
  <targetType>user</targetType>
  <source>telegram</source>
  <identifiers>
    <username>dev_guru</username>
  </identifiers>
</response>

2. For "post this in #announcements":
<response>
  <targetType>room</targetType>
  <source>discord</source>
  <identifiers>
    <roomName>announcements</roomName>
  </identifiers>
</response>

IMPORTANT: Your response must ONLY contain the <response></response> XML block above. Do not include any text, thinking, or reasoning before or after this XML block. Start your response immediately with <response> and end with </response>.`;
/**
 * Represents an action to send a message to a user or room.
 *
 * @typedef {Action} sendMessageAction
 * @property {string} name - The name of the action.
 * @property {string[]} similes - Additional names for the action.
 * @property {string} description - Description of the action.
 * @property {function} validate - Asynchronous function to validate if the action can be executed.
 * @property {function} handler - Asynchronous function to handle the action execution.
 * @property {ActionExample[][]} examples - Examples demonstrating the usage of the action.
 */
export const sendMessageAction: Action = {
  name: 'SEND_MESSAGE',
  similes: ['DM', 'MESSAGE', 'SEND_DM', 'POST_MESSAGE'],
  description: 'Send a message to a user or room (other than the current one)',

  validate: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
    // Check if we have permission to send messages
    const worldId = message.roomId;
    const agentId = runtime.agentId;

    // Get all components for the current room to understand available sources
    const roomComponents = await runtime.getComponents(message.roomId, worldId, agentId);

    // Get source types from room components
    const availableSources = new Set(roomComponents.map((c) => c.type));

    // TODO: Add ability for plugins to register their sources
    // const registeredSources = runtime.getRegisteredSources?.() || [];
    // availableSources.add(...registeredSources);

    return availableSources.size > 0;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: any,
    callback?: HandlerCallback,
    responses?: Memory[]
  ): Promise<ActionResult> => {
    try {
      if (!state) {
        logger.error('State is required for sendMessage action');
        return {
          text: 'State is required for sendMessage action',
          values: {
            success: false,
            error: 'STATE_REQUIRED',
          },
          data: {
            actionName: 'SEND_MESSAGE',
            error: 'State is required',
          },
          success: false,
          error: new Error('State is required for sendMessage action'),
        };
      }
      if (!callback) {
        logger.error('Callback is required for sendMessage action');
        return {
          text: 'Callback is required for sendMessage action',
          values: {
            success: false,
            error: 'CALLBACK_REQUIRED',
          },
          data: {
            actionName: 'SEND_MESSAGE',
            error: 'Callback is required',
          },
          success: false,
          error: new Error('Callback is required for sendMessage action'),
        };
      }
      if (!responses) {
        logger.error('Responses are required for sendMessage action');
        return {
          text: 'Responses are required for sendMessage action',
          values: {
            success: false,
            error: 'RESPONSES_REQUIRED',
          },
          data: {
            actionName: 'SEND_MESSAGE',
            error: 'Responses are required',
          },
          success: false,
          error: new Error('Responses are required for sendMessage action'),
        };
      }

      // Handle initial responses
      for (const response of responses) {
        await callback(response.content);
      }

      const sourceEntityId = message.entityId;
      const room = state.data.room ?? (await runtime.getRoom(message.roomId));
      const worldId = room.worldId;

      // Extract target and source information
      const targetPrompt = composePromptFromState({
        state,
        template: targetExtractionTemplate,
      });

      const targetResult = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt: targetPrompt,
        stopSequences: [],
      });

      const targetData = parseKeyValueXml(targetResult);
      if (!targetData?.targetType || !targetData?.source) {
        await callback({
          text: "I couldn't determine where you want me to send the message. Could you please specify the target (user or room) and platform?",
          actions: ['SEND_MESSAGE_ERROR'],
          source: message.content.source,
        });
        return {
          text: 'Could not determine message target',
          values: {
            success: false,
            error: 'TARGET_UNCLEAR',
          },
          data: {
            actionName: 'SEND_MESSAGE',
            error: 'Could not parse target information from message',
          },
          success: false,
        };
      }

      const source = targetData.source.toLowerCase();

      if (targetData.targetType === 'user') {
        // Try to find the target user entity
        const targetEntity = await findEntityByName(runtime, message, state);

        if (!targetEntity) {
          await callback({
            text: "I couldn't find the user you want me to send a message to. Could you please provide more details about who they are?",
            actions: ['SEND_MESSAGE_ERROR'],
            source: message.content.source,
          });
          return {
            text: 'Target user not found',
            values: {
              success: false,
              error: 'USER_NOT_FOUND',
              targetType: 'user',
            },
            data: {
              actionName: 'SEND_MESSAGE',
              error: 'Could not find target user',
              targetType: 'user',
              source,
            },
            success: false,
          };
        }

        // Get the component for the specified source
        const userComponent = await runtime.getComponent(
          targetEntity.id!,
          source,
          worldId,
          sourceEntityId
        );

        if (!userComponent) {
          await callback({
            text: `I couldn't find ${source} information for that user. Could you please provide their ${source} details?`,
            actions: ['SEND_MESSAGE_ERROR'],
            source: message.content.source,
          });
          return {
            text: `No ${source} information found for user`,
            values: {
              success: false,
              error: 'COMPONENT_NOT_FOUND',
              targetType: 'user',
              source,
            },
            data: {
              actionName: 'SEND_MESSAGE',
              error: `No ${source} component found for target user`,
              targetType: 'user',
              targetEntityId: targetEntity.id,
              source,
            },
            success: false,
          };
        }

        const sendDirectMessage = (runtime.getService(source) as any)?.sendDirectMessage;

        if (!sendDirectMessage) {
          await callback({
            text: "I couldn't find the user you want me to send a message to. Could you please provide more details about who they are?",
            actions: ['SEND_MESSAGE_ERROR'],
            source: message.content.source,
          });
          return {
            text: 'Message service not available',
            values: {
              success: false,
              error: 'SERVICE_NOT_FOUND',
              targetType: 'user',
              source,
            },
            data: {
              actionName: 'SEND_MESSAGE',
              error: `No sendDirectMessage service found for ${source}`,
              targetType: 'user',
              source,
            },
            success: false,
          };
        }
        // Send the message using the appropriate client
        try {
          await sendDirectMessage(runtime, targetEntity.id!, source, message.content.text, worldId);

          await callback({
            text: `Message sent to ${targetEntity.names[0]} on ${source}.`,
            actions: ['SEND_MESSAGE'],
            source: message.content.source,
          });
          return {
            text: `Message sent to ${targetEntity.names[0]}`,
            values: {
              success: true,
              targetType: 'user',
              targetId: targetEntity.id,
              targetName: targetEntity.names[0],
              source,
              messageSent: true,
            },
            data: {
              actionName: 'SEND_MESSAGE',
              targetType: 'user',
              targetId: targetEntity.id,
              targetName: targetEntity.names[0],
              source,
              messageContent: message.content.text,
            },
            success: true,
          };
        } catch (error: any) {
          logger.error(
            'Failed to send direct message:',
            error instanceof Error ? error.message : String(error)
          );
          await callback({
            text: 'I encountered an error trying to send the message. Please try again.',
            actions: ['SEND_MESSAGE_ERROR'],
            source: message.content.source,
          });
          return {
            text: 'Failed to send direct message',
            values: {
              success: false,
              error: 'SEND_FAILED',
              targetType: 'user',
              source,
            },
            data: {
              actionName: 'SEND_MESSAGE',
              error: error.message,
              targetType: 'user',
              targetId: targetEntity.id,
              source,
            },
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      } else if (targetData.targetType === 'room') {
        // Try to find the target room
        const rooms = await runtime.getRooms(worldId);
        const targetRoom = rooms.find((r) => {
          // Match room name from identifiers
          return r.name?.toLowerCase() === targetData.identifiers.roomName?.toLowerCase();
        });

        if (!targetRoom) {
          await callback({
            text: "I couldn't find the room you want me to send a message to. Could you please specify the exact room name?",
            actions: ['SEND_MESSAGE_ERROR'],
            source: message.content.source,
          });
          return {
            text: 'Target room not found',
            values: {
              success: false,
              error: 'ROOM_NOT_FOUND',
              targetType: 'room',
              roomName: targetData.identifiers.roomName,
            },
            data: {
              actionName: 'SEND_MESSAGE',
              error: 'Could not find target room',
              targetType: 'room',
              roomName: targetData.identifiers.roomName,
              source,
            },
            success: false,
          };
        }

        const sendRoomMessage = (runtime.getService(source) as any)?.sendRoomMessage;

        if (!sendRoomMessage) {
          await callback({
            text: "I couldn't find the room you want me to send a message to. Could you please specify the exact room name?",
            actions: ['SEND_MESSAGE_ERROR'],
            source: message.content.source,
          });
          return {
            text: 'Room message service not available',
            values: {
              success: false,
              error: 'SERVICE_NOT_FOUND',
              targetType: 'room',
              source,
            },
            data: {
              actionName: 'SEND_MESSAGE',
              error: `No sendRoomMessage service found for ${source}`,
              targetType: 'room',
              source,
            },
            success: false,
          };
        }

        // Send the message to the room
        try {
          await sendRoomMessage(runtime, targetRoom.id, source, message.content.text, worldId);

          await callback({
            text: `Message sent to ${targetRoom.name} on ${source}.`,
            actions: ['SEND_MESSAGE'],
            source: message.content.source,
          });
          return {
            text: `Message sent to ${targetRoom.name}`,
            values: {
              success: true,
              targetType: 'room',
              targetId: targetRoom.id,
              targetName: targetRoom.name,
              source,
              messageSent: true,
            },
            data: {
              actionName: 'SEND_MESSAGE',
              targetType: 'room',
              targetId: targetRoom.id,
              targetName: targetRoom.name,
              source,
              messageContent: message.content.text,
            },
            success: true,
          };
        } catch (error: any) {
          logger.error(
            'Failed to send room message:',
            error instanceof Error ? error.message : String(error)
          );
          await callback({
            text: 'I encountered an error trying to send the message to the room. Please try again.',
            actions: ['SEND_MESSAGE_ERROR'],
            source: message.content.source,
          });
          return {
            text: 'Failed to send room message',
            values: {
              success: false,
              error: 'SEND_FAILED',
              targetType: 'room',
              source,
            },
            data: {
              actionName: 'SEND_MESSAGE',
              error: error.message,
              targetType: 'room',
              targetId: targetRoom.id,
              targetName: targetRoom.name,
              source,
            },
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      }

      // Should not reach here
      return {
        text: 'Unknown target type',
        values: {
          success: false,
          error: 'UNKNOWN_TARGET_TYPE',
        },
        data: {
          actionName: 'SEND_MESSAGE',
          error: 'Unknown target type: ' + targetData.targetType,
        },
        success: false,
      };
    } catch (error) {
      logger.error(`Error in sendMessage handler: ${error}`);
      await callback?.({
        text: 'There was an error processing your message request.',
        actions: ['SEND_MESSAGE_ERROR'],
        source: message.content.source,
      });
      return {
        text: 'Error processing message request',
        values: {
          success: false,
          error: 'HANDLER_ERROR',
        },
        data: {
          actionName: 'SEND_MESSAGE',
          error: error instanceof Error ? error.message : String(error),
        },
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: "Send a message to @dev_guru on telegram saying 'Hello!'",
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Message sent to dev_guru on telegram.',
          actions: ['SEND_MESSAGE'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: "Post 'Important announcement!' in #announcements",
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Message sent to announcements.',
          actions: ['SEND_MESSAGE'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: "DM Jimmy and tell him 'Meeting at 3pm'",
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Message sent to Jimmy.',
          actions: ['SEND_MESSAGE'],
        },
      },
    ],
  ] as ActionExample[][],
};

export default sendMessageAction;
