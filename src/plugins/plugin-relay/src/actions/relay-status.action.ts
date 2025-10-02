import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  composePromptFromState,
  parseKeyValueXml,
  ModelType,
} from "@elizaos/core";
import { RelayService } from "../services/relay.service";
import type { StatusRequest, RelayStatus } from "../types";

interface StatusParams {
  requestId?: string;
  txHash?: string;
  user?: string;
}

const parseStatusParams = (text: string): StatusParams | null => {
  const parsed = parseKeyValueXml(text);
  
  // At least one identifier must be provided
  if (!parsed?.requestId && !parsed?.txHash && !parsed?.user) {
    console.warn(`Missing status identifiers: ${JSON.stringify({ parsed })}`);
    return null;
  }

  return {
    requestId: parsed.requestId?.trim(),
    txHash: parsed.txHash?.trim(),
    user: parsed.user?.trim(),
  };
};

const statusTemplate = `# Transaction Status Request

## User Request
{{recentMessages}}

## Instructions
Extract the transaction status request details from the user's message.

**You need at least ONE of these:**
- Request ID (transaction/request ID from Relay)
- Transaction hash (blockchain transaction hash)
- User address (wallet address)

Respond with the status parameters in this exact format:
<statusParams>
<requestId></requestId>
<txHash></txHash>
<user></user>
</statusParams>`;

export const relayStatusAction: Action = {
  name: "CHECK_RELAY_STATUS",
  description: "Check the status of a Relay Link cross-chain transaction",
  similes: [
    "GET_RELAY_STATUS",
    "CHECK_BRIDGE_STATUS",
    "TRANSACTION_STATUS",
    "BRIDGE_STATUS",
    "CHECK_CROSS_CHAIN",
  ],

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    const keywords = [
      "status",
      "check",
      "transaction",
      "bridge",
      "relay",
      "request",
      "hash",
      "tx",
    ];

    const text = message.content.text?.toLowerCase();
    const hasKeyword = keywords.some(keyword => text?.includes(keyword));
    const hasIdentifier = /0x[a-fA-F0-9]{64}/.test(text || "") || /request|id/i.test(text || "");

    return hasKeyword && hasIdentifier;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      // Get Relay service
      const relayService = runtime.getService<RelayService>(RelayService.serviceType);

      if (!relayService) {
        throw new Error("Relay service not initialized");
      }

      // Compose state and get status parameters from LLM
      const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
      const context = composePromptFromState({
        state: composedState,
        template: statusTemplate,
      });

      // Extract status parameters using LLM
      const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: context,
      });
      
      const statusParams = parseStatusParams(xmlResponse);
      
      if (!statusParams) {
        throw new Error("Failed to parse status parameters from request. Please provide a request ID, transaction hash, or user address.");
      }

      // Get status from Relay
      const statuses = await relayService.getStatus(statusParams as StatusRequest);

      if (statuses.length === 0) {
        const notFoundResponse: ActionResult = {
          text: "No transactions found matching your request.",
          success: false,
        };

        if (callback) {
          callback({
            text: notFoundResponse.text,
            content: { error: "no_transactions_found" },
          });
        }

        return notFoundResponse;
      }

      // Format response
      const response: ActionResult = {
        text: formatStatusResponse(statuses),
        success: true,
        data: {
          statuses,
          request: statusParams,
        },
      };

      if (callback) {
        callback({
          text: response.text,
          actions: ["CHECK_RELAY_STATUS"],
          source: message.content.source,
          data: response.data,
        });
      }

      return response;
    } catch (error: unknown) {
      const errorMessage = (error as Error).message;
      const errorResponse: ActionResult = {
        text: `Failed to get transaction status: ${errorMessage}`,
        success: false,
        error: errorMessage,
      };

      if (callback) {
        callback({
          text: errorResponse.text,
          content: { error: "relay_status_failed", details: errorMessage },
        });
      }

      return errorResponse;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "Check the status of request 0x1234...",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Let me check the status of that transaction...",
          action: "CHECK_RELAY_STATUS",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "What's the status of my bridge transaction?",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll check your recent bridge transactions...",
          action: "CHECK_RELAY_STATUS",
        },
      },
    ],
  ],
};

