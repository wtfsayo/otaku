import { Address, Hash, Hex } from "viem";
import {
  Service,
  Action,
  Provider,
  Evaluator,
  Memory,
  IAgentRuntime,
  Plugin,
} from "@elizaos/core";
import BigNumber from "bignumber.js";

// Type exports for better compatibility
export type { Address, Hash, Hex };
export { BigNumber };

/**
 * Morpho Supply Parameters
 */
export interface MorphoSupplyParams {
  asset: string;
  amount: BigNumber;
  maxGasForMatching: BigNumber;
  onBehalf?: string;
}

/**
 * Morpho Supply Result
 */
export interface MorphoSupplyResult {
  transactionHash: string;
  suppliedAmount: BigNumber;
  matchedAmount: BigNumber;
  poolAmount: BigNumber;
  improvedAPY: number;
  matchingEfficiency: number;
}

/**
 * Morpho Borrow Parameters
 */
export interface MorphoBorrowParams {
  asset: string;
  amount: BigNumber;
  maxGasForMatching: BigNumber;
  onBehalf?: string;
}

/**
 * Morpho Borrow Result
 */
export interface MorphoBorrowResult {
  transactionHash: string;
  borrowedAmount: BigNumber;
  matchedAmount: BigNumber;
  poolAmount: BigNumber;
  matchedRate: number;
  poolRate: number;
  rateImprovement: number;
}

/**
 * Morpho Withdraw Parameters
 */
export interface MorphoWithdrawParams {
  asset: string;
  amount: BigNumber;
  maxGasForMatching: BigNumber;
  receiver?: string;
}

/**
 * Morpho Withdraw Result
 */
export interface MorphoWithdrawResult {
  transactionHash: string;
  withdrawnAmount: BigNumber;
  matchingImpact: BigNumber;
  executionDetails: {
    fromMatched: BigNumber;
    fromPool: BigNumber;
    gasUsed: BigNumber;
  };
}

/**
 * Morpho Repay Parameters
 */
export interface MorphoRepayParams {
  asset: string;
  amount: BigNumber;
  maxGasForMatching: BigNumber;
  onBehalf?: string;
}

/**
 * Morpho Repay Result
 */
export interface MorphoRepayResult {
  transactionHash: string;
  repaidAmount: BigNumber;
  interestSaved: BigNumber;
  positionUpdate: {
    remainingDebt: BigNumber;
    newHealthFactor: number;
  };
}

/**
 * Morpho Position Data
 */
export interface MorphoPosition {
  totalSupplied: BigNumber;
  totalBorrowed: BigNumber;
  supplies: MorphoAssetPosition[];
  borrows: MorphoAssetPosition[];
  totalMatchedSupply: BigNumber;
  totalMatchedBorrow: BigNumber;
  matchingEfficiency: number;
  healthFactor: number;
}

/**
 * Individual Asset Position
 */
export interface MorphoAssetPosition {
  asset: string;
  symbol: string;
  totalAmount: BigNumber;
  matchedAmount: BigNumber;
  poolAmount: BigNumber;
  matchedAPY: number;
  poolAPY: number;
  averageAPY: number;
  matchingRatio: number;
  currentAPY?: number;
}

/**
 * Rate Comparison Data
 */
export interface RateComparison {
  asset: string;
  morphoSupplyAPY: number;
  morphoBorrowAPY: number;
  poolSupplyAPY: number;
  poolBorrowAPY: number;
  supplyImprovement: number;
  borrowImprovement: number;
  matchingPercentage: number;
  recommendedAction?: string;
}

/**
 * Morpho Market Data
 */
export interface MorphoMarketData {
  marketId?: string;
  name: string;
  totalSupply: BigNumber;
  totalBorrow: BigNumber;
  supplyRate: number;
  borrowRate: number;
  utilizationRate: number;
  liquidity: BigNumber;
  decimals: number;
  lltv: number;
  liquidationPenalty: number;
}

/**
 * Morpho Error Response
 */
export interface MorphoErrorResponse {
  code: string;
  message: string;
  details?: any;
  suggestions?: string[];
  matchingImpact?: MatchingImpact;
  fallbackOptions?: string[];
}

/**
 * Matching Impact Data
 */
export interface MatchingImpact {
  expectedMatching: number;
  actualMatching: number;
  gasUsed: BigNumber;
  rateImpact: number;
}

/**
 * Plugin Configuration
 */
export interface MorphoConfig {
  network: "base" | "base-sepolia";
  rpcUrl: string;
  morphoApiUrl?: string;
  defaultMaxGasForMatching: BigNumber;
  matchingEfficiencyThreshold: number;
  rateImprovementThreshold: number;
  maxGasPrice: BigNumber;
  retryAttempts: number;
  monitoringInterval: number;
}

