import { Service, IAgentRuntime, logger } from "@elizaos/core";
import {
  createPublicClient,
  createWalletClient,
  http,
  WalletClient,
  type PublicClient,
  parseUnits,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { Market, AccrualPosition, MarketParams } from "@morpho-org/blue-sdk";
import { Time } from "@morpho-org/morpho-ts";
import BigNumber from "bignumber.js";
import "@morpho-org/blue-sdk-viem/lib/augment";
import { MarketId } from "@morpho-org/blue-sdk";
import {
  Q_MARKETS,
  Q_MARKET_SUMMARY,
  Q_USER_MARKET_POSITIONS,
  Q_USER_VAULT_POSITIONS,
  Q_VAULTS,
  Q_VAULT_BY_ADDRESS,
} from "./queries";

import {
  MorphoMarketData,
  MorphoPosition,
  MorphoVaultData,
  RateComparison,
  MarketSummary,
  UserPosition,
  UserVaultPosition,
} from "../types";
import { privateKeyToAccount } from "viem/accounts";

// ----------------------------
// Constants
// ----------------------------
const MORPHO_GQL = "https://api.morpho.org/graphql";
const MORPHO_ADDRESS = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"; // Morpho Blue address

export class MorphoService extends Service {
  static serviceType = "morpho";
  capabilityDescription = "";

  private publicClient: PublicClient | null = null;
  private network: "base" | "base-sepolia";

  private gql = new GqlClient(MORPHO_GQL);

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.network =
      (runtime.getSetting("MORPHO_NETWORK") as "base" | "base-sepolia") ||
      "base";
  }

  private chainObj() {
    return this.network === "base" ? base : baseSepolia;
  }
  private getChainId(): number {
    return this.network === "base" ? 8453 : 84532;
  }
  public getChainSlug(): "base" | "base-sepolia" {
    return this.network;
  }

  private ensurePublicClient(): PublicClient {
    if (!this.publicClient) throw new Error("Service not initialized");
    return this.publicClient;
  }

  private createWalletClient(walletPrivateKey: string): WalletClient {
    const rpcUrl =
      this.runtime.getSetting("BASE_RPC_URL") || "https://mainnet.base.org";
    const account = privateKeyToAccount(walletPrivateKey as `0x${string}`);
    return createWalletClient({
      account,
      chain: this.chainObj(),
      transport: http(rpcUrl),
    });
  }

  async initialize(runtime: IAgentRuntime): Promise<void> {
    const rpcUrl =
      runtime.getSetting("BASE_RPC_URL") || "https://mainnet.base.org";
    this.publicClient = createPublicClient({
      chain: this.chainObj(),
      transport: http(rpcUrl),
    }) as PublicClient;

    const block = await this.publicClient.getBlockNumber();
    logger.info(`Connected to ${this.network} at block ${block}`);
  }

  static async start(runtime: IAgentRuntime): Promise<MorphoService> {
    const service = new MorphoService(runtime);
    await service.initialize(runtime);
    return service;
  }

  async stop(): Promise<void> {
    logger.info("Stopping service...");
  }

  /**
   * Get supply position info for a specific market (lending positions)
   */
  async getSupplyPositions(
    market: string,
    walletPrivateKey: string,
  ): Promise<{
    suppliedAssets: number;
    suppliedShares: number;
    withdrawableAssets: number;
    assetSymbol: string;
    marketId: string;
  }> {
    const pc = this.ensurePublicClient();
    const wallet = this.createWalletClient(walletPrivateKey);

    const address = wallet.account?.address;
    if (!address) throw new Error("Wallet account address is required");

    const marketId = await this.getMarketId(market);
    const marketParams = await MarketParams.fetch(marketId as MarketId, pc);

    // Get user's supply position
    const position = await AccrualPosition.fetch(
      address,
      marketId as MarketId,
      pc,
    );
    const supplyShares = (position as any).supplyShares ?? 0n;

    // Get asset decimals
    const loanDecimals = (await pc.readContract({
      address: marketParams.loanToken as `0x${string}`,
      abi: [
        {
          type: "function",
          name: "decimals",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "uint8" }],
        },
      ],
      functionName: "decimals",
    })) as number;

    // Get asset symbol
    const assetSymbol = (await pc.readContract({
      address: marketParams.loanToken as `0x${string}`,
      abi: [
        {
          type: "function",
          name: "symbol",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "string" }],
        },
      ],
      functionName: "symbol",
    })) as string;

    // Convert shares to assets (Note: this is simplified - in reality you'd use Market.convertToAssets)
    const suppliedAssetsBase = supplyShares;
    const suppliedAssets =
      Number(suppliedAssetsBase) / Math.pow(10, loanDecimals);
    const suppliedSharesFormatted =
      Number(supplyShares) / Math.pow(10, loanDecimals);

    // For simplicity, assume withdrawable = supplied (in practice, might be limited by market liquidity)
    const withdrawableAssets = suppliedAssets;

    return {
      suppliedAssets,
      suppliedShares: suppliedSharesFormatted,
      withdrawableAssets,
      assetSymbol,
      marketId,
    };
  }

  // ----------------------------
  // Market Operations
  // ----------------------------

  /**
   * Supply assets to a Morpho market to earn yield
   */
  public async supply(
    params: {
      market?: string;
      assets?: string | number | bigint;
      onBehalf?: `0x${string}`;
    } = {},
    walletPrivateKey: string,
  ): Promise<`0x${string}`[]> {
    console.log("--- MorphoService.supply: start ---");
    try {
      const wallet = this.createWalletClient(walletPrivateKey);
      const pc = this.ensurePublicClient();

      const onBehalf = params.onBehalf ?? wallet.account?.address;
      if (!onBehalf) throw new Error("Wallet account address is required");

      const cfg = {
        market: params.market ?? "",
        assets: params.assets ?? "1",
        onBehalf,
      };

      console.log("Network:", this.getChainSlug());
      console.log("Account:", wallet.account?.address);
      console.log("Input -> market:", cfg.market, "assets:", cfg.assets);

      const { requests, marketParams, assetsBase } =
        await this.buildSupplyTx(cfg);

      console.log("Prepared", requests.length, "request(s) for supply.");
      console.log("Market:", marketParams.loanToken);
      console.log("Assets to supply (base units):", assetsBase.toString());

      const hashes: `0x${string}`[] = [];
      for (let i = 0; i < requests.length; i++) {
        const req = requests[i];
        const label = `[${i + 1}/${requests.length}] ${String(req.functionName || "write")}`;
        console.log(`${label} -> sending...`);
        try {
          const hash = await wallet.writeContract({
            ...req,
            account: wallet.account,
          } as any);
          console.log(`${label} -> tx sent: ${hash}`);
          const receipt = await pc.waitForTransactionReceipt({
            hash,
            pollingInterval: 2_000,
            timeout: 120_000,
            confirmations: 2,
          });
          console.log(
            `${label} -> mined. blockNumber=${receipt.blockNumber} status=${receipt.status}`,
          );
          hashes.push(hash);
        } catch (txErr: any) {
          console.error(`${label} -> FAILED`);
          console.error(
            "Message:",
            txErr?.shortMessage || txErr?.message || txErr,
          );
          throw txErr;
        }
      }

      console.log("All supply transactions confirmed. Hashes:", hashes);
      return hashes;
    } catch (err: any) {
      console.error("supply failed:", err?.shortMessage || err?.message || err);
      throw err;
    } finally {
      console.log("--- MorphoService.supply: end ---");
    }
  }

  /**
   * Supply collateral to a Morpho market
   */
  public async supplyCollateral(
    params: {
      market?: string;
      assets?: string | number | bigint;
      onBehalf?: `0x${string}`;
    } = {},
    walletPrivateKey: string,
  ): Promise<`0x${string}`[]> {
    console.log("--- MorphoService.supplyCollateral: start ---");
    try {
      const wallet = this.createWalletClient(walletPrivateKey);
      const pc = this.ensurePublicClient();

      const onBehalf = params.onBehalf ?? wallet.account?.address;
      if (!onBehalf) throw new Error("Wallet account address is required");

      const cfg = {
        market: params.market ?? "",
        assets: params.assets ?? "1",
        onBehalf,
      };

      console.log("Network:", this.getChainSlug());
      console.log("Account:", wallet.account?.address);
      console.log("Input -> market:", cfg.market, "assets:", cfg.assets);

      const { requests, marketParams, assetsBase } =
        await this.buildSupplyCollateralTx(cfg);

      console.log(
        "Prepared",
        requests.length,
        "request(s) for supply collateral.",
      );
      console.log("Market collateral:", marketParams.collateralToken);
      console.log("Assets to supply (base units):", assetsBase.toString());

      const hashes: `0x${string}`[] = [];
      for (let i = 0; i < requests.length; i++) {
        const req = requests[i];
        const label = `[${i + 1}/${requests.length}] ${String(req.functionName || "write")}`;
        console.log(`${label} -> sending...`);
        try {
          const hash = await wallet.writeContract({
            ...req,
            account: wallet.account,
          } as any);
          console.log(`${label} -> tx sent: ${hash}`);
          const receipt = await pc.waitForTransactionReceipt({
            hash,
            pollingInterval: 2_000,
            timeout: 120_000,
            confirmations: 2,
          });
          console.log(
            `${label} -> mined. blockNumber=${receipt.blockNumber} status=${receipt.status}`,
          );
          hashes.push(hash);
        } catch (txErr: any) {
          console.error(`${label} -> FAILED`);
          console.error(
            "Message:",
            txErr?.shortMessage || txErr?.message || txErr,
          );
          throw txErr;
        }
      }

      console.log(
        "All supply collateral transactions confirmed. Hashes:",
        hashes,
      );
      return hashes;
    } catch (err: any) {
      console.error(
        "supplyCollateral failed:",
        err?.shortMessage || err?.message || err,
      );
      throw err;
    } finally {
      console.log("--- MorphoService.supplyCollateral: end ---");
    }
  }

  /**
   * Borrow assets from a Morpho market
   */
  public async borrow(
    params: {
      market?: string;
      assets?: string | number | bigint;
      receiver?: `0x${string}`;
      onBehalf?: `0x${string}`;
    } = {},
    walletPrivateKey: string,
  ): Promise<`0x${string}`[]> {
    console.log("--- MorphoService.borrow: start ---");
    try {
      const wallet = this.createWalletClient(walletPrivateKey);
      const pc = this.ensurePublicClient();

      const onBehalf = params.onBehalf ?? wallet.account?.address;
      const receiver = params.receiver ?? wallet.account?.address;
      if (!onBehalf) throw new Error("Wallet account address is required");
      if (!receiver) throw new Error("Receiver address is required");

      const cfg = {
        market: params.market ?? "",
        assets: params.assets ?? "1",
        receiver,
        onBehalf,
      };

      console.log("Network:", this.getChainSlug());
      console.log("Account:", wallet.account?.address);
      console.log("Input -> market:", cfg.market, "assets:", cfg.assets);

      const { requests, marketParams, assetsBase } =
        await this.buildBorrowTx(cfg);

      console.log("Prepared", requests.length, "request(s) for borrow.");
      console.log("Market loan token:", marketParams.loanToken);
      console.log("Assets to borrow (base units):", assetsBase.toString());

      const hashes: `0x${string}`[] = [];
      for (let i = 0; i < requests.length; i++) {
        const req = requests[i];
        const label = `[${i + 1}/${requests.length}] ${String(req.functionName || "write")}`;
        console.log(`${label} -> sending...`);
        try {
          const hash = await wallet.writeContract({
            ...req,
            account: wallet.account,
          } as any);
          console.log(`${label} -> tx sent: ${hash}`);
          const receipt = await pc.waitForTransactionReceipt({
            hash,
            pollingInterval: 2_000,
            timeout: 120_000,
            confirmations: 2,
          });
          console.log(
            `${label} -> mined. blockNumber=${receipt.blockNumber} status=${receipt.status}`,
          );
          hashes.push(hash);
        } catch (txErr: any) {
          console.error(`${label} -> FAILED`);
          console.error(
            "Message:",
            txErr?.shortMessage || txErr?.message || txErr,
          );
          throw txErr;
        }
      }

      console.log("All borrow transactions confirmed. Hashes:", hashes);
      return hashes;
    } catch (err: any) {
      console.error("borrow failed:", err?.shortMessage || err?.message || err);
      throw err;
    } finally {
      console.log("--- MorphoService.borrow: end ---");
    }
  }

  /**
   * Repay borrowed assets to a Morpho market
   */
  public async repay(
    params: {
      market?: string;
      assets?: string | number | bigint;
      shares?: string | number | bigint;
      onBehalf?: `0x${string}`;
      fullRepayment?: boolean;
    } = {},
    walletPrivateKey: string,
  ): Promise<`0x${string}`[]> {
    console.log("--- MorphoService.repay: start ---");
    try {
      const wallet = this.createWalletClient(walletPrivateKey);
      const pc = this.ensurePublicClient();

      const onBehalf = params.onBehalf ?? wallet.account?.address;
      if (!onBehalf) throw new Error("Wallet account address is required");

      const cfg = {
        market: params.market ?? "",
        assets: params.assets,
        shares: params.shares,
        onBehalf,
        fullRepayment: params.fullRepayment ?? false,
      };

      console.log("Network:", this.getChainSlug());
      console.log("Account:", wallet.account?.address);
      console.log(
        "Input -> market:",
        cfg.market,
        "assets:",
        cfg.assets,
        "shares:",
        cfg.shares,
        "fullRepayment:",
        cfg.fullRepayment,
      );

      const { requests, marketParams, assetsBase, sharesBase } =
        await this.buildRepayTx(cfg);

      console.log("Prepared", requests.length, "request(s) for repay.");
      console.log("Market loan token:", marketParams.loanToken);
      if (assetsBase)
        console.log("Assets to repay (base units):", assetsBase.toString());
      if (sharesBase)
        console.log("Shares to repay (base units):", sharesBase.toString());

      const hashes: `0x${string}`[] = [];
      for (let i = 0; i < requests.length; i++) {
        const req = requests[i];
        const label = `[${i + 1}/${requests.length}] ${String(req.functionName || "write")}`;
        console.log(`${label} -> sending...`);
        try {
          const hash = await wallet.writeContract({
            ...req,
            account: wallet.account,
          } as any);
          console.log(`${label} -> tx sent: ${hash}`);
          const receipt = await pc.waitForTransactionReceipt({
            hash,
            pollingInterval: 2_000,
            timeout: 120_000,
            confirmations: 2,
          });
          console.log(
            `${label} -> mined. blockNumber=${receipt.blockNumber} status=${receipt.status}`,
          );
          hashes.push(hash);
        } catch (txErr: any) {
          console.error(`${label} -> FAILED`);
          console.error(
            "Message:",
            txErr?.shortMessage || txErr?.message || txErr,
          );
          throw txErr;
        }
      }

      console.log("All repay transactions confirmed. Hashes:", hashes);
      return hashes;
    } catch (err: any) {
      console.error("repay failed:", err?.shortMessage || err?.message || err);
      throw err;
    } finally {
      console.log("--- MorphoService.repay: end ---");
    }
  }

  /**
   * Withdraw supplied assets from a Morpho market
   */
  public async withdraw(
    params: {
      market?: string;
      assets?: string | number | bigint;
      shares?: string | number | bigint;
      receiver?: `0x${string}`;
      onBehalf?: `0x${string}`;
    } = {},
    walletPrivateKey: string,
  ): Promise<`0x${string}`[]> {
    console.log("--- MorphoService.withdraw: start ---");
    try {
      const wallet = this.createWalletClient(walletPrivateKey);
      const pc = this.ensurePublicClient();

      const onBehalf = params.onBehalf ?? wallet.account?.address;
      const receiver = params.receiver ?? wallet.account?.address;
      if (!onBehalf) throw new Error("Wallet account address is required");
      if (!receiver) throw new Error("Receiver address is required");

      const cfg = {
        market: params.market ?? "",
        assets: params.assets,
        shares: params.shares,
        receiver,
        onBehalf,
      };

      console.log("Network:", this.getChainSlug());
      console.log("Account:", wallet.account?.address);
      console.log(
        "Input -> market:",
        cfg.market,
        "assets:",
        cfg.assets,
        "shares:",
        cfg.shares,
      );

      const { requests, marketParams, assetsBase, sharesBase } =
        await this.buildWithdrawTx(cfg);

      console.log("Prepared", requests.length, "request(s) for withdraw.");
      console.log("Market loan token:", marketParams.loanToken);
      if (assetsBase)
        console.log("Assets to withdraw (base units):", assetsBase.toString());
      if (sharesBase)
        console.log("Shares to withdraw (base units):", sharesBase.toString());

      const hashes: `0x${string}`[] = [];
      for (let i = 0; i < requests.length; i++) {
        const req = requests[i];
        const label = `[${i + 1}/${requests.length}] ${String(req.functionName || "write")}`;
        console.log(`${label} -> sending...`);
        try {
          const hash = await wallet.writeContract({
            ...req,
            account: wallet.account,
          } as any);
          console.log(`${label} -> tx sent: ${hash}`);
          const receipt = await pc.waitForTransactionReceipt({
            hash,
            pollingInterval: 2_000,
            timeout: 120_000,
            confirmations: 2,
          });
          console.log(
            `${label} -> mined. blockNumber=${receipt.blockNumber} status=${receipt.status}`,
          );
          hashes.push(hash);
        } catch (txErr: any) {
          console.error(`${label} -> FAILED`);
          console.error(
            "Message:",
            txErr?.shortMessage || txErr?.message || txErr,
          );
          throw txErr;
        }
      }

      console.log("All withdraw transactions confirmed. Hashes:", hashes);
      return hashes;
    } catch (err: any) {
      console.error(
        "withdraw failed:",
        err?.shortMessage || err?.message || err,
      );
      throw err;
    } finally {
      console.log("--- MorphoService.withdraw: end ---");
    }
  }

  /**
   * Withdraw collateral from a Morpho market
   */
  public async withdrawCollateral(
    params: {
      market?: string;
      assets?: string | number | bigint;
      receiver?: `0x${string}`;
      onBehalf?: `0x${string}`;
    } = {},
    walletPrivateKey: string,
  ): Promise<`0x${string}`[]> {
    console.log("--- MorphoService.withdrawCollateral: start ---");
    try {
      const wallet = this.createWalletClient(walletPrivateKey);
      const pc = this.ensurePublicClient();

      const onBehalf = params.onBehalf ?? wallet.account?.address;
      const receiver = params.receiver ?? wallet.account?.address;
      if (!onBehalf) throw new Error("Wallet account address is required");
      if (!receiver) throw new Error("Receiver address is required");

      const cfg = {
        market: params.market ?? "",
        assets: params.assets ?? "1",
        receiver,
        onBehalf,
      };

      console.log("Network:", this.getChainSlug());
      console.log("Account:", wallet.account?.address);
      console.log("Input -> market:", cfg.market, "assets:", cfg.assets);

      const { requests, marketParams, assetsBase } =
        await this.buildWithdrawCollateralTx(cfg);

      console.log(
        "Prepared",
        requests.length,
        "request(s) for withdraw collateral.",
      );
      console.log("Market collateral:", marketParams.collateralToken);
      console.log("Assets to withdraw (base units):", assetsBase.toString());

      const hashes: `0x${string}`[] = [];
      for (let i = 0; i < requests.length; i++) {
        const req = requests[i];
        const label = `[${i + 1}/${requests.length}] ${String(req.functionName || "write")}`;
        console.log(`${label} -> sending...`);
        try {
          const hash = await wallet.writeContract({
            ...req,
            account: wallet.account,
          } as any);
          console.log(`${label} -> tx sent: ${hash}`);
          const receipt = await pc.waitForTransactionReceipt({
            hash,
            pollingInterval: 2_000,
            timeout: 120_000,
            confirmations: 2,
          });
          console.log(
            `${label} -> mined. blockNumber=${receipt.blockNumber} status=${receipt.status}`,
          );
          hashes.push(hash);
        } catch (txErr: any) {
          console.error(`${label} -> FAILED`);
          console.error(
            "Message:",
            txErr?.shortMessage || txErr?.message || txErr,
          );
          throw txErr;
        }
      }

      console.log(
        "All withdraw collateral transactions confirmed. Hashes:",
        hashes,
      );
      return hashes;
    } catch (err: any) {
      console.error(
        "withdrawCollateral failed:",
        err?.shortMessage || err?.message || err,
      );
      throw err;
    } finally {
      console.log("--- MorphoService.withdrawCollateral: end ---");
    }
  }

  // ----------------------------
  // Transaction builders for market operations
  // ----------------------------

  public async buildSupplyTx(params: {
    market: string;
    assets: string | number | bigint;
    onBehalf: `0x${string}`;
  }): Promise<{
    requests: any[];
    marketParams: any;
    assetsBase: bigint;
  }> {
    const pc = this.ensurePublicClient();
    const marketId = await this.getMarketId(params.market);
    const marketParams = await MarketParams.fetch(marketId as MarketId, pc);

    const onBehalf = params.onBehalf;

    // Get loan asset decimals for the market
    const loanDecimals = (await pc.readContract({
      address: marketParams.loanToken as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "decimals",
    })) as number;

    const assetsBase = parseUnits(String(params.assets), loanDecimals);

    // Check allowance and approve if needed
    const currentAllowance = (await pc.readContract({
      address: marketParams.loanToken as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [onBehalf, MORPHO_ADDRESS],
    })) as bigint;

    const requests: any[] = [];

    if (currentAllowance < assetsBase) {
      console.log("🔧 Supply needs approval...");
      console.log("💰 Approving exact amount (no buffer)");
      const { request: approveReq } = await pc.simulateContract({
        address: marketParams.loanToken as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [MORPHO_ADDRESS, assetsBase],
        account: onBehalf,
      });
      requests.push(approveReq);

      // Add raw supply request WITHOUT simulation (approval needs to execute first)
      requests.push({
        address: MORPHO_ADDRESS,
        abi: MORPHO_ABI,
        functionName: "supply" as const,
        args: [marketParams, assetsBase, 0n, onBehalf, "0x"],
        account: onBehalf,
      });
      console.log("✅ Approval + raw supply requests added");
    } else {
      console.log("✅ Sufficient allowance for supply");
      // Only simulate when no approval needed
      const { request: supplyReq } = await pc.simulateContract({
        address: MORPHO_ADDRESS,
        abi: MORPHO_ABI,
        functionName: "supply",
        args: [marketParams, assetsBase, 0n, onBehalf, "0x"],
        account: onBehalf,
      });
      requests.push(supplyReq);
    }

    return { requests, marketParams, assetsBase };
  }

  public async buildSupplyCollateralTx(params: {
    market: string;
    assets: string | number | bigint;
    onBehalf: `0x${string}`;
  }): Promise<{
    requests: any[];
    marketParams: any;
    assetsBase: bigint;
  }> {
    const pc = this.ensurePublicClient();
    const marketId = await this.getMarketId(params.market);
    const marketParams = await MarketParams.fetch(marketId as MarketId, pc);

    const onBehalf = params.onBehalf;

    // Get collateral asset decimals
    const collateralDecimals = (await pc.readContract({
      address: marketParams.collateralToken as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "decimals",
    })) as number;

    const assetsBase = parseUnits(String(params.assets), collateralDecimals);

    // Check allowance and approve if needed
    const currentAllowance = (await pc.readContract({
      address: marketParams.collateralToken as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [onBehalf, MORPHO_ADDRESS],
    })) as bigint;

    const requests: any[] = [];

    if (currentAllowance < assetsBase) {
      console.log("🔧 SupplyCollateral needs approval...");
      console.log("💰 Approving exact amount (no buffer)");
      const { request: approveReq } = await pc.simulateContract({
        address: marketParams.collateralToken as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [MORPHO_ADDRESS, assetsBase],
        account: onBehalf,
      });
      requests.push(approveReq);

      // Add raw supplyCollateral request WITHOUT simulation
      requests.push({
        address: MORPHO_ADDRESS,
        abi: MORPHO_ABI,
        functionName: "supplyCollateral" as const,
        args: [marketParams, assetsBase, onBehalf, "0x"],
        account: onBehalf,
      });
      console.log("✅ Approval + raw supplyCollateral requests added");
    } else {
      console.log("✅ Sufficient allowance for supplyCollateral");
      // Only simulate when no approval needed
      const { request: supplyCollateralReq } = await pc.simulateContract({
        address: MORPHO_ADDRESS,
        abi: MORPHO_ABI,
        functionName: "supplyCollateral",
        args: [marketParams, assetsBase, onBehalf, "0x"],
        account: onBehalf,
      });
      requests.push(supplyCollateralReq);
    }

    return { requests, marketParams, assetsBase };
  }

  public async buildBorrowTx(params: {
    market: string;
    assets: string | number | bigint;
    receiver: `0x${string}`;
    onBehalf: `0x${string}`;
  }): Promise<{
    requests: any[];
    marketParams: any;
    assetsBase: bigint;
  }> {
    const pc = this.ensurePublicClient();
    const marketId = await this.getMarketId(params.market);
    const marketParams = await MarketParams.fetch(marketId as MarketId, pc);

    const onBehalf = params.onBehalf;
    const receiver = params.receiver;

    // Get loan asset decimals
    const loanDecimals = (await pc.readContract({
      address: marketParams.loanToken as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "decimals",
    })) as number;

    const assetsBase = parseUnits(String(params.assets), loanDecimals);

    const { request: borrowReq } = await pc.simulateContract({
      address: MORPHO_ADDRESS,
      abi: MORPHO_ABI,
      functionName: "borrow",
      args: [marketParams, assetsBase, 0n, onBehalf, receiver],
      account: onBehalf,
    });

    return { requests: [borrowReq], marketParams, assetsBase };
  }

  public async buildRepayTx(params: {
    market: string;
    assets?: string | number | bigint;
    shares?: string | number | bigint;
    onBehalf: `0x${string}`;
    fullRepayment?: boolean;
  }): Promise<{
    requests: any[];
    marketParams: any;
    assetsBase?: bigint;
    sharesBase?: bigint;
  }> {
    const pc = this.ensurePublicClient();
    const marketId = await this.getMarketId(params.market);
    const marketParams = await MarketParams.fetch(marketId as MarketId, pc);

    const onBehalf = params.onBehalf;

    const requests: any[] = [];
    let assetsBase: bigint | undefined;
    let sharesBase: bigint | undefined;

    if (params.fullRepayment) {
      // Get user's current borrow shares for full repayment
      const position = await AccrualPosition.fetch(
        onBehalf,
        marketId as MarketId,
        pc,
      );
      const borrowShares = (position as any).borrowShares ?? 0n;
      sharesBase = borrowShares;

      if (borrowShares > 0n) {
        // Get the expected assets needed for these shares
        const expectedAssets = (await pc.readContract({
          address: MORPHO_ADDRESS,
          abi: MORPHO_ABI,
          functionName: "expectedBorrowAssets",
          args: [marketParams, onBehalf],
        })) as bigint;

        // Approve the expected assets amount
        const currentAllowance = (await pc.readContract({
          address: marketParams.loanToken as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [onBehalf, MORPHO_ADDRESS],
        })) as bigint;

        if (currentAllowance < expectedAssets) {
          const { request: approveReq } = await pc.simulateContract({
            address: marketParams.loanToken as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [MORPHO_ADDRESS, expectedAssets],
            account: onBehalf,
          });
          requests.push(approveReq);
        }

        // Repay using shares (recommended for full repayment)
        const { request: repayReq } = await pc.simulateContract({
          address: MORPHO_ADDRESS,
          abi: MORPHO_ABI,
          functionName: "repay",
          args: [marketParams, 0n, sharesBase, onBehalf, "0x"],
          account: onBehalf,
        });
        requests.push(repayReq);
      }
    } else if (params.shares) {
      // Repay specific shares
      const loanDecimals = (await pc.readContract({
        address: marketParams.loanToken as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "decimals",
      })) as number;

      sharesBase = parseUnits(String(params.shares), loanDecimals);

      // Approve and repay
      const { request: repayReq } = await pc.simulateContract({
        address: MORPHO_ADDRESS,
        abi: MORPHO_ABI,
        functionName: "repay",
        args: [marketParams, 0n, sharesBase, onBehalf, "0x"],
        account: onBehalf,
      });
      requests.push(repayReq);
    } else if (params.assets) {
      // Repay specific assets
      const loanDecimals = (await pc.readContract({
        address: marketParams.loanToken as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "decimals",
      })) as number;

      assetsBase = parseUnits(String(params.assets), loanDecimals);

      // Check allowance and approve if needed
      const currentAllowance = (await pc.readContract({
        address: marketParams.loanToken as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [onBehalf, MORPHO_ADDRESS],
      })) as bigint;

      console.log(
        `🔍 Current allowance: ${Number(currentAllowance) / 1_000_000} USDC, needed: ${Number(assetsBase) / 1_000_000} USDC`,
      );

      if (currentAllowance < assetsBase) {
        console.log("🔧 Adding approval request...");
        console.log(
          `💰 Approving exactly ${Number(assetsBase) / 1_000_000} USDC (user-specified amount)`,
        );
        const { request: approveReq } = await pc.simulateContract({
          address: marketParams.loanToken as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [MORPHO_ADDRESS, assetsBase],
          account: onBehalf,
        });
        requests.push(approveReq);
        console.log("✅ Approval request added");

        // Add raw repay request WITHOUT simulation (approval needs to execute first)
        requests.push({
          address: MORPHO_ADDRESS,
          abi: MORPHO_ABI,
          functionName: "repay" as const,
          args: [marketParams, assetsBase, 0n, onBehalf, "0x"],
          account: onBehalf,
        });
        console.log("✅ Raw repay request added");
      } else {
        console.log("✅ Sufficient allowance, no approval needed");

        // Only simulate when no approval needed
        const { request: repayReq } = await pc.simulateContract({
          address: MORPHO_ADDRESS,
          abi: MORPHO_ABI,
          functionName: "repay",
          args: [marketParams, assetsBase, 0n, onBehalf, "0x"],
          account: onBehalf,
        });
        requests.push(repayReq);
      }
    } else {
      throw new Error(
        "Either assets, shares, or fullRepayment must be specified for repay",
      );
    }

    console.log(`🎯 Total requests built: ${requests.length}`);

    return { requests, marketParams, assetsBase, sharesBase };
  }

  public async buildWithdrawTx(params: {
    market: string;
    assets?: string | number | bigint;
    shares?: string | number | bigint;
    receiver: `0x${string}`;
    onBehalf: `0x${string}`;
  }): Promise<{
    requests: any[];
    marketParams: any;
    assetsBase?: bigint;
    sharesBase?: bigint;
  }> {
    const pc = this.ensurePublicClient();
    const marketId = await this.getMarketId(params.market);
    const marketParams = await MarketParams.fetch(marketId as MarketId, pc);

    const onBehalf = params.onBehalf;
    const receiver = params.receiver;

    let assetsBase: bigint | undefined;
    let sharesBase: bigint | undefined;

    if (params.assets) {
      const loanDecimals = (await pc.readContract({
        address: marketParams.loanToken as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "decimals",
      })) as number;

      assetsBase = parseUnits(String(params.assets), loanDecimals);

      const { request: withdrawReq } = await pc.simulateContract({
        address: MORPHO_ADDRESS,
        abi: MORPHO_ABI,
        functionName: "withdraw",
        args: [marketParams, assetsBase, 0n, onBehalf, receiver],
        account: onBehalf,
      });

      return { requests: [withdrawReq], marketParams, assetsBase };
    } else if (params.shares) {
      const loanDecimals = (await pc.readContract({
        address: marketParams.loanToken as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "decimals",
      })) as number;

      sharesBase = parseUnits(String(params.shares), loanDecimals);

      const { request: withdrawReq } = await pc.simulateContract({
        address: MORPHO_ADDRESS,
        abi: MORPHO_ABI,
        functionName: "withdraw",
        args: [marketParams, 0n, sharesBase, onBehalf, receiver],
        account: onBehalf,
      });

      return { requests: [withdrawReq], marketParams, sharesBase };
    } else {
      throw new Error("Either assets or shares must be specified for withdraw");
    }
  }

  public async buildWithdrawCollateralTx(params: {
    market: string;
    assets: string | number | bigint;
    receiver: `0x${string}`;
    onBehalf: `0x${string}`;
  }): Promise<{
    requests: any[];
    marketParams: any;
    assetsBase: bigint;
  }> {
    const pc = this.ensurePublicClient();
    const marketId = await this.getMarketId(params.market);
    const marketParams = await MarketParams.fetch(marketId as MarketId, pc);

    const onBehalf = params.onBehalf;
    const receiver = params.receiver;

    // Get collateral asset decimals
    const collateralDecimals = (await pc.readContract({
      address: marketParams.collateralToken as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "decimals",
    })) as number;

    const assetsBase = parseUnits(String(params.assets), collateralDecimals);

    const { request: withdrawCollateralReq } = await pc.simulateContract({
      address: MORPHO_ADDRESS,
      abi: MORPHO_ABI,
      functionName: "withdrawCollateral",
      args: [marketParams, assetsBase, onBehalf, receiver],
      account: onBehalf,
    });

    return { requests: [withdrawCollateralReq], marketParams, assetsBase };
  }

  // ----------------------------
  // Helper methods (original functionality needs to be added here)
  // ----------------------------

  private async getMarketId(input: string): Promise<string> {
    return isMarketId(input) ? input : this.resolveMarketIdFromPair(input);
  }

  private async resolveMarketIdFromPair(pair: string): Promise<string> {
    const parts = pair
      .split("/")
      .map((s) => s?.trim())
      .filter(Boolean);
    if (parts.length !== 2) {
      throw new Error(
        `Invalid pair "${pair}". Expected "Collateral/Loan", e.g. "cbBTC/USDC".`,
      );
    }
    const [collRaw, loanRaw] = parts;
    const chainId = this.getChainId();
    const markets = await this.fetchMarketsFromApi(chainId);

    const collIsAddr = isAddress(collRaw);
    const loanIsAddr = isAddress(loanRaw);
    const k = (s: string) => s.toLowerCase();

    const exact = markets.find((m: any) => {
      const c = m?.collateralAsset,
        l = m?.loanAsset;
      if (!c || !l) return false;
      const cAddr = (c.address ?? "").toLowerCase();
      const lAddr = (l.address ?? "").toLowerCase();
      const cSym = (c.symbol ?? "").toLowerCase();
      const lSym = (l.symbol ?? "").toLowerCase();
      const collOk = collIsAddr ? cAddr === k(collRaw) : cSym === k(collRaw);
      const loanOk = loanIsAddr ? lAddr === k(loanRaw) : lSym === k(loanRaw);
      return collOk && loanOk;
    });
    if (exact?.uniqueKey) return exact.uniqueKey;

    const relaxed = markets.find((m: any) => {
      const cSym = (m?.collateralAsset?.symbol ?? "").toLowerCase();
      const lSym = (m?.loanAsset?.symbol ?? "").toLowerCase();
      return cSym.includes(k(collRaw)) && lSym.includes(k(loanRaw));
    });
    if (relaxed?.uniqueKey) return relaxed.uniqueKey;

    throw new Error(
      `No whitelisted Morpho market found for "${pair}" on chainId ${chainId}.`,
    );
  }

  private async fetchMarketsFromApi(chainId: number): Promise<any[]> {
    const data = await this.gql.query<{ markets: { items: any[] } }>(
      Q_MARKETS,
      {
        chainIds: [chainId],
        first: 1000,
      },
    );
    const items = data?.markets?.items ?? [];
    return items;
  }

  private async fetchVaultsFromApi(chainId: number): Promise<any[]> {
    const data = await this.gql.query<{ vaults: { items: any[] } }>(Q_VAULTS, {
      chainIds: [chainId],
      first: 1000,
    });
    return data?.vaults?.items ?? [];
  }

  private async fetchPositionsFromApi(
    address: `0x${string}`,
    chainId: number,
  ): Promise<string[]> {
    const data = await this.gql.query<{
      userByAddress?: {
        marketPositions?: { market?: { uniqueKey?: string } }[];
      };
    }>(Q_USER_MARKET_POSITIONS, { chainId, address });
    const items = data?.userByAddress?.marketPositions ?? [];
    return items
      .map((p) => p?.market?.uniqueKey)
      .filter((x): x is string => typeof x === "string");
  }

  // ----------------------------
  // Mapping helpers
  // ----------------------------
  private mapMarketSummary(m: any): MarketSummary {
    return {
      marketId: m.uniqueKey,
      lltvPct: Number(m.lltv) / 1e16,
      totalSupplyUsd: m.state?.supplyAssetsUsd ?? 0,
      totalBorrowUsd: m.state?.borrowAssetsUsd ?? 0,
      totalLiquidityUsd: m.state?.liquidityAssetsUsd ?? 0,
      supplyRatePct: pct(m.state?.supplyApy ?? 0),
      borrowRatePct: pct(m.state?.borrowApy ?? 0),
      utilization: m.state?.utilization ?? 0,
      loanAsset: {
        address: m.loanAsset?.address ?? "0x",
        symbol: m.loanAsset?.symbol ?? "UNKNOWN",
        decimals: m.loanAsset?.decimals ?? 18,
      },
      collateralAsset: {
        address: m.collateralAsset?.address ?? "0x",
        symbol: m.collateralAsset?.symbol ?? "UNKNOWN",
        decimals: m.collateralAsset?.decimals ?? 18,
      },
    };
  }

  private mapVault(v: any): MorphoVaultData {
    const dec = Number(v?.asset?.decimals ?? 18);
    const totalAssets = fromBaseUnits(v?.state?.totalAssets ?? "0", dec);
    const totalSupply =
      v?.state?.totalSupply != null ? bn(v.state.totalSupply) : null;

    return {
      address: v?.address,
      name: v?.name ?? "UNKNOWN",
      asset: {
        address: v?.asset?.address ?? "0x",
        symbol: v?.asset?.symbol ?? "UNKNOWN",
        decimals: dec,
      },
      totalDepositsTokens: totalAssets,
      totalDepositsUsd:
        v?.state?.totalAssetsUsd != null ? bn(v.state.totalAssetsUsd) : null,
      totalSupplyShares: totalSupply,
      apy: {
        apy: typeof v?.state?.apy === "number" ? v.state.apy : null,
        daily: typeof v?.state?.dailyApy === "number" ? v.state.dailyApy : null,
        weekly:
          typeof v?.state?.weeklyApy === "number" ? v.state.weeklyApy : null,
        monthly:
          typeof v?.state?.monthlyApy === "number" ? v.state.monthlyApy : null,
        yearly:
          typeof v?.state?.yearlyApy === "number" ? v.state.yearlyApy : null,
      },
    };
  }

  private mapVaultAllocations(out: MorphoVaultData, v: any) {
    if (!v?.state?.allocation?.length) return out;
    const dec = out.asset.decimals;
    out.allocations = (v.state.allocation as any[]).map((a) => ({
      marketId: a?.market?.uniqueKey ?? "",
      supplyAssetsTokens: fromBaseUnits(a?.supplyAssets ?? "0", dec),
      supplyAssetsUsd:
        a?.supplyAssetsUsd != null ? bn(a.supplyAssetsUsd) : null,
      supplyCapTokens:
        a?.supplyCap != null ? fromBaseUnits(a.supplyCap, dec) : null,
    }));
    return out;
  }

  // ----------------------------
  // Resolvers
  // ----------------------------
  private async resolveVaultAddress(vault: string): Promise<`0x${string}`> {
    const q = vault.trim().toLowerCase();
    const chainId = this.getChainId();
    const items = await this.fetchVaultsFromApi(chainId);

    if (isAddress(q)) return q as `0x${string}`;

    const byNameExact = items.find(
      (v: any) => (v?.name ?? "").toLowerCase() === q,
    );
    if (byNameExact?.address) return byNameExact.address as `0x${string}`;

    const byNameContains = items.find((v: any) =>
      (v?.name ?? "").toLowerCase().includes(q),
    );
    if (byNameContains?.address) return byNameContains.address as `0x${string}`;

    throw new Error(
      `No whitelisted Morpho vault found for "${vault}" on chainId ${chainId}.`,
    );
  }

  // ----------------------------
  // Public API
  // ----------------------------
  async getMarketData(market?: string): Promise<MorphoMarketData[]> {
    this.ensurePublicClient();
    const out: MorphoMarketData[] = [];

    // Single market path: on-chain LIF + summary
    if (market) {
      try {
        const marketId = await this.getMarketId(market);
        const [summary, params] = await Promise.all([
          this.fetchMarketSummaryById(marketId),
          MarketParams.fetch(marketId as MarketId, this.publicClient!),
        ]);

        const symbol = `${summary.collateralAsset.symbol} / ${summary.loanAsset.symbol}`;
        const liquidationPenalty =
          (Number(params.liquidationIncentiveFactor) / 1e18 - 1) * 100;

        out.push({
          name: symbol,
          marketId,
          totalSupply: bn(summary.totalSupplyUsd),
          totalBorrow: bn(summary.totalBorrowUsd),
          supplyRate: summary.supplyRatePct,
          borrowRate: summary.borrowRatePct,
          utilizationRate: summary.utilization,
          liquidity: bn(summary.totalLiquidityUsd),
          decimals: summary.loanAsset.decimals,
          lltv: summary.lltvPct,
          liquidationPenalty,
        });
      } catch (err) {
        logger.warn(`Error fetching market ${market}: ${err}`);
      }
      return out;
    }

    // All markets path: single GraphQL call + inline filters
    try {
      const items = await this.fetchMarketsFromApi(this.getChainId());
      for (const m of items) {
        const cSym = (m?.collateralAsset?.symbol ?? "").trim();
        const lSym = (m?.loanAsset?.symbol ?? "").trim();
        if (
          !cSym ||
          !lSym ||
          cSym.toUpperCase() === "UNKNOWN" ||
          lSym.toUpperCase() === "UNKNOWN"
        )
          continue;

        const lltv = Number(m?.lltv ?? 0);
        if (!Number.isFinite(lltv) || lltv <= 0) continue;

        const size = Number(m?.state?.supplyAssetsUsd ?? 0);
        if (!Number.isFinite(size) || size < 25_000) continue;

        const borrowApy = Number(m?.state?.borrowApy ?? 0);
        if (!Number.isFinite(borrowApy) || borrowApy < 0) continue;
        if (borrowApy > 2.0 && size < 1_000_000) continue;

        const symbol = `${cSym} / ${lSym}`;
        const lltvPct = Number(m.lltv) / 1e16;
        const totalSupplyUsd = m?.state?.supplyAssetsUsd ?? 0;
        const totalBorrowUsd = m?.state?.borrowAssetsUsd ?? 0;
        const totalLiquidityUsd = m?.state?.liquidityAssetsUsd ?? 0;

        out.push({
          name: symbol,
          marketId: m.uniqueKey,
          totalSupply: bn(totalSupplyUsd),
          totalBorrow: bn(totalBorrowUsd),
          supplyRate: pct(m?.state?.supplyApy ?? 0),
          borrowRate: pct(m?.state?.borrowApy ?? 0),
          utilizationRate: m?.state?.utilization ?? 0,
          liquidity: bn(totalLiquidityUsd),
          decimals: m?.loanAsset?.decimals ?? 18,
          lltv: lltvPct,
          liquidationPenalty: NaN,
        });
      }
    } catch (err) {
      logger.warn(`Error fetching all markets: ${err}`);
    }
    return out;
  }

  async getUserPositions(
    walletPrivateKey: string,
    market?: string,
  ): Promise<UserPosition[]> {
    this.ensurePublicClient();
    const wallet = this.createWalletClient(walletPrivateKey);

    const address = wallet.account?.address;
    if (!address) throw new Error("Wallet account address is required");

    if (market?.trim()) {
      const marketId = await this.getMarketId(market);
      const result = await this.buildUserPosition(address, marketId);
      return [result];
    }

    const chainId = this.getChainId();
    const positions = await this.fetchPositionsFromApi(address, chainId);

    const BATCH_SIZE = 8;
    const results: UserPosition[] = [];

    for (let i = 0; i < positions.length; i += BATCH_SIZE) {
      const batch = positions.slice(i, i + BATCH_SIZE);
      const out = await Promise.all(
        batch.map((id) =>
          this.buildUserPosition(address, id).catch(() => null),
        ),
      );
      for (const r of out) if (r?.hasPosition) results.push(r);
    }

    return results;
  }

  public async getVaultData(vault?: string): Promise<MorphoVaultData[]> {
    this.ensurePublicClient();
    const chainId = this.getChainId();

    // Single vault
    if (vault?.trim()) {
      const address = await this.resolveVaultAddress(vault);
      const data = await this.gql.query<{ vaultByAddress?: any }>(
        Q_VAULT_BY_ADDRESS,
        {
          address,
          chainId,
        },
      );
      const v = data?.vaultByAddress;
      if (!v) return [];
      const out = this.mapVault(v);
      return [this.mapVaultAllocations(out, v)];
    }

    // All vaults
    const items = await this.fetchVaultsFromApi(chainId);
    return items.map(this.mapVault);
  }

  public async getUserVaultPositions(
    walletPrivateKey: string,
  ): Promise<UserVaultPosition[]> {
    const wallet = this.createWalletClient(walletPrivateKey);
    const address = wallet.account?.address;
    if (!address) throw new Error("Wallet account address is required");

    const data = await this.gql.query<{
      userByAddress?: { vaultPositions?: any[] };
    }>(Q_USER_VAULT_POSITIONS, { chainId: this.getChainId(), address });

    const raw = data?.userByAddress?.vaultPositions ?? [];
    return raw.map((vp: any) => ({
      vault: {
        address: vp?.vault?.address,
        name: vp?.vault?.name,
        asset: {
          address: vp?.vault?.asset?.address,
          symbol: vp?.vault?.asset?.symbol,
          decimals: vp?.vault?.asset?.decimals ?? 18,
        },
        state: {
          dailyApy: vp?.vault?.state?.dailyApy ?? null,
          weeklyApy: vp?.vault?.state?.weeklyApy ?? null,
          monthlyApy: vp?.vault?.state?.monthlyApy ?? null,
          yearlyApy: vp?.vault?.state?.yearlyApy ?? null,
        },
      },
      shares: String(vp?.shares ?? "0"),
      assets: String(vp?.assets ?? "0"),
    }));
  }

  public async getMarketSummary(market: string): Promise<MarketSummary> {
    const uniqueKey = await this.getMarketId(market);
    return this.fetchMarketSummaryById(uniqueKey);
  }

  private async fetchMarketSummaryById(
    uniqueKey: string,
  ): Promise<MarketSummary> {
    const data = await this.gql.query<{ marketByUniqueKey?: any }>(
      Q_MARKET_SUMMARY,
      {
        uniqueKey,
        chainId: this.getChainId(),
      },
    );
    const m = data?.marketByUniqueKey;
    if (!m)
      throw new Error(
        `Market ${uniqueKey} not found on chainId ${this.getChainId()}`,
      );
    return this.mapMarketSummary(m);
  }

  // ----------------------------
  // Pricing & positions
  // ----------------------------
  async fetchDexScreenerData(tokenAddress: string): Promise<{
    priceUsd: number;
    liquidityUsd: number;
    volumeUsd24h: number;
    marketCap: number;
  } | null> {
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      const response = await fetch(url);
      if (!response.ok) {
        logger.warn(`DEX Screener request failed: ${response.status}`);
        return null;
      }
      const data: any = await response.json();
      const p = data?.pairs?.[0];
      if (!p) return null;
      return {
        priceUsd: parseFloat(p.priceUsd || "0"),
        liquidityUsd: parseFloat(p.liquidity?.usd || "0"),
        volumeUsd24h: parseFloat(p.volume?.h24 || "0"),
        marketCap: parseFloat(p.fdv || "0"),
      };
    } catch (error) {
      logger.warn("Failed to fetch from DEX Screener:", error);
      return null;
    }
  }

  private async buildUserPosition(
    address: `0x${string}`,
    marketId: string,
  ): Promise<UserPosition> {
    const pc = this.ensurePublicClient();

    const raw = await AccrualPosition.fetch(address, marketId as MarketId, pc);
    const pos = raw.accrueInterest(Time.timestamp());

    const summary = await this.fetchMarketSummaryById(marketId);
    const collMeta = summary.collateralAsset;
    const loanMeta = summary.loanAsset;

    const collDecimals = Number(collMeta.decimals ?? 18);
    const loanDecimals = Number(loanMeta.decimals ?? 18);

    const borrowAssetsBase: bigint = (pos as any).borrowAssets ?? 0n;
    const collateralBase: bigint = (pos as any).collateral ?? 0n;

    const loanTokens = fromBaseUnits(borrowAssetsBase, loanDecimals);
    const collateralTokens = fromBaseUnits(collateralBase, collDecimals);

    const LLTV = summary.lltvPct / 100;

    let pLiqLoanPerColl: BigNumber | null = null;
    if (collateralTokens.gt(0) && LLTV > 0) {
      pLiqLoanPerColl = loanTokens.div(collateralTokens.times(LLTV));
    }

    const [loanPx, collPx] = await Promise.all([
      this.fetchDexScreenerData(loanMeta.address).catch(() => null),
      this.fetchDexScreenerData(collMeta.address).catch(() => null),
    ]);

    const loanUsdPx =
      loanPx?.priceUsd ?? (loanMeta.symbol.toUpperCase() === "USDC" ? 1 : null);
    const collUsdPx = collPx?.priceUsd ?? null;

    const loanUsd = loanUsdPx != null ? loanTokens.times(loanUsdPx) : null;
    const collUsd =
      collUsdPx != null ? collateralTokens.times(collUsdPx) : null;

    const pCurrLoanPerColl =
      loanUsdPx != null && collUsdPx != null
        ? bn(collUsdPx).div(loanUsdPx)
        : null;

    const ltvPct =
      pCurrLoanPerColl && collateralTokens.gt(0)
        ? loanTokens
            .div(collateralTokens.times(pCurrLoanPerColl))
            .times(100)
            .toNumber()
        : null;

    const dropToLiqPct =
      pLiqLoanPerColl && pCurrLoanPerColl
        ? pLiqLoanPerColl.div(pCurrLoanPerColl).minus(1).times(100).toNumber()
        : null;

    const borrowShares: bigint = (pos as any).borrowShares ?? 0n;
    const supplyShares: bigint = (pos as any).supplyShares ?? 0n;
    const collateralRaw: bigint = (pos as any).collateral ?? 0n;

    // Calculate supply information (lending position)
    const supplyAssetsBase: bigint = (pos as any).supplyAssets ?? 0n;
    const suppliedTokens = fromBaseUnits(supplyAssetsBase, loanDecimals);
    const suppliedUsd =
      loanUsdPx != null ? suppliedTokens.times(loanUsdPx) : null;

    // For simplicity, assume withdrawable = supplied (in practice, market liquidity may limit this)
    const withdrawableTokens = suppliedTokens;

    // Calculate earned interest (simplified - would need historical data for accurate calculation)
    const hasSupplied = supplyShares > 0n || suppliedTokens.gt(0);
    const earnedInterest = hasSupplied
      ? suppliedTokens.times(0.001).toString(10)
      : null; // Rough estimate

    const hasAmounts =
      collateralTokens.gt(0) || loanTokens.gt(0) || suppliedTokens.gt(0);
    const hasRaw = borrowShares > 0n || supplyShares > 0n || collateralRaw > 0n;
    const hasPosition = hasRaw || hasAmounts;

    return {
      marketId,
      pairLabel: `${collMeta.symbol}/${loanMeta.symbol}`,
      symbols: { collateral: collMeta.symbol, loan: loanMeta.symbol },
      decimals: { collateral: collDecimals, loan: loanDecimals },
      amounts: {
        collateralTokens: collateralTokens.toString(10),
        loanTokens: loanTokens.toString(10),
        collateralUsd: collUsd ? collUsd.toString(10) : null,
        loanUsd: loanUsd ? loanUsd.toString(10) : null,
        // Supply (lending) amounts
        suppliedTokens: suppliedTokens.toString(10),
        suppliedUsd: suppliedUsd ? suppliedUsd.toString(10) : null,
        withdrawableTokens: withdrawableTokens.toString(10),
      },
      shares: {
        borrowShares: borrowShares.toString(),
        supplyShares: supplyShares.toString(),
      },
      prices: {
        collateralUsd: collUsdPx,
        loanUsd: loanUsdPx,
        liquidationLoanPerCollateral: pLiqLoanPerColl
          ? pLiqLoanPerColl.toString(10)
          : null,
        currentLoanPerCollateral: pCurrLoanPerColl
          ? pCurrLoanPerColl.toString(10)
          : null,
      },
      risk: {
        lltvPct: summary.lltvPct,
        ltvPct,
        dropToLiquidationPct: dropToLiqPct,
      },
      addresses: {
        collateral: collMeta.address as `0x${string}`,
        loan: loanMeta.address as `0x${string}`,
        user: address as `0x${string}`,
      },
      supply: {
        hasSupplied,
        earnedInterest,
        currentApy: hasSupplied ? summary.supplyRatePct : null,
      },
      hasPosition,
    };
  }

  private async readVaultMeta(vaultAddr: `0x${string}`): Promise<{
    asset: `0x${string}`;
    assetDecimals: number;
    shareDecimals: number;
  }> {
    const pc = this.ensurePublicClient();
    const [asset, shareDecimals] = await Promise.all([
      pc.readContract({
        address: vaultAddr,
        abi: ERC4626_ABI,
        functionName: "asset",
      }) as Promise<`0x${string}`>,
      pc.readContract({
        address: vaultAddr,
        abi: ERC4626_ABI,
        functionName: "decimals",
      }) as Promise<number>,
    ]);

    // Try to use your GraphQL decimals first (you often have them), otherwise read ERC20.decimals
    let assetDecimals: number;
    try {
      assetDecimals = Number(
        await pc.readContract({
          address: asset,
          abi: [
            {
              type: "function",
              name: "decimals",
              stateMutability: "view",
              inputs: [],
              outputs: [{ type: "uint8" }],
            },
          ],
          functionName: "decimals",
        }),
      );
    } catch {
      // Fallback to 18, but on Base USDC is 6 — best effort only
      assetDecimals = 18;
    }

    return { asset, assetDecimals, shareDecimals };
  }

  public async depositToVault(
    params: {
      vault?: string;
      assets?: string | number | bigint;
      approveAmount?: "exact" | "max";
      receiver?: `0x${string}`;
    } = {},
    walletPrivateKey: string,
  ): Promise<`0x${string}`[]> {
    console.log("--- MorphoService.depositToVault: start ---");
    try {
      const wallet = this.createWalletClient(walletPrivateKey);
      const pc = this.ensurePublicClient();

      const receiver = params.receiver ?? wallet.account?.address;
      if (!receiver) throw new Error("Wallet account address is required");

      const cfg = {
        vault: params.vault ?? "",
        assets: params.assets ?? "1",
        approveAmount: params.approveAmount ?? ("max" as const),
        receiver,
      };

      console.log("Network:", this.getChainSlug());
      console.log("Account:", wallet.account?.address);
      console.log(
        "Input -> vault:",
        cfg.vault,
        "assets:",
        cfg.assets,
        "approveAmount:",
        cfg.approveAmount,
      );

      const {
        requests,
        asset,
        vault,
        assetsBase,
        expectedShares,
        shareDecimals,
      } = await this.buildVaultDepositTx(cfg);

      console.log("Prepared", requests.length, "request(s).");
      console.log("Vault:", vault);
      console.log("Asset:", asset);
      console.log("Assets (base units):", assetsBase.toString());
      if (expectedShares !== undefined) {
        console.log(
          "Expected shares:",
          expectedShares.toString(),
          shareDecimals != null ? `(shareDecimals=${shareDecimals})` : "",
        );
      }

      const hashes: `0x${string}`[] = [];
      for (let i = 0; i < requests.length; i++) {
        const req = requests[i];
        const label = `[${i + 1}/${requests.length}] ${String(req.functionName || "write")}`;
        console.log(`${label} -> sending...`);
        try {
          const hash = await wallet.writeContract({
            ...req,
            account: wallet.account,
          } as any);
          console.log(`${label} -> tx sent: ${hash}`);
          const receipt = await pc.waitForTransactionReceipt({
            hash,
            pollingInterval: 2_000,
            timeout: 120_000,
            confirmations: 2,
          });
          console.log(
            `${label} -> mined. blockNumber=${receipt.blockNumber} status=${receipt.status}`,
          );
          hashes.push(hash);
        } catch (txErr: any) {
          console.error(`${label} -> FAILED`);
          console.error(
            "Message:",
            txErr?.shortMessage || txErr?.message || txErr,
          );
          if (txErr?.data?.message)
            console.error("Revert reason:", txErr.data.message);
          if (txErr?.cause) console.error("Cause:", txErr.cause);
          throw txErr;
        }
      }

      console.log("All transactions confirmed. Hashes:", hashes);
      return hashes;
    } catch (err: any) {
      console.error(
        "depositToVault failed:",
        err?.shortMessage || err?.message || err,
      );
      throw err;
    } finally {
      console.log("--- MorphoService.depositToVault: end ---");
    }
  }

  public async withdrawFromVault(
    params: {
      vault?: string;
      assets?: string | number | bigint;
      receiver?: `0x${string}`;
      owner?: `0x${string}`;
    } = {},
    walletPrivateKey: string,
  ): Promise<`0x${string}`[]> {
    console.log("--- MorphoService.withdrawFromVault: start ---");
    try {
      const wallet = this.createWalletClient(walletPrivateKey);
      const pc = this.ensurePublicClient();

      const walletAddress = wallet.account?.address;
      if (!walletAddress) throw new Error("Wallet account address is required");

      const cfg = {
        vault: params.vault ?? "",
        assets: params.assets ?? "1",
        receiver: params.receiver ?? walletAddress,
        owner: params.owner ?? walletAddress,
      };

      console.log("Network:", this.getChainSlug());
      console.log("Account:", wallet.account?.address);
      console.log("Input -> vault:", cfg.vault, "assets:", cfg.assets);

      const { requests, vault, assetsBase } =
        await this.buildVaultWithdrawTx(cfg);

      console.log("Prepared", requests.length, "request(s) for withdraw.");
      console.log("Vault:", vault);
      console.log("Assets to withdraw (base units):", assetsBase.toString());

      const hashes: `0x${string}`[] = [];
      for (let i = 0; i < requests.length; i++) {
        const req = requests[i];
        const label = `[${i + 1}/${requests.length}] ${String(req.functionName || "write")}`;
        console.log(`${label} -> sending...`);
        try {
          const hash = await wallet.writeContract({
            ...req,
            account: wallet.account,
          } as any);
          console.log(`${label} -> tx sent: ${hash}`);
          const receipt = await pc.waitForTransactionReceipt({
            hash,
            pollingInterval: 2_000,
            timeout: 120_000,
            confirmations: 2,
          });
          console.log(
            `${label} -> mined. blockNumber=${receipt.blockNumber} status=${receipt.status}`,
          );
          hashes.push(hash);
        } catch (txErr: any) {
          console.error(`${label} -> FAILED`);
          console.error(
            "Message:",
            txErr?.shortMessage || txErr?.message || txErr,
          );
          if (txErr?.data?.message)
            console.error("Revert reason:", txErr.data.message);
          if (txErr?.cause) console.error("Cause:", txErr.cause);
          throw txErr;
        }
      }

      console.log("All withdraw transactions confirmed. Hashes:", hashes);
      return hashes;
    } catch (err: any) {
      console.error(
        "withdrawFromVault failed:",
        err?.shortMessage || err?.message || err,
      );
      throw err;
    } finally {
      console.log("--- MorphoService.withdrawFromVault: end ---");
    }
  }

  public async buildVaultDepositTx(params: {
    vault: string;
    assets: string | number | bigint;
    receiver: `0x${string}`; // Make receiver required
    approveAmount?: "exact" | "max";
  }): Promise<{
    requests: any[];
    asset: `0x${string}`;
    vault: `0x${string}`;
    assetsBase: bigint;
    expectedShares?: bigint;
    shareDecimals?: number;
  }> {
    const pc = this.ensurePublicClient();

    const receiver = params.receiver;
    const vaultAddr = await this.resolveVaultAddress(params.vault);

    const { asset, assetDecimals, shareDecimals } =
      await this.readVaultMeta(vaultAddr);

    const assetsBase = parseUnits(String(params.assets), assetDecimals);

    const currentAllowance = (await pc.readContract({
      address: asset,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [receiver, vaultAddr],
    })) as bigint;

    const needsApproval = currentAllowance < assetsBase;
    const approveAmount =
      params.approveAmount === "max" ? 2n ** 256n - 1n : assetsBase;

    const requests: any[] = [];

    if (needsApproval) {
      const { request: approveReq } = await pc.simulateContract({
        address: asset,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [vaultAddr, approveAmount],
        account: receiver,
      });
      requests.push(approveReq);

      let expectedShares: bigint | undefined = undefined;
      try {
        expectedShares = (await pc.readContract({
          address: vaultAddr,
          abi: ERC4626_ABI,
          functionName: "previewDeposit",
          args: [assetsBase],
        })) as bigint;
      } catch {
        /* some vaults may not implement preview */
      }

      requests.push({
        address: vaultAddr,
        abi: ERC4626_ABI,
        functionName: "deposit" as const,
        args: [assetsBase, receiver],
        account: receiver,
      });

      return {
        requests,
        asset,
        vault: vaultAddr,
        assetsBase,
        expectedShares,
        shareDecimals,
      };
    }

    let expectedShares: bigint | undefined = undefined;
    try {
      expectedShares = (await pc.readContract({
        address: vaultAddr,
        abi: ERC4626_ABI,
        functionName: "previewDeposit",
        args: [assetsBase],
      })) as bigint;
    } catch {}

    const { request: depositReq } = await pc.simulateContract({
      address: vaultAddr,
      abi: ERC4626_ABI,
      functionName: "deposit",
      args: [assetsBase, receiver],
      account: receiver,
    });
    requests.push(depositReq);

    return {
      requests,
      asset,
      vault: vaultAddr,
      assetsBase,
      expectedShares,
      shareDecimals,
    };
  }

  public async buildVaultWithdrawTx(params: {
    vault: string;
    assets: string | number | bigint;
    receiver: `0x${string}`; // Make receiver required
    owner: `0x${string}`; // Make owner required
  }): Promise<{ requests: any[]; vault: `0x${string}`; assetsBase: bigint }> {
    const pc = this.ensurePublicClient();
    const chainId = this.getChainId();

    const receiver = params.receiver;
    const owner = params.owner;
    const vaultAddr = await this.resolveVaultAddress(params.vault);

    const data = await this.gql.query<{ vaultByAddress?: any }>(
      Q_VAULT_BY_ADDRESS,
      {
        address: vaultAddr,
        chainId,
      },
    );
    const v = data?.vaultByAddress;
    if (!v)
      throw new Error(`Vault ${params.vault} not found on chainId ${chainId}`);
    const decimals = Number(
      v.asset?.decimals ??
        (await pc.readContract({
          address: vaultAddr,
          abi: ERC4626_ABI,
          functionName: "decimals",
        })),
    );

    const assetsBase = parseUnits(String(params.assets), decimals);

    const { request } = await pc.simulateContract({
      address: vaultAddr,
      abi: ERC4626_ABI,
      functionName: "withdraw",
      args: [assetsBase, receiver, owner],
      account: owner,
    });

    return { requests: [request], vault: vaultAddr, assetsBase };
  }
}

