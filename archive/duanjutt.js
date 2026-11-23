export const meta = {
  id: 'duanjutt',
  name: '短剧天堂',
  version: '1.0.1',
  protocol: 1,
  description: '短剧天堂：分类、详情与播放。搜索页有验证码，当前不提供搜索。',
  author: 'community',
  kind: 'source',
  linkDomains: ['duanjutt.tv'],
  defaultHeaders: {
    Referer: 'https://duanjutt.tv/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://duanjutt.tv';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FALLBACK_TABS = [
  { id: '/vodtype/1.html', label: '短剧' },
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

  async function fetchHtml(url, ctx) {
    const res = await hg.http.fetch({
      url,
      headers: headers(),
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

  async function loadTabs(ctx) {
    try {
      const html = await fetchHtml(origin() + '/', ctx);
      const doc = hg.html.parse(html);
      const links = doc.select('.dropdown-box ul li a');
      const items = [];
      for (let i = 0; i < links.length; i++) {
        const name = links[i].text().trim();
        const href = links[i].attr('href');
        if (!name || !href) continue;
        if (name.includes('首页') || name.includes('明星')) continue;
        items.push({ id: pathId(href), label: name });
      }
      if (items.length) return items;
    } catch (_) {}
    return FALLBACK_TABS.slice();
  }

  function parseCards(html) {
    const doc = hg.html.parse(html);
    const items = [];
    const nodes = doc.select('.myui-vodlist li');
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i].first('a.myui-vodlist__thumb') || nodes[i].first('a');
      if (!a) continue;
      const href = a.attr('href');
      const title = a.attr('title') || a.text();
      if (!href || !title) continue;
      const cover = a.attr('data-original') || a.attr('src');
      const noteEl = nodes[i].first('.pic-text');
      const item = { id: pathId(href), title: title.trim(), type: 'short' };
      if (cover) item.cover = absUrl(cover);
      if (noteEl) {
        const note = noteEl.text().trim();
        if (note) item.badge = note.slice(0, 8);
      }
      items.push(item);
    }
    return items;
  }

  function parsePlayer(html) {
    const m = html.match(/r player.*=\{(.*)\}/);
    if (!m) return null;
    try { return JSON.parse('{' + m[1] + '}'); } catch (_) { return null; }
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
        const tabs = await loadTabs(ctx);
        const html = await fetchHtml(absUrl(tabs[0].id), ctx);
        return { items: [{ id: 'latest', title: tabs[0].label, layout: 'grid', items: parseCards(html) }], next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        return loadTabs(ctx);
      },
      async list(params, ctx) {
        const cat = (params && params.categoryId) || FALLBACK_TABS[0].id;
        const page = pageOf(params && params.cursor);
        let url = absUrl(cat);
        if (page > 1) url = url.replace('.html', '-' + page + '.html');
        const html = await fetchHtml(url, ctx);
        const items = parseCards(html);
        return { items, next: items.length ? String(page + 1) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id;
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const html = await fetchHtml(absUrl(id), ctx);
        const doc = hg.html.parse(html);
        const titleEl = doc.first('h1') || doc.first('.myui-content__detail h1');
        const title = titleEl ? titleEl.text().trim() : String(id);
        const img = doc.first('.myui-content__thumb img') || doc.first('.lazyload');
        const cover = img && (img.attr('data-original') || img.attr('src'));
        const links = doc.select('#playlist1 a');
        const episodes = [];
        for (let i = 0; i < links.length; i++) {
          const href = links[i].attr('href');
          if (!href) continue;
          episodes.push({
            id: pathId(href),
            index: i + 1,
            episodeNumber: i + 1,
            label: links[i].text().trim() || String(i + 1),
          });
        }
        if (!episodes.length) fail('UPSTREAM_CHANGED', '未解析到分集');
        const detail = {
          id: pathId(id),
          title,
          type: 'short',
          playlists: [{ id: 'main', label: '默认', episodes }],
        };
        if (cover) detail.cover = absUrl(cover);
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const episodeId = params && params.episodeId;
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const html = await fetchHtml(absUrl(episodeId), ctx);
        const cfg = parsePlayer(html);
        if (!cfg || cfg.encrypt !== 0 || !cfg.url) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        return {
          streams: [{
            url: cfg.url,
            kind: 'media',
            format: guessFormat(cfg.url),
            headers: headers(),
          }],
        };
      },
    },
  };
}
