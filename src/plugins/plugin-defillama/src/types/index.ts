/**
 * DeFiLlama Plugin Type Definitions
 *
 * These interfaces define the data structures used throughout the plugin
 * for interacting with DeFiLlama API and managing DeFi data.
 */

// Protocol Data Types
export interface Protocol {
  id: string;
  name: string;
  address: string;
  symbol: string;
  url: string;
  description: string;
  chain: string;
  logo: string;
  audits: string;
  audit_note: string;
  gecko_id: string;
  cmcId: string;
  category: string;
  chains: string[];
  module: string;
  twitter: string;
  forkedFrom: string[];
  oracles: string[];
  listedAt: number;
  methodology: string;
  slug: string;
}

export interface ProtocolDetails extends Protocol {
  tvl: number;
  chainTvls: Record<string, number>;
  change_1h: number;
  change_1d: number;
  change_7d: number;
  tokenBreakdowns: Record<string, number>;
  mcap: number;
  tvlPrevDay: number;
  tvlPrevWeek: number;
  tvlPrevMonth: number;
}

// Yield Data Types
export interface YieldPool {
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number;
  apyBase: number;
  apyReward: number;
  rewardTokens: string[];
  pool: string;
  apyPct1D: number;
  apyPct7D: number;
  apyPct30D: number;
  stablecoin: boolean;
  ilRisk: string;
  exposure: string;
  predictions: {
    predictedClass: string;
    predictedProbability: number;
    binnedConfidence: number;
  };
  poolMeta?: string;
  url?: string;
  apyMean30d?: number;
  volumeUsd1d?: number;
  volumeUsd7d?: number;
  apyBaseInception?: number;
}

// Market Data Types
export interface TVLData {
  date: string;
  totalLiquidityUSD: number;
}

export interface Chain {
  gecko_id: string;
  tvl: number;
  tokenSymbol: string;
  cmcId: string;
  name: string;
  chainId: number;
}

export interface ChainTvl {
  [chain: string]: number;
}

export interface HistoricalData {
  date: number;
  totalLiquidityUSD: number;
}

export interface Bridge {
  id: number;
  name: string;
  displayName: string;
  icon: string;
  volumePrevDay: number;
  volumePrev2Day: number;
  lastHourlyVolume: number;
  currentDayVolume: number;
  lastDailyVolume: number;
  dayBeforeLastVolume: number;
  weeklyVolume: number;
  monthlyVolume: number;
  chains: string[];
}

export interface Stablecoin {
  id: string;
  name: string;
  symbol: string;
  gecko_id: string;
  pegType: string;
  pegMechanism: string;
  priceSource: string;
  circulating: Record<string, number>;
  circulatingPrevDay: Record<string, number>;
  circulatingPrevWeek: Record<string, number>;
  circulatingPrevMonth: Record<string, number>;
  chainCirculating: Record<string, Record<string, number>>;
  price: number;
}

// Service Types
export interface RateLimitStatus {
  remaining: number;
  resetTime: number;
  limit: number;
}

export interface APIRequest {
  endpoint: string;
  params?: Record<string, any>;
  priority: "high" | "medium" | "low";
}

// Configuration Types
export interface DefiLlamaConfig {
  apiBaseUrl: string;
  rateLimitPerMinute: number;
  maxConcurrentRequests: number;
  retryAttempts: number;
  retryDelay: number;
}

// Error Types
export interface DefiLlamaError {
  code: string;
  message: string;
  details?: any;
  suggestions?: string[];
  dataAge?: number;
  fallbackAvailable?: boolean;
}

// Filter Types for Actions
export interface YieldFilters {
  chains?: string[];
  minApy?: number;
  maxApy?: number;
  stablecoin?: boolean;
  ilRisk?: "yes" | "no" | "all";
  singleStaking?: boolean;
  minTvl?: number;
  project?: string;
  sortBy?: "apy" | "tvl" | "apyBase" | "apyReward";
  limit?: number;
}

export interface ProtocolFilters {
  chains?: string[];
  category?: string;
  minTvl?: number;
  sortBy?: "tvl" | "change_1d" | "change_7d" | "mcap";
  limit?: number;
}

export interface MarketTrendFilters {
  period?: "1d" | "7d" | "30d" | "90d" | "1y";
  sectors?: string[];
  chains?: string[];
  metric?: "tvl" | "volume" | "users" | "fees";
}

