export const Q_MARKETS = `
  query Markets($chainIds: [Int!], $first: Int!) {
    markets(
      first: $first
      orderBy: SupplyAssetsUsd
      orderDirection: Desc
      where: { chainId_in: $chainIds, whitelisted: true }
    ) {
      items {
        uniqueKey
        lltv
        loanAsset { address symbol decimals }
        collateralAsset { address symbol decimals }
        state { supplyAssetsUsd borrowAssetsUsd utilization liquidityAssetsUsd supplyApy borrowApy }
      }
    }
  }
`;

export const Q_VAULTS = `
  query Vaults($chainIds: [Int!], $first: Int!) {
    vaults(
      first: $first
      orderBy: TotalAssetsUsd
      orderDirection: Desc
      where: { chainId_in: $chainIds, whitelisted: true }
    ) {
      items {
        address
        name
        asset { address symbol decimals }
        state {
          totalAssets
          totalAssetsUsd
          totalSupply
          apy
          dailyApy
          weeklyApy
          monthlyApy
          yearlyApy
        }
      }
    }
  }
`;

export const Q_VAULT_BY_ADDRESS = `
  query OneVault($address: String!, $chainId: Int!) {
    vaultByAddress(address: $address, chainId: $chainId) {
      address
      name
      asset { address symbol decimals }
      state {
        totalAssets
        totalAssetsUsd
        totalSupply
        apy
        dailyApy
        weeklyApy
        monthlyApy
        yearlyApy
        allocation {
          supplyCap
          supplyAssets
          supplyAssetsUsd
          market { uniqueKey }
        }
      }
    }
  }
`;

export const Q_USER_MARKET_POSITIONS = `
  query UserPositions($chainId: Int!, $address: String!) {
    userByAddress(chainId: $chainId, address: $address) {
      marketPositions {
        market { uniqueKey }
      }
    }
  }
`;

export const Q_USER_VAULT_POSITIONS = `
  query UserVaultPositions($chainId: Int!, $address: String!) {
    userByAddress(chainId: $chainId, address: $address) {
      vaultPositions {
        vault {
          address
          name
          asset { address symbol decimals }
          state { dailyApy weeklyApy monthlyApy yearlyApy }
        }
        shares
        assets
      }
    }
  }
`;

export const Q_MARKET_SUMMARY = `
  query MarketSummary($uniqueKey: String!, $chainId: Int!) {
    marketByUniqueKey(uniqueKey: $uniqueKey, chainId: $chainId) {
      uniqueKey
      lltv
      loanAsset { address symbol decimals }
      collateralAsset { address symbol decimals }
      state {
        utilization
        supplyAssetsUsd
        borrowAssetsUsd
        liquidityAssetsUsd
        supplyApy
        borrowApy
      }
    }
  }
`;
