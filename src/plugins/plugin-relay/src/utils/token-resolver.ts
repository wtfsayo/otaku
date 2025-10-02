/**
 * Token resolver utilities for Relay plugin
 * Copied from CDP plugin's CoinGecko integration
 */

/**
 * Token metadata from CoinGecko
 */
export interface TokenMetadata {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  network: string;
}

/**
 * CoinGecko API response types
 */
interface CoinGeckoTokenResponse {
  symbol?: string;
  name?: string;
  platforms?: Record<string, string>;
  detail_platforms?: Record<string, { decimal_place?: number }>;
}

interface CoinGeckoSearchCoin {
  id: string;
  symbol: string;
  name: string;
}

interface CoinGeckoSearchResponse {
  coins?: CoinGeckoSearchCoin[];
}

interface CoinGeckoCoinDetailResponse {
  platforms?: Record<string, string>;
}

/**
 * CoinGecko platform IDs mapping
 * Maps chain names to CoinGecko platform identifiers
 */
const NETWORK_TO_PLATFORM: Record<string, string> = {
  "ethereum": "ethereum",
  "base": "base",
  "arbitrum": "arbitrum-one",
  "polygon": "polygon-pos",
  "optimism": "optimistic-ethereum",
  "zora": "zora-network",
  "blast": "blast",
  "scroll": "scroll",
  "linea": "linea",
};

/**
 * In-memory cache for token metadata to avoid rate limits
 * Cache key format: "network:address"
 */
const tokenCache = new Map<string, TokenMetadata>();

/**
 * Cache expiry time (5 minutes)
 */
const CACHE_TTL = 5 * 60 * 1000;
const cacheTimestamps = new Map<string, number>();

/**
 * Get CoinGecko platform ID from network name
 */
function getPlatformId(network: string): string {
  return NETWORK_TO_PLATFORM[network] || network;
}

/**
 * Get cache key for token
 */
function getCacheKey(network: string, address: string): string {
  return `${network}:${address.toLowerCase()}`;
}

/**
 * Check if cache entry is still valid
 */
function isCacheValid(key: string): boolean {
  const timestamp = cacheTimestamps.get(key);
  if (!timestamp) return false;
  return Date.now() - timestamp < CACHE_TTL;
}

/**
 * Fetch token metadata from CoinGecko API
 * 
 * @param address - Token contract address
 * @param network - Network name (e.g., "base", "ethereum")
 * @returns Token metadata or null if not found
 */
