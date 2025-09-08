export interface EVMChainConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorer: string;
  isTestnet?: boolean;
}

export const SUPPORTED_EVM_CHAINS: Record<string, EVMChainConfig> = {
  ethereum: {
    name: "Ethereum",
    chainId: 1,
    rpcUrl: process.env.ETHEREUM_RPC_URL || "https://eth.llamarpc.com",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    blockExplorer: "https://etherscan.io",
  },
  base: {
    name: "Base",
    chainId: 8453,
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    blockExplorer: "https://basescan.org",
  },
  arbitrum: {
    name: "Arbitrum One",
    chainId: 42161,
    rpcUrl: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    blockExplorer: "https://arbiscan.io",
  },
  optimism: {
    name: "Optimism",
    chainId: 10,
    rpcUrl: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    blockExplorer: "https://optimistic.etherscan.io",
  },
  polygon: {
    name: "Polygon",
    chainId: 137,
    rpcUrl: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
    nativeCurrency: {
      name: "MATIC",
      symbol: "MATIC",
      decimals: 18,
    },
    blockExplorer: "https://polygonscan.com",
  },
  // Testnets
  sepolia: {
    name: "Sepolia",
    chainId: 11155111,
    rpcUrl: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
    nativeCurrency: {
      name: "Sepolia Ether",
      symbol: "ETH",
      decimals: 18,
    },
    blockExplorer: "https://sepolia.etherscan.io",
    isTestnet: true,
  },
};

export const DEFAULT_CHAIN = "base";

export function getChainConfig(chainName: string): EVMChainConfig | null {
  return SUPPORTED_EVM_CHAINS[chainName.toLowerCase()] || null;
}

export function getAllChainNames(): string[] {
  return Object.keys(SUPPORTED_EVM_CHAINS);
}

export function getMainnetChains(): string[] {
  return Object.keys(SUPPORTED_EVM_CHAINS).filter(
    (chain) => !SUPPORTED_EVM_CHAINS[chain].isTestnet,
  );
}
