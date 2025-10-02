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
import { 
  mainnet, 
  base, 
  arbitrum, 
  polygon, 
  optimism, 
  zora,
  blast,
  scroll,
  linea,
  type Chain
  } from "viem/chains";
import { RelayService } from "../services/relay.service"; 
import { type BridgeRequest, type ResolvedBridgeRequest, type RelayStatus } from "../types";
import type { ProgressData } from "@relayprotocol/relay-sdk";
import { resolveTokenToAddress, getTokenDecimals } from "../utils/token-resolver";

const parseBridgeParams = (text: string): BridgeRequest | null => {
  const parsed = parseKeyValueXml(text);
  
  if (!parsed?.originChain || !parsed?.destinationChain || !parsed?.currency || !parsed?.amount) {
    console.warn(`Missing required bridge parameters: ${JSON.stringify({ parsed })}`);
    return null;
  }

  return {
    originChain: parsed.originChain.toLowerCase().trim(),
    destinationChain: parsed.destinationChain.toLowerCase().trim(),
    currency: parsed.currency.toLowerCase().trim(),
    amount: parsed.amount,
    recipient: parsed.recipient?.trim() || undefined,
    useExactInput: parsed.useExactInput !== "false",
    useExternalLiquidity: parsed.useExternalLiquidity === "true",
    referrer: parsed.referrer?.trim() || undefined,
  };
};

const bridgeTemplate = `# Cross-Chain Bridge Request

## User Request
{{recentMessages}}

## Available Networks
- ethereum (Ethereum Mainnet)
- base (Base)
- arbitrum (Arbitrum One)
- polygon (Polygon)
- optimism (Optimism)
- zora (Zora)
- blast (Blast)
- scroll (Scroll)
- linea (Linea)

## Instructions
Extract the bridge details from the user's request.

**Important Notes:**
- Use lowercase chain names ONLY (e.g., "ethereum", "base", "arbitrum")
- Do NOT provide chain IDs - only chain names
- For amounts, use human-readable format (e.g., "0.5" for 0.5 ETH, NOT in wei)
- Use token symbols (eth, usdc, usdt, weth, etc.)

Respond with the bridge parameters in this exact format:
<bridgeParams>
<originChain>ethereum</originChain>
<destinationChain>base</destinationChain>
<currency>eth</currency>
<amount>0.5</amount>
<useExactInput>true</useExactInput>
<useExternalLiquidity>false</useExternalLiquidity>
</bridgeParams>`;

// Supported chains mapping
const SUPPORTED_CHAINS: Record<string, Chain> = {
  ethereum: mainnet,
  base: base,
  arbitrum: arbitrum,
  polygon: polygon,
  optimism: optimism,
  zora: zora,
  blast: blast,
  scroll: scroll,
  linea: linea,
};

/**
 * Resolve chain name to chain ID using viem chains
 * Similar to how we resolve token symbols in CDP swap
 */
const resolveChainNameToId = (chainName: string): number | null => {
  const normalized = chainName.toLowerCase().trim();
  const chain = SUPPORTED_CHAINS[normalized];
  
  if (!chain) {
    console.error(`Chain not found: ${chainName}. Available chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`);
    return null;
  }
  
  return chain.id;
};

/**
 * Parse amount to wei based on token decimals
 * Most tokens use 18 decimals (ETH, WETH), stablecoins use 6 (USDC, USDT)
 */
const parseAmountToWei = (amount: string, currency: string): string => {
  const decimals = currency.toLowerCase().includes("usdc") || 
                   currency.toLowerCase().includes("usdt") ? 6 : 18;
  
  const [integer, fractional = ""] = amount.split(".");
  const paddedFractional = fractional.padEnd(decimals, "0").slice(0, decimals);
  const amountInWei = BigInt(integer + paddedFractional);
  
  return amountInWei.toString();
};

