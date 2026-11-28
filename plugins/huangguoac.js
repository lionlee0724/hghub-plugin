export const meta = {
  id: 'huangguoac',
  name: '黄果漫剧',
  version: '0.1.1',
  protocol: 1,
  kind: 'source',
  description: '黄果漫剧（huangguoac.net 为官方地址发布页，内容在 huangguoac.com 及其镜像）：AI 成人短剧、里番动漫、日漫、韩漫。每集页面的 SSR 里直接内嵌带签名的 HLS 地址，游客即可播放，不用登录也不消耗金币，一部作品的全部集数都能直接看。',
  mature: true,
  linkDomains: ['huangguoac.net', 'huangguoac.com', 'ctvr2.zeemeodb.cc', 'vt8f.zeemeodb.cc', 'i5g1.zeemeodb.cc'],
  defaultHeaders: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 25, playback: 30 },
};

export default function (hg) {
  // huangguoac.com 常被 TLS 重置；huangguoac.net 只是地址发布页，不给内容。
  const MIRRORS = [
    'https://ctvr2.zeemeodb.cc',
    'https://vt8f.zeemeodb.cc',
    'https://i5g1.zeemeodb.cc',
    'https://huangguoac.com',
  ];
  const PUBLISHER_HOSTS = ['huangguoac.net', 'www.huangguoac.net'];

  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  const MAX_BYTES = 4 * 1024 * 1024;
  // 封面图在 CDN 上是 AES-128-CBC 加密的（content-type 退化成 octet-stream），
  // 用宿主原生 aes-cbc 还原，不占插件运行时。
  const IMG_KEY_ASCII = 'f5d965df75336270';
  const IMG_IV_ASCII = '97b60394abc2fbe1';

  function isImageHost(host) {
    const h = String(host || '').toLowerCase();
    return h.indexOf('pic.') === 0;
  }

  function imgRef(url) {
    const u = String(url || '').trim();
    if (!u) return '';
    const abs = u.replace(/^http:\/\//i, 'https://');
    let host = '';
    try {
      host = new URL(abs).hostname;
    } catch {
      return abs;
    }
    if (!isImageHost(host)) return abs;
    return {
      url: abs,
      transform: {
        type: 'aes-cbc',
        key: hg.codec.base64Encode(IMG_KEY_ASCII),
        iv: hg.codec.base64Encode(IMG_IV_ASCII),
        padding: 'pkcs7',
      },
    };
  }

  const CATS = [
    { id: 'duanju', label: '成人短剧' },
    { id: 'ai-manju', label: 'AI漫剧' },
    { id: 'lifan-dongman', label: '里番动漫' },
  ];

  // riman / hanman 是漫画（/comic/ 链接），没有视频流，不收。
  const VIDEO_RE = /^https?:\/\/[^/]+\/video\/(\d+)\/?(?:(?:ep-(\d+))\/?)?(?:\?.*)?$/i;

  function base() {
    const cur = hg.endpoint && hg.endpoint.current;
    const url = cur && typeof cur.url === 'string' ? cur.url.replace(/\/+$/, '') : '';
    if (url) {
      try {
        if (!PUBLISHER_HOSTS.includes(new URL(url).hostname.toLowerCase())) return url;
      } catch {
        // 解析不了就当没配
      }
    }
    return MIRRORS[0];
  }

  function textOf(res) {
    const d = res && res.data;
    if (typeof d === 'string') return d;
    if (d == null) return '';
    try {
      return String(d);
    } catch {
      return '';
    }
  }

  // 页面里的 JSON 被转义过一层：\u0026 与 \" 都要还原，否则 m3u8 的签名参数会断。
  function unescapeAll(s) {
    return String(s || '')
      .replace(/\\u0026/g, '&')
      .replace(/\\"/g, '"')
      .replace(/\\\//g, '/')
      .replace(/&amp;/g, '&');
  }

  // 站点 CDN 的缓存键不含 query，?page= / ?q= 会被忽略，分页只能靠 path 变化。
  async function fetchText(path, ctx, ttl, accept) {
    let lastError = null;
    const start = base();
    const order = [start, ...MIRRORS.filter((m) => m !== start)];
    for (const host of order) {
      try {
        const res = await hg.http.fetch({
          url: `${host}${path}`,
          headers: {
            'User-Agent': UA,
            Accept: accept || 'text/html,application/xhtml+xml',
            Referer: `${host}/`,
          },
          retry: 1,
          maxBytes: MAX_BYTES,
          signal: ctx && ctx.signal,
          ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 1800 } } : {}),
        });
        if (res.status === 404) throw new hg.PluginError('NOT_FOUND', '内容不存在或已下架');
        if (!res.ok) {
          lastError = new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
          continue;
        }
        return unescapeAll(textOf(res));
      } catch (error) {
        if (error && error.code === 'CANCELLED') throw error;
        if (error && error.code === 'NOT_FOUND') throw error;
        lastError = error;
      }
    }
    throw lastError || new hg.PluginError('UPSTREAM_ERROR', '所有线路都连不上');
  }

  // 列表区卡片是 hg-comic-feed-card__cover；封面走懒加载 data-src，src 只是占位图。
  // 推荐位用的是 hg-drama-card，选择器必须区分开，否则会混进热搜榜条目。
  function cardsOf(html) {
    const out = [];
    const seen = new Set();
    const re = /<a[^>]+href="\/video\/(\d+)\/"[^>]*>\s*<div class="hg-comic-feed-card__cover">\s*<img[^>]*data-src="([^"]+)"[^>]*alt="([^"]*)"/g;
    let m;
    while ((m = re.exec(html))) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({
        id: m[1],
        title: String(m[3] || '').replace(/\s+/g, ' ').trim(),
        cover: imgRef(m[2]),
      });
    }
    return out.filter((x) => x.title);
  }

  function uniq(items) {
    const seen = new Set();
    const out = [];
    for (const it of items || []) {
      if (!it || !it.id || seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
    return out;
  }

  function pageNo(cursor) {
    const n = parseInt(cursor, 10);
    return Number.isFinite(n) && n > 1 ? n : 1;
  }

  async function listPage(catId, page, ctx) {
    const path = page > 1 ? `/${catId}/${page}/` : `/${catId}/`;
    const html = await fetchText(path, ctx, 180);
    const items = uniq(cardsOf(html));
    const totalPages = Number((html.match(/data-pages="(\d+)"/) || [])[1] || 0);
    return { items, totalPages };
  }

  function playSrcFromPage(html, ep) {
    // 每集页面的 SSR 内嵌 epPlaySrcs，但只含当前集与左右各一集，所以按集号逐页取。
    const block = html.match(/"epPlaySrcs":\{([\s\S]*?)\},"following"/);
    if (block) {
      const map = {};
      for (const x of block[1].matchAll(/"(\d+)":"([^"]+)"/g)) map[x[1]] = unescapeAll(x[2]);
      if (ep && map[String(ep)]) return map[String(ep)];
      const first = Object.keys(map).sort((a, b) => Number(a) - Number(b))[0];
      if (first) return map[first];
    }
    const direct = html.match(/"videoSrc":"(https?:[^"]*m3u8[^"]*)"/);
    if (direct) return unescapeAll(direct[1]);
    const attr = html.match(/data-play-src="([^"]+)"/);
    return attr ? unescapeAll(attr[1]) : '';
  }

  async function fetchDetail(id, ctx) {
    const html = await fetchText(`/video/${id}/`, ctx, 300);

    const rawTitle =
      (html.match(/"title":"([^"]{1,80})"/) || [])[1] ||
      (html.match(/property="og:title" content="([^"]*)"/) || [])[1] ||
      '';
    const title = String(rawTitle)
      .replace(/^《/, '')
      .replace(/》第\d+集.*$/, '')
      .replace(/》.*$/, '')
      .replace(/\s*[-|｜]\s*黄果漫剧.*$/i, '')
      .trim();

    const cover =
      (html.match(/"coverSrc":"(https:\/\/[^"]+)"/) || [])[1] ||
      (html.match(/"posterSrc":"(https:\/\/[^"]+)"/) || [])[1] ||
      (html.match(/property="og:image" content="([^"]+)"/) || [])[1] ||
      '';

    const desc = (html.match(/"description":"((?:[^"\\]|\\.){0,400})"/) || [])[1] || '';

    const tags = (() => {
      const m = html.match(/"tags":\[([^\]]*)\]/);
      if (!m) return [];
      try {
        return JSON.parse(`[${m[1]}]`).filter((x) => typeof x === 'string' && x);
      } catch {
        return [];
      }
    })();

    const eps = [...new Set([...html.matchAll(/data-ep-id="(\d+)"/g)].map((m) => Number(m[1])))]
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);

    return {
      id: String(id),
      title: title || `作品 ${id}`,
      cover: imgRef(cover),
      description: String(desc).replace(/\\n/g, ' ').slice(0, 400),
      tags: tags.slice(0, 8),
      episodes: eps.length ? eps : [1],
    };
  }

  async function streamOf(id, ep, ctx) {
    const page = ep > 1 ? `/video/${id}/ep-${ep}/` : `/video/${id}/`;
    const html = await fetchText(page, ctx, 0);
    const src = playSrcFromPage(html, ep);
    if (!src) throw new hg.PluginError('CONTENT_LOCKED', `第 ${ep} 集没有给出播放地址（可能需要登录或付费）`);
    return src;
  }

  function streamHeaders() {
    return { 'User-Agent': UA, Referer: `${MIRRORS[0]}/` };
  }

  return {
    home: {
      async getSections(params, ctx) {
        const sections = [];
        for (const cat of CATS) {
          let items = [];
          try {
            const r = await listPage(cat.id, 1, ctx);
            items = r.items;
          } catch (error) {
            if (error && error.code === 'CANCELLED') throw error;
            continue;
          }
          if (!items.length) continue;
          sections.push({
            id: `c${cat.id}`,
            title: cat.label,
            layout: sections.length === 0 ? 'row' : 'grid',
            items: items.slice(0, 24),
          });
        }
        if (!sections.length) throw new hg.PluginError('UPSTREAM_ERROR', '首页各分区都取不到内容');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories() {
        return CATS.map((c) => ({ id: c.id, label: c.label }));
      },

      async list(params, ctx) {
        const cid = String((params && params.categoryId) || '').trim();
        if (!CATS.some((c) => c.id === cid)) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const page = pageNo(params && params.cursor);
        const { items, totalPages } = await listPage(cid, page, ctx);
        const out = { items };
        if (totalPages ? page < totalPages : items.length >= 20) out.next = String(page + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const kw = String((params && params.query) || '').replace(/\s+/g, ' ').trim();
        if (!kw) return { items: [] };

        // 站点 CDN 的缓存键不含 query，/search/?q= 常被别的关键词的缓存顶掉。
        // 只有页面回显的关键词与请求一致才采信。
        try {
          const html = await fetchText(`/search/?q=${encodeURIComponent(kw)}`, ctx, 0);
          const echoed =
            (html.match(/data-track-keyword="([^"]*)"/) || [])[1] ||
            (html.match(/<title>([^<]*)的漫剧搜索结果/) || [])[1] ||
            '';
          const at = html.indexOf('hg-search-results');
          if (at >= 0 && echoed && echoed.includes(kw)) {
            const items = uniq(cardsOf(html.slice(at, at + 80000)));
            if (items.length) return { items: items.slice(0, 40) };
          }
        } catch (error) {
          if (error && error.code === 'CANCELLED') throw error;
        }

        // 回退：各分类首页做本地匹配。覆盖最新内容，站点搜索恢复后会自动走上面那条。
        const needle = kw.toLowerCase();
        const pool = [];
        for (const cat of CATS) {
          try {
            const r = await listPage(cat.id, 1, ctx);
            pool.push(...r.items);
          } catch (error) {
            if (error && error.code === 'CANCELLED') throw error;
          }
        }
        const items = uniq(pool).filter((x) => String(x.title || '').toLowerCase().includes(needle));
        return { items: items.slice(0, 40) };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = String((params && params.id) || '').trim();
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '内容 ID 不合法');
        const d = await fetchDetail(id, ctx);
        return {
          id: d.id,
          title: d.title,
          cover: d.cover,
          description: d.description,
          tags: d.tags,
          mediaType: d.episodes.length > 1 ? 'series' : 'movie',
          playlists: [
            {
              id: 'main',
              label: '正片',
              kind: 'main',
              episodes: d.episodes.map((n, i) => ({
                id: String(n),
                index: i + 1,
                episodeNumber: n,
                label: `第${n}集`,
              })),
            },
          ],
        };
      },

      async resolvePlayback(params, ctx) {
        const id = String((params && params.mediaId) || '').trim();
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '内容 ID 不合法');
        const ep = Math.max(1, parseInt((params && params.episodeId) || '1', 10) || 1);
        const url = await streamOf(id, ep, ctx);
        return {
          streams: [
            {
              kind: 'media',
              url,
              format: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'progressive',
              headers: streamHeaders(),
            },
          ],
        };
      },

      async matchUrl(params) {
        const m = String((params && params.url) || '').trim().match(VIDEO_RE);
        if (!m) return null;
        return { mediaId: m[1], episodeId: m[2] ? String(Number(m[2])) : '1' };
      },
    },
  };
}