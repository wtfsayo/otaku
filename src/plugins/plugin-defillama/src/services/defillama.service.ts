import { logger, Service, type IAgentRuntime } from "@elizaos/core";

export type DefiLlamaProtocol = {
  id: string;
  name: string;
  symbol: string | null;
  [key: string]: any;
};

export class DefiLlamaService extends Service {
  static serviceType = "defillama_protocols" as const;
  capabilityDescription = "Look up DeFiLlama protocols by name/symbol (TTL-cached index)";

  private cache: DefiLlamaProtocol[] = [];
  private cacheTimestampMs: number = 0;
  private ttlMs: number = 300000; // 5 minutes

  constructor(runtime: IAgentRuntime) { super(runtime); }

  static async start(runtime: IAgentRuntime): Promise<DefiLlamaService> {
    const svc = new DefiLlamaService(runtime);
    await svc.initialize(runtime);
    return svc;
  }

  async initialize(runtime: IAgentRuntime): Promise<void> {
    const ttlSetting = runtime.getSetting("DEFILLAMA_PROTOCOLS_TTL_MS");
    if (ttlSetting) {
      const parsed = Number(ttlSetting);
      if (!Number.isNaN(parsed) && parsed >= 0) this.ttlMs = parsed;
    }
    await this.loadIndex();
  }

  async stop(): Promise<void> {}

  async getProtocolsByNames(names: string[]): Promise<Array<{ id: string; success: boolean; data?: any; error?: string }>> {
    await this.ensureFresh();
    const inputs = Array.isArray(names) ? names : [];
    const results: Array<{ id: string; success: boolean; data?: any; error?: string }> = [];

    for (const raw of inputs) {
      const q = (raw || "").trim();
      if (!q) {
        results.push({ id: q, success: false, error: "Empty protocol name" });
        continue;
      }

      const qLower = q.toLowerCase();

      let picked: DefiLlamaProtocol | null = null;

      for (const p of this.cache) { const n = (p.name || "").toLowerCase(); if (n === qLower) { picked = p; break; } }
      if (!picked) { for (const p of this.cache) { const s = (p.symbol || "").toLowerCase(); if (s && s === qLower) { picked = p; break; } } }
      if (!picked) { for (const p of this.cache) { const slug = (p as any).slug ? String((p as any).slug).toLowerCase() : ""; if (slug && slug === qLower) { picked = p; break; } } }
      if (!picked) { for (const p of this.cache) { const n = (p.name || "").toLowerCase(); if (n.startsWith(qLower)) { picked = p; break; } } }
      if (!picked) { for (const p of this.cache) { const slug = (p as any).slug ? String((p as any).slug).toLowerCase() : ""; if (slug.startsWith(qLower)) { picked = p; break; } } }

      if (picked) {
        results.push({ id: q, success: true, data: shapeProtocol(picked) });
      } else {
        results.push({ id: q, success: false, error: `No protocol match for: ${q}` });
      }
    }

    return results;
  }

  private async ensureFresh(): Promise<void> {
    const now = Date.now();
    if (this.cache.length === 0 || now - this.cacheTimestampMs > this.ttlMs) {
      await this.loadIndex();
    }
  }

  private async loadIndex(): Promise<void> {
    const url = "https://api.llama.fi/protocols";
    const maxAttempts = 5;
    const baseDelayMs = 500;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        logger.debug(`[DefiLlama] Loading protocols (attempt ${attempt}/${maxAttempts}): ${url}`);
        const res = await fetch(url, { method: "GET", headers: { Accept: "application/json", "User-Agent": "ElizaOS-DefiLlama/1.0" }, signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`Failed ${res.status} ${res.statusText}`);
        const list = (await res.json()) as DefiLlamaProtocol[];
        this.cache = Array.isArray(list) ? list : [];
        this.cacheTimestampMs = Date.now();
        logger.info(`[DefiLlama] Protocols loaded: ${this.cache.length} (ttlMs=${this.ttlMs})`);
        return;
      } catch (e) {
        clearTimeout(timeout);
        const isLast = attempt === maxAttempts;
        const msg = e instanceof Error ? e.message : String(e);
        if (isLast) { logger.error(`[DefiLlama] Failed to load protocols after ${maxAttempts} attempts: ${msg}`); break; }
        const backoff = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
        logger.warn(`[DefiLlama] Fetch failed (attempt ${attempt}): ${msg}. Retrying in ${backoff}ms...`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
}

function shapeProtocol(p: any): any {
  const chains: string[] = Array.isArray(p.chains) ? Array.from(new Set(p.chains)) : [];
  return {
    id: p.id,
    slug: p.slug ?? null,
    name: p.name,
    symbol: p.symbol ?? null,
    url: p.url ?? null,
    logo: p.logo ?? null,
    category: p.category ?? null,
    chains,
    address: p.address ?? null,
    gecko_id: p.gecko_id ?? null,
    cmcId: p.cmcId ?? null,
    twitter: p.twitter ?? null,
    tvl: p.tvl ?? null,
    tvl_change_1h: p.change_1h ?? null,
    tvl_change_1d: p.change_1d ?? null,
    tvl_change_7d: p.change_7d ?? null,
    chainTvls: p.chainTvls,
  };
}


