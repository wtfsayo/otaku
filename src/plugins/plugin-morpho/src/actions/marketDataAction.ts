import {
  Action,
  IAgentRuntime,
  Memory,
  logger,
  State,
  HandlerCallback,
  ActionResult,
  ModelType,
  parseKeyValueXml
} from '@elizaos/core';
import { MorphoService } from '../services';
import { MorphoMarketData } from '../types';
import { fmtPct, shortHex, fmtUSD } from './utils';


/* =========================
 * Prompt helper
 * ========================= */
function getMarketXmlPrompt(userMessage: string): string {
  return `<task>Extract Morpho market identifier from the user's message.</task>

<message>
${userMessage}
</message>

<instructions>
Return ONLY the following XML structure. Do not add extra text or explanations:

<request>
    <market>wstETH/WETH</market>
</request>

Rules:
- Leave out <market> if no specific market is mentioned.
- If a pair is mentioned, normalize spaces around the slash to exactly "Collateral/Loan" (single spaces on both sides), keep the original casing (e.g., "wstETH/WETH").
- If a 66-char 0x-hex string is present, use that as <market> (marketId).
</instructions>`;
}

/* =========================
 * Action: GET_MORPHO_MARKET_INFO
 * ========================= */
export const marketInfoAction: Action = {
  name: 'GET_MORPHO_MARKET_INFO',
  similes: ['MARKET_INFO', 'MARKET_DATA', 'RATES', 'MORPHO_RATES', 'CHECK_RATES'],
  description: 'Get current market data, rates, and stats for Morpho markets (no positions)',
  validate: async (runtime: IAgentRuntime) => {
    const morphoService = runtime.getService(MorphoService.serviceType) as MorphoService;
    if (!morphoService) {
      logger.error('Required services not available');
      return false;
    }
    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    logger.info('Starting Morpho market info action');

    try {
      const userText = message.content.text || '';
      const prompt = getMarketXmlPrompt(userText);
      const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
      const parsed = parseKeyValueXml(xmlResponse);
      const params = { market: parsed?.market || undefined };

      const service = runtime.getService(MorphoService.serviceType) as MorphoService;
      const markets = await service.getMarketData(params.market);

      if (!markets.length) {
        const errorText = `❌ No market data${params.market ? ` for ${params.market}` : ''} found.`;
        const data = { actionName: 'GET_MORPHO_MARKET_INFO', params, markets: [] };
        if (callback) {
          await callback({
            text: errorText,
            actions: ['GET_MORPHO_MARKET_INFO'],
            source: message.content.source,
            data
          });
        }
        return {
          text: errorText,
          success: false,
          data,
          values: {
            marketsFetched: false,
            marketsCount: 0,
            requestedMarket: params.market ?? null
          }
        };
      }

      const text = params.market
        ? markets.map(m => formatDetailedMarketView(m, service)).join('\n\n')
        : formatMarketsTable(markets);

      const data = { actionName: 'GET_MORPHO_MARKET_INFO', params, markets };

      if (callback) {
        await callback({
          text,
          actions: ['GET_MORPHO_MARKET_INFO'],
          source: message.content.source,
          data
        });
      }

      return {
        text,
        success: true,
        data,
        values: {
          marketsFetched: true,
          marketsCount: markets.length,
          requestedMarket: params.market ?? null
        }
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const text = `❌ Failed to get market info: ${msg}`;
      const data = { actionName: 'GET_MORPHO_MARKET_INFO', error: msg };

      if (callback) {
        await callback({
          text,
          actions: ['GET_MORPHO_MARKET_INFO'],
          source: message.content.source,
          data
        });
      }

      return {
        text,
        success: false,
        error: new Error(msg),
        data,
        values: {
          error: true,
          marketsFetched: false
        }
      };
    }
  },
  examples: [
    [
      {
        name: '{{name1}}',
        content: { text: 'What are the current rates for wstETH / WETH on Morpho?' }
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Here are the current wstETH / WETH market rates on Morpho...',
          action: 'GET_MORPHO_MARKET_INFO'
        }
      }
    ],
    [
      {
        name: '{{name1}}',
        content: { text: 'Show me all market data' }
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Here is the complete market overview...',
          action: 'GET_MORPHO_MARKET_INFO'
        }
      }
    ],
    [
      {
        name: '{{name1}}',
        content: { text: 'Check this market: 0x3a4048c64ba1b375330d376b1ce40e4047d03b47ab4d48af484edec9fec801ba' }
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Here’s the current data for the requested market...',
          action: 'GET_MORPHO_MARKET_INFO'
        }
      }
    ]
  ]
};

/* =========================
 * Formatting helpers (local)
 * ========================= */
function formatDetailedMarketView(market: MorphoMarketData, service: MorphoService): string {
  const chain = service.getChainSlug();
  const link = market.marketId ? `https://app.morpho.org/${chain}/market/${market.marketId}/` : '';

  return [
    `### ${market.name} — Market`,
    ``,
    `**Rates**  ·  Supply **${fmtPct(market.supplyRate)}**  ·  Borrow **${fmtPct(market.borrowRate)}**`,
    `**Stats**  ·  Supplied **${fmtUSD(market.totalSupply)}**  ·  Borrowed **${fmtUSD(market.totalBorrow)}**  ·  Liquidity **${fmtUSD(market.liquidity)}**  ·  Util **${fmtPct(market.utilizationRate*100,1)}**`,
    `**Risk**   ·  LLTV **${fmtPct(market.lltv,1)}**  ·  Penalty **${fmtPct(market.liquidationPenalty,2)}**`,
    link ? `🔗 **Open in Morpho:** ${link}` : ''
  ].filter(Boolean).join('\n');
}

function formatMarketsTable(markets: MorphoMarketData[]): string {
  if (!markets.length) {
    return `### Morpho Markets\n\nNo market data found.`;
  }

  const header = [
    `### Morpho Markets`,
    ``,
    `| Market | Supply APY | Borrow APY | Utilization | LLTV | Supplied | Borrowed | Liquidity | ID |`,
    `|:--|--:|--:|--:|--:|--:|--:|--:|:--|`
  ];

  const rows = markets.map((m) => {
    // rates are already in % per your service mapping
    const supply = fmtPct(m.supplyRate);
    const borrow = fmtPct(m.borrowRate);

    // utilization is 0..1 in your data; convert to %
    const util = fmtPct((m.utilizationRate ?? 0) * 100, 1);

    // LLTV already in % per your mapping
    const lltv = fmtPct(m.lltv, 1);

    const supplied = fmtUSD(m.totalSupply);
    const borrowed = fmtUSD(m.totalBorrow);
    const liq = fmtUSD(m.liquidity);

    const id = m.marketId ? `\`${shortHex(m.marketId)}\`` : '—';

    return `| ${m.name} | ${supply} | ${borrow} | ${util} | ${lltv} | ${supplied} | ${borrowed} | ${liq} | ${id} |`;
  });

  return [...header, ...rows].join('\n');
}

