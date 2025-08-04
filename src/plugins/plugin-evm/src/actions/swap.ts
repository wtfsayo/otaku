import type {
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import {
  ModelType,
  composePromptFromState,
  elizaLogger,
  parseKeyValueXml,
} from "@elizaos/core";
import {
  type ExtendedChain,
  type Route,
  createConfig,
  getRoutes,
  getStepTransaction,
  getToken,
} from "@lifi/sdk";

import {
  type Address,
  type ByteArray,
  type Hex,
  encodeFunctionData,
  parseAbi,
  parseUnits,
} from "viem";
import { type WalletProvider, initWalletProvider } from "../providers/wallet";
import { swapTemplate } from "../templates";
import type { SwapParams, SwapQuote, Transaction } from "../types";
import type { BebopRoute } from "../types/index";
import { getEntityWallet } from "../../../../utils/entity";

export { swapTemplate };

export class SwapAction {
  private lifiConfig;
  private bebopChainsMap;

  constructor(private walletProvider: WalletProvider) {
    this.walletProvider = walletProvider;
    const lifiChains: ExtendedChain[] = [];
    for (const config of Object.values(this.walletProvider.chains)) {
      try {
        lifiChains.push({
          id: config.id,
          name: config.name,
          key: config.name.toLowerCase(),
          chainType: "EVM" as const,
          nativeToken: {
            ...config.nativeCurrency,
            chainId: config.id,
            address: "0x0000000000000000000000000000000000000000",
            coinKey: config.nativeCurrency.symbol,
            priceUSD: "0",
            logoURI: "",
            symbol: config.nativeCurrency.symbol,
            decimals: config.nativeCurrency.decimals,
            name: config.nativeCurrency.name,
          },
          rpcUrls: {
            public: { http: [config.rpcUrls.default.http[0]] },
          },
          blockExplorerUrls: config.blockExplorers?.default?.url
            ? [config.blockExplorers.default.url]
            : [],
          metamask: {
            chainId: `0x${config.id.toString(16)}`,
            chainName: config.name,
            nativeCurrency: config.nativeCurrency,
            rpcUrls: [config.rpcUrls.default.http[0]],
            blockExplorerUrls: config.blockExplorers?.default?.url
              ? [config.blockExplorers.default.url]
              : [],
          },
          coin: config.nativeCurrency.symbol,
          mainnet: true,
          diamondAddress: "0x0000000000000000000000000000000000000000",
        } as ExtendedChain);
      } catch {
        // Skip chains with missing config in viem
      }
    }
    this.lifiConfig = createConfig({
      integrator: "eliza",
      chains: lifiChains,
    });
    this.bebopChainsMap = {
      mainnet: "ethereum",
      optimism: "optimism",
      polygon: "polygon",
      arbitrum: "arbitrum",
      base: "base",
      linea: "linea",
    };
  }

  /**
   * Resolves a token symbol or address to a valid contract address using LiFi SDK
   */
  private async resolveTokenAddress(
    tokenSymbolOrAddress: string,
    chainId: number
  ): Promise<string> {
    // If it's already a valid address (starts with 0x and is 42 chars), return as is
    if (
      tokenSymbolOrAddress.startsWith("0x") &&
      tokenSymbolOrAddress.length === 42
    ) {
      return tokenSymbolOrAddress;
    }

    // If it's the zero address (native token), return as is
    if (tokenSymbolOrAddress === "0x0000000000000000000000000000000000000000") {
      return tokenSymbolOrAddress;
    }

    try {
      // Use LiFi SDK to resolve token symbol to address
      const token = await getToken(chainId, tokenSymbolOrAddress);
      return token.address;
    } catch (error) {
      elizaLogger.error(
        `Failed to resolve token ${tokenSymbolOrAddress} on chain ${chainId}:`,
        error
      );
      // If LiFi fails, return original value and let downstream handle the error
      return tokenSymbolOrAddress;
    }
  }

  async swap(params: SwapParams): Promise<Transaction> {
    const walletClient = this.walletProvider.getWalletClient(params.chain);
    const [fromAddress] = await walletClient.getAddresses();

    // Resolve token symbols to addresses first
    const chainConfig = this.walletProvider.getChainConfigs(params.chain);
    const chainId = chainConfig.id;

    const resolvedFromToken = await this.resolveTokenAddress(
      params.fromToken,
      chainId
    );
    const resolvedToToken = await this.resolveTokenAddress(
      params.toToken,
      chainId
    );

    // Update params with resolved addresses
    const resolvedParams = {
      ...params,
      fromToken: resolvedFromToken as Address,
      toToken: resolvedToToken as Address,
    };

    // Try swap with progressively higher slippage if needed
    const slippageLevels = [0.01, 0.015, 0.02]; // 1%, 1.5%, 2%
    let lastError: Error | undefined;
    let attemptCount = 0;

    for (const slippage of slippageLevels) {
      try {
        elizaLogger.info(
          `Attempting swap with ${(slippage * 100).toFixed(1)}% slippage...`
        );

        // Getting quotes from different aggregators with current slippage
        const sortedQuotes: SwapQuote[] = await this.getSortedQuotes(
          fromAddress,
          resolvedParams,
          slippage
        );

        // Trying to execute the best quote by amount, fallback to the next one if it fails
        for (const quote of sortedQuotes) {
          attemptCount++;
          elizaLogger.info(
            `Trying ${quote.aggregator} (attempt ${attemptCount})...`
          );

          let res;
          switch (quote.aggregator) {
            case "lifi":
              res = await this.executeLifiQuote(quote);
              break;
            case "bebop":
              res = await this.executeBebopQuote(quote, resolvedParams);
              break;
            default:
              throw new Error("Unknown aggregator");
          }

          if (res !== undefined) {
            elizaLogger.info(`✅ Swap succeeded via ${quote.aggregator}!`);
            return res;
          }

          elizaLogger.warn(
            `${quote.aggregator} attempt failed, trying next option...`
          );
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        elizaLogger.warn(
          `Swap attempt with ${(slippage * 100).toFixed(1)}% slippage failed: ${lastError.message}`
        );

        // If it's a slippage error, revert, or MEV issue and we have more slippage levels to try, continue
        if (
          lastError.message.includes("price movement") ||
          lastError.message.includes("Return amount is not enough") ||
          lastError.message.includes("reverted") ||
          lastError.message.includes("MEV frontrunning") ||
          lastError.message.includes("TRANSFER_FROM_FAILED")
        ) {
          // Add small delay to avoid rapid retries
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }

        // If it's not a recoverable error, throw immediately
        throw lastError;
      }
    }

    // If all slippage levels failed, throw the last error with additional context
    const errorMsg = `All swap attempts failed after ${attemptCount} tries. ${lastError?.message || "Unknown error"}`;
    elizaLogger.error(errorMsg);
    throw new Error(errorMsg);
  }

  private async getSortedQuotes(
    fromAddress: Address,
    params: SwapParams,
    slippage: number = 0.01
  ): Promise<SwapQuote[]> {
    const decimalsAbi = parseAbi(["function decimals() view returns (uint8)"]);
    let fromTokenDecimals: number;

    const chainConfig = this.walletProvider.getChainConfigs(params.chain);

    // Check if the fromToken is the native currency
    if (
      params.fromToken.toUpperCase() ===
        chainConfig.nativeCurrency.symbol.toUpperCase() ||
      params.fromToken === "0x0000000000000000000000000000000000000000"
    ) {
      fromTokenDecimals = chainConfig.nativeCurrency.decimals;
    } else {
      fromTokenDecimals = await this.walletProvider
        .getPublicClient(params.chain)
        .readContract({
          address: params.fromToken as Address,
          abi: decimalsAbi,
          functionName: "decimals",
        });
    }

    const quotesPromises: Promise<SwapQuote | undefined>[] = [
      this.getLifiQuote(fromAddress, params, fromTokenDecimals, slippage),
      this.getBebopQuote(fromAddress, params, fromTokenDecimals),
    ];
    const quotesResults = await Promise.all(quotesPromises);
    const sortedQuotes: SwapQuote[] = quotesResults.filter(
      (quote): quote is SwapQuote => quote !== undefined
    );
    sortedQuotes.sort((a, b) =>
      BigInt(a.minOutputAmount) > BigInt(b.minOutputAmount) ? -1 : 1
    );
    if (sortedQuotes.length === 0) throw new Error("No routes found");
    return sortedQuotes;
  }

  private async getLifiQuote(
    fromAddress: Address,
    params: SwapParams,
    fromTokenDecimals: number,
    slippage: number = 0.01
  ): Promise<SwapQuote | undefined> {
    try {
      const routes = await getRoutes({
        fromChainId: this.walletProvider.getChainConfigs(params.chain).id,
        toChainId: this.walletProvider.getChainConfigs(params.chain).id,
        fromTokenAddress: params.fromToken,
        toTokenAddress: params.toToken,
        fromAmount: parseUnits(params.amount, fromTokenDecimals).toString(),
        fromAddress: fromAddress,
        options: {
          slippage: slippage,
          order: "RECOMMENDED",
        },
      });
      if (!routes.routes.length) throw new Error("No routes found");
      return {
        aggregator: "lifi",
        minOutputAmount: routes.routes[0].steps[0].estimate.toAmountMin,
        swapData: routes.routes[0],
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check for specific slippage-related errors
      if (
        errorMessage.includes("Return amount is not enough") ||
        errorMessage.includes("INSUFFICIENT_OUTPUT_AMOUNT") ||
        errorMessage.includes("slippage")
      ) {
        elizaLogger.error(
          `LiFi swap failed due to slippage protection. Consider increasing slippage tolerance. Error: ${errorMessage}`
        );
      }

      elizaLogger.error("Error in getLifiQuote:", errorMessage);
      return undefined;
    }
  }

  private async getBebopQuote(
    fromAddress: Address,
    params: SwapParams,
    fromTokenDecimals: number
  ): Promise<SwapQuote | undefined> {
    try {
      const chainName =
        (this.bebopChainsMap as any)[params.chain] ?? params.chain;
      const url = `https://api.bebop.xyz/router/${chainName}/v1/quote`;

      // Resolve token addresses before making the request
      const chainConfig = this.walletProvider.getChainConfigs(params.chain);
      const resolvedFromToken = await this.resolveTokenAddress(
        params.fromToken,
        chainConfig.id
      );
      const resolvedToToken = await this.resolveTokenAddress(
        params.toToken,
        chainConfig.id
      );

      const reqParams = new URLSearchParams({
        sell_tokens: resolvedFromToken,
        buy_tokens: resolvedToToken,
        sell_amounts: parseUnits(params.amount, fromTokenDecimals).toString(),
        taker_address: fromAddress,
        approval_type: "Standard",
        skip_validation: "true",
        gasless: "false",
        source: "eliza",
      });
      const response = await fetch(`${url}?${reqParams.toString()}`, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw Error(
          `Bebop API error: ${response.status} ${response.statusText}`
        );
      }

      const data: any = await response.json();

      // Improved error handling for Bebop API response
      if (
        !data.routes ||
        !Array.isArray(data.routes) ||
        data.routes.length === 0
      ) {
        throw new Error("No routes found in Bebop API response");
      }

      const firstRoute = data.routes[0];
      if (!firstRoute?.quote?.tx) {
        throw new Error("Invalid route structure in Bebop API response");
      }

      const route: BebopRoute = {
        data: firstRoute.quote.tx.data,
        sellAmount: parseUnits(params.amount, fromTokenDecimals).toString(),
        approvalTarget: firstRoute.quote.approvalTarget as `0x${string}`,
        from: firstRoute.quote.tx.from as `0x${string}`,
        value: firstRoute.quote.tx.value?.toString() || "0",
        to: firstRoute.quote.tx.to as `0x${string}`,
        gas: firstRoute.quote.tx.gas?.toString() || "0",
        gasPrice: firstRoute.quote.tx.gasPrice?.toString() || "0",
      };

      // Check if buyTokens exists and has the expected structure
      if (!firstRoute.quote.buyTokens) {
        throw new Error("Missing buyTokens information in Bebop API response");
      }

      // Try to find the buy token info using both the original token and resolved address
      let buyTokenInfo =
        firstRoute.quote.buyTokens[resolvedToToken] ||
        firstRoute.quote.buyTokens[params.toToken] ||
        firstRoute.quote.buyTokens[resolvedToToken.toLowerCase()];

      if (!buyTokenInfo) {
        // If not found, try to get the first (and likely only) buy token
        const buyTokenKeys = Object.keys(firstRoute.quote.buyTokens);
        if (buyTokenKeys.length > 0) {
          buyTokenInfo = firstRoute.quote.buyTokens[buyTokenKeys[0]];
        }
      }

      if (!buyTokenInfo || !buyTokenInfo.minimumAmount) {
        throw new Error(
          "Cannot determine minimum output amount from Bebop response"
        );
      }

      return {
        aggregator: "bebop",
        minOutputAmount: buyTokenInfo.minimumAmount.toString(),
        swapData: route,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      elizaLogger.error("Error in getBebopQuote:", errorMessage);
      return undefined;
    }
  }

  private async executeLifiQuote(
    quote: SwapQuote
  ): Promise<Transaction | undefined> {
    try {
      const route: Route = quote.swapData as Route;

      // Get the first step and request transaction data for it
      const step = route.steps[0];
      if (!step) {
        throw new Error("No steps found in route");
      }

      // Use getStepTransaction to get the actual transaction data
      const stepWithTx = await getStepTransaction(step);

      if (!stepWithTx.transactionRequest) {
        throw new Error(
          "No transaction request found in step after getStepTransaction"
        );
      }

      // Get wallet client for the correct chain
      const chainId = route.fromChainId;
      const chainName = Object.keys(this.walletProvider.chains).find(
        (name) =>
          this.walletProvider.getChainConfigs(name as any).id === chainId
      );

      if (!chainName) {
        throw new Error(
          `Chain with ID ${chainId} not found in wallet provider`
        );
      }

      const walletClient = this.walletProvider.getWalletClient(
        chainName as any
      );
      const publicClient = this.walletProvider.getPublicClient(
        chainName as any
      );

      if (!walletClient.account) {
        throw new Error("Wallet account is not available");
      }

      const txRequest = stepWithTx.transactionRequest;

      // Check if we need to approve tokens for LiFi contract (for ERC20 tokens, not native ETH)
      const fromToken = route.fromToken;
      if (fromToken.address !== "0x0000000000000000000000000000000000000000") {
        // This is an ERC20 token, check allowance
        const allowanceAbi = parseAbi([
          "function allowance(address,address) view returns (uint256)",
        ]);
        const spenderAddress = txRequest.to as Address; // LiFi contract address

        const allowance: bigint = await publicClient.readContract({
          address: fromToken.address as Address,
          abi: allowanceAbi,
          functionName: "allowance",
          args: [walletClient.account.address, spenderAddress],
        });

        const requiredAmount = BigInt(route.fromAmount);

        if (allowance < requiredAmount) {
          elizaLogger.info(
            `Approving ${fromToken.symbol} for LiFi contract...`
          );

          const approvalData = encodeFunctionData({
            abi: parseAbi(["function approve(address,uint256)"]),
            functionName: "approve",
            args: [spenderAddress, requiredAmount],
          });

          const approvalTx = await walletClient.sendTransaction({
            account: walletClient.account,
            to: fromToken.address as Address,
            value: 0n,
            data: approvalData,
            chain: walletClient.chain,
          });

          // Wait for approval to be confirmed
          elizaLogger.info(`Waiting for approval confirmation...`);
          const approvalReceipt = await publicClient.waitForTransactionReceipt({
            hash: approvalTx,
            timeout: 60000, // 60 second timeout
          });

          if (approvalReceipt.status === "reverted") {
            throw new Error(
              `Token approval failed. Transaction hash: ${approvalTx}`
            );
          }

          elizaLogger.info(`Token approval confirmed. Proceeding with swap...`);
        }
      }

      const hash = await walletClient.sendTransaction({
        account: walletClient.account,
        to: txRequest.to as `0x${string}`,
        value: BigInt(txRequest.value || "0"),
        data: txRequest.data as `0x${string}`,
        chain: walletClient.chain,
        gas: txRequest.gasLimit
          ? BigInt(Math.floor(Number(txRequest.gasLimit) * 1.2))
          : undefined, // Add 20% gas buffer
        gasPrice: txRequest.gasPrice
          ? BigInt(Math.floor(Number(txRequest.gasPrice) * 1.1))
          : undefined, // 10% higher gas price for MEV protection
      });

      // Wait for transaction receipt to verify success
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: hash,
        timeout: 60000, // 60 second timeout
      });

      if (receipt.status === "reverted") {
        throw new Error(
          `Transaction reverted on-chain. Hash: ${hash}. This could be due to price movement, insufficient gas, or MEV frontrunning. Please try again.`
        );
      }

      return {
        hash,
        from: walletClient.account.address,
        to: txRequest.to as `0x${string}`,
        value: BigInt(txRequest.value || "0"),
        data: txRequest.data as `0x${string}`,
        chainId: route.fromChainId,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check for specific slippage-related errors
      if (
        errorMessage.includes("Return amount is not enough") ||
        errorMessage.includes("INSUFFICIENT_OUTPUT_AMOUNT") ||
        errorMessage.includes("slippage")
      ) {
        elizaLogger.error(
          `LiFi swap failed due to slippage protection. Consider increasing slippage tolerance. Error: ${errorMessage}`
        );
        throw new Error(
          "Swap failed due to price movement. Try again or increase slippage tolerance."
        );
      }

      elizaLogger.error(`Failed to execute lifi quote: ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }

  private async executeBebopQuote(
    quote: SwapQuote,
    params: SwapParams
  ): Promise<Transaction | undefined> {
    try {
      const bebopRoute: BebopRoute = quote.swapData as BebopRoute;
      const walletClient = this.walletProvider.getWalletClient(params.chain);
      const publicClient = this.walletProvider.getPublicClient(params.chain);

      if (!walletClient.account) {
        throw new Error("Wallet account is not available");
      }

      // Resolve token address for approval check
      const chainConfig = this.walletProvider.getChainConfigs(params.chain);
      const resolvedFromToken = await this.resolveTokenAddress(
        params.fromToken,
        chainConfig.id
      );

      // Skip approval for native tokens
      if (resolvedFromToken !== "0x0000000000000000000000000000000000000000") {
        const allowanceAbi = parseAbi([
          "function allowance(address,address) view returns (uint256)",
        ]);
        const allowance: bigint = await publicClient.readContract({
          address: resolvedFromToken as Address,
          abi: allowanceAbi,
          functionName: "allowance",
          args: [walletClient.account.address, bebopRoute.approvalTarget],
        });

        if (allowance < BigInt(bebopRoute.sellAmount)) {
          elizaLogger.info(`Approving token for Bebop...`);

          const approvalData = encodeFunctionData({
            abi: parseAbi(["function approve(address,uint256)"]),
            functionName: "approve",
            args: [bebopRoute.approvalTarget, BigInt(bebopRoute.sellAmount)],
          });

          const approvalTx = await walletClient.sendTransaction({
            account: walletClient.account,
            to: resolvedFromToken as Address,
            value: 0n,
            data: approvalData,
            chain: walletClient.chain,
          });

          // Wait for approval confirmation
          elizaLogger.info(`Waiting for approval confirmation...`);
          const approvalReceipt = await publicClient.waitForTransactionReceipt({
            hash: approvalTx,
            timeout: 60000,
          });

          if (approvalReceipt.status === "reverted") {
            throw new Error(
              `Token approval failed. Transaction hash: ${approvalTx}`
            );
          }

          elizaLogger.info(`Token approval confirmed. Proceeding with swap...`);
        }
      }

      const hash = await walletClient.sendTransaction({
        account: walletClient.account,
        to: bebopRoute.to,
        value: BigInt(bebopRoute.value),
        data: bebopRoute.data as Hex,
        chain: walletClient.chain,
      });

      // Wait for transaction confirmation
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: hash,
        timeout: 60000,
      });

      if (receipt.status === "reverted") {
        throw new Error(`Bebop swap reverted. Transaction hash: ${hash}`);
      }

      return {
        hash,
        from: walletClient.account.address,
        to: bebopRoute.to,
        value: BigInt(bebopRoute.value),
        data: bebopRoute.data as Hex,
        chainId: chainConfig.id,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      elizaLogger.error(`Failed to execute bebop quote: ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }
}

const buildSwapDetails = async (
  state: State,
  _message: Memory,
  runtime: IAgentRuntime,
  wp: WalletProvider
): Promise<SwapParams> => {
  const chains = wp.getSupportedChains();

  // Add balances to state for better context in template
  const balances = await wp.getWalletBalances();

  state = await runtime.composeState(_message, ["RECENT_MESSAGES"], true);
  state.supportedChains = chains.join(" | ");
  state.chainBalances = Object.entries(balances)
    .map(([chain, balance]) => {
      const chainConfig = wp.getChainConfigs(chain as any);
      return `${chain}: ${balance} ${chainConfig.nativeCurrency.symbol}`;
    })
    .join(", ");

  const context = composePromptFromState({
    state,
    template: swapTemplate,
  });

  const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
    prompt: context,
  });

  const parsedXml = parseKeyValueXml(xmlResponse);

  if (!parsedXml) {
    throw new Error("Failed to parse XML response from LLM for swap details.");
  }

  // Map parsed XML fields to SwapParams fields
  let swapDetails: SwapParams = {
    fromToken: parsedXml.inputToken,
    toToken: parsedXml.outputToken,
    amount: parsedXml.amount,
    chain: parsedXml.chain,
  };

  // Normalize chain name to lowercase to handle case sensitivity issues
  if (swapDetails.chain) {
    const normalizedChainName = swapDetails.chain.toLowerCase();

    // Validate chain exists
    if (!wp.chains[normalizedChainName]) {
      throw new Error(
        `Chain ${swapDetails.chain} not configured. Available chains: ${chains.join(", ")}`
      );
    }

    // Update swapDetails with normalized chain name
    swapDetails.chain = normalizedChainName as any;
  }

  // Handle missing or null amount by calculating from balance
  if (
    !swapDetails.amount ||
    swapDetails.amount === "null" ||
    swapDetails.amount === ""
  ) {
    // Get the original message text to check for balance-related requests
    const messageText = (_message.content.text || "").toLowerCase();

    if (messageText.includes("half") || messageText.includes("50%")) {
      // User wants half their balance
      const balance = balances[swapDetails.chain];
      if (balance) {
        const halfBalance = (parseFloat(balance) / 2).toString();
        swapDetails.amount = halfBalance;
      }
    } else if (
      messageText.includes("all") ||
      messageText.includes("100%") ||
      messageText.includes("everything")
    ) {
      // User wants all their balance (minus some for gas)
      const balance = balances[swapDetails.chain];
      if (balance) {
        const mostBalance = (parseFloat(balance) * 0.9).toString(); // Leave 10% for gas
        swapDetails.amount = mostBalance;
      }
    } else if (messageText.match(/(\d+)%/)) {
      // User specified a percentage
      const match = messageText.match(/(\d+)%/);
      if (match) {
        const percentage = parseInt(match[1]) / 100;
        const balance = balances[swapDetails.chain];
        if (balance) {
          const percentageBalance = (
            parseFloat(balance) * percentage
          ).toString();
          swapDetails.amount = percentageBalance;
        }
      }
    }
  }

  return swapDetails;
};

export const swapAction = {
  name: "EVM_SWAP_TOKENS",
  description: "Swap tokens on the same chain",
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    state?: State,
    _options?: any,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const walletResult = await getEntityWallet(
      runtime,
      _message,
      "EVM_SWAP_TOKENS",
      callback
    );
    if (!walletResult.success) {
      return walletResult.result;
    }
    const walletPrivateKey = walletResult.walletPrivateKey;
    const walletProvider = await initWalletProvider(runtime, walletPrivateKey);
    const action = new SwapAction(walletProvider);

    try {
      // Get swap parameters
      if (!state) {
        state = await runtime.composeState(_message);
      }

      const swapOptions = await buildSwapDetails(
        state,
        _message,
        runtime,
        walletProvider
      );

      const swapResp = await action.swap(swapOptions);

      const successText = `✅ Successfully swapped ${swapOptions.amount} ${swapOptions.fromToken} for ${swapOptions.toToken} on ${swapOptions.chain}\nTransaction Hash: ${swapResp.hash}`;

      // Only create success memory and callback after successful swap
      if (callback) {
        callback({
          text: `Successfully swapped ${swapOptions.amount} ${swapOptions.fromToken} for ${swapOptions.toToken} on ${swapOptions.chain}\nTransaction Hash: ${swapResp.hash}`,
          content: {
            success: true,
            hash: swapResp.hash,
            chain: swapOptions.chain,
            fromToken: swapOptions.fromToken,
            toToken: swapOptions.toToken,
            amount: swapOptions.amount,
          },
        });
      }

      return {
        success: true,
        text: successText,
        values: {
          swapSucceeded: true,
          inputToken: swapOptions.fromToken,
          outputToken: swapOptions.toToken,
        },
        data: {
          actionName: "EVM_SWAP_TOKENS",
          transactionHash: swapResp.hash,
          chain: swapOptions.chain,
          fromToken: swapOptions.fromToken,
          toToken: swapOptions.toToken,
          amount: swapOptions.amount,
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Error in swap handler:", errorMessage);

      // Provide meaningful error messages
      let userFriendlyMessage = "";

      if (errorMessage.includes("TRANSFER_FROM_FAILED")) {
        userFriendlyMessage =
          "The swap failed because the tokens couldn't be transferred. This usually happens when you don't have enough tokens or the token has special restrictions.";
      } else if (
        errorMessage.includes("price movement") ||
        errorMessage.includes("slippage")
      ) {
        userFriendlyMessage =
          "The swap failed because the token price changed too much while processing. This happens in volatile markets.";
      } else if (
        errorMessage.includes("MEV") ||
        errorMessage.includes("frontrunning")
      ) {
        userFriendlyMessage =
          "The swap was blocked by trading bots that tried to take advantage of your transaction.";
      } else if (errorMessage.includes("reverted")) {
        userFriendlyMessage =
          "The swap couldn't go through. This often happens when there isn't enough liquidity for the trade.";
      } else if (errorMessage.includes("No routes found")) {
        userFriendlyMessage =
          "I couldn't find a way to swap these tokens. They might not be tradeable on this network.";
      } else if (errorMessage.includes("All swap attempts failed")) {
        userFriendlyMessage =
          "The swap failed after trying different options. The tokens might have very low liquidity or trading restrictions.";
      } else {
        // For any other errors, keep it simple
        userFriendlyMessage = "The swap couldn't be completed.";
      }

      if (callback) {
        callback({
          text: userFriendlyMessage,
          content: {
            success: false,
            error: errorMessage,
            fromToken: state?.swapOptions?.fromToken,
            toToken: state?.swapOptions?.toToken,
            amount: state?.swapOptions?.amount,
            chain: state?.swapOptions?.chain,
          },
        });
      }
      return {
        success: false,
        text: `❌ ${userFriendlyMessage}`,
        values: {
          swapSucceeded: false,
          error: true,
          errorMessage,
        },
        data: {
          actionName: "EVM_SWAP_TOKENS",
          error: errorMessage,
        },
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
  template: swapTemplate,
  validate: async (runtime: IAgentRuntime) => {
    return true;
  },
  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "Swap 1 WETH for USDC on Arbitrum",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "✅ Successfully swapped 1 WETH for USDC on arbitrum\nTransaction Hash: 0xabc...def",
          actions: ["EVM_SWAP_TOKENS"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Convert 50% of my ETH to DAI on Base",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "✅ Successfully swapped 0.5 ETH for DAI on base\nTransaction Hash: 0xdef...123",
          actions: ["EVM_SWAP_TOKENS"],
        },
      },
    ],
  ],
  
  similes: ["TOKEN_SWAP", "EXCHANGE_TOKENS", "TRADE_TOKENS"],
};
