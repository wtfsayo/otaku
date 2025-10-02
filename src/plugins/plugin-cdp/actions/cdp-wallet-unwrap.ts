import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger,
  ModelType,
  composePromptFromState,
  parseKeyValueXml,
} from "@elizaos/core";
import { getEntityWallet } from "../../../utils/entity";
import { CdpService } from "../services/cdp.service";
import { getTokenDecimals } from "../utils/coingecko";
import { type CdpSwapNetwork } from "../types";

const unwrapTemplate = `# CDP WETH Unwrap Request

## User Request
{{recentMessages}}

## Available Networks
- base (default)
- base-sepolia  
- ethereum
- arbitrum
- optimism
- polygon

## Instructions
Extract the unwrap details from the user's request. If any detail is missing, use reasonable defaults.

**Important Notes:**
- **Default network is "base"** - only specify another network if explicitly mentioned by the user
- Amount should be in human-readable format (e.g., "10.5" for 10.5 WETH)
- **For "all", "max", "full balance", or "entire balance" requests, use "MAX" as the amount**
- This action unwraps WETH to native ETH

Respond with the unwrap parameters in this exact format:
<unwrapParams>
<network>base</network>
<amount>10.5</amount>
</unwrapParams>`;

interface UnwrapParams {
  network: CdpSwapNetwork;
  amount: string;
}

const parseUnwrapParams = (text: string): UnwrapParams | null => {
  logger.debug("Parsing unwrap parameters from XML response");
  const parsed = parseKeyValueXml(text);
  logger.debug(`Parsed XML data: ${JSON.stringify(parsed)}`);
  
  // Network defaults to "base" if not provided
  if (!parsed?.amount) {
    logger.warn(`Missing required unwrap parameters: ${JSON.stringify({ parsed })}`);
    return null;
  }

  const unwrapParams = {
    network: (parsed.network || "base") as UnwrapParams["network"],
    amount: parsed.amount,
  };
  
  logger.debug(`Formatted unwrap parameters: ${JSON.stringify(unwrapParams)}`);
  return unwrapParams;
};

/**
 * WETH addresses for different networks
 * These are the wrapped native token contracts that can be unwrapped
 */
const WETH_ADDRESSES: Record<string, string> = {
  "base": "0x4200000000000000000000000000000000000006",
  "base-sepolia": "0x4200000000000000000000000000000000000006",
  "ethereum": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "ethereum-sepolia": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "arbitrum": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  "optimism": "0x4200000000000000000000000000000000000006",
  "polygon": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
};

/**
 * Note: WETH unwrapping is done by calling the withdraw() function on the WETH contract,
 * not by using CDP's swap API. WETH → ETH is a 1:1 conversion, not a DEX swap.
 */