export const relayBridgeAction: Action = {
  name: "EXECUTE_RELAY_BRIDGE",
  description: "Execute a cross-chain bridge transaction using Relay Link",
  similes: [
    "BRIDGE_TOKENS",
    "CROSS_CHAIN_TRANSFER",
    "RELAY_BRIDGE",
    "SEND_CROSS_CHAIN",
    "TRANSFER_CROSS_CHAIN",
  ],

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    const keywords = [
      "bridge",
      "cross-chain",
      "relay",
      "transfer",
      "send",
      "move",
      "from",
      "to",
    ];

    const text = (message.content.text || "").toLowerCase();
    const hasKeyword = keywords.some(keyword => text.includes(keyword));
    const hasChains = /(?:ethereum|base|arbitrum|polygon|optimism|zora|blast|scroll|linea)/i.test(text);

    return hasKeyword && hasChains;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    console.log("[RELAY BRIDGE] Action handler started");
    console.log("[RELAY BRIDGE] Message text:", message.content.text);
    
    try {
      // Get Relay service
      console.log("[RELAY BRIDGE] Attempting to get Relay service with type:", RelayService.serviceType);
      const relayService = runtime.getService<RelayService>(RelayService.serviceType);

      if (!relayService) {
        console.error("[RELAY BRIDGE] Relay service not found in runtime");
        throw new Error("Relay service not initialized");
      }
      console.log("[RELAY BRIDGE] Relay service retrieved successfully");

      // Compose state and get bridge parameters from LLM
      console.log("[RELAY BRIDGE] Composing state for LLM extraction");
      const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
      const context = composePromptFromState({
        state: composedState,
        template: bridgeTemplate,
      });

      // Extract bridge parameters using LLM (gets chain names, not IDs)
      console.log("[RELAY BRIDGE] Calling LLM to extract parameters");
      const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: context,
      });
      console.log("[RELAY BRIDGE] LLM response:", xmlResponse);
      
      const bridgeParams = parseBridgeParams(xmlResponse);
      console.log("[RELAY BRIDGE] Parsed parameters:", JSON.stringify(bridgeParams, null, 2));
      
            if (!bridgeParams) {
              console.error("[RELAY BRIDGE] Failed to parse parameters from LLM response");
              throw new Error("Failed to parse bridge parameters from request");
            }

            // Always derive user address from EVM_PRIVATE_KEY
            console.log("[RELAY BRIDGE] Deriving user address from EVM_PRIVATE_KEY");
            const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
            if (!privateKey) {
              throw new Error("EVM_PRIVATE_KEY not set - required for bridge execution");
            }
            const normalizedPk = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
            const { privateKeyToAccount } = await import("viem/accounts");
            const account = privateKeyToAccount(normalizedPk as `0x${string}`);
            const userAddress = account.address;
            console.log("[RELAY BRIDGE] Using wallet address:", userAddress);

      // Resolve chain names to IDs (similar to token resolution in CDP swap)
      console.log("[RELAY BRIDGE] Resolving chain names to IDs");
      const originChainId = resolveChainNameToId(bridgeParams.originChain);
      const destinationChainId = resolveChainNameToId(bridgeParams.destinationChain);
      console.log("[RELAY BRIDGE] Origin chain ID:", originChainId, "Destination chain ID:", destinationChainId);

      if (!originChainId) {
        console.error("[RELAY BRIDGE] Invalid origin chain:", bridgeParams.originChain);
        throw new Error(`Unsupported origin chain: ${bridgeParams.originChain}. Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`);
      }

      if (!destinationChainId) {
        console.error("[RELAY BRIDGE] Invalid destination chain:", bridgeParams.destinationChain);
        throw new Error(`Unsupported destination chain: ${bridgeParams.destinationChain}. Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`);
      }

      // Resolve token symbols to contract addresses on BOTH chains
      console.log("[RELAY BRIDGE] Resolving token addresses on origin and destination chains");
      const currencyAddress = await resolveTokenToAddress(bridgeParams.currency, bridgeParams.originChain);
      // Same token symbol but resolved on destination chain (e.g., USDC on Base vs USDC on Optimism)
      const toCurrencyAddress = await resolveTokenToAddress(bridgeParams.currency, bridgeParams.destinationChain);

      if (!currencyAddress) {
        console.error("[RELAY BRIDGE] Could not resolve currency:", bridgeParams.currency);
        throw new Error(`Could not resolve currency: ${bridgeParams.currency} on ${bridgeParams.originChain}`);
      }

      if (!toCurrencyAddress) {
        console.error("[RELAY BRIDGE] Could not resolve destination currency:", bridgeParams.currency);
        throw new Error(`Could not resolve currency: ${bridgeParams.currency} on ${bridgeParams.destinationChain}`);
      }

      console.log("[RELAY BRIDGE] Resolved currency addresses:", { origin: currencyAddress, destination: toCurrencyAddress });

      // Get token decimals for proper amount conversion
      const decimals = await getTokenDecimals(currencyAddress, bridgeParams.originChain);
      console.log("[RELAY BRIDGE] Token decimals:", decimals);

      // Parse amount to smallest unit
      const [integer, fractional = ""] = bridgeParams.amount.split(".");
      const paddedFractional = fractional.padEnd(decimals, "0").slice(0, decimals);
      const amountInWei = BigInt(integer + paddedFractional);
      console.log("[RELAY BRIDGE] Amount in smallest unit:", amountInWei.toString());

      // Create resolved bridge request with chain IDs and contract addresses
      // Create resolved bridge request - both user and recipient default to userAddress
      const resolvedRequest: ResolvedBridgeRequest = {
        user: userAddress,
        originChainId,
        destinationChainId,
        currency: currencyAddress,
        toCurrency: toCurrencyAddress,
        amount: amountInWei.toString(),
        recipient: bridgeParams.recipient || userAddress,
        useExactInput: bridgeParams.useExactInput,
        useExternalLiquidity: bridgeParams.useExternalLiquidity,
        referrer: bridgeParams.referrer,
      };
      console.log("[RELAY BRIDGE] Resolved request:", JSON.stringify(resolvedRequest, null, 2));

      // Execute bridge
      let currentStatus = `Initiating bridge from ${bridgeParams.originChain} to ${bridgeParams.destinationChain}...`;
      if (callback) {
        callback({ text: currentStatus });
      }

      // Helper to serialize BigInt for logging
      const serializeBigInt = (obj: any): any => {
        if (obj === null || obj === undefined) return obj;
        if (typeof obj === 'bigint') return obj.toString();
        if (Array.isArray(obj)) return obj.map(serializeBigInt);
        if (typeof obj === 'object') {
          const serialized: any = {};
          for (const key in obj) {
            serialized[key] = serializeBigInt(obj[key]);
          }
          return serialized;
        }
        return obj;
      };

      console.log("[RELAY BRIDGE] Executing bridge transaction");
      const requestId = await relayService.executeBridge(
        resolvedRequest,
        (data: ProgressData) => {
          try {
            console.log("[RELAY BRIDGE] Progress update:", JSON.stringify(serializeBigInt(data), null, 2));
          } catch (err) {
            console.log("[RELAY BRIDGE] Progress update: (unable to serialize)", err);
          }
          currentStatus = `Bridge in progress...`;
          if (callback) {
            callback({ text: currentStatus });
          }
        }
      );
      console.log("[RELAY BRIDGE] Bridge executed, request ID:", requestId);

      // Get final status
      const statuses = await relayService.getStatus({ requestId });
      const status = statuses[0];

      // Format response (using serializeBigInt helper defined above)
      const response: ActionResult = {
        text: formatBridgeResponse(status, resolvedRequest, requestId),
        success: true,
        data: serializeBigInt({
          requestId,
          status,
          request: {
            ...bridgeParams,
            resolvedOriginChainId: originChainId,
            resolvedDestinationChainId: destinationChainId,
            amountInWei: amountInWei.toString(),
          },
        }),
      };

      if (callback) {
        callback({
          text: response.text,
          actions: ["EXECUTE_RELAY_BRIDGE"],
          source: message.content.source,
          data: response.data,
        });
      }

      return response;
    } catch (error: unknown) {
      console.error("[RELAY BRIDGE] Error occurred:", error);
      const errorMessage = (error as Error).message;
      const errorStack = (error as Error).stack;
      console.error("[RELAY BRIDGE] Error message:", errorMessage);
      console.error("[RELAY BRIDGE] Error stack:", errorStack);
      
      const errorResponse: ActionResult = {
        text: `Failed to execute bridge: ${errorMessage}`,
        success: false,
        error: errorMessage,
      };

      if (callback) {
        callback({
          text: errorResponse.text,
          content: { error: "relay_bridge_failed", details: errorMessage },
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
          text: "Bridge 0.5 ETH from Ethereum to Base",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll bridge 0.5 ETH from Ethereum to Base for you...",
          action: "EXECUTE_RELAY_BRIDGE",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Send 1000 USDC from Base to Arbitrum",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Executing cross-chain transfer of 1000 USDC from Base to Arbitrum...",
          action: "EXECUTE_RELAY_BRIDGE",
        },
      },
    ],
  ],
};

