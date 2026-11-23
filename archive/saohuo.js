export const meta = {
  id: 'saohuo',
  name: '烧火电影',
  version: '1.0.1',
  protocol: 1,
  description: '烧火电影：分类、搜索、多线路详情与 iframe 解析播放。',
  author: 'community',
  kind: 'source',
  linkDomains: ['shdy2.com'],
  defaultHeaders: {
    Referer: 'https://shdy2.com/',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://shdy2.com';
const UA = 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36';
const TABS = [
  { id: '1', label: '电影', type: 'movie' },
  { id: '2', label: '电视剧', type: 'series' },
  { id: '4', label: '动漫', type: 'anime' },
];

export default function (hg) {
  function origin() {
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return SITE;
  }

  function headers() {
    return { 'User-Agent': UA, Referer: origin() + '/' };
  }

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  async function fetchHtml(url, ctx, extra) {
    const res = await hg.http.fetch({
      url,
      headers: Object.assign(headers(), extra || {}),
      responseType: 'text',
      timeoutMs: 15000,
      retry: 1,
      maxBytes: 8 * 1024 * 1024,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
    return res.data;
  }

  function absUrl(href) {
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return href;
    if (href.startsWith('//')) return 'https:' + href;
    const o = origin();
    return href.startsWith('/') ? o + href : o + '/' + href;
  }

  function pathId(href) {
    try { return new URL(absUrl(href)).pathname; } catch (_) { return String(href || ''); }
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function typeOf(id) {
    for (let i = 0; i < TABS.length; i++) if (TABS[i].id === id) return TABS[i].type;
    return 'other';
  }

  function parseCards(html, typeHint) {
    const doc = hg.html.parse(html);
    const items = [];
    const nodes = doc.select('ul.v_list div.v_img');
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i].first('a');
      if (!a) continue;
      const href = a.attr('href');
      const title = a.attr('title') || a.text();
      if (!href || !title) continue;
      const img = nodes[i].first('img');
      const cover = img && (img.attr('data-original') || img.attr('src'));
      const noteEl = nodes[i].first('.v_note');
      const item = { id: pathId(href), title: title.trim(), type: typeHint || 'other' };
      if (cover) item.cover = absUrl(cover);
      if (noteEl) {
        const note = noteEl.text().trim();
        if (note) item.badge = note.slice(0, 8);
      }
      items.push(item);
    }
    return items;
  }

  function guessFormat(url) {
    if (/\.m3u8(\?|$)/i.test(url)) return 'hls';
    if (/\.mp4(\?|$)/i.test(url)) return 'progressive';
    return 'hls';
  }

  return {
    endpoints: { list() { return [{ id: 'main', label: '主站', url: SITE }]; } },

    home: {
      async getSections(params, ctx) {
        const html = await fetchHtml(origin() + '/list/1-1.html', ctx);
        return { items: [{ id: 'movie', title: '电影', layout: 'grid', items: parseCards(html, 'movie') }], next: null };
      },
    },

    catalog: {
      async getCategories() {
        return TABS.map(function (t) { return { id: t.id, label: t.label }; });
      },
      async list(params, ctx) {
        const id = (params && params.categoryId) || '1';
        const page = pageOf(params && params.cursor);
        const html = await fetchHtml(origin() + '/list/' + id + '-' + page + '.html', ctx);
        const items = parseCards(html, typeOf(id));
        return { items, next: items.length ? String(page + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const html = await fetchHtml(origin() + '/s----------.html?wd=' + encodeURIComponent(q), ctx);
        return { items: parseCards(html), next: null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id;
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const html = await fetchHtml(absUrl(id), ctx);
        const doc = hg.html.parse(html);
        const titleEl = doc.first('h1') || doc.first('.v_title');
        const title = titleEl ? titleEl.text().trim() : String(id);
        const fromNodes = doc.select('ul.from_list li');
        const playNodes = doc.select('#play_link li');
        const playlists = [];
        for (let i = 0; i < playNodes.length; i++) {
          const label = fromNodes[i] ? fromNodes[i].text().trim() : ('线路' + (i + 1));
          const links = playNodes[i].select('a');
          const episodes = [];
          for (let j = 0; j < links.length; j++) {
            const href = links[j].attr('href');
            if (!href) continue;
            episodes.push({
              id: pathId(href),
              index: j + 1,
              episodeNumber: j + 1,
              label: links[j].text().trim() || String(j + 1),
            });
          }
          episodes.sort(function (a, b) {
            const na = parseInt(String(a.label).match(/\d+/) || '0', 10);
            const nb = parseInt(String(b.label).match(/\d+/) || '0', 10);
            return na - nb;
          });
          for (let k = 0; k < episodes.length; k++) episodes[k].index = k + 1;
          if (episodes.length) playlists.push({ id: String(i + 1), label, episodes });
        }
        if (!playlists.length) fail('UPSTREAM_CHANGED', '未解析到分集');
        return {
          id: pathId(id),
          title,
          type: playlists[0].episodes.length > 1 ? 'series' : 'movie',
          playlists,
        };
      },

      async resolvePlayback(params, ctx) {
        const episodeId = params && params.episodeId;
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const html = await fetchHtml(absUrl(episodeId), ctx);
        const doc = hg.html.parse(html);
        const iframe = doc.first('iframe');
        const iframeSrc = iframe && iframe.attr('src');
        if (!iframeSrc) fail('UPSTREAM_CHANGED', '未找到播放框');
        const playerUrl = absUrl(iframeSrc);
        const playerHtml = await fetchHtml(playerUrl, ctx, { Referer: absUrl(episodeId) });
        const bm = playerHtml.match(/__HHJX_BOOTSTRAP__\s*=\s*(\{[\s\S]*?\})/);
        if (!bm) fail('UPSTREAM_CHANGED', '未找到解析引导');
        let boot = {};
        try { boot = JSON.parse(bm[1]); } catch (_) { fail('UPSTREAM_CHANGED', '解析引导不是 JSON'); }
        const cipher = (playerUrl.match(/[?&]url=([0-9A-Fa-f]+)/) || [])[1];
        const apiOrigin = (playerUrl.match(/^(https?:\/\/[^/]+)/) || [])[1];
        if (!apiOrigin) fail('UPSTREAM_CHANGED', '解析域名无效');
        const res = await hg.http.fetch({
          url: apiOrigin + '/api/parse',
          method: 'POST',
          headers: {
            'User-Agent': UA,
            Referer: playerUrl,
            'Content-Type': 'application/json',
          },
          body: { json: { url: boot.url || cipher, t: boot.t, key: boot.key, client_fallback: false } },
          responseType: 'json',
          timeoutMs: 20000,
          signal: ctx && ctx.signal,
        });
        if (!res.ok) fail('UPSTREAM_ERROR', '解析暂时不可用（HTTP ' + res.status + '）');
        let playUrl = res.data && res.data.url;
        if (!playUrl) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        if (playUrl.indexOf('http://') === 0) playUrl = playUrl.replace('http://', 'https://');
        return {
          streams: [{
            url: playUrl,
            kind: 'media',
            format: guessFormat(playUrl),
            headers: { 'User-Agent': UA, Referer: playerUrl },
          }],
        };
      },
    },
  };
}