function formatStatusResponse(statuses: RelayStatus[]): string {
  if (statuses.length === 1) {
    return formatSingleStatus(statuses[0]);
  }

  let response = `📊 **Found ${statuses.length} Transactions**\n\n`;

  statuses.forEach((status, index) => {
    response += `**${index + 1}. ${status.id.slice(0, 10)}...**\n`;
    response += `- Status: ${getStatusEmoji(status.status)} ${status.status}\n`;
    response += `- Created: ${new Date(status.createdAt).toLocaleString()}\n`;

    if (status.data?.inTxs?.[0]) {
      response += `- Origin: Chain ${status.data.inTxs[0].chainId}\n`;
    }
    if (status.data?.outTxs?.[0]) {
      response += `- Destination: Chain ${status.data.outTxs[0].chainId}\n`;
    }

    response += "\n";
  });

  return response.trim();
}

function formatSingleStatus(status: RelayStatus): string {
  const statusEmoji = getStatusEmoji(status.status);

  let response = `
${statusEmoji} **Transaction Status: ${status.status.toUpperCase()}**

**Request ID:** \`${status.id}\`
**User:** \`${status.user}\`
**Recipient:** \`${status.recipient}\`
**Created:** ${new Date(status.createdAt).toLocaleString()}
**Updated:** ${new Date(status.updatedAt).toLocaleString()}
  `.trim();

  if (status.data?.inTxs?.[0]) {
    const inTx = status.data.inTxs[0];
    response += `\n\n**Origin Transaction:**`;
    response += `\n- Chain: ${getChainName(inTx.chainId)}`;
    response += `\n- Hash: \`${inTx.hash}\``;
    response += `\n- Time: ${new Date(inTx.timestamp * 1000).toLocaleString()}`;
  }

  if (status.data?.outTxs?.[0]) {
    const outTx = status.data.outTxs[0];
    response += `\n\n**Destination Transaction:**`;
    response += `\n- Chain: ${getChainName(outTx.chainId)}`;
    response += `\n- Hash: \`${outTx.hash}\``;
    response += `\n- Time: ${new Date(outTx.timestamp * 1000).toLocaleString()}`;
  }

  if (status.data?.fees) {
    const gasFeeWei = typeof status.data.fees.gas === "string"
      ? status.data.fees.gas
      : status.data.fees.gas ?? "0";
    const relayerFeeWei = typeof status.data.fees.relayer === "string"
      ? status.data.fees.relayer
      : status.data.fees.relayer ?? "0";
    const totalFees = BigInt(gasFeeWei) + BigInt(relayerFeeWei);
    response += `\n\n**Fees:**`;
    response += `\n- Gas: ${(Number(gasFeeWei) / 1e18).toFixed(6)} ETH`;
    response += `\n- Relayer: ${(Number(relayerFeeWei) / 1e18).toFixed(6)} ETH`;
    response += `\n- Total: ${(Number(totalFees) / 1e18).toFixed(6)} ETH`;
  }

  return response;
}

function getStatusEmoji(status: string): string {
  const emojis: Record<string, string> = {
    success: "✅",
    pending: "⏳",
    failed: "❌",
    processing: "🔄",
  };
  return emojis[status.toLowerCase()] || "❓";
}

function getChainName(chainId: number): string {
  const chains: Record<number, string> = {
    1: "Ethereum",
    8453: "Base",
    42161: "Arbitrum",
    137: "Polygon",
    10: "Optimism",
    7777777: "Zora",
    81457: "Blast",
    534352: "Scroll",
    59144: "Linea",
  };
  return chains[chainId] || `Chain ${chainId}`;
}

export default relayStatusAction;
