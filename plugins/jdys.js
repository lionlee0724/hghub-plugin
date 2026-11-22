export const meta = {
  id: 'jdys',
  name: '绝对影视',
  version: '1.0.1',
  protocol: 1,
  description: '绝对影视：分类、搜索、详情与 AES 播放解析。',
  author: 'community',
  kind: 'source',
  linkDomains: ['jdys.art', 'www.jdys.art'],
  defaultHeaders: {
    Referer: 'https://www.jdys.art/',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://www.jdys.art';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FALLBACK_TABS = [
  { id: '/', label: '首页' },
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
    try {
      const u = new URL(absUrl(href));
      return u.pathname.replace(/\/$/, '') || '/';
    } catch (_) {
      return String(href || '');
    }
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  async function loadTabs(ctx) {
    try {
      const html = await fetchHtml(origin() + '/', ctx);
      const doc = hg.html.parse(html);
      const links = doc.select('.menu-item-type-post_type a');
      const items = [];
      for (let i = 0; i < links.length; i++) {
        const name = links[i].text().trim();
        const href = links[i].attr('href');
        if (!name || !href || name.includes('影视类型')) continue;
        items.push({ id: absUrl(href), label: name });
      }
      if (items.length) return items;
    } catch (_) {}
    return FALLBACK_TABS.map(function (t) { return { id: origin() + t.id, label: t.label }; });
  }

  function parseCards(html) {
    const doc = hg.html.parse(html);
    const items = [];
    const nodes = doc.select('.bt_img.mi_ne_kd ul li, .bt_img li');
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i].first('a');
      const titleEl = nodes[i].first('h3.dytit > a') || a;
      const href = a && a.attr('href');
      const title = titleEl && titleEl.text();
      if (!href || !title) continue;
      const img = nodes[i].first('img');
      const cover = img && (img.attr('data-original') || img.attr('src'));
      const cat = nodes[i].first('.dytit .dycategory > a');
      const item = { id: absUrl(href), title: title.trim(), type: 'other' };
      if (cover) item.cover = absUrl(cover);
      if (cat) {
        const note = cat.text().trim();
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
        if (page > 1) url = url.replace(/\/?$/, '/') + 'page/' + page + '/';
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
        let url = origin() + '/?s=' + encodeURIComponent(q);
        if (page > 1) url = origin() + '/page/' + page + '/?s=' + encodeURIComponent(q);
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
        const titleEl = doc.first('h1') || doc.first('.moviedteail_tt h1');
        const title = titleEl ? titleEl.text().trim() : String(id);
        const img = doc.first('.dyimg img') || doc.first('.poster img');
        const cover = img && (img.attr('src') || img.attr('data-original'));
        const links = doc.select('.paly_list_btn a');
        const episodes = [];
        for (let i = 0; i < links.length; i++) {
          const href = links[i].attr('href');
          if (!href) continue;
          episodes.push({
            id: absUrl(href),
            index: i + 1,
            episodeNumber: i + 1,
            label: links[i].text().trim() || String(i + 1),
          });
        }
        if (!episodes.length) fail('UPSTREAM_CHANGED', '未解析到分集');
        const detail = {
          id: absUrl(id),
          title,
          type: episodes.length > 1 ? 'series' : 'movie',
          playlists: [{ id: 'online', label: '在线', episodes }],
        };
        if (cover) detail.cover = absUrl(cover);
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const episodeId = params && params.episodeId;
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const html = await fetchHtml(absUrl(episodeId), ctx);
        const doc = hg.html.parse(html);
        const box = doc.first('.videoplay script');
        const script = box ? box.text() : html;
        const encM = script.match(/var\s+[^=]*=\s*"([^"]*)";/);
        const matches = [];
        const re = /parse\((.*?)\)/g;
        let m;
        while ((m = re.exec(script))) matches.push(m[1]);
        if (!encM || matches.length < 2) fail('UPSTREAM_CHANGED', '未找到播放密钥');
        const key = String(matches[0]).replace(/"/g, '');
        const iv = String(matches[1]).replace(/"/g, '');
        const plain = hg.codec.utf8Decode(hg.crypto.aesDecrypt({
          mode: 'cbc',
          key: hg.codec.utf8Encode(key),
          iv: hg.codec.utf8Encode(iv),
          padding: 'pkcs7',
        }, hg.codec.base64Decode(encM[1])));
        const urlM = plain.match(/url:\s*"(.*?)"/);
        if (!urlM) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        return {
          streams: [{
            url: urlM[1],
            kind: 'media',
            format: guessFormat(urlM[1]),
            headers: headers(),
          }],
        };
      },
    },
  };
}