// Response Types
export interface ProtocolResponse {
  protocols: ProtocolDetails[];
  totalTvl: number;
  chains: ChainTvl;
  categories: Record<string, number>;
}

export interface YieldResponse {
  pools: YieldPool[];
  totalPools: number;
  avgApy: number;
  topApy: number;
}

export interface TrendAnalysis {
  period: string;
  trends: {
    metric: string;
    startValue: number;
    endValue: number;
    change: number;
    changePercent: number;
    trend: "up" | "down" | "stable";
  }[];
  topGainers: ProtocolDetails[];
  topLosers: ProtocolDetails[];
  sectorPerformance: Record<string, number>;
}

export interface CrossChainAnalysis {
  chains: {
    name: string;
    tvl: number;
    protocols: number;
    avgYield: number;
    topProtocol: string;
    dominance: number;
  }[];
  bridgeVolume: Record<string, number>;
  crossChainOpportunities: {
    fromChain: string;
    toChain: string;
    opportunity: string;
    potentialGain: number;
  }[];
}

// Additional types for new API endpoints

export interface DexVolume {
  id: string;
  name: string;
  displayName: string;
  total24h: number;
  total48hto24h?: number;
  total7d: number;
  total30d?: number;
  change_1d: number;
  change_7d: number;
  change_30d?: number;
  chains: string[];
  logo?: string;
  url?: string;
  methodology?: string;
}

export interface ProtocolFees {
  id: string;
  name: string;
  displayName: string;
  logo: string;
  category: string;
  total24h: number;
  total48hto24h: number;
  total7d: number;
  totalAllTime: number;
  change_1d: number;
  revenue24h?: number;
  dailyUserFees?: number;
  dailySupplySideRevenue?: number;
  dailyProtocolRevenue?: number;
  dailyHoldersRevenue?: number;
  chains: string[];
}

export interface CoinPrice {
  decimals: number;
  price: number;
  symbol: string;
  timestamp: number;
  confidence: number;
}

export interface HistoricalPrice {
  timestamp: number;
  price: number;
}

export interface YieldChartData {
  timestamp: number;
  tvlUsd: number;
  apy: number;
  apyBase: number;
  apyReward: number;
}

export interface VolumeData {
  [timestamp: string]: number;
}

export interface FeeData {
  [timestamp: string]: number;
}

// Market Trends Analysis Types
export interface TrendAnalysisRequirements {
  analysisScope: string;
  timeHorizon: string;
  focusAreas: string;
  trendIndicators: string;
  marketContext: string;
  riskAssessment: string;
  sentimentAnalysis: string;
  comparativeAnalysis: string;
  actionableInsights: string;
  detailLevel: string;
  analysisStrategy: string;
}

export interface SectorData {
  name: string;
  tvl: number;
  change1d: number;
  change7d: number;
  protocolCount: number;
  volatility: number;
  riskScore: number;
  opportunityScore: number;
  protocols: ProtocolDetails[];
}

export interface ChainPerformanceData {
  name: string;
  tvl: number;
  change7d: number;
  protocolCount: number;
  dominance: number;
  growthMomentum: number;
  ecosystemHealth: string;
  innovationScore: number;
}

export interface ProtocolTrendData {
  name: string;
  tvl: number;
  change1d: number;
  change7d: number;
  marketShare: number;
  trendStrength: number;
  riskLevel: string;
  innovationScore: number;
  chains: string[];
}

export interface MarketSentimentData {
  bullishness: number;
  trend: string;
  overall: string;
  score: number;
  distribution: {
    positive: number;
    negative: number;
    neutral: number;
  };
  momentumIndicators: {
    accelerating: number;
    decelerating: number;
  };
  volatilityLevel: string;
}

export interface MarketCorrelationData {
  correlations: Array<{
    sector1: string;
    sector2: string;
    correlation: number;
  }>;
  highCorrelations: Array<
    [
      string,
      {
        sector1: string;
        sector2: string;
        correlation: number;
      },
    ]
  >;
  diversificationOpportunities: Array<
    [
      string,
      {
        sector1: string;
        sector2: string;
        correlation: number;
      },
    ]
  >;
}

export interface ComprehensiveTrendData {
  sectors: SectorData[];
  chains: ChainPerformanceData[];
  protocols: ProtocolTrendData[];
  sentiment: MarketSentimentData;
  correlations: MarketCorrelationData;
  marketOverview: {
    totalTvl: number;
    activeProtocols: number;
    activeChains: number;
    marketCap: number;
  };
  timeframe: string;
  timestamp: number;
}

