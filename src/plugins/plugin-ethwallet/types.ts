export interface EVMWallet {
  privateKey: string;
  publicKey: string;
  address: string;
  chain: string;
  type: "generated" | "imported";
  createdAt: number;
}

export interface EVMMetaWallet {
  id: string;
  strategy?: string;
  wallets: Record<string, EVMWallet>; // keyed by chain name
  createdAt: number;
}

export interface WalletBalance {
  address: string;
  chain: string;
  nativeBalance: string; // in wei
  nativeBalanceFormatted: string; // in ETH/MATIC etc
  tokens?: TokenBalance[];
}

export interface TokenBalance {
  contractAddress: string;
  symbol: string;
  name: string;
  balance: string;
  balanceFormatted: string;
  decimals: number;
  price?: number;
  value?: number;
}

export interface WalletCreationResult {
  success: boolean;
  wallet?: EVMWallet;
  error?: string;
}

export interface ChainValidationResult {
  isValid: boolean;
  supportedChains: string[];
  error?: string;
}
