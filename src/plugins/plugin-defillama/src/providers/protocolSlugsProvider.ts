import {
  Provider,
  IAgentRuntime,
  Memory,
  State,
  ProviderResult,
  logger,
} from "@elizaos/core";
import { DefiLlamaService } from "../services/defiLlamaService";

export const protocolSlugsProvider: Provider = {
  name: "PROTOCOL_SLUGS_PROVIDER",
  description:
    "Use this provider when you need to resolve protocol names to slugs and vice versa.",
  dynamic: true,
  get: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
  ): Promise<ProviderResult> => {
    try {
      const defiLlamaService = runtime.getService(
        "defillama",
      ) as DefiLlamaService;

      if (!defiLlamaService) {
        return {
          text: "",
          values: {},
          data: {},
        };
      }

      // Parse message first to extract potential protocol keywords
      const messageText = message.content.text?.toLowerCase() || "";
      const messageWords = messageText
        .split(/\s+/)
        .filter((word) => word.length > 2); // Filter out very short words

      // Get all protocols
      const allProtocols = await defiLlamaService.getProtocols();

      // Get top protocols for context (always include these)
      const topProtocols = (allProtocols as any[])
        .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
        .slice(0, 10); // Top 10 most relevant by TVL

      // Filter to relevant protocols: those mentioned in message or top protocols
      const relevantProtocols = (allProtocols as any[]).filter((protocol) => {
        const name = protocol.name.toLowerCase();
        const slug = protocol.slug.toLowerCase();
        
        // Always include top protocols
        if (topProtocols.includes(protocol)) {
          return true;
        }
        
        // Include if any message word matches protocol name or slug
        return messageWords.some((word) => {
          return (
            name.includes(word) ||
            slug.includes(word) ||
            word.includes(name) ||
            word.includes(slug)
          );
        });
      });

      logger.info(
        `[PROTOCOL_SLUGS_PROVIDER] Filtered ${relevantProtocols.length} relevant protocols from ${allProtocols.length} total`,
      );

      // Create name to slug mappings only for relevant protocols
      const nameToSlug: Record<string, string> = {};
      const slugToName: Record<string, string> = {};
      const aliasToSlug: Record<string, string> = {};

      for (const protocol of relevantProtocols) {
        const slug = protocol.slug;
        const name = protocol.name.toLowerCase();

        nameToSlug[name] = slug;
        slugToName[slug] = protocol.name;

        // Add common aliases and variations
        aliasToSlug[name.replace(/\s+/g, "")] = slug; // Remove spaces
        aliasToSlug[name.replace(/\s+/g, "-")] = slug; // Replace spaces with dashes

        // Handle specific known rebrands and aliases
        if (name.includes("maker") || name.includes("makerdao")) {
          aliasToSlug["makerdao"] = slug;
          aliasToSlug["maker"] = slug;
        }

        if (name.includes("sky") && name.includes("lending")) {
          aliasToSlug["makerdao"] = slug;
          aliasToSlug["maker"] = slug;
        }

        // Handle other common variations
        const words = name.split(" ");
        if (words.length > 1) {
          aliasToSlug[words[0]] = slug; // First word only
          aliasToSlug[words.join("")] = slug; // All words concatenated
        }
      }

      // Format top protocols for display
      const topProtocolsList = topProtocols
        .map((p) => `${p.name} (${p.slug})`);

      // Find protocol matches in message
      const foundProtocols: Array<{
        name: string;
        slug: string;
        confidence: string;
      }> = [];

      // Check for exact matches first
      for (const [alias, slug] of Object.entries(aliasToSlug)) {
        if (messageText.includes(alias)) {
          const protocolName = slugToName[slug];
          foundProtocols.push({
            name: protocolName,
            slug: slug,
            confidence: messageText === alias ? "exact" : "high",
          });
        }
      }

      // Remove duplicates and sort by confidence
      const uniqueProtocols = foundProtocols
        .filter((p, i, arr) => arr.findIndex((x) => x.slug === p.slug) === i)
        .sort((a, b) => {
          const order = { exact: 0, high: 1, medium: 2, low: 3 };
          return (
            (order[a.confidence as keyof typeof order] || 9) -
            (order[b.confidence as keyof typeof order] || 9)
          );
        })
        .slice(0, 5); // Limit to top 5 matches

      const contextText =
        uniqueProtocols.length > 0
          ? `Protocol Matches Found (${uniqueProtocols.length}):
${uniqueProtocols.map((p) => `- ${p.name} → ${p.slug} (${p.confidence} match)`).join("\n")}

Use these exact slugs for API calls.

Top 10 Protocols by TVL available:
${topProtocolsList.join(", ")}`
          : `No specific protocols mentioned in message.

Top 10 Protocols by TVL available:
${topProtocolsList.join(", ")}

Use exact protocol slugs for lookups. Common rebrands:
- MakerDAO → Sky Lending (check current data for exact slug)`;

      return {
        text: contextText,
        values: {
          availableProtocols: allProtocols.length,
          relevantProtocols: relevantProtocols.length,
          foundProtocols: uniqueProtocols,
          topProtocols: topProtocolsList,
          nameToSlug: Object.keys(nameToSlug),
          hasMatches: uniqueProtocols.length > 0,
        },
        data: {
          nameToSlug,
          slugToName,
          aliasToSlug,
          foundProtocols: uniqueProtocols,
          topProtocols: topProtocolsList,
          relevantProtocols,
        },
      };
    } catch (error) {
      logger.error(
        "Error in protocol slugs provider:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        text: "Unable to load protocol mappings at this time.",
        values: {},
        data: {},
      };
    }
  },
};