/**
 * Transaction Options
 */
export interface TransactionOptions {
  gasLimit?: BigNumber;
  gasPrice?: BigNumber;
  maxFeePerGas?: BigNumber;
  maxPriorityFeePerGas?: BigNumber;
  nonce?: number;
}

/**
 * Service result types
 */
export type SupplyResult = MorphoSupplyResult;
export type BorrowResult = MorphoBorrowResult;
export type WithdrawResult = MorphoWithdrawResult;
export type RepayResult = MorphoRepayResult;

/**
 * Action parameter types
 */
export interface SupplyActionParams {
  asset: string;
  amount: string;
  maxGasForMatching?: string;
}

export interface BorrowActionParams {
  asset: string;
  amount: string;
  maxGasForMatching?: string;
}

export interface WithdrawActionParams {
  asset: string;
  amount: string;
  maxGasForMatching?: string;
}

export interface RepayActionParams {
  asset: string;
  amount: string;
  maxGasForMatching?: string;
}

/**
 * Error codes
 */
export enum MorphoErrorCode {
  INSUFFICIENT_COLLATERAL = "INSUFFICIENT_COLLATERAL",
  MATCHING_FAILED = "MATCHING_FAILED",
  POSITION_NOT_FOUND = "POSITION_NOT_FOUND",
  RATE_CALCULATION_ERROR = "RATE_CALCULATION_ERROR",
  LIQUIDITY_ERROR = "LIQUIDITY_ERROR",
  GAS_ESTIMATION_ERROR = "GAS_ESTIMATION_ERROR",
  TRANSACTION_FAILED = "TRANSACTION_FAILED",
  INVALID_PARAMETERS = "INVALID_PARAMETERS",
  NETWORK_ERROR = "NETWORK_ERROR",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

/**
 * Asset metadata
 */
export interface AssetMetadata {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
  isActive: boolean;
  canBeCollateral: boolean;
  canBeBorrowed: boolean;
}

/**
 * Morpho Vault Types
 */
export interface MorphoVault {
  address: string;
  name: string;
  symbol: string;
  asset: string;
  totalAssets: BigNumber;
  totalSupply: BigNumber;
  performanceFee: number;
  managementFee: number;
  curator: string;
  owner: string;
  pendingOwner?: string;
  guardian?: string;
  feeRecipient: string;
  skimRecipient: string;
  timelock: number;
  lastTotalAssets: BigNumber;
  supplyQueue: string[];
  withdrawQueue: string[];
  supplyQueueLength: number;
  withdrawQueueLength: number;
}

export interface VaultDepositParams {
  vault: string;
  assets: BigNumber;
  receiver?: string;
}

export interface VaultDepositResult {
  transactionHash: string;
  shares: BigNumber;
  assets: BigNumber;
  newBalance: BigNumber;
}

export interface VaultWithdrawParams {
  vault: string;
  shares?: BigNumber;
  assets?: BigNumber;
  receiver?: string;
  owner?: string;
}

export interface VaultWithdrawResult {
  transactionHash: string;
  shares: BigNumber;
  assets: BigNumber;
  newBalance: BigNumber;
}

/**
 * Bundler Types
 */
export interface BundleAction {
  target: string;
  callData: Hex;
  value?: BigNumber;
}

export interface BundleParams {
  actions: BundleAction[];
  revertOnFailure?: boolean;
}

export interface BundleResult {
  transactionHash: string;
  results: any[];
  gasUsed: BigNumber;
}

/**
 * Rewards Types
 */
export interface RewardsClaim {
  token: string;
  amount: BigNumber;
  proof: string[];
}

export interface RewardsClaimParams {
  claims: RewardsClaim[];
  receiver?: string;
}

export interface RewardsClaimResult {
  transactionHash: string;
  totalClaimed: BigNumber;
  claimedTokens: { token: string; amount: BigNumber }[];
}

export interface UserRewards {
  claimable: { token: string; amount: BigNumber }[];
  totalValue: BigNumber;
  lastUpdate: number;
}

/**
 * Liquidation Types
 */
export interface LiquidationAlert {
  userAddress: string;
  healthFactor: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  recommendedActions: string[];
  timeToLiquidation?: number;
}

export interface PreLiquidationParams {
  borrower: string;
  repayAsset: string;
  seizeAsset: string;
  repayAmount?: BigNumber;
}

/**
 * Oracle Types
 */
export interface PriceFeed {
  asset: string;
  price: BigNumber;
  decimals: number;
  updatedAt: number;
  source: string;
}

export interface HealthFactorData {
  healthFactor: number;
  liquidationThreshold: number;
  maxLtv: number;
  totalCollateralValue: BigNumber;
  totalDebtValue: BigNumber;
  availableBorrowingPower: BigNumber;
}

/**
 * Market Creation Types
 */
export interface MarketCreationParams {
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  lltv: BigNumber; // Loan-to-value ratio in basis points
}

export interface MarketCreationResult {
  marketId: Hex;
  transactionHash: string;
  market: {
    loanToken: string;
    collateralToken: string;
    oracle: string;
    irm: string;
    lltv: BigNumber;
  };
}

/**
 * Public Allocator Types
 */
export interface AllocationConfig {
  vault: string;
  marketId: Hex;
  maxIn: BigNumber;
  maxOut: BigNumber;
}

export interface ReallocateParams {
  vault: string;
  marketId: Hex;
  assets: BigNumber;
}

/**
 * Enhanced Action Parameter Types
 */
export interface VaultDepositActionParams {
  vault: string;
  amount: string;
  receiver?: string;
}

export interface VaultWithdrawActionParams {
  vault: string;
  amount: string;
  isShares?: boolean;
  receiver?: string;
}

export interface BundledSupplyBorrowParams {
  supplyAsset: string;
  supplyAmount: string;
  borrowAsset: string;
  borrowAmount: string;
  maxGasForMatching?: string;
}

export interface ClaimRewardsActionParams {
  tokens?: string[];
  receiver?: string;
}

export type MorphoApiMarket = {
  uniqueKey: string;
  lltv: string;
  oracleAddress: string;
  irmAddress: string;
  loanAsset: { address: string; symbol: string };
  collateralAsset: { address: string; symbol: string };
  tvlUsd?: number;
};

export type MarketSummary = {
  marketId: string;
  lltvPct: number;
  totalSupplyUsd: number;
  totalBorrowUsd: number;
  totalLiquidityUsd: number;
  supplyRatePct: number;
  borrowRatePct: number;
  utilization: number;
  loanAsset: { address: string; symbol: string; decimals: number };
  collateralAsset: { address: string; symbol: string; decimals: number };
};

export interface UserPosition {
  marketId: string;
  pairLabel: string;
  symbols: {
    collateral: string;
    loan: string;
  };
  decimals: {
    collateral: number;
    loan: number;
  };
  amounts: {
    collateralTokens: string;
    loanTokens: string;
    collateralUsd: string | null;
    loanUsd: string | null;
    // Supply (lending) amounts
    suppliedTokens: string;
    suppliedUsd: string | null;
    withdrawableTokens: string;
  };
  shares: {
    borrowShares: string;
    supplyShares: string;
  };
  prices: {
    collateralUsd: number | null;
    loanUsd: number | null;
    liquidationLoanPerCollateral: string | null;
    currentLoanPerCollateral: string | null;
  };
  risk: {
    lltvPct: number;
    ltvPct: number | null;
    dropToLiquidationPct: number | null;
  };
  addresses: {
    collateral: `0x${string}`;
    loan: `0x${string}`;
    user: `0x${string}`;
  };
  supply: {
    hasSupplied: boolean;
    earnedInterest: string | null;
    currentApy: number | null;
  };
  hasPosition: boolean;
}

export type UserVaultPosition = {
  vault: {
    address: `0x${string}`;
    name: string;
    asset: {
      address: `0x${string}`;
      symbol: string;
      decimals: number;
    };
    state: {
      dailyApy: number | null;
      weeklyApy: number | null;
      monthlyApy: number | null;
      yearlyApy: number | null;
    };
  };
  shares: string;
  assets: string;
};

export type MorphoVaultData = {
  address: `0x${string}`;
  name: string;
  asset: {
    address: `0x${string}`;
    symbol: string;
    decimals: number;
  };
  // Totals
  totalDepositsTokens: BigNumber; // state.totalAssets (normalized)
  totalDepositsUsd?: BigNumber | null; // state.totalAssetsUsd (if you want it)
  totalSupplyShares?: BigNumber | null; // state.totalSupply (vault shares)

  // APYs (decimals, e.g. 0.046 -> 4.6%)
  apy: {
    daily: number | null;
    weekly: number | null;
    monthly: number | null;
    yearly: number | null;
    apy?: number | null; // overall apy if you want to expose it
  };

  // Optional: per-allocation info (array of markets)
  allocations?: Array<{
    marketId: string;
    supplyAssetsTokens: BigNumber;
    supplyAssetsUsd?: BigNumber | null;
    supplyCapTokens?: BigNumber | null;
  }>;
};
