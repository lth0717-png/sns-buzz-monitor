// 화제성 순위 데이터. Vercel이 결과를 10분 동안 저장해 두고, 10분이 지나면 새로 수집합니다.
import { collect } from '../lib/collect.js';

export default async function handler(req, res) {
  try {
    const data = await collect();
    const okCount = Object.values(data.status).filter((s) => s.ok).length;
    // 전부 실패하면 잠깐만 저장해서 곧 다시 시도하게 함
    const maxAge = okCount === 0 ? 30 : 600;
    res.setHeader('Cache-Control', `public, s-maxage=${maxAge}, stale-while-revalidate=300`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(JSON.stringify(data));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: String(e.message || e) });
  }
}
