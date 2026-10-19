// 일반 소식 화제성 수집 (API 키 필요 없음)
// - 구글 트렌드 급상승 검색어 (관련 기사 포함)
// - 구글 뉴스 주요 기사
// - 위키백과 많이 본 문서 (어제 기준)
// - 레딧 인기글 (전 세계 탭만)
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const REGIONS = {
  kr: { geo: 'KR', news: 'hl=ko&gl=KR&ceid=KR:ko', wiki: 'ko.wikipedia', wikiHost: 'ko.wikipedia.org', main: ['대문'] },
  global: { geo: 'US', news: 'hl=en-US&gl=US&ceid=US:en', wiki: 'en.wikipedia', wikiHost: 'en.wikipedia.org', main: ['Main_Page'] },
};

async function get(url, mockName, type = 'text') {
  if (process.env.BUZZ_MOCK_DIR) {
    const t = await readFile(path.join(process.env.BUZZ_MOCK_DIR, mockName), 'utf8');
    return type === 'json' ? JSON.parse(t) : t;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: type === 'json' ? 'application/json' : 'application/rss+xml, application/xml, text/xml' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return type === 'json' ? await r.json() : await r.text();
  } finally {
    clearTimeout(timer);
  }
}

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ''; };
const tagsAll = (xml, name) => [...xml.matchAll(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1]);
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : '');

// "2K+" → 2000, "500+" → 500
function trafficNum(s) {
  const m = String(s || '').replace(/,/g, '').match(/([\d.]+)\s*([KMB만천]?)/i);
  if (!m) return 0;
  const mult = { K: 1e3, M: 1e6, B: 1e9, 천: 1e3, 만: 1e4 }[m[2].toUpperCase()] || 1;
  return Math.round(Number(m[1]) * mult);
}

async function googleTrends(r) {
  const xml = await get(`https://trends.google.com/trending/rss?geo=${r.geo}`, `trends_${r.geo}.xml`);
  return tagsAll(xml, 'item').map((it) => {
    const news = tagsAll(it, 'ht:news_item').map((n) => ({
      title: tag(n, 'ht:news_item_title'), url: safeUrl(tag(n, 'ht:news_item_url')), source: tag(n, 'ht:news_item_source'),
    })).filter((n) => n.title);
    const traffic = tag(it, 'ht:approx_traffic');
    const pub = tag(it, 'pubDate');
    return {
      title: tag(it, 'title'), traffic, traffic_num: trafficNum(traffic),
      started_at: pub ? new Date(pub).toISOString() : null,
      picture: safeUrl(tag(it, 'ht:picture')), news,
    };
  }).filter((t) => t.title);
}

async function googleNews(r) {
  const xml = await get(`https://news.google.com/rss?${r.news}`, `news_${r.geo}.xml`);
  return tagsAll(xml, 'item').slice(0, 20).map((it) => {
    const source = tag(it, 'source');
    let title = tag(it, 'title');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const pub = tag(it, 'pubDate');
    return { title, source, url: safeUrl(tag(it, 'link')), published: pub ? new Date(pub).toISOString() : null };
  }).filter((n) => n.title);
}

async function wikiTop(r) {
  // 위키 집계는 하루 늦게 올라와서 1~3일 전 순서로 시도
  for (let back = 1; back <= 3; back++) {
    const d = new Date(Date.now() - back * 864e5);
    const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, '0'), day = String(d.getUTCDate()).padStart(2, '0');
    try {
      const j = await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${r.wiki}/all-access/${y}/${m}/${day}`, `wiki_${r.geo}.json`, 'json');
      const arts = (j.items && j.items[0] && j.items[0].articles) || [];
      const list = arts.filter((a) => !a.article.includes(':') && !r.main.includes(a.article) && a.article !== '-')
        .slice(0, 15).map((a) => ({ title: a.article.replace(/_/g, ' '), views: a.views, url: `https://${r.wikiHost}/wiki/${encodeURIComponent(a.article)}` }));
      if (list.length) return { date: `${y}-${m}-${day}`, list };
    } catch { /* 하루 더 전으로 */ }
  }
  throw new Error('위키 집계 없음');
}

async function redditPopular() {
  const j = await get('https://www.reddit.com/r/popular.json?limit=30&raw_json=1', 'reddit_popular.json', 'json');
  return ((j.data && j.data.children) || []).map((c) => c.data).filter((p) => p && !p.over_18 && !p.stickied).slice(0, 15).map((p) => ({
    title: p.title, subreddit: p.subreddit, ups: p.ups, comments: p.num_comments, url: 'https://www.reddit.com' + p.permalink,
  }));
}

export async function collectTrends(region = 'kr', { extras = true } = {}) {
  const r = REGIONS[region] || REGIONS.kr;
  const jobs = { trends: () => googleTrends(r) };
  if (extras) {
    jobs.news = () => googleNews(r);
    jobs.wiki = () => wikiTop(r);
    if (region === 'global') jobs.reddit = () => redditPopular();
  }
  const keys = Object.keys(jobs);
  const settled = await Promise.allSettled(keys.map((k) => jobs[k]()));
  const out = { collected_at: new Date().toISOString(), region, status: {} };
  settled.forEach((s, i) => {
    const k = keys[i];
    if (s.status === 'fulfilled') { out[k] = s.value; out.status[k] = { ok: true, count: Array.isArray(s.value) ? s.value.length : (s.value.list || []).length }; }
    else { out[k] = null; out.status[k] = { ok: false, error: String((s.reason && s.reason.message) || s.reason) }; }
  });
  const topics = (out.trends || []).map((t, i) => ({ ...t, key: region + ':' + t.title, order: i }));
  topics.sort((a, b) => b.traffic_num - a.traffic_num || a.order - b.order);
  out.topics = topics.slice(0, 30);
  delete out.trends;
  return out;
}