export interface TrendAnalysisResults {
  trendData: ComprehensiveTrendData;
  marketInsights: string[];
  sectorRotation: string[];
  emergingOpportunities: string[];
  riskFactors: string[];
  strategicRecommendations: string[];
  marketOverview: {
    totalTvl: number;
    activeProtocols: number;
    activeChains: number;
    marketCap: number;
  };
  topTrendingSectors: SectorData[];
  chainPerformance: ChainPerformanceData[];
  protocolHighlights: ProtocolTrendData[];
  sentimentAnalysis: MarketSentimentData;
  correlationInsights: MarketCorrelationData;
  strategicInsights: string;
  actionableRecommendations: string[];
  timestamp: number;
}

// Risk Analysis Types
export interface RiskAnalysisRequirements {
  analysisScope: string;
  riskCategories: string;
  assetFocus: string;
  timeHorizon: string;
  riskTolerance: string;
  contextualFactors: string;
  assessmentDepth: string;
  comparisonBenchmarks: string;
  actionableInsights: string;
  reportFormat: string;
  urgencyLevel: string;
}

export interface ProtocolRiskAssessment {
  name: string;
  riskLevel: string;
  riskScore: number;
  factors: string[];
  recommendation: string;
  tvl: number;
  category: string;
}

export interface YieldRiskAnalysis {
  protocol: string;
  pool: string;
  apy: number;
  riskScore: number;
  riskFactors: string[];
  tvl: number;
  impermanentLoss: boolean;
}

export interface RiskIntelligence {
  protocolAnalysis: ProtocolRiskData[];
  yieldAnalysis: YieldRiskData[];
  marketMetrics: Record<string, number>;
  riskFactors: string[];
}

export interface ProtocolRiskData {
  name: string;
  tvl: number;
  category: string;
  riskAssessment: {
    level: string;
    score: number;
    factors: string[];
    recommendation: string;
  };
}

export interface YieldRiskData {
  project: string;
  symbol: string;
  apy: number;
  tvlUsd: number;
  riskScore: number;
  riskFactors: string[];
  impermanentLoss: boolean;
}

export interface RiskAnalysisResults {
  overallRiskScores: {
    average: number;
    level: string;
    protocolCount: number;
  };
  protocolAssessments: ProtocolRiskAssessment[];
  yieldRiskAnalysis: YieldRiskAnalysis[];
  redFlags: string[];
  mitigationStrategies: string[];
  recommendations: string[];
}

// Historical Data Analysis Types
export interface HistoricalAnalysisRequirements {
  analysisType: string;
  targetEntities: string;
  timescalePreference: string;
  metricsFocus: string;
  contextualFactors: string;
  comparisonBenchmarks: string;
  trendIdentification: string;
  reportingFormat: string;
  actionableInsights: string;
  detailLevel: string;
  urgencyLevel: string;
}

export interface ProtocolTrends {
  trend: string;
  totalChange: number;
  avgValue: number;
  volatility: number;
  momentum: number;
  strength: string;
  timespan: number;
  supportLevel: number;
  resistanceLevel: number;
}

export interface HistoricalPatterns {
  cyclical: boolean;
  seasonal: boolean;
  correlations: string[];
  anomalies: string[];
}

export interface HistoricalAnalysisResults {
  protocolTrends: Record<string, ProtocolTrends>;
  marketPatterns: HistoricalPatterns;
  keyInsights: string[];
  performanceMetrics: Record<string, number>;
  marketOverview: {
    totalProtocols: number;
    totalTVL: number;
    topProtocols: ProtocolDetails[];
    chainDistribution: Chain[];
  };
}

// Price Data Analysis Types
export interface PriceAnalysisRequirements {
  queryType: string;
  assets: string;
  timeFrame: string;
  granularity: string;
  comparisonContext: string;
  useCase: string;
  formatPreference: string;
  currencyBase: string;
  additionalMetrics: string;
  urgency: string;
}

export interface TokenAnalysis {
  token: string;
  tokenName: string;
  symbol: string;
  decimals: number;
  confidence: number;
  currentPrice: CoinPrice;
  metrics: PriceMetrics;
  recommendations: string[];
}

export interface PriceMetrics {
  volatility: number;
  trend: string;
  support: number;
  resistance: number;
  volume: number;
}

