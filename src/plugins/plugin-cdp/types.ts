/**
 * CDP Plugin Type Definitions
 */

/**
 * Mainnet networks supported by CDP for swaps
 * These are the networks that support the swap functionality
 */
export type CdpSwapNetwork = "base" | "ethereum" | "arbitrum" | "optimism";

/**
 * All networks supported by CDP
 * Includes both mainnet and testnet networks across various chains
 */
export type CdpNetwork = 
  | CdpSwapNetwork
  | "base-sepolia"
  | "ethereum-sepolia"
  | "ethereum-hoodi"
  | "polygon"
  | "polygon-mumbai"
  | "arbitrum-sepolia"
  | "optimism-sepolia";

/**
 * Networks supported for token transfers
 * Includes mainnet and testnet networks
 */
export type CdpTransferNetwork = 
  | "base"
  | "base-sepolia"
  | "ethereum"
  | "ethereum-sepolia"
  | "arbitrum"
  | "arbitrum-sepolia"
  | "optimism"
  | "optimism-sepolia"
  | "polygon";