export const cdpWalletUnwrap: Action = {
  name: "CDP_WALLET_UNWRAP",
  similes: [
    "CDP_UNWRAP",
    "CDP_UNWRAP_WETH",
    "UNWRAP_WETH_CDP",
    "WETH_TO_ETH_CDP",
  ],
  description: "Unwrap WETH to native ETH on EVM Based Chains",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    try {
      // Check if services are available
      const cdpService = _runtime.getService(
        CdpService.serviceType,
      ) as CdpService;

      if (!cdpService) {
        logger.warn("Required services not available for token deployment");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "Error validating token deployment action:",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("CDP_WALLET_UNWRAP handler invoked");
    logger.debug(`Message content: ${JSON.stringify(message.content)}`);
    
    try {
      logger.debug("Retrieving CDP service");
      const cdpService = runtime.getService(CdpService.serviceType) as CdpService;
      
      if (!cdpService) {
        logger.error("CDP Service not initialized");
        throw new Error("CDP Service not initialized");
      }
      logger.debug("CDP service retrieved successfully");

      // Ensure the user has a wallet saved
      logger.debug("Verifying entity wallet for:", message.entityId);
      const walletResult = await getEntityWallet(
        runtime,
        message,
        "CDP_WALLET_UNWRAP",
        callback,
      );
      if (walletResult.success === false) {
        logger.warn("Entity wallet verification failed");
        return walletResult.result;
      }
      logger.debug("Entity wallet verified successfully");

      // Compose state and get unwrap parameters from LLM
      logger.debug("Composing state for LLM prompt");
      const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
      const context = composePromptFromState({
        state: composedState,
        template: unwrapTemplate,
      });
      logger.debug("Composed prompt context");

      logger.debug("Calling LLM to extract unwrap parameters");
      const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: context,
      });
      logger.debug("LLM response received:", xmlResponse);

      const unwrapParams = parseUnwrapParams(xmlResponse);
      
      if (!unwrapParams) {
        logger.error("Failed to parse unwrap parameters from LLM response");
        throw new Error("Failed to parse unwrap parameters from request");
      }
      logger.info(`Unwrap parameters parsed successfully: ${JSON.stringify(unwrapParams)}`);

      // Get WETH address for the network
      const wethAddress = WETH_ADDRESSES[unwrapParams.network];
      if (!wethAddress) {
        throw new Error(`WETH address not configured for network ${unwrapParams.network}`);
      }
      const fromToken = wethAddress as `0x${string}`;
      
      logger.debug(`Unwrapping: WETH (${fromToken}) -> ETH on ${unwrapParams.network}`);

      // Get decimals for WETH (always 18 for WETH)
      logger.debug(`Fetching decimals for WETH: ${fromToken}`);
      const decimals = await getTokenDecimals(fromToken, unwrapParams.network);
      logger.debug(`Token decimals: ${decimals}`);

      // Handle "MAX" amount - fetch WETH balance
      let amountToUnwrap = unwrapParams.amount;
      if (unwrapParams.amount.toUpperCase() === "MAX") {
        logger.info("MAX amount detected, fetching WETH balance...");
        const account = await cdpService.getOrCreateAccount({ name: message.entityId });
        const balancesResponse = await account.listTokenBalances({ network: unwrapParams.network as any });
        const rows = balancesResponse?.balances || [];
        
        if (!rows.length) {
          logger.error(`No token balances found on ${unwrapParams.network}`);
          throw new Error(`No token balances found in your wallet. Please check your wallet balance first.`);
        }

        // Helper to convert values to integer strings
        const toIntegerString = (v: unknown): string => {
          if (typeof v === "bigint") return v.toString();
          if (typeof v === "number") return Math.trunc(v).toString();
          if (typeof v === "string") return v;
          return "0";
        };

        // Helper to format units
        const formatUnits = (amountInBaseUnits: string, decimals: number): string => {
          if (!/^-?\d+$/.test(amountInBaseUnits)) return amountInBaseUnits;
          const negative = amountInBaseUnits.startsWith("-");
          const digits = negative ? amountInBaseUnits.slice(1) : amountInBaseUnits;
          const d = Math.max(0, decimals | 0);
          if (d === 0) return (negative ? "-" : "") + digits;
          const padded = digits.padStart(d + 1, "0");
          const i = padded.length - d;
          let head = padded.slice(0, i);
          let tail = padded.slice(i);
          // trim trailing zeros on fractional part
          tail = tail.replace(/0+$/, "");
          if (tail.length === 0) return (negative ? "-" : "") + head;
          // trim leading zeros on integer part
          head = head.replace(/^0+(?=\d)/, "");
          return (negative ? "-" : "") + head + "." + tail;
        };
        
        // Find the balance for WETH
        const tokenBalance = rows.find((b: any) => {
          const address = (b?.token?.contractAddress || b?.token?.address || "").toLowerCase();
          return address === fromToken.toLowerCase();
        });

        if (!tokenBalance) {
          logger.error(`WETH ${fromToken} not found in wallet balances on ${unwrapParams.network}`);
          throw new Error(`No WETH balance found in your wallet. You need WETH to unwrap it to ETH.`);
        }

        // Extract raw amount and decimals
        const raw = toIntegerString(tokenBalance?.amount?.amount ?? tokenBalance?.amount ?? "0");
        const tokenDecimals = ((tokenBalance?.amount as any)?.decimals ?? (tokenBalance?.token as any)?.decimals ?? decimals) as number;
        
        logger.info(`Found WETH balance: ${raw} (${tokenDecimals} decimals)`);
        
        // Check if balance is zero or negative
        const balanceInWei = BigInt(raw);
        if (balanceInWei <= 0n) {
          logger.error(`Zero or negative WETH balance: ${raw}`);
          throw new Error(`You have zero WETH balance. Cannot unwrap.`);
        }
        
        // Format to human-readable amount
        amountToUnwrap = formatUnits(raw, tokenDecimals);
        logger.info(`Using MAX WETH balance: ${amountToUnwrap} (validated non-zero)`);
      }

      // Parse amount to wei using correct decimals
      const parseUnits = (value: string, decimals: number): bigint => {
        const [integer, fractional = ""] = value.split(".");
        const paddedFractional = fractional.padEnd(decimals, "0").slice(0, decimals);
        return BigInt(integer + paddedFractional);
      };

      const amountInWei = parseUnits(amountToUnwrap, decimals);
      logger.debug(`Amount in wei: ${amountInWei.toString()}`);

      logger.info(`Executing CDP unwrap: network=${unwrapParams.network}, amount=${amountToUnwrap} WETH -> ETH`);

      // Unwrap WETH by calling the withdraw() function on the WETH contract
      // This is a direct contract call, not a swap
      logger.debug(`Calling WETH contract withdraw function`);
      
      // Get viem clients for the account
      const { walletClient, publicClient } = await cdpService.getViemClientsForAccount({
        accountName: message.entityId,
        network: unwrapParams.network === "base" ? "base" : "base-sepolia",
      });
      
      // WETH withdraw ABI
      const wethAbi = [{
        name: "withdraw",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [{ name: "amount", type: "uint256" }],
        outputs: []
      }] as const;
      
      // Send withdraw transaction
      const txHash = await walletClient.writeContract({
        address: fromToken,
        abi: wethAbi,
        functionName: "withdraw",
        args: [amountInWei],
        chain: walletClient.chain,
      } as any);
      
      logger.info(`WETH unwrap transaction sent: ${txHash}`);
      
      // Wait for transaction confirmation
      logger.info("Waiting for unwrap transaction confirmation...");
      const receipt = await publicClient.waitForTransactionReceipt({ 
        hash: txHash,
        timeout: 60_000,
      });
      logger.info(`Unwrap confirmed in block ${receipt.blockNumber} (status: ${receipt.status})`);
      
      const successText = `✅ Successfully unwrapped ${amountToUnwrap} WETH to ETH on ${unwrapParams.network}\n` +
                         `Transaction Hash: ${txHash}`;

      logger.debug("Sending success callback");
      callback?.({
        text: successText,
        content: {
          success: true,
          transactionHash: txHash,
          network: unwrapParams.network,
          amount: amountToUnwrap,
        },
      });

      logger.debug("Returning success result");
      return {
        text: successText,
        success: true,
        data: {
          transactionHash: txHash,
          network: unwrapParams.network,
          amount: amountToUnwrap,
          fromToken: "WETH",
          toToken: "ETH",
        },
        values: {
          unwrapSuccess: true,
          transactionHash: txHash,
        },
      };
    } catch (error) {
      logger.error("CDP_WALLET_UNWRAP error:", error);
      logger.error("Error stack:", error instanceof Error ? error.stack : "No stack trace available");
      
      let errorMessage = "Failed to unwrap WETH.";
      if (error instanceof Error) {
        logger.debug(`Processing error message: ${error.message}`);
        if (error.message.includes("insufficient") || error.message.includes("zero")) {
          errorMessage = "Insufficient WETH balance for unwrapping.";
        } else if (error.message.includes("slippage")) {
          errorMessage = "Unwrap failed due to price movement. Try again.";
        } else if (error.message.includes("not authenticated")) {
          errorMessage = "CDP service is not authenticated. Please check your API credentials.";
        } else {
          errorMessage = `Unwrap failed: ${error.message}`;
        }
      }
      
      logger.debug(`Sending error callback: ${errorMessage}`);
      callback?.({
        text: errorMessage,
        content: { error: "cdp_wallet_unwrap_failed", details: error },
      });
      
      logger.debug("Returning error result");
      return {
        text: errorMessage,
        success: false,
        error: error as Error,
      };
    }
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "unwrap 1 WETH to ETH" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll unwrap 1 WETH to native ETH for you.",
          action: "CDP_WALLET_UNWRAP",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "unwrap all my WETH on base" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll unwrap all your WETH to ETH on Base network.",
          action: "CDP_WALLET_UNWRAP",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "convert 0.5 WETH to ETH on ethereum" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Converting 0.5 WETH to native ETH on Ethereum...",
          action: "CDP_WALLET_UNWRAP",
        },
      },
    ],
  ],
};

export default cdpWalletUnwrap;

