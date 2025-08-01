// import { logger } from '@elizaos/core';
// import BigNumber from 'bignumber.js';
// import { MorphoMarketData, RateComparison } from '../types';

// export interface GasEstimation {
//     baseGas: BigNumber;
//     matchingGas: BigNumber;
//     totalGas: BigNumber;
//     recommendedGas: BigNumber;
//     estimatedCost: BigNumber;
//     worthMatching: boolean;
// }

// export interface MatchingGasRecommendation {
//     minGas: BigNumber;
//     optimalGas: BigNumber;
//     maxGas: BigNumber;
//     expectedMatchingRatio: number;
//     costBenefitRatio: number;
// }

// export class GasOptimizer {
//     // Base gas costs for different operations (in gas units)
//     private static readonly BASE_GAS = {
//         supply: new BigNumber(150000),
//         borrow: new BigNumber(200000),
//         withdraw: new BigNumber(180000),
//         repay: new BigNumber(160000)
//     };

//     // Gas per matching iteration
//     private static readonly GAS_PER_MATCH = new BigNumber(50000);
    
//     // Maximum iterations for matching
//     private static readonly MAX_MATCHING_ITERATIONS = 10;

//     static estimateGas(
//         operation: 'supply' | 'borrow' | 'withdraw' | 'repay',
//         amount: BigNumber,
//         marketData: MorphoMarketData,
//         gasPrice: BigNumber
//     ): GasEstimation {
//         const baseGas = this.BASE_GAS[operation];
        
//         // Estimate matching gas based on market conditions
//         const matchingGas = this.estimateMatchingGas(
//             amount,
//             marketData,
//             operation === 'supply' || operation === 'borrow'
//         );
        
//         const totalGas = baseGas.plus(matchingGas);
//         const recommendedGas = this.getRecommendedGas(totalGas, marketData);
//         const estimatedCost = recommendedGas.times(gasPrice);
        
//         // Determine if matching is worth it
//         const worthMatching = this.isMatchingWorthIt(
//             operation,
//             amount,
//             matchingGas,
//             estimatedCost,
//             marketData
//         );
        
//         return {
//             baseGas,
//             matchingGas,
//             totalGas,
//             recommendedGas,
//             estimatedCost,
//             worthMatching
//         };
//     }

//     static getMatchingRecommendation(
//         operation: 'supply' | 'borrow',
//         amount: BigNumber,
//         marketData: MorphoMarketData,
//         rateComparison: RateComparison,
//         gasPrice: BigNumber
//     ): MatchingGasRecommendation {
//         // Calculate gas recommendations based on market efficiency
//         const liquidityDepth = operation === 'supply' 
//             ? marketData.totalSupply 
//             : marketData.totalBorrow;
        
//         const amountRatio = amount.div(liquidityDepth).toNumber();
//         const currentMatchingRatio = operation === 'supply'
//             ? marketData.supplyMatchingRatio
//             : marketData.borrowMatchingRatio;
        
//         // Estimate iterations needed
//         const estimatedIterations = this.estimateIterationsNeeded(
//             amountRatio,
//             currentMatchingRatio
//         );
        
//         // Calculate gas recommendations
//         const minGas = this.GAS_PER_MATCH.times(Math.max(1, estimatedIterations * 0.5));
//         const optimalGas = this.GAS_PER_MATCH.times(estimatedIterations);
//         const maxGas = this.GAS_PER_MATCH.times(Math.min(estimatedIterations * 1.5, this.MAX_MATCHING_ITERATIONS));
        
//         // Expected matching ratio with optimal gas
//         const expectedMatchingRatio = Math.min(
//             currentMatchingRatio + (amountRatio * 0.1),
//             0.95
//         );
        
//         // Calculate cost-benefit ratio
//         const rateImprovement = operation === 'supply'
//             ? rateComparison.supplyImprovement
//             : rateComparison.borrowImprovement;
        
//         const annualBenefit = amount.times(rateImprovement / 100);
//         const gasCost = optimalGas.times(gasPrice);
//         const costBenefitRatio = annualBenefit.div(gasCost).toNumber();
        
//         return {
//             minGas,
//             optimalGas,
//             maxGas,
//             expectedMatchingRatio,
//             costBenefitRatio
//         };
//     }

//     static adjustGasForNetworkConditions(
//         baseGas: BigNumber,
//         networkCongestion: 'low' | 'medium' | 'high'
//     ): BigNumber {
//         const multipliers = {
//             low: 1.0,
//             medium: 1.2,
//             high: 1.5
//         };
        
//         return baseGas.times(multipliers[networkCongestion]);
//     }

//     static validateGasLimit(gasLimit: BigNumber, operation: string): boolean {
//         const maxGasLimit = new BigNumber(5000000); // 5M gas max
//         const minGasLimit = this.BASE_GAS[operation as keyof typeof this.BASE_GAS] || new BigNumber(100000);
        
