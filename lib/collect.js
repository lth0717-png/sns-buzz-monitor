// SNS 화제성 데이터 수집과 점수 계산 (API 키 필요 없음)
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { attachPrices } from './prices.js';

const SOURCES = {
  ape_stocks: 'https://apewisdom.io/api/v1.0/filter/all-stocks',
  ape_crypto: 'https://apewisdom.io/api/v1.0/filter/all-crypto',
  stocktwits: 'https://api.stocktwits.com/api/2/trending/symbols.json',
  coingecko: 'https://api.coingecko.com/api/v3/search/trending',
};

// 테스트할 때만 BUZZ_MOCK_DIR 폴더의 저장된 파일을 씀
async function fetchJson(key) {
  if (process.env.BUZZ_MOCK_DIR) {
    return JSON.parse(await readFile(path.join(process.env.BUZZ_MOCK_DIR, key + '.json'), 'utf8'));
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(SOURCES[key], {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SNS-Buzz-Monitor/1.0)', Accept: 'application/json' },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const unescape = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

function parseApe(data, market) {
  return ((data && data.results) || []).slice(0, 100).map((r) => ({
    ticker: String(r.ticker || '').replace(/\.X$/, '').toUpperCase(),
    name: unescape(r.name),
    market,
    mentions: num(r.mentions),
    mentions_24h_ago: num(r.mentions_24h_ago),
    rank: num(r.rank),
    rank_24h_ago: num(r.rank_24h_ago) || null,
  }));
}

function parseStocktwits(data) {
  return ((data && data.symbols) || []).map((s, i) => {
    const sym = String(s.symbol || '');
    const crypto = sym.endsWith('.X') || s.instrument_class === 'CRYPTO';
    return {
      ticker: String(s.symbol_display || sym.replace(/\.X$/, '')).toUpperCase(),
      name: s.title || '',
      market: crypto ? 'crypto' : 'stock',
      rank: num(s.rank) || i + 1,
      summary: (s.trends && s.trends.summary) || '',
    };
  });
}

function parseCoingecko(data) {
  return ((data && data.coins) || []).map((c, i) => {
    const it = c.item || c;
    const d = it.data || {};
    let pc = d.price_change_percentage_24h;
    if (pc && typeof pc === 'object') pc = pc.usd;
    return {
      ticker: String(it.symbol || '').toUpperCase(),
      name: it.name || '',
      market: 'crypto',
      rank: i + 1,
      price: num(d.price),
      price_change_24h: num(pc),
    };
  });
}

function reasonKo(it) {
  const bits = [];
  if (it.mentions != null) {
    if (it.mentions_24h_ago) {
      const x = it.mentions / it.mentions_24h_ago;
      if (x >= 1.5) bits.push(`레딧 언급 ${it.mentions}회로 하루 전(${it.mentions_24h_ago}회)보다 ${x.toFixed(1)}배 늘었어요`);
      else if (x <= 0.67) bits.push(`레딧 언급 ${it.mentions}회로 하루 전(${it.mentions_24h_ago}회)보다 줄었어요`);
      else bits.push(`레딧에서 꾸준히 ${it.mentions}회 언급되고 있어요`);
    } else if (it.mentions > 0) {
      bits.push(`레딧에서 새로 언급되기 시작했어요(${it.mentions}회)`);
    }
    if (it.rank_24h_ago && it.reddit_rank && it.rank_24h_ago - it.reddit_rank >= 20) {
      bits.push(`레딧 순위가 ${it.rank_24h_ago}위에서 ${it.reddit_rank}위로 올랐어요`);
    }
  }
  if (it.st_rank) bits.push(`StockTwits 트렌딩 ${it.st_rank}위예요`);
  if (it.cg_rank) {
    let s = `CoinGecko 검색 급상승 ${it.cg_rank}위예요`;
    if (it.price_change_24h != null) s += `(24시간 가격 ${it.price_change_24h >= 0 ? '+' : ''}${it.price_change_24h.toFixed(1)}%)`;
    bits.push(s);
  }
  return bits.join('. ') + (bits.length ? '.' : '');
}

export async function collect({ prices = true } = {}) {
  const jobs = {
    ape_stocks: (d) => parseApe(d, 'stock'),
    ape_crypto: (d) => parseApe(d, 'crypto'),
    stocktwits: parseStocktwits,
    coingecko: parseCoingecko,
  };
  const keys = Object.keys(jobs);
  const settled = await Promise.allSettled(keys.map((k) => fetchJson(k)));
  const raw = {};
  const status = {};
  settled.forEach((s, i) => {
    const k = keys[i];
    if (s.status === 'fulfilled') {
      try { raw[k] = jobs[k](s.value); status[k] = { ok: true, count: raw[k].length }; }
      catch (e) { raw[k] = []; status[k] = { ok: false, error: String(e.message || e) }; }
    } else {
      raw[k] = [];
      status[k] = { ok: false, error: String((s.reason && s.reason.message) || s.reason) };
    }
  });

  const map = new Map();
  const get = (market, ticker, name) => {
    const key = market + ':' + ticker;
    if (!map.has(key)) {
      map.set(key, { key, ticker, market, name: name || '', sources: [], mentions: null, mentions_24h_ago: null,
        reddit_rank: null, rank_24h_ago: null, st_rank: null, st_summary: '', cg_rank: null, price_change_24h: null });
    }
    const it = map.get(key);
    if (!it.name && name) it.name = name;
    return it;
  };
  for (const r of [...raw.ape_stocks, ...raw.ape_crypto]) {
    const it = get(r.market, r.ticker, r.name);
    Object.assign(it, { mentions: r.mentions, mentions_24h_ago: r.mentions_24h_ago, reddit_rank: r.rank, rank_24h_ago: r.rank_24h_ago });
    it.sources.push('레딧');
  }
  for (const s of raw.stocktwits) {
    const it = get(s.market, s.ticker, s.name);
    Object.assign(it, { st_rank: s.rank, st_summary: s.summary });
    it.sources.push('StockTwits');
  }
  for (const c of raw.coingecko) {
    const it = get('crypto', c.ticker, c.name);
    Object.assign(it, { cg_rank: c.rank, cg_price: c.price, price_change_24h: c.price_change_24h });
    it.sources.push('CoinGecko');
  }

  const items = [];
  for (const it of map.values()) {
    const cur = it.mentions || 0;
    const ratio = it.mentions != null ? cur / Math.max(it.mentions_24h_ago || 1, 1) : null;
    let score = 0;
    if (it.mentions != null) score += Math.sqrt(Math.min(cur, 2000)) * 2 + (cur >= 5 ? Math.min(ratio, 10) * 6 * Math.min(1, cur / 30) : 0);
    if (it.st_rank) score += Math.max(0, 31 - it.st_rank) * 2;
    if (it.cg_rank) score += Math.max(0, 16 - it.cg_rank) * 2.5;
    const nSrc = new Set(it.sources).size;
    score += (nSrc - 1) * 15;
    const tags = [];
    if (ratio != null && ratio >= 3 && cur >= 10) tags.push('급상승');
    if (it.rank_24h_ago && it.reddit_rank && it.rank_24h_ago - it.reddit_rank >= 20 && it.reddit_rank <= 30) tags.push('순위 급등');
    if (nSrc >= 2) tags.push('여러 SNS 동시 화제');
    items.push({
      ...it,
      sources: [...new Set(it.sources)],
      change_pct: it.mentions != null && it.mentions_24h_ago ? Math.round(((cur - it.mentions_24h_ago) / it.mentions_24h_ago) * 100) : null,
      score: Math.round(score * 10) / 10,
      tags,
      reason_ko: reasonKo(it),
    });
  }
  items.sort((a, b) => b.score - a.score);
  let price_status = {};
  if (prices) {
    try { price_status = await attachPrices(items); } catch (e) { price_status = { error: String(e.message || e) }; }
  }
  return { collected_at: new Date().toISOString(), status, price_status, items };
}
