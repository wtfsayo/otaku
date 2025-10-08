# ElizaOS DeFiLlama Plugin Testing Guide

Simple testing guide for the ElizaOS DeFiLlama plugin with 20 test questions.

## Available Actions

The plugin provides 10 actions:
1. `PROTOCOL_DATA` - Protocol analysis and comparisons
2. `YIELD_SEARCH` - Yield opportunity discovery
3. `DEFI_RECOMMENDATIONS` - Investment recommendations
4. `CROSS_CHAIN_ANALYSIS` - Multi-chain comparisons
5. `MARKET_TRENDS` - Trending protocols and sectors
6. `RISK_ANALYSIS` - Protocol risk assessment
7. `HISTORICAL_DATA` - Time-series analysis
8. `FEE_VOLUME_DATA` - Revenue analysis
9. `PRICE_DATA` - Token price data
10. `STABLECOIN_ANALYSIS` - Stablecoin analysis

## Test Questions

1. **Protocol Data:** "Break down the lending category - show me protocol rankings and TVL distribution."

2. **Protocol Data:** "Analyze multichain protocols - which ones have significant presence on both Arbitrum and Optimism?"

3. **Price Data:** "Get prices for FRAX, CRV, and CVX with confidence scores."

4. **Stablecoin Analysis:** "Analyze peg stability for LUSD and FRAX - show price variance."

5. **Yield Search:** "Find stablecoin yields on Polygon above 10% APY with over $5M TVL."

6. **Cross-Chain Analysis:** "Find arbitrage opportunities when bridging assets from Ethereum to Polygon."

7. **Market Trends:** "Identify emerging protocols with significant growth trends in the last 30 days."

8. **Fees Volume:** "Analyze protocol fee revenue for DEXs - which are most profitable?"

9. **Historical Data:** "Show Curve's TVL growth patterns over 6 months compared to other DEXs."

10. **Risk Analysis:** "Assess security risks of protocols launched in the last year."

11. **Recommendations:** "Build me a risk-adjusted DeFi portfolio with 60% stable yields, 30% blue-chip protocols, 10% emerging opportunities."

12. **Yield Search:** "Find yields across Ethereum, Arbitrum, and Polygon for USDC filtering by APY >12%."

13. **Cross-Chain Analysis:** "Analyze yield efficiency after gas costs for migrating $25,000 from Ethereum to L2s."

14. **Fees Volume:** "Which protocols have the most sustainable fee models?"

15. **Recommendations:** "Based on current market trends, recommend a sector rotation strategy."

16. **Risk Analysis:** "Evaluate governance risks - which protocols have centralized vs decentralized control?"

17. **Risk Analysis:** "Assess smart contract maturity for lending protocols launched in the last 2 years."

18. **Historical Data:** "Analyze TVL volatility and maximum drawdowns for major lending protocols."

19. **Market Trends:** "Analyze correlations between different DeFi sectors during market changes."

20. **Historical Data:** "Compare how different protocols recovered from major market downturns."

## Success Criteria

- ✅ Correct action triggered by keywords
- ✅ Appropriate API data retrieved
- ✅ Clear, actionable insights provided
- ✅ Graceful error handling
- ✅ Fast response times
