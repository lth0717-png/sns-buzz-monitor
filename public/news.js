// "일반 소식" 탭: 구글 트렌드 급상승 검색어 + 주요 뉴스 + 위키백과 + 레딧
(() => {
  const css = `
  [hidden]{display:none!important}
  .viewseg{display:inline-flex;background:var(--panel-2);border:1px solid var(--line);border-radius:9px;padding:3px;gap:2px}
  .viewseg button{border:0;background:transparent;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:13.5px;font-weight:600;color:var(--mute)}
  .viewseg button[aria-pressed="true"]{background:var(--panel);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08)}
  .n-card .kw{font-size:19px;font-weight:700;letter-spacing:-.3px;line-height:1.3;word-break:keep-all;overflow-wrap:anywhere}
  .n-card .when{font-size:12px;color:var(--mute);font-family:var(--mono)}
  .n-traffic{font-family:var(--mono);font-size:12px;font-weight:600;padding:2px 7px;border-radius:5px;background:var(--heat-soft);color:var(--heat);white-space:nowrap}
  .n-related{list-style:none;margin:0;padding:10px 0 0;border-top:1px solid var(--line-2);display:flex;flex-direction:column;gap:6px}
  .n-related li{font-size:13px;line-height:1.45;min-width:0}
  .n-related a,.n-list a{color:var(--ink);text-decoration:none}
  .n-related a:hover,.n-list a:hover{color:var(--brand);text-decoration:underline}
  .n-src{color:var(--mute);font-size:11.5px;margin-right:6px;white-space:nowrap}
  .n-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:12px;align-items:start}
  .n-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column}
  .n-list li{display:grid;grid-template-columns:22px 1fr auto;gap:8px;padding:8px 0;border-top:1px solid var(--line-2);font-size:13.5px;line-height:1.45;align-items:baseline}
  .n-list li:first-child{border-top:0}
  .n-list .i{font-family:var(--mono);font-size:12px;color:var(--mute)}
  .n-list .r{font-family:var(--mono);font-size:12px;color:var(--mute);white-space:nowrap}
  .n-list .sub{display:block;font-size:11.5px;color:var(--mute)}
  .n-meta{font-size:12.5px;color:var(--mute);font-family:var(--mono)}
  @media (max-width:560px){.logo-txt{display:none}}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.append(st);

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const link = (url, text) => { if (!url) return el('span', null, text); const a = el('a', null, text); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
  const ago = (iso) => { if (!iso) return ''; const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 1 ? '방금' : m < 60 ? m + '분 전' : Math.round(m / 60) + '시간 전'; };
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');

  const view = $('view-news');
  view.innerHTML = `
    <section class="headline">
      <span class="eyebrow">Trending · 일반 소식</span>
      <h1 id="n-take" class="skel">지금 사람들이 가장 많이 찾는 소식을 정리하고 있어요</h1>
    </section>
    <div class="filters">
      <div class="seg" role="group" aria-label="지역 선택" id="n-region">
        <button type="button" data-r="kr" aria-pressed="true">한국</button>
        <button type="button" data-r="global" aria-pressed="false">전 세계</button>
      </div>
      <span class="n-meta" id="n-meta"></span>
    </div>
    <div id="n-alerts"></div>
    <section aria-labelledby="n-topics-h">
      <div class="sec-h"><h2 id="n-topics-h">급상승 검색어</h2><p id="n-topics-sub">구글 트렌드 · 검색량 순</p></div>
      <div class="hot" id="n-topics"></div>
    </section>
    <section class="n-cols">
      <div class="box"><h3>주요 뉴스</h3><p>구글 뉴스 헤드라인</p><ol class="n-list" id="n-news"></ol></div>
      <div class="box"><h3>많이 본 위키백과 문서</h3><p id="n-wiki-sub">하루 조회수 기준</p><ol class="n-list" id="n-wiki"></ol></div>
      <div class="box" id="n-reddit-box" hidden><h3>레딧 인기글</h3><p>r/popular · 추천 수</p><ol class="n-list" id="n-reddit"></ol></div>
    </section>
    <p class="legend">
      <b>급상승 검색어</b> 구글에서 최근 검색이 급증한 키워드예요. 한국은 한국 구글, 전 세계는 미국 구글 기준이에요.
      <b>AI</b> Gemini가 관련 기사 제목만 보고 쓴 요약이에요. 기사 제목에 없는 내용은 쓰지 않도록 했지만, 중요한 내용은 원문 기사로 확인해 주세요.
      데이터는 10분마다, 요약은 1시간마다 새로 모아요. 출처: Google Trends, Google News, Wikipedia, Reddit.
    </p>`;

  let REGION = 'kr';
  const cache = {}; // region -> { data, reasons, meta }

  function render() {
    const c = cache[REGION];
    if (!c || !c.data) return;
    const d = c.data, R = c.reasons || {};
    const label = REGION === 'kr' ? '한국' : '전 세계(미국)';
    $('n-meta').textContent = `${new Date(d.collected_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })} 수집 · ${ago(d.collected_at)}`;
    if (document.body.dataset.view === 'news') { const m = $('meta'); if (m) m.textContent = $('n-meta').textContent; }

    const names = { trends: '구글 트렌드', news: '구글 뉴스', wiki: '위키백과', reddit: '레딧' };
    const failed = Object.entries(d.status || {}).filter(([, s]) => !s.ok).map(([k]) => names[k] || k);
    const alerts = [];
    if (failed.length) alerts.push(`지금 ${failed.join(', ')} 데이터를 가져오지 못했어요. 나머지 출처로 보여드리고 10분 뒤 다시 시도해요.`);
    if (c.meta && c.meta.error && c.meta.error !== 'no_key') alerts.push('AI 요약을 잠시 만들지 못해 관련 기사 제목으로 보여드려요.');
    $('n-alerts').replaceChildren(...alerts.map((m) => { const a = el('div', 'alert'); a.append(el('span', null, '!'), el('span', null, m)); return a; }));

    const topics = d.topics || [];
    const take = $('n-take'); take.classList.remove('skel');
    take.textContent = topics.length
      ? `지금 ${label}에서 가장 많이 검색되는 키워드는 "${topics[0].title}"예요.` + (topics[1] ? ` 이어서 "${topics[1].title}"${topics[2] ? `, "${topics[2].title}"` : ''} 순이에요.` : '')
      : `지금은 ${label} 급상승 검색어를 가져오지 못했어요.`;

    $('n-topics').replaceChildren(...topics.slice(0, 12).map((t, i) => {
      const card = el('article', 'card n-card');
      const head = el('div', 'head');
      const mid = el('div'); mid.style.minWidth = '0';
      mid.append(el('div', 'kw', t.title), el('div', 'when', t.started_at ? ago(t.started_at) + ' 급상승' : ''));
      head.append(el('span', 'rank', String(i + 1)), mid, el('span', 'n-traffic', '검색 ' + (t.traffic || '–')));
      const why = el('p', 'why');
      const ai = R[t.key];
      if (ai) why.append(el('span', 'src-badge ai', 'AI'), ai);
      else why.append(el('span', 'src-badge num', '기사'), t.news[0] ? t.news[0].title : '관련 기사가 아직 없어요.');
      card.append(head, why);
      if (t.news.length) {
        const ul = el('ul', 'n-related');
        t.news.slice(0, 3).forEach((n) => { const li = el('li'); li.append(el('span', 'n-src', n.source || ''), link(n.url, n.title)); ul.append(li); });
        card.append(ul);
      }
      return card;
    }));
    if (!topics.length) $('n-topics').replaceChildren(el('p', 'muted', '표시할 급상승 검색어가 없어요.'));

    const list = (id, items, row) => { $(id).replaceChildren(...(items || []).map((x, i) => { const li = el('li'); li.append(el('span', 'i', String(i + 1)), ...row(x)); return li; })); if (!(items || []).length) $(id).replaceChildren(el('li', 'muted', '불러오지 못했어요.')); };
    list('n-news', (d.news || []).slice(0, 12), (n) => { const b = el('span'); b.append(link(n.url, n.title), el('span', 'sub', n.source || '')); return [b, el('span', 'r', ago(n.published))]; });
    $('n-wiki-sub').textContent = d.wiki && d.wiki.date ? `${d.wiki.date} 하루 조회수 기준` : '하루 조회수 기준';
    list('n-wiki', d.wiki ? d.wiki.list.slice(0, 12) : [], (w) => [link(w.url, w.title), el('span', 'r', fmt(w.views) + '회')]);
    $('n-reddit-box').hidden = REGION !== 'global';
    if (REGION === 'global') list('n-reddit', (d.reddit || []).slice(0, 12), (p) => { const b = el('span'); b.append(link(p.url, p.title), el('span', 'sub', 'r/' + p.subreddit)); return [b, el('span', 'r', '▲' + fmt(p.ups))]; });
  }

  async function load(region) {
    const c = cache[region] || (cache[region] = {});
    try {
      const r = await fetch('/api/trends?region=' + region);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      c.data = await r.json();
      if (region === REGION) render();
    } catch (e) {
      if (region === REGION) $('n-meta').textContent = '불러오기 실패 · 잠시 후 다시 시도해 주세요';
    }
    try {
      const j = await (await fetch('/api/trend-reasons?region=' + region)).json();
      c.reasons = j.reasons || {}; c.meta = { model: j.model, error: j.error };
      if (region === REGION) render();
    } catch (e) { c.meta = { error: 'fetch' }; }
  }

  document.querySelectorAll('#n-region button').forEach((b) => b.addEventListener('click', () => {
    REGION = b.dataset.r;
    document.querySelectorAll('#n-region button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    try { history.replaceState(null, '', REGION === 'kr' ? '#news' : '#news-global'); } catch (e) {}
    if (cache[REGION] && cache[REGION].data) render();
    load(REGION);
  }));

  // 상단 "코인·주식 / 일반 소식" 전환
  let loaded = false;
  function show(v) {
    document.body.dataset.view = v;
    $('view-market').hidden = v !== 'market';
    view.hidden = v !== 'news';
    document.querySelectorAll('.viewseg button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.view === v)));
    if (v === 'news') {
      if (!loaded) { loaded = true; load(REGION); } else render();
      try { if (!location.hash.startsWith('#news')) history.replaceState(null, '', REGION === 'kr' ? '#news' : '#news-global'); } catch (e) {}
    } else {
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
      const rb = $('reload'); if (rb) rb.click();
    }
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.viewseg button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
  const rb = $('reload');
  if (rb) rb.addEventListener('click', () => { if (document.body.dataset.view === 'news') load(REGION); });
  setInterval(() => { if (document.body.dataset.view === 'news') load(REGION); }, 2 * 60 * 1000);
  setInterval(() => { if (document.body.dataset.view === 'news') render(); }, 60 * 1000);

  if (location.hash.startsWith('#news')) {
    if (location.hash === '#news-global') { REGION = 'global'; document.querySelectorAll('#n-region button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.r === 'global'))); }
    show('news');
  } else {
    document.body.dataset.view = 'market';
  }
})();
