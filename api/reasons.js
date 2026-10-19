// "왜 화제인지" 한국어 요약. 구글 Gemini 무료 키(GEMINI_API_KEY)로 상위 종목을 한 번에 요약합니다.
// 무료 사용량을 아끼려고 결과를 1시간(SUMMARY_CACHE_MINUTES로 변경 가능) 저장해 둡니다.
import { collect } from '../lib/collect.js';

const MODELS = [
  process.env.GEMINI_MODEL,
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-3-flash-preview',
].filter(Boolean);

async function askGemini(prompt, key) {
  let lastErr = '';
  for (const model of MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
      }),
    });
    // 없는 모델(404/400)이거나 붐비거나 한도 초과(429/5xx)면 다음 후보 모델로
    if (!r.ok) { lastErr = `${model}: HTTP ${r.status}`; if ([400, 404, 429, 500, 502, 503, 504].includes(r.status)) continue; throw new Error(`Gemini ${lastErr}: ${(await r.text()).slice(0, 200)}`); }
    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    return { model, text };
  }
  throw new Error('사용할 수 있는 Gemini 모델을 찾지 못했어요. ' + lastErr);
}

export default async function handler(req, res) {
  const cacheMin = Number(process.env.SUMMARY_CACHE_MINUTES) || 60;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.setHeader('Cache-Control', 'public, s-maxage=600');
    return res.status(200).send(JSON.stringify({ reasons: {}, error: 'no_key' }));
  }
  try {
    const { items } = await collect();
    const top = items.slice(0, 25).map((it) => ({
      id: it.key,
      종목: `${it.ticker} (${it.name})`,
      구분: it.market === 'crypto' ? '코인' : '주식',
      레딧_24시간_언급: it.mentions,
      레딧_하루전_언급: it.mentions_24h_ago,
      레딧_순위: it.reddit_rank,
      레딧_하루전_순위: it.rank_24h_ago,
      StockTwits_트렌딩_순위: it.st_rank,
      CoinGecko_검색급상승_순위: it.cg_rank,
      StockTwits_화제_이유_원문: it.st_summary || null,
    }));
    const prompt = [
      '너는 한국 개인투자자를 위한 SNS 화제성 대시보드의 편집자야.',
      '아래 각 종목이 지금 SNS(레딧, StockTwits, CoinGecko)에서 왜 화제인지 한국어로 간략히 요약해.',
      '규칙:',
      '- 종목마다 1~2문장, 최대 90자. 쉬운 말, "~해요"체.',
      '- "StockTwits_화제_이유_원문"이 있으면 그 내용(실적, 신약, 정책, 급등락 등 핵심 사건과 강세/약세 의견)을 중심으로 요약해.',
      '- 원문이 없으면 숫자(언급 증가, 순위 변화)만으로 설명하고, 원문에 없는 뉴스나 사건은 절대 지어내지 마.',
      '- 매수·매도 권유 표현은 쓰지 마.',
      '출력: {"<id>": "<요약>", ...} 형태의 JSON 객체만.',
      '',
      JSON.stringify(top),
    ].join('\n');
    const { model, text } = await askGemini(prompt, key);
    let reasons = {};
    try { reasons = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()); } catch { reasons = {}; }
    const clean = {};
    for (const [k, v] of Object.entries(reasons || {})) if (typeof v === 'string') clean[k] = v.slice(0, 160);
    res.setHeader('Cache-Control', `public, s-maxage=${cacheMin * 60}, stale-while-revalidate=600`);
    return res.status(200).send(JSON.stringify({ generated_at: new Date().toISOString(), model, reasons: clean }));
  } catch (e) {
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(200).send(JSON.stringify({ reasons: {}, error: String(e.message || e).slice(0, 300) }));
  }
}