export interface PriceDataResponse {
  current: Record<string, CoinPrice>;
  historical: Record<string, { prices: HistoricalPrice[] }>;
}

// Fees/Volume Analysis Types
export interface FeesVolumeRequirements {
  analysisType: string;
  assetFocus: string;
  chainFocus: string[];
  chains: string;
  timePeriod: string;
  timeFrame: string;
  optimizationGoal: string;
  efficiencyMetrics: string;
  protocolPreference: string;
  marketContext: string;
  comparisonScope: string;
  useCase: string;
  volumeThreshold: number;
  feeThreshold: number;
  comparisonMetric: string;
  usageContext: string;
  protocolInterest: string;
}

export interface ProcessedProtocolFee {
  name: string;
  daily_fees: number;
  daily_revenue: number;
  change_1d: number;
  category: string;
  chains: string[];
  efficiency: FeeEfficiency;
  sustainability: FeeSustainability;
}

export interface ProcessedDexVolume {
  name: string;
  volume_24h: number;
  change_1d: number;
  chains: string[];
  estimated_fees: number;
  market_share: number;
  liquidity_efficiency: LiquidityEfficiency;
}

export interface FeeEfficiency {
  fee_to_tvl_ratio: number;
  revenue_capture_rate: number;
  efficiency_score: number;
}

export interface FeeSustainability {
  level: string;
  factors: string[];
}

export interface LiquidityEfficiency {
  level: string;
  score: number;
  volatility: string;
}

export interface EfficiencyMetric {
  protocol: string;
  efficiency_score: number;
  fee_rate: number;
  volume_efficiency: number;
}

export interface ChainAnalysisData {
  total_fees: number;
  total_volume: number;
  fee_rate?: number;
  protocol_count: number;
}

export interface ProcessedFeesVolumeData {
  protocolFees: ProcessedProtocolFee[];
  dexVolumes: ProcessedDexVolume[];
  efficiencyMetrics: EfficiencyMetric[];
  chainAnalysis: Record<string, ChainAnalysisData>;
  totalDataPoints: number;
  metadata: {
    analysisType: string;
    timeFrame: string;
    focusedChains: string;
  };
}

// Stablecoin Analysis Types
export interface StablecoinAnalysisRequirements {
  analysisType: string;
  stablecoinFocus: string;
  pegStabilityFocus: string;
  chainAnalysis: string;
  timeHorizon: string;
  riskTolerance: string;
  liquidityRequirements: string;
  comparisonBenchmarks: string;
  useCase: string;
  reportingFormat: string;
  urgentInsights: string;
}

export interface StablecoinAssessment {
  name: string;
  symbol: string;
  marketCap: number;
  dominance: number;
  stabilityScore: number;
  riskLevel: string;
  pegStatus: PegStatusData;
  recommendation: string;
  yieldOpportunities: YieldOpportunityData[];
  chainDistribution: ChainDistributionData;
}

export interface PegStatusData {
  currentPrice: number;
  deviation: number;
  status: string;
  deviationSeverity: string;
}

export interface YieldOpportunityData {
  protocol: string;
  apy: number;
  risk: string;
  mechanism: string;
}

export interface ChainDistributionData {
  chains: Array<{ chain: string; amount: number }>;
  totalChains: number;
  concentrationRisk: string;
}

export interface StablecoinIntelligence {
  stablecoinAssessments: StablecoinRawAssessment[];
  marketMetrics: {
    totalMarketCap: number;
    stablecoinCount: number;
    majorStablecoins: number;
    dominanceConcentration: {
      level: string;
      top3: number;
      top5: number;
    };
    marketHealthScore: number;
  };
}

export interface StablecoinRawAssessment {
  name: string;
  symbol: string;
  marketCap: number;
  dominance: number;
  change24h: number;
  pegMechanism: string;
  stabilityAssessment: {
    stabilityScore: number;
    riskLevel: string;
    stabilityFactors: string[];
    riskFactors: string[];
    pegStatus: PegStatusData;
    recommendation: string;
  };
  yieldOpportunities: YieldOpportunityData[];
  chainDistribution: ChainDistributionData;
}

export interface StablecoinAnalysisResults {
  overallStabilityScores: {
    average: number;
    level: string;
    stablecoinCount: number;
    marketHealthScore: number;
  };
  stablecoinAssessments: StablecoinAssessment[];
  riskFactors: string[];
  recommendations: string[];
}
