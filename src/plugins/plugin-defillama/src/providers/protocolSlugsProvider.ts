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

      // Get all protocols and create lookup mappings
      const protocols = await defiLlamaService.getProtocols();

      // Create name to slug mappings
      const nameToSlug: Record<string, string> = {};
      const slugToName: Record<string, string> = {};
      const aliasToSlug: Record<string, string> = {};

      for (const protocol of protocols as any[]) {
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

      // Get top protocols for context
      const topProtocols = (protocols as any[])
        .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
        .slice(0, 20)
        .map((p) => `${p.name} (${p.slug})`);

      // Parse message to find potential protocol references
      const messageText = message.content.text?.toLowerCase() || "";
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
          ? `Protocol Matches Found:
${uniqueProtocols.map((p) => `- ${p.name} → ${p.slug} (${p.confidence} match)`).join("\n")}

Use these exact slugs for API calls.`
          : `No specific protocols detected in message.

Top 20 Available Protocols:
${topProtocols.slice(0, 10).join(", ")}
${topProtocols.slice(10).join(", ")}

Total available protocols: ${protocols.length}

For protocol lookups, use exact protocol slugs. Common rebrands:
- MakerDAO → Sky Lending (slug varies - check current data)`;

      return {
        text: contextText,
        values: {
          availableProtocols: protocols.length,
          foundProtocols: uniqueProtocols,
          topProtocols: topProtocols.slice(0, 10),
          nameToSlug: Object.keys(nameToSlug).slice(0, 50), // Limit for performance
          hasMatches: uniqueProtocols.length > 0,
        },
        data: {
          nameToSlug,
          slugToName,
          aliasToSlug,
          foundProtocols: uniqueProtocols,
          topProtocols,
          allProtocols: protocols,
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
