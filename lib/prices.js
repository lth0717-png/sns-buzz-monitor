// 현재 가격과 오늘 가격 변동률 (API 키 필요 없음)
// - 미국 주식: 야후 파이낸스 공개 시세 (전일 종가 대비 = 오늘 변동)
// - 코인: CoinGecko 시가총액 상위 250개 시세 (최근 24시간 변동)
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function getJson(url, mockName) {
  if (process.env.BUZZ_MOCK_DIR) {
    try { return JSON.parse(await readFile(path.join(process.env.BUZZ_MOCK_DIR, mockName + '.json'), 'utf8')); }
    catch { throw new Error('mock 없음'); }
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const yahooSym = (t) => t.replace(/\./g, '-');

// 야후 spark 응답은 버전에 따라 모양이 달라서 두 가지 모두 읽음
function readSpark(j) {
  const out = {};
  if (j && j.spark && Array.isArray(j.spark.result)) {
    for (const r of j.spark.result) {
      const m = r.response && r.response[0] && r.response[0].meta;
      if (m) out[r.symbol] = { price: num(m.regularMarketPrice), prev: num(m.chartPreviousClose ?? m.previousClose) };
    }
  } else if (j && typeof j === 'object') {
    for (const [sym, v] of Object.entries(j)) {
      if (!v || typeof v !== 'object') continue;
      const closes = Array.isArray(v.close) ? v.close.filter((x) => x != null) : [];
      const price = closes.length ? closes[closes.length - 1] : null;
      out[sym] = { price: num(price), prev: num(v.chartPreviousClose ?? v.previousClose) };
    }
  }
  return out;
}

async function stockPrices(tickers) {
  const res = {};
  const syms = [...new Set(tickers)].map(yahooSym);
  const chunks = [];
  for (let i = 0; i < syms.length; i += 20) chunks.push(syms.slice(i, i + 20));
  const hosts = ['query1', 'query2'];
  await Promise.all(chunks.map(async (c, i) => {
    for (const h of hosts) {
      try {
        const j = await getJson(`https://${h}.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(c.join(','))}&range=1d&interval=5m`, 'yahoo_spark');
        Object.assign(res, readSpark(j));
        return;
      } catch { /* 다른 주소로 한 번 더 */ }
    }
  }));
  // spark에서 빠진 종목은 차트 주소로 하나씩 (최대 25개)
  const missing = syms.filter((s) => !res[s] || res[s].price == null).slice(0, 25);
  await Promise.all(missing.map(async (s) => {
    try {
      const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1d&interval=1d`, 'yahoo_chart_' + s);
      const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
      if (m) res[s] = { price: num(m.regularMarketPrice), prev: num(m.chartPreviousClose ?? m.previousClose) };
    } catch { /* 없으면 표시 안 함 */ }
  }));
  const out = {};
  for (const t of tickers) {
    const r = res[yahooSym(t)];
    if (r && r.price != null) out[t] = { price: r.price, change_pct: r.prev ? ((r.price - r.prev) / r.prev) * 100 : null };
  }
  return out;
}

async function cryptoPrices() {
  const out = {};
  const j = await getJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&price_change_percentage=24h', 'coingecko_markets');
  for (const c of Array.isArray(j) ? j : []) {
    const sym = String(c.symbol || '').toUpperCase();
    if (!sym || out[sym]) continue; // 같은 기호면 시가총액 큰 코인 우선
    out[sym] = { price: num(c.current_price), change_pct: num(c.price_change_percentage_24h) };
  }
  return out;
}

// items: collect()의 종목 목록. 가격을 붙여서 돌려줌
export async function attachPrices(items, maxStocks = 90) {
  const stockTickers = items.filter((i) => i.market === 'stock').slice(0, maxStocks).map((i) => i.ticker);
  const [st, cr] = await Promise.allSettled([stockPrices(stockTickers), cryptoPrices()]);
  const sMap = st.status === 'fulfilled' ? st.value : {};
  const cMap = cr.status === 'fulfilled' ? cr.value : {};
  let sN = 0, cN = 0;
  for (const it of items) {
    if (it.market === 'stock' && sMap[it.ticker]) {
      Object.assign(it, { price: sMap[it.ticker].price, price_change_pct: sMap[it.ticker].change_pct, price_basis: '오늘' }); sN++;
    } else if (it.market === 'crypto') {
      const c = cMap[it.ticker];
      if (c && c.price != null) { Object.assign(it, { price: c.price, price_change_pct: c.change_pct, price_basis: '24시간' }); cN++; }
      else if (it.cg_price != null) { Object.assign(it, { price: it.cg_price, price_change_pct: it.price_change_24h, price_basis: '24시간' }); cN++; }
    }
  }
  return {
    stock_prices: { ok: sN > 0, count: sN, error: st.status === 'rejected' ? String(st.reason) : undefined },
    crypto_prices: { ok: cN > 0, count: cN, error: cr.status === 'rejected' ? String(cr.reason && cr.reason.message || cr.reason) : undefined },
  };
}
