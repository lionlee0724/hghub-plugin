export const meta = {
  id: 'huangpp',
  name: '黄泡泡',
  version: '0.2.0',
  protocol: 1,
  kind: 'source',
  description: '黄泡泡（huangpaopao.club）：二次元里番/同人/3D 动画。游客即可拿到每部作品完整的 HLS 播放地址（站点自行签发 CDN 票据），不需要登录、不消耗金币；合集型作品按站点的 collectionMembers 还原全部集数。首页分区、分类翻页、关键词搜索齐备。注意：短剧（/drama/）第 2 集起要金币，插件只收影集。',
  mature: true,
  linkDomains: ['huangpaopao.club', 'huangpp.com', 'huangpp1.com', 'huangpp2.com', 'huangpp3.com'],
  defaultHeaders: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 25, playback: 30 },
};

export default function (hg) {
  // 内容站在 huangpaopao.club；huangpp.com 与 huangpp1/2/3.com 已改成导航/品牌页，全部内容路径 404。
  const SITE = 'https://huangpaopao.club';
  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  // 单页 16 张卡片，RSC 载荷 40–80 KB，播放页 130 KB 上下，留足余量。
  const MAX_BYTES = 4 * 1024 * 1024;

  const CATS = [
    { id: '10301', label: '里番' },
    { id: '10302', label: '泡面番' },
    { id: '10303', label: '同人动画' },
    { id: '10304', label: '3D动画' },
  ];
  // 封面图是「只异或前 100 字节」的混淆（content-type 也退化成 octet-stream），
  // 宿主没有对应的原生变换，只能走 plugin 钩子自己解。
  // 密钥 13 字节：站点源码 i=new TextEncoder().encode("2019ysapp7527")，按 i[e%i.length] 循环。
  const IMG_XOR_KEY = '2019ysapp7527';

  function imgRef(url) {
    const u = String(url || '').trim();
    if (!u) return '';
    return {
      url: u.replace(/^http:\/\//i, 'https://'),
      transform: { type: 'plugin', name: 'hpp-image' },
    };
  }

  function isImageMagic(u8) {
    if (!u8 || u8.length < 12) return false;
    if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return true;                       // jpeg
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return true;     // png
    if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x38) return true;     // gif
    if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 && u8[8] === 0x57) return true; // webp
    return false;
  }

  function imageMime(u8) {
    if (u8[0] === 0x89) return 'image/png';
    if (u8[0] === 0x47) return 'image/gif';
    if (u8[0] === 0x52) return 'image/webp';
    return 'image/jpeg';
  }
  const WATCH_RE = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:huangpaopao\.club|huangpp\d?\.com)\/series\/watch\/(\d+)\/?(?:\?.*)?$/i;

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

  // RSC 载荷里 JSON 被转义了一层，先还原，再按需截取数组。
  function flatten(text) {
    return String(text || '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  function grabArray(flat, key) {
    const marker = `"${key}":[`;
    const at = flat.indexOf(marker);
    if (at < 0) return null;
    const start = at + marker.length - 1;
    let depth = 0;
    let end = -1;
    let inStr = false;
    let esc = false;
    for (let i = start; i < flat.length; i += 1) {
      const ch = flat[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === '[') depth += 1;
      else if (ch === ']') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) return null;
    try {
      return JSON.parse(flat.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  function trimLabel(raw) {
    let s = String(raw || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/\s*[-|｜]\s*黄泡泡.*$/i, '').trim();
    s = s.replace(/^观看/, '').trim();
    return s;
  }

  // 卡片：RSC/HTML 里都是 "href":"/series/watch/<id>/","aria-label":"观看<标题>"，
  // 封面是紧跟着的 <img src> 或 cover 字段。
  // 大部分卡片的封面直接内联在卡片后面的 <img src> 里；但有一小部分封面被抽成
  // 独立的 flight 区块（如 4c:["$","$L4b",null,{"src":"...","alt":"<标题>"}]），
  // 卡片位置上只剩 $L 引用。这种情况下按 alt == 标题 回查前缀的 src。
  function coverOf(flat, tail, title) {
    const inline =
      (tail.match(/"src":"(https:\/\/[^"]+\.(?:jpg|jpeg|webp|png|avif|gif))"/i) || [])[1] ||
      (tail.match(/"(?:cover|coverImg)":"(https:\/\/[^"]+)"/) || [])[1];
    if (inline) return inline;

    const needle = `"alt":"${String(title || '').replace(/^观看/, '')}"`;
    const at = flat.indexOf(needle);
    if (at < 0) return '';
    const back = flat.slice(Math.max(0, at - 400), at);
    const hits = [...back.matchAll(/"src":"(https:\/\/[^"]+)"/g)];
    return hits.length ? hits[hits.length - 1][1] : '';
  }

  function cardsOf(flat) {
    const out = [];
    const seen = new Set();
    const re = /"href":"\/series\/watch\/(\d+)\/","aria-label":"([^"]+)"/g;
    let m;
    while ((m = re.exec(flat))) {
      const id = m[1];
      if (seen.has(id)) continue;
      const tail = flat.slice(m.index, m.index + 900);
      const cover = coverOf(flat, tail, m[2]);
      seen.add(id);
      out.push({ id, title: trimLabel(m[2]), cover: imgRef(cover) });
    }
    return out;
  }

  // 搜索页的 RSC 里是干净的 data.list，比卡片更准。
  function listOf(flat) {
    const rows = grabArray(flat, 'list');
    if (!Array.isArray(rows)) return null;
    const out = [];
    for (const it of rows) {
      if (!it || typeof it !== 'object') continue;
      const url = String(it.url || '');
      const mm = url.match(/^\/series\/watch\/(\d+)\//);
      if (!mm) continue;
      out.push({
        id: mm[1],
        title: trimLabel(it.title || ''),
        cover: imgRef(it.cover || it.coverImg || ''),
      });
    }
    return out;
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

  async function fetchRsc(path, ctx, ttl) {
    const res = await hg.http.fetch({
      url: `${SITE}${path}?_rsc=hp${ttl || 0}`,
      headers: {
        'User-Agent': UA,
        Accept: 'text/x-component',
        RSC: '1',
        Referer: `${SITE}/`,
      },
      retry: 2,
      maxBytes: MAX_BYTES,
      signal: ctx && ctx.signal,
      ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 1800 } } : {}),
    });
    if (res.status === 404) throw new hg.PluginError('NOT_FOUND', '内容不存在或已下架');
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return flatten(textOf(res));
  }

  async function fetchPage(path, ctx, ttl) {
    const res = await hg.http.fetch({
      url: `${SITE}${path}`,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', Referer: `${SITE}/` },
      retry: 2,
      maxBytes: MAX_BYTES,
      signal: ctx && ctx.signal,
      ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 1800 } } : {}),
    });
    if (res.status === 404) throw new hg.PluginError('NOT_FOUND', '内容不存在或已下架');
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return flatten(textOf(res));
  }

  // 目录页 RSC 里没有 list 键，卡片最稳；RSC 不通就退回 HTML。
  // 站点对连续请求会偶发 404，两个通道都空时再补一轮 RSC。
  async function catalogPage(catId, page, ctx) {
    const path = `/series/all/${catId}/1/page/${page}/`;

    async function attempt(ttl) {
      try {
        const flat = await fetchRsc(path, ctx, ttl);
        const items = cardsOf(flat);
        if (items.length) return items;
      } catch (error) {
        if (error && error.code === 'CANCELLED') throw error;
      }
      try {
        const flat = await fetchPage(path, ctx, ttl);
        const items = cardsOf(flat);
        if (items.length) return items;
      } catch (error) {
        if (error && error.code === 'CANCELLED') throw error;
      }
      return [];
    }

    let items = await attempt(120);
    if (!items.length) items = await attempt(0);
    if (!items.length) throw new hg.PluginError('UPSTREAM_ERROR', '分类页取不到内容');
    return uniq(items);
  }

  async function searchPage(keyword, page, ctx) {
    const path = `/search/${encodeURIComponent(keyword)}/page/${page}/`;
    try {
      const flat = await fetchRsc(path, ctx, 0);
      const rows = listOf(flat);
      if (rows && rows.length) return rows;
      const cards = cardsOf(flat);
      if (cards.length) return cards;
    } catch (error) {
      if (error && error.code === 'CANCELLED') throw error;
    }
    const flat = await fetchPage(path, ctx, 0);
    return uniq(listOf(flat) || cardsOf(flat));
  }

  function pageNo(cursor) {
    const n = parseInt(cursor, 10);
    return Number.isFinite(n) && n > 1 ? n : 1;
  }

  // 播放页的 SSR 里有一个大的 data.video 对象：分集列表在 collectionMembers，
  // 当前集的流在同名的 video.url。按括号配对截出对象再 JSON.parse，比正则稳。
  function grabVideo(flat) {
    const at = flat.indexOf('"video":{');
    if (at < 0) return null;
    const start = at + '"video":'.length;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < flat.length; i += 1) {
      const ch = flat[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(flat.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  // 分集顺序就是 collectionMembers 的数组顺序（站点按显示顺序下发，第 1 集在前）。
  // 部分合集是从中间截的（标题写「4」「6」「7」），所以真实集号单独解析。
  function episodesOf(video, id) {
    const mem = video && Array.isArray(video.collectionMembers) ? video.collectionMembers : [];
    const out = [];
    for (const raw of mem) {
      const mid = String((raw && raw.id) != null ? raw.id : '').trim();
      if (!/^\d+$/.test(mid)) continue;
      out.push({ id: mid, title: String((raw && raw.title) || '').trim() });
    }
    if (out.length) return out;
    // 没有合集信息时按单集处理：优先用站点选中的视频 id。
    const sel = String((video && video.selectedVideoId) || '').trim();
    return [{ id: /^\d+$/.test(sel) ? sel : String(id), title: '' }];
  }

  function episodeNumberOf(title, fallback) {
    const m = String(title || '').match(/(\d{1,4})\s*$/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return fallback;
  }

  async function fetchDetail(id, ctx, ttl) {
    const flat = await fetchPage(`/series/watch/${id}/`, ctx, ttl === undefined ? 300 : ttl);
    const video = grabVideo(flat);

    const videoUrl = String((video && video.video && video.video.url) || '').trim();
    if (!videoUrl) {
      throw new hg.PluginError('CONTENT_LOCKED', '这部作品在站点侧没有给出播放地址（可能需要登录或付费）');
    }
    const title =
      trimLabel((video && video.title) || '') ||
      trimLabel((flat.match(/<title>([^<]*)<\/title>/i) || [])[1] || '') ||
      `影集 ${id}`;

    const cover =
      String((video && video.coverImg) || '').trim() ||
      (flat.match(/property="og:image" content="([^"]+)"/) || [])[1] ||
      '';

    const desc =
      String((video && video.descriptionText) || '').trim() ||
      (flat.match(/name="description" content="([^"]*)"/) || [])[1] ||
      '';

    const tagSet = new Set();
    for (const list of [(video && video.tagsName) || [], (video && video.tags) || []]) {
      if (!Array.isArray(list)) continue;
      for (const t of list) if (typeof t === 'string' && t) tagSet.add(t);
    }

    return {
      id: String(id),
      title,
      cover: imgRef(cover),
      description: String(desc).replace(/\\n/g, ' ').slice(0, 400),
      tags: [...tagSet].slice(0, 8),
      videoUrl,
      episodes: episodesOf(video, id),
    };
  }

  function streamUrlOf(videoUrl) {
    const raw = String(videoUrl || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    return `${SITE}/h5/m3u8/${raw.replace(/^\/+/, '')}`;
  }

  function streamHeaders() {
    return { 'User-Agent': UA, Referer: `${SITE}/` };
  }

  // 封面走 { type: 'plugin' }，在这里做「只异或前 100 字节」的还原。
  // 保持纯计算、不联网；已经是合法图片就直接原样返回，避免二次破坏。
  function transformImage(params) {
    const data = params && params.data;
    if (!data || typeof data.length !== 'number' || !data.length) return { data };
    if (isImageMagic(data)) return { data, contentType: imageMime(data) };
    const out = new Uint8Array(data.length);
    out.set(data);
    const key = IMG_XOR_KEY;
    const limit = Math.min(100, out.length);
    for (let i = 0; i < limit; i += 1) out[i] ^= key.charCodeAt(i % key.length);
    if (!isImageMagic(out)) return { data };
    return { data: out, contentType: imageMime(out) };
  }

  return {
    home: {
      async getSections(params, ctx) {
        const sections = [];
        for (const cat of CATS) {
          let items = [];
          try {
            items = await catalogPage(cat.id, 1, ctx);
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
        const items = await catalogPage(cid, page, ctx);
        const out = { items };
        // 每页 16 条，满页说明后面还有。
        if (items.length >= 16) out.next = String(page + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const kw = String((params && params.query) || '').replace(/\s+/g, ' ').trim();
        if (!kw) return { items: [] };
        const items = await searchPage(kw, 1, ctx);
        return { items: uniq(items).slice(0, 40) };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = String((params && params.id) || '').trim();
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '内容 ID 不合法');
        const d = await fetchDetail(id, ctx);
        const multi = d.episodes.length > 1;
        return {
          id: d.id,
          title: d.title,
          cover: d.cover,
          description: d.description,
          tags: d.tags,
          mediaType: multi ? 'series' : 'movie',
          playlists: [
            {
              id: 'main',
              label: '正片',
              kind: 'main',
              // index 必须从 1 开始：写成 0 会被宿主当成无效序号丢掉首项。
              episodes: d.episodes.map((e, i) => {
                const number = episodeNumberOf(e.title, i + 1);
                return {
                  id: e.id,
                  index: i + 1,
                  episodeNumber: number,
                  label: multi ? `第${number}集` : '全集',
                };
              }),
            },
          ],
        };
      },

      async resolvePlayback(params, ctx) {
        const id = String((params && params.mediaId) || '').trim();
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '内容 ID 不合法');
        const want = String((params && params.episodeId) || '').trim();

        // 详情页只带当前集自己的流；换集时按该集的视频 id 重新取页面。
        // ttl 传 0：播放地址是带签名的，必须现取，不能读详情缓存。
        let videoUrl = '';
        if (want && /^\d+$/.test(want) && want !== id) {
          try {
            videoUrl = (await fetchDetail(want, ctx, 0)).videoUrl;
          } catch (error) {
            if (error && error.code === 'CANCELLED') throw error;
            // 集 id 不是独立页面时退回合集页，至少能播当前集。
            videoUrl = '';
          }
        }
        if (!videoUrl) {
          videoUrl = (await fetchDetail(id, ctx, 0)).videoUrl;
        }

        const url = streamUrlOf(videoUrl);
        if (!url) throw new hg.PluginError('CONTENT_LOCKED', '这部作品没有可播放的地址');
        return {
          streams: [{ kind: 'media', url, format: 'hls', headers: streamHeaders() }],
        };
      },

      async matchUrl(params) {
        const m = String((params && params.url) || '').trim().match(WATCH_RE);
        if (!m) return null;
        // 站点用的是 /series/watch/<合集 id>/，具体集 id 要读页面才知道；
        // 交给宿主先按合集 id 打开，首集由 getDetail 的第一项决定。
        return { mediaId: m[1], episodeId: m[1] };
      },
    },

    transformResource: transformImage,
  };
}
