export const meta = {
  id: 'avtoday',
  name: 'avtoday',
  version: '1.0.1',
  protocol: 1,
  description: 'avtoday：分类、搜索、详情与 HLS 播放。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['avtoday.io'],
  defaultHeaders: {
    Referer: 'https://avtoday.io/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://avtoday.io';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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
    try {
      const u = new URL(absUrl(href));
      return u.pathname.replace(/\/$/, '');
    } catch (_) {
      return String(href || '');
    }
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function parseCards(html) {
    const doc = hg.html.parse(html);
    const items = [];
    const nodes = doc.select('.thumbnail');
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i].first('.video-title a');
      const title = a && a.text();
      if (!title || title.indexOf('[廣告]') >= 0) continue;
      const href = a.attr('href');
      if (!href) continue;
      const preview = nodes[i].first('.preview-video');
      const style = preview && preview.attr('style');
      const coverM = style && style.match(/url\('(.*?)'\)/);
      const tag = nodes[i].first('.video-tag');
      const item = { id: pathId(href), title: title.trim(), type: 'movie' };
      if (coverM) item.cover = absUrl(coverM[1]);
      if (tag) {
        const note = tag.text().trim();
        if (note) item.badge = note.slice(0, 8);
      }
      items.push(item);
    }
    return items;
  }

  async function loadTabs(ctx) {
    const html = await fetchHtml(origin() + '/catalog', ctx);
    const doc = hg.html.parse(html);
    const slides = doc.select('.swiper-wrapper > .swiper-slide');
    const items = [];
    for (let i = 0; i < slides.length; i++) {
      const nameEl = slides[i].first('.btn-categories__title');
      const a = slides[i].first('a.btn-categories');
      const name = nameEl ? nameEl.text().trim() : '';
      const href = a && a.attr('href');
      if (!name || !href) continue;
      items.push({ id: absUrl(href), label: name });
    }
    return items.length ? items : [{ id: origin() + '/catalog', label: '目录' }];
  }

  return {
    endpoints: { list() { return [{ id: 'main', label: '主站', url: SITE }]; } },

    home: {
      async getSections(params, ctx) {
        const html = await fetchHtml(origin() + '/', ctx);
        return { items: [{ id: 'latest', title: '最新', layout: 'grid', items: parseCards(html) }], next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        return loadTabs(ctx);
      },
      async list(params, ctx) {
        const cat = (params && params.categoryId) || origin() + '/';
        const page = pageOf(params && params.cursor);
        let url = absUrl(cat);
        if (page > 1) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'page=' + page;
        const html = await fetchHtml(url, ctx);
        const items = parseCards(html);
        return { items, next: items.length ? String(page + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const page = pageOf(params && params.cursor);
        const html = await fetchHtml(origin() + '/search?s=' + encodeURIComponent(q) + '&page=' + page, ctx);
        const items = parseCards(html);
        return { items, next: items.length ? String(page + 1) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id;
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const url = absUrl(id);
        const html = await fetchHtml(url, ctx);
        const doc = hg.html.parse(html);
        const titleEl = doc.first('h1') || doc.first('.video-title');
        const title = titleEl ? titleEl.text().trim() : String(id);
        return {
          id: pathId(id),
          title,
          type: 'movie',
          playlists: [{
            id: 'main',
            label: '默认',
            episodes: [{ id: pathId(id), index: 1, episodeNumber: 1, label: '播放' }],
          }],
        };
      },

      async resolvePlayback(params, ctx) {
        const episodeId = params && params.episodeId;
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const pageUrl = absUrl(episodeId);
        const code = (pageUrl.split('/video/')[1] || '').replace(/\/$/, '');
        if (!code) fail('INVALID_ARGUMENT', '作品编号无效');
        const playerUrl = origin() + '/player?s=' + encodeURIComponent(code);
        const html = await fetchHtml(playerUrl, ctx, { Referer: pageUrl });
        const m = html.match(/m3u8_url\s+=\s+'(.+)'/);
        if (!m) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        return {
          streams: [{
            url: m[1],
            kind: 'media',
            format: 'hls',
            headers: { 'User-Agent': UA, Referer: playerUrl + '/' },
          }],
        };
      },
    },
  };
}
