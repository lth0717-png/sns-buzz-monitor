// 일반 소식 급상승 검색어가 "왜 화제인지" 한국어 요약 (Gemini). /api/trend-reasons?region=kr|global
// 무료 사용량을 아끼려고 결과를 1시간(SUMMARY_CACHE_MINUTES로 변경 가능) 저장해 둡니다.
import { collectTrends } from '../lib/trends.js';

const MODELS = [
  process.env.GEMINI_MODEL,
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
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
    if (!r.ok) { lastErr = `${model}: HTTP ${r.status}`; if ([400, 404, 429, 500, 502, 503, 504].includes(r.status)) continue; throw new Error(`Gemini ${lastErr}`); }
    const j = await r.json();
    return { model, text: j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '' };
  }
  throw new Error('사용할 수 있는 Gemini 모델을 찾지 못했어요. ' + lastErr);
}

export default async function handler(req, res) {
  const region = String((req.query && req.query.region) || 'kr') === 'global' ? 'global' : 'kr';
  const cacheMin = Number(process.env.SUMMARY_CACHE_MINUTES) || 60;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.setHeader('Cache-Control', 'public, s-maxage=600');
    return res.status(200).send(JSON.stringify({ reasons: {}, error: 'no_key' }));
  }
  try {
    const { topics } = await collectTrends(region, { extras: false });
    const input = topics.slice(0, 20).map((t) => ({
      id: t.key, 키워드: t.title, 검색량: t.traffic, 관련_기사_제목: t.news.slice(0, 3).map((n) => `${n.title} (${n.source})`),
    }));
    if (!input.length) throw new Error('급상승 검색어 없음');
    const prompt = [
      `너는 한국 독자를 위한 실시간 화제 대시보드의 편집자야. 아래는 ${region === 'kr' ? '한국' : '미국'} 구글 급상승 검색어와 관련 기사 제목이야.`,
      '각 키워드가 지금 왜 화제인지 한국어로 간략히 요약해.',
      '규칙:',
      '- 키워드마다 1~2문장, 최대 90자. 쉬운 말, "~해요"체.',
      '- 관련 기사 제목에 나온 내용만 근거로 쓰고, 제목에 없는 사실은 지어내지 마. 기사가 없으면 "관련 기사가 아직 없어요."라고 써.',
      '- 영어 키워드나 기사라도 요약은 한국어로.',
      '출력: {"<id>": "<요약>", ...} 형태의 JSON 객체만.',
      '',
      JSON.stringify(input),
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