export async function getTokenMetadata(
  address: string,
  network: string
): Promise<TokenMetadata | null> {
  const normalizedAddress = address.toLowerCase();
  const cacheKey = getCacheKey(network, normalizedAddress);

  // Check cache first
  if (isCacheValid(cacheKey)) {
    const cached = tokenCache.get(cacheKey);
    if (cached) {
      console.log(`[TOKEN RESOLVER] Token metadata cache hit: ${cacheKey}`);
      return cached;
    }
  }

  try {
    const platformId = getPlatformId(network);
    const url = `https://api.coingecko.com/api/v3/coins/${platformId}/contract/${normalizedAddress}`;
    
    console.log(`[TOKEN RESOLVER] Fetching token metadata from CoinGecko: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`[TOKEN RESOLVER] Token not found on CoinGecko: ${address} on ${network}`);
        return null;
      }
      if (response.status === 429) {
        console.error("[TOKEN RESOLVER] CoinGecko rate limit exceeded");
        return null;
      }
      console.error(`[TOKEN RESOLVER] CoinGecko API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json() as CoinGeckoTokenResponse;

    // Extract decimals from detail_platforms
    const decimals = data.detail_platforms?.[platformId]?.decimal_place || 18;

    const metadata: TokenMetadata = {
      symbol: data.symbol?.toLowerCase() || "",
      name: data.name || "",
      address: normalizedAddress,
      decimals,
      network,
    };

    // Cache the result
    tokenCache.set(cacheKey, metadata);
    cacheTimestamps.set(cacheKey, Date.now());

    console.log(`[TOKEN RESOLVER] Successfully fetched token metadata: ${metadata.symbol} (${metadata.name}) - ${decimals} decimals`);
    return metadata;
  } catch (error) {
    console.error(`[TOKEN RESOLVER] Error fetching token metadata from CoinGecko: ${error}`);
    return null;
  }
}

/**
 * Resolve token symbol to address for a given network
 * This uses CoinGecko's search API to find the token
 * 
 * @param symbol - Token symbol (e.g., "USDC", "WETH")
 * @param network - Network name
 * @returns Token address or null if not found
 */
export async function resolveTokenSymbol(
  symbol: string,
  network: string
): Promise<string | null> {
  try {
    const platformId = getPlatformId(network);
    const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`;
    
    console.log(`[TOKEN RESOLVER] Searching token by symbol: ${symbol}`);
    
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[TOKEN RESOLVER] CoinGecko search API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as CoinGeckoSearchResponse;
    
    // Find the first coin that matches the symbol exactly and has the network
    const coin = data.coins?.find((c) => 
      c.symbol.toLowerCase() === symbol.toLowerCase()
    );

    if (!coin) {
      console.warn(`[TOKEN RESOLVER] Token symbol not found: ${symbol}`);
      return null;
    }

    // Fetch full coin details to get the address on the specific network
    const coinUrl = `https://api.coingecko.com/api/v3/coins/${coin.id}`;
    const coinResponse = await fetch(coinUrl);
    
    if (!coinResponse.ok) {
      return null;
    }

    const coinDataRaw = await coinResponse.json();
    const coinData = coinDataRaw as CoinGeckoCoinDetailResponse;
    const address = coinData.platforms?.[platformId];

    if (address) {
      console.log(`[TOKEN RESOLVER] Resolved ${symbol} to ${address} on ${network}`);
      return address.toLowerCase();
    }

    console.warn(`[TOKEN RESOLVER] Token ${symbol} not found on network ${network}`);
    return null;
  } catch (error) {
    console.error(`[TOKEN RESOLVER] Error resolving token symbol: ${error}`);
    return null;
  }
}

/**
 * Resolve token to address
 * Handles both symbols (e.g., "USDC") and addresses (0x...)
 * For native tokens (ETH), returns zero address
 * 
 * @param token - Token symbol or address
 * @param network - Network name (e.g., "base", "optimism")
 * @returns Token address or null if not found
 */
export async function resolveTokenToAddress(
  token: string,
  network: string
): Promise<`0x${string}` | null> {
  console.log(`[TOKEN RESOLVER] Resolving token: ${token} on network: ${network}`);
  const trimmedToken = token.trim();
  
  // For native tokens (ETH, MATIC, etc.)
  if (trimmedToken.toLowerCase() === "eth" || trimmedToken.toLowerCase() === "matic") {
    console.log(`[TOKEN RESOLVER] Token ${token} is a native token, using zero address`);
    return "0x0000000000000000000000000000000000000000";
  }
  
  // If it looks like an address, validate it with CoinGecko to prevent fake addresses
  if (trimmedToken.startsWith("0x") && trimmedToken.length === 42) {
    console.log(`[TOKEN RESOLVER] Token ${token} looks like an address, validating with CoinGecko`);
    const metadata = await getTokenMetadata(trimmedToken, network);
    if (metadata?.address) {
      console.log(`[TOKEN RESOLVER] Validated address ${token} exists on CoinGecko: ${metadata.symbol} (${metadata.name})`);
      return metadata.address as `0x${string}`;
    }
    console.warn(`[TOKEN RESOLVER] Address ${token} not found on CoinGecko for network ${network} - may be fake/invalid`);
    return null;
  }
  
  // Try to resolve symbol to address via CoinGecko
  console.log(`[TOKEN RESOLVER] Resolving token symbol from CoinGecko for ${trimmedToken}`);
  const address = await resolveTokenSymbol(trimmedToken, network);
  if (address) {
    console.log(`[TOKEN RESOLVER] Resolved ${token} to ${address} via CoinGecko`);
    return address as `0x${string}`;
  }
  
  console.warn(`[TOKEN RESOLVER] Could not resolve token ${token} on ${network}`);
  return null;
}

/**
 * Get token decimals (with fallback to common values)
 * 
 * @param address - Token address
 * @param network - Network name
 * @returns Number of decimals (defaults to 18 if not found)
 */
export async function getTokenDecimals(
  address: string,
  network: string
): Promise<number> {
  const metadata = await getTokenMetadata(address, network);
  
  if (metadata?.decimals) {
    return metadata.decimals;
  }

  // Fallback for common tokens
  const lowerSymbol = metadata?.symbol?.toLowerCase();
  if (lowerSymbol === "usdc" || lowerSymbol === "usdt") {
    return 6;
  }

  // Default to 18 (most ERC20 tokens use 18 decimals)
  console.warn(`[TOKEN RESOLVER] Could not determine decimals for ${address}, defaulting to 18`);
  return 18;
}

/**
 * Clear the token metadata cache
 */
export function clearTokenCache(): void {
  tokenCache.clear();
  cacheTimestamps.clear();
  console.log("[TOKEN RESOLVER] Token metadata cache cleared");
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: tokenCache.size,
    entries: Array.from(tokenCache.keys()),
  };
}

