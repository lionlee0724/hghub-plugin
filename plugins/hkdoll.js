export const meta = {
  id: 'hkdoll',
  name: '玩偶姐姐',
  version: '1.0.5',
  protocol: 1,
  description: '玩偶姐姐：分类、搜索、详情与 XOR 解密播放。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['hongkongdollvideo.com'],
  defaultHeaders: {
    Referer: 'https://hongkongdollvideo.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://hongkongdollvideo.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CDN_NODE = 't33';   // cdn2020 当前可用节点

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

  // 分类路径含中文/空格（如 /Pussy Hunter/），必须编码
  function encodeUrl(u) { try { return encodeURI(decodeURI(u)); } catch (e) { return encodeURI(u); } }
  function absUrl(href) {
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return encodeUrl(href);
    if (href.startsWith('//')) return encodeUrl('https:' + href);
    const o = origin();
    return encodeUrl(href.startsWith('/') ? o + href : o + '/' + href);
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function xorHex(hex, key) {
    let out = '';
    for (let i = 0; i < hex.length; i += 2) {
      const code = parseInt(hex.substr(i, 2), 16);
      const k = key.charCodeAt((i / 2) % key.length);
      out += String.fromCharCode(code ^ k);
    }
    return out;
  }

  function decodePageParams(param) {
    const key = param.slice(-32);
    const enc = param.substring(0, param.length - 32);
    return JSON.parse(xorHex(enc, key));
  }

  function getPlayUrl(embedUrl) {
    const token = embedUrl.split('?token=')[1];
    if (!token) return '';
    const tail = token.slice(-10);
    const md5 = hg.codec.hexEncode(hg.crypto.digest('md5', tail));
    const xorKey = md5.slice(8, 24).split('').reverse().join('');
    const body = token.slice(0, -10);
    const json = JSON.parse(xorHex(body, xorKey));
    return json.stream;
  }

  // 是否还有下一页：看页面里有没有指向 /{page+1}.html 的分页链接（不足一页的分类，站点对 /2.html 会回第 1 页）
  function hasNext(html, page) {
    return html.indexOf('/' + (page + 1) + '.html"') >= 0;
  }

  function parseCards(html) {
    const doc = hg.html.parse(html);
    const items = [];
    const seen = {};   // 首页同一部片会在多个板块重复出现（实测 180 个节点里只有 167 个唯一地址），
                       // 不去重宿主会逐条报 warn「重复条目已丢弃」，还会挤掉上限内的真条目
    const nodes = doc.select('.video-item');
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i].first('.thumb a');
      const href = a && a.attr('href');
      const title = a && a.attr('title');
      if (!href || !title) continue;
      const id = absUrl(href);
      if (seen[id]) continue;
      seen[id] = true;
      const img = nodes[i].first('.thumb img');
      const cover = img && (img.attr('data-src') || img.attr('src'));
      const dur = nodes[i].first('.duratio');
      const item = { id: id, title: title.trim(), type: 'movie' };
      if (cover) item.cover = absUrl(cover);
      if (dur) {
        const note = dur.text().trim();
        if (note) item.badge = note.slice(0, 8);
      }
      items.push(item);
    }
    return items;
  }

  async function loadTabs(ctx) {
    const html = await fetchHtml(origin() + '/', ctx);
    const doc = hg.html.parse(html);
    const links = doc.select('.scrollbar a');
    const items = [];
    for (let i = 0; i < links.length; i++) {
      const name = links[i].text().trim();
      const href = links[i].attr('href');
      if (!name || !href || name.indexOf('亚洲成人视频') >= 0) continue;
      if (['FLICKO', '天美影视', '维纳斯'].indexOf(name) >= 0) continue;   // 站点该系列为空（2026-11 实测）
      { const u = absUrl(href); if (u.indexOf(origin().replace(/^https?:\/\//, '').replace(/^www\./, '')) < 0) continue; }   // 跳过站外广告链接（Telegram、导航站等）
      items.push({ id: absUrl(href), label: name });
    }
    return items.length ? items : [{ id: origin() + '/', label: '首页' }];
  }

  function guessFormat(url) {
    if (/\.m3u8(\?|$)/i.test(url)) return 'hls';
    return 'progressive';
  }

  // 站点会给出多个 CDN 节点，有些早已下线（t26 404），有些证书过期（见 resolvePlayback 注释）。
  // 解析时并发探一次，把真能取到清单的排前面；全都不通才如实报错，不让播放器先黑屏一次。
  async function pickWorking(urls, ctx) {
    const probe = async (u) => {
      try {
        const res = await hg.http.fetch({ url: u, headers: headers(), responseType: 'text', timeoutMs: 6000, maxBytes: 256 * 1024, signal: ctx && ctx.signal });
        const body = typeof res.data === 'string' ? res.data : '';
        return res.ok && /^#EXTM3U/.test(body.trim()) ? u : null;
      } catch (_) { return null; }
    };
    const ok = (await Promise.all(urls.map(probe))).filter(Boolean);
    if (!ok.length) return null;
    const rest = urls.filter(function (u) { return ok.indexOf(u) < 0; });
    return ok.concat(rest);
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
        if (page > 1) url = url.replace(/\/?$/, '/') + page + '.html';
        const html = await fetchHtml(url, ctx);
        const items = parseCards(html);
        return { items, next: items.length && hasNext(html, page) ? String(page + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const page = pageOf(params && params.cursor);
        let url = origin() + '/search/' + encodeURIComponent(q) + '/';
        if (page > 1) url += page + '.html';
        const html = await fetchHtml(url, ctx);
        const items = parseCards(html);
        return { items, next: items.length && hasNext(html, page) ? String(page + 1) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id;
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const html = await fetchHtml(absUrl(id), ctx);
        const doc = hg.html.parse(html);
        const titleEl = doc.first('h1') || doc.first('.video-title');
        const title = titleEl ? titleEl.text().trim() : String(id);
        return {
          id: absUrl(id),
          title,
          type: 'movie',
          playlists: [{
            id: 'main',
            label: '默认',
            episodes: [{ id: absUrl(id), index: 1, episodeNumber: 1, label: '播放' }],
          }],
        };
      },

      async resolvePlayback(params, ctx) {
        const episodeId = params && params.episodeId;
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const html = await fetchHtml(absUrl(episodeId), ctx);
        const m = html.match(/var __PAGE__PARAMS__="([^"]+)"/);
        if (!m) fail('UPSTREAM_CHANGED', '未找到页面参数');
        const pageLoader = decodePageParams(m[1]);
        const embedUrl = pageLoader && pageLoader.player && pageLoader.player.embedUrl;
        if (!embedUrl) fail('UPSTREAM_CHANGED', '未找到播放嵌入地址');
        const playUrl = getPlayUrl(embedUrl);
        if (!playUrl) fail('UPSTREAM_CHANGED', '播放地址解密失败');
        // 站点仍返回早年的 CDN 节点（t26/t27…），多数已下线 404；同路径在当前节点 t33 可用（2026-11 实测）
        let urls = [playUrl];
        const alt = playUrl.replace(/\/\/t\d+\.cdn2020\.com\//, '//' + CDN_NODE + '.cdn2020.com/');
        if (alt !== playUrl) urls.unshift(alt);   // 当前节点优先，原地址兜底
        if (/\.m3u8/i.test(playUrl)) {
          const sorted = await pickWorking(urls, ctx);
          if (!sorted) fail('NETWORK', '这部影片的播放节点连不上（站点下发的 CDN 域名证书已过期，iOS 会拒绝连接）');
          urls = sorted;
        }
        return {
          streams: urls.map(function (u, i) {
            return { url: u, kind: 'media', format: guessFormat(u), headers: headers(), label: i === 0 && urls.length > 1 ? '线路 1' : '线路 ' + (i + 1) };
          }),
        };
      },
    },
  };
}