function formatBridgeResponse(status: RelayStatus | undefined, request: ResolvedBridgeRequest, requestId: string): string {
  const statusEmoji = status?.status === "success" ? "✅" : status?.status === "pending" ? "⏳" : "❌";

  let response = `
${statusEmoji} **Bridge ${(status?.status || "PENDING").toUpperCase()}**

**Request ID:** \`${requestId}\`
**Route:** ${getChainName(request.originChainId)} → ${getChainName(request.destinationChainId)}
**Amount:** ${formatAmount(request.amount, request.currency)}
**Status:** ${status?.status || "pending"}
  `.trim();

  if (status?.data?.inTxs?.[0]) {
    response += `\n\n**Origin Transaction:**\n- Hash: \`${status.data.inTxs[0].hash}\``;
  }

  if (status?.data?.outTxs?.[0]) {
    response += `\n\n**Destination Transaction:**\n- Hash: \`${status.data.outTxs[0].hash}\``;
  }

  if (status?.data?.fees) {
    const gasFeeWei = status.data.fees.gas ?? "0";
    const relayerFeeWei = status.data.fees.relayer ?? "0";
    const totalFees = BigInt(gasFeeWei) + BigInt(relayerFeeWei);
    response += `\n\n**Total Fees:** ${(Number(totalFees) / 1e18).toFixed(6)} ETH`;
  }

  return response;
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

function formatAmount(amount: string, currency: string): string {
  const decimals = currency.toLowerCase().includes("usdc") || currency.toLowerCase().includes("usdt") ? 6 : 18;
  const value = Number(amount) / Math.pow(10, decimals);
  return `${value.toFixed(6)} ${currency.toUpperCase()}`;
}

export default relayBridgeAction;
