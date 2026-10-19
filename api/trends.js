// 일반 소식 화제성 데이터. /api/trends?region=kr 또는 global. 10분 동안 저장해 둡니다.
import { collectTrends } from '../lib/trends.js';

export default async function handler(req, res) {
  const region = String((req.query && req.query.region) || 'kr') === 'global' ? 'global' : 'kr';
  try {
    const data = await collectTrends(region);
    const ok = Object.values(data.status).some((s) => s.ok);
    res.setHeader('Cache-Control', `public, s-maxage=${ok ? 600 : 30}, stale-while-revalidate=300`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(JSON.stringify(data));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: String(e.message || e) });
  }
}
