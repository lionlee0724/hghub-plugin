export const meta = {
  id: 'anfuns',
  name: 'anfuns',
  version: '1.0.1',
  protocol: 1,
  description: 'anfuns 动漫源：分类、搜索、多线路详情与播放解析。',
  author: 'community',
  kind: 'source',
  linkDomains: ['anfuns.org', 'www.anfuns.org'],
  defaultHeaders: {
    Referer: 'https://www.anfuns.org/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://www.anfuns.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TABS = [
  { id: '0', label: '最近更新' },
  { id: '1', label: '新旧番剧' },
  { id: '2', label: '蓝光无修' },
  { id: '3', label: '动漫剧场' },
  { id: '4', label: '欧美动漫' },
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

  function parseCards(html) {
    const doc = hg.html.parse(html);
    const items = [];
    const nodes = doc.select('.hl-list-item, li.hl-list-item');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const a = el.first('.hl-item-thumb') || el.first('.hl-item-wrap') || el.first('a');
      const href = a && a.attr('href');
      const title = (el.first('.hl-item-title') && el.first('.hl-item-title').text()) || (a && (a.attr('title') || a.text()));
      if (!href || !title) continue;
      const cover = a && (a.attr('data-original') || a.attr('src'));
      const noteEl = el.first('.remarks') || el.first('.hl-text-subs');
      const item = { id: pathId(href), title: title.trim(), type: 'anime' };
      if (cover) item.cover = absUrl(cover);
      if (noteEl) {
        const note = noteEl.text().replace('/', '').trim();
        if (note) item.badge = note.slice(0, 8);
      }
      items.push(item);
    }
    return items;
  }

  function parsePlayer(html) {
    const m = html.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (_) { return null; }
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
        const html = await fetchHtml(origin() + '/map.html', ctx);
        return { items: [{ id: 'latest', title: '最近更新', layout: 'grid', items: parseCards(html) }], next: null };
      },
    },

    catalog: {
      async getCategories() {
        return TABS.map(function (t) { return { id: t.id, label: t.label }; });
      },
      async list(params, ctx) {
        const id = (params && params.categoryId) || '0';
        const page = pageOf(params && params.cursor);
        const url = id === '0' ? origin() + '/map.html' : origin() + '/type/' + id + '-' + page + '.html';
        const html = await fetchHtml(url, ctx);
        const items = parseCards(html);
        return { items, next: id === '0' ? null : (items.length ? String(page + 1) : null) };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const page = pageOf(params && params.cursor);
        const html = await fetchHtml(origin() + '/search/page/' + page + '/wd/' + encodeURIComponent(q) + '.html', ctx);
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
        const titleEl = doc.first('h2') || doc.first('.hl-dc-title') || doc.first('h1');
        const title = titleEl ? titleEl.text().trim() : String(id);
        const img = doc.first('.hl-dc-pic img') || doc.first('.hl-item-thumb');
        const cover = img && (img.attr('data-original') || img.attr('src'));
        const from = doc.select('.hl-plays-from a');
        const lists = doc.select('ul.hl-plays-list');
        const playlists = [];
        for (let i = 0; i < lists.length; i++) {
          const label = from[i] ? from[i].text().trim() : ('线路' + (i + 1));
          const links = lists[i].select('li a');
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
          if (episodes.length) playlists.push({ id: String(i + 1), label, episodes });
        }
        if (!playlists.length) fail('UPSTREAM_CHANGED', '未解析到分集');
        const detail = {
          id: pathId(id),
          title,
          type: 'anime',
          playlists,
        };
        if (cover) detail.cover = absUrl(cover);
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const episodeId = params && params.episodeId;
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const pageUrl = absUrl(episodeId);
        const html = await fetchHtml(pageUrl, ctx);
        const cfg = parsePlayer(html);
        if (!cfg || !cfg.url) fail('UPSTREAM_CHANGED', '未解析到播放配置');
        const artUrl = origin() + '/vapi/AIRA/art.php?url=' + encodeURIComponent(cfg.url);
        const artHtml = await fetchHtml(artUrl, ctx);
        const m = artHtml.match(/url:\s*'([^']+)'/);
        const playUrl = m && m[1];
        if (!playUrl) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        return {
          streams: [{
            url: playUrl,
            kind: 'media',
            format: guessFormat(playUrl),
            headers: { 'User-Agent': UA, Referer: pageUrl },
          }],
        };
      },
    },
  };
}