//         if (gasLimit.gt(maxGasLimit)) {
//             logger.warn(`Gas limit ${gasLimit.toString()} exceeds maximum ${maxGasLimit.toString()}`);
//             return false;
//         }
        
//         if (gasLimit.lt(minGasLimit)) {
//             logger.warn(`Gas limit ${gasLimit.toString()} below minimum ${minGasLimit.toString()}`);
//             return false;
//         }
        
//         return true;
//     }

//     static analyzeGasUsage(
//         actualGasUsed: BigNumber,
//         estimatedGas: BigNumber,
//         matchingAchieved: number
//     ): {
//         efficiency: number;
//         overUnderEstimate: number;
//         recommendation: string;
//     } {
//         const efficiency = estimatedGas.gt(0) 
//             ? actualGasUsed.div(estimatedGas).toNumber() 
//             : 0;
        
//         const overUnderEstimate = actualGasUsed.minus(estimatedGas).div(estimatedGas).times(100).toNumber();
        
//         let recommendation = '';
//         if (efficiency > 1.2) {
//             recommendation = 'Gas limit was too low, increase for better matching';
//         } else if (efficiency < 0.5) {
//             recommendation = 'Gas limit was too high, reduce to save costs';
//         } else if (matchingAchieved < 0.3 && efficiency > 0.8) {
//             recommendation = 'Low matching despite gas usage, try different timing';
//         } else {
//             recommendation = 'Gas usage was optimal';
//         }
        
//         return {
//             efficiency,
//             overUnderEstimate,
//             recommendation
//         };
//     }

//     // Private helper methods
//     private static estimateMatchingGas(
//         amount: BigNumber,
//         marketData: MorphoMarketData,
//         isSupplyOrBorrow: boolean
//     ): BigNumber {
//         if (!isSupplyOrBorrow) {
//             // Withdraw/repay operations have simpler matching
//             return this.GAS_PER_MATCH.times(2);
//         }
        
//         // Estimate based on market liquidity and current matching
//         const totalLiquidity = marketData.totalSupply.plus(marketData.totalBorrow);
//         const amountRatio = amount.div(totalLiquidity).toNumber();
        
//         // More iterations needed for larger amounts relative to liquidity
//         let estimatedIterations = 3; // Base iterations
//         if (amountRatio > 0.1) estimatedIterations = 5;
//         if (amountRatio > 0.2) estimatedIterations = 7;
//         if (amountRatio > 0.5) estimatedIterations = 10;
        
//         // Adjust based on current matching efficiency
//         const avgMatchingRatio = (marketData.supplyMatchingRatio + marketData.borrowMatchingRatio) / 2;
//         if (avgMatchingRatio < 0.3) {
//             estimatedIterations = Math.ceil(estimatedIterations * 1.5);
//         }
        
//         return this.GAS_PER_MATCH.times(Math.min(estimatedIterations, this.MAX_MATCHING_ITERATIONS));
//     }

//     private static getRecommendedGas(totalGas: BigNumber, marketData: MorphoMarketData): BigNumber {
//         // Add buffer based on market volatility
//         const utilizationRate = marketData.utilizationRate;
//         let buffer = 1.1; // 10% buffer default
        
//         if (utilizationRate > 0.9) buffer = 1.3; // High utilization = more buffer
//         else if (utilizationRate > 0.7) buffer = 1.2;
        
//         return totalGas.times(buffer).integerValue(BigNumber.ROUND_UP);
//     }

//     private static isMatchingWorthIt(
//         operation: string,
//         amount: BigNumber,
//         matchingGas: BigNumber,
//         gasCost: BigNumber,
//         marketData: MorphoMarketData
//     ): boolean {
//         // Simple heuristic: matching is worth it if potential savings > gas cost
//         const rateImprovement = operation === 'supply' || operation === 'borrow' ? 0.02 : 0.01; // 2% or 1%
//         const potentialSavings = amount.times(rateImprovement);
        
//         // Consider time value - annualize the gas cost
//         const annualizedGasCost = gasCost.times(365); // Rough approximation
        
//         return potentialSavings.gt(annualizedGasCost);
//     }

//     private static estimateIterationsNeeded(
//         amountRatio: number,
//         currentMatchingRatio: number
//     ): number {
//         // Base iterations on amount size and current market matching
//         let iterations = 3;
        
//         if (amountRatio > 0.05) iterations += 2;
//         if (amountRatio > 0.1) iterations += 2;
//         if (amountRatio > 0.2) iterations += 3;
        
//         // Adjust for poor current matching
//         if (currentMatchingRatio < 0.3) {
//             iterations = Math.ceil(iterations * 1.5);
//         }
        
//         return Math.min(iterations, this.MAX_MATCHING_ITERATIONS);
//     }
// }