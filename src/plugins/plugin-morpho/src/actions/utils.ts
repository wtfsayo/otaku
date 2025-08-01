import BigNumber from 'bignumber.js';

const stripZeros = (s: string) => s.replace(/(\.\d*?[1-9])0+$/,'$1').replace(/\.0+$/,'');
const toBN = (x: BigNumber.Value) => new BigNumber(x ?? 0);

export function fmtUSD(v: BigNumber.Value, dp = 2): string {
  const n = toBN(v);
  if (!n.isFinite()) return '—';
  if (n.abs().gte(1_000_000_000)) return `$${n.div(1_000_000_000).toFormat(1)}B`;
  if (n.abs().gte(1_000_000))     return `$${n.div(1_000_000).toFormat(1)}M`;
  if (n.abs().gte(1_000))         return `$${n.div(1_000).toFormat(1)}K`;
  return `$${n.toFormat(dp)}`;
}

export function fmtPct(v: number | null | undefined, dp = 2): string {
  if (v == null || !isFinite(v)) return '—';
  return `${new BigNumber(v).toFormat(dp)}%`;
}

export function fmtTok(v: BigNumber.Value, sym: string, dp = 6): string {
  const s = stripZeros(toBN(v).toFormat(dp));
  return `${s} ${sym.toLowerCase()}`;
}

export function fmtNum(v: BigNumber.Value, dp = 2): string {
  const n = toBN(v);
  return n.isFinite() ? stripZeros(n.toFormat(dp)) : '—';
}

export function shortHex(id?: string, prefix = 6, suffix = 6) {
    if (!id) return '';
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return id;
    return `${id.slice(0, 2 + prefix)}…${id.slice(-suffix)}`;
}


export function fmtAbbrev(v: BigNumber.Value, digits = 0): string {
    const n = toBN(v);
    if (!n.isFinite()) return '—';
  
    const abs = n.abs();
    let div = new BigNumber(1);
    let suffix = '';
    if (abs.gte(1e12))      { div = new BigNumber(1e12); suffix = 'T'; }
    else if (abs.gte(1e9))  { div = new BigNumber(1e9);  suffix = 'B'; }
    else if (abs.gte(1e6))  { div = new BigNumber(1e6);  suffix = 'M'; }
    else if (abs.gte(1e3))  { div = new BigNumber(1e3);  suffix = 'K'; }
  
    if (suffix) {
      const val = n.div(div);
      const dp = val.abs().gte(100) ? 0 : digits;
      return `${stripZeros(val.toFormat(dp))}${suffix}`;
    }
    return stripZeros(n.toFormat(2));
  }
  
  export function fmtTokCompact(v: BigNumber.Value, sym: string, digits = 0): string {
    return `${fmtAbbrev(v, digits)} ${sym}`;
  }