const bn = (x: string | number | bigint) => new BigNumber(String(x));
const pow10 = (d: number) => new BigNumber(10).pow(d);
const fromBaseUnits = (x: string | number | bigint, decimals: number) =>
  bn(x).div(pow10(decimals));
const pct = (v: number) => v * 100;
const isAddress = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s.trim());
const isMarketId = (s: string) => /^0x[a-fA-F0-9]{64}$/.test(s.trim());

// ----------------------------
// GraphQL Client
// ----------------------------
class GqlClient {
  constructor(private url: string) {}
  async query<T>(query: string, variables: Record<string, any>): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`GQL ${res.status} ${res.statusText}: ${txt}`);
    }
    const json = (await res.json()) as any;
    if (json?.errors?.length) {
      throw new Error(`GQL errors: ${JSON.stringify(json.errors)}`);
    }
    return json.data as T;
  }
}

// --- Minimal ABIs ---
const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
];

const ERC4626_ABI = [
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "convertToShares",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "previewDeposit",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
];

// Morpho Blue ABI (minimal)
const MORPHO_ABI = [
  {
    type: "function",
    name: "supply",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "assets", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },

  {
    type: "function",
    name: "supplyCollateral",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "assets", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },

  {
    type: "function",
    name: "borrow",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "assets", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },

  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "assets", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },

  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "assets", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },

  {
    type: "function",
    name: "withdrawCollateral",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "assets", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "receiver", type: "address" },
    ],
    outputs: [],
  },

  {
    type: "function",
    name: "expectedBorrowAssets",
    stateMutability: "view",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
];
