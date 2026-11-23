export const meta = {
  id: 'aowu',
  name: '嗷呜动漫',
  version: '1.0.1',
  protocol: 1,
  description: '嗷呜动漫：DS 列表接口、详情多线路与 AES 播放解析。',
  author: 'community',
  kind: 'source',
  linkDomains: ['aowu.tv', 'www.aowu.tv'],
  defaultHeaders: {
    Referer: 'https://www.aowu.tv/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://www.aowu.tv';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TABS = [
  { id: '20', label: '新番' },
  { id: '21', label: '番剧' },
  { id: '22', label: '剧场' },
];

export default function (hg) {
  function origin() {
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return SITE;
  }

  function headers(extra) {
    return Object.assign({ 'User-Agent': UA, Referer: origin() + '/' }, extra || {});
  }

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  async function fetchHtml(url, ctx, extra) {
    const res = await hg.http.fetch({
      url,
      headers: headers(extra),
      responseType: 'text',
      timeoutMs: 15000,
      retry: 1,
      maxBytes: 8 * 1024 * 1024,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
    return bypassCookie(url, res.data, ctx, extra);
  }

  async function bypassCookie(url, html, ctx, extra) {
    if (typeof html !== 'string') return html;
    if (html.charAt(0) === '"' && html.charAt(html.length - 1) === '"') {
      try { html = JSON.parse(html); } catch (_) {}
    }
    if (html.indexOf('fl_js_validator') >= 0 && html.indexOf('document.cookie') >= 0) {
      const m = html.match(/document\.cookie\s*=\s*"([^"]+)"/);
      if (m) {
        const pair = m[1].split(';')[0];
        const eq = pair.indexOf('=');
        if (eq > 0) {
          await hg.cookies.set({
            url,
            cookie: { name: pair.slice(0, eq), value: pair.slice(eq + 1), path: '/' },
          });
        }
        const sep = url.indexOf('?') >= 0 ? '&' : '?';
        const res = await hg.http.fetch({
          url: url + sep + '_t=' + Date.now(),
          headers: headers(Object.assign({ Cookie: m[1] }, extra || {})),
          responseType: 'text',
          timeoutMs: 15000,
          maxBytes: 8 * 1024 * 1024,
          signal: ctx && ctx.signal,
        });
        if (res.ok) html = res.data;
      }
    }
    return html;
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

  function md5hex(s) {
    return hg.codec.hexEncode(hg.crypto.digest('md5', s));
  }

  async function listVod(type, page, ctx) {
    const time = Math.round(Date.now() / 1000);
    const key = md5hex('DS' + time + 'DCC147D11943AF75');
    const res = await hg.http.fetch({
      url: origin() + '/index.php/ds_api/vod',
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: {
        form: {
          type: String(type), class: '', area: '', lang: '', version: '', state: '', letter: '',
          page: String(page), time: String(time), key,
        },
      },
      responseType: 'json',
      timeoutMs: 15000,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) fail('UPSTREAM_ERROR', '列表暂时不可用（HTTP ' + res.status + '）');
    const rows = res.data && res.data.list;
    const items = [];
    if (Array.isArray(rows)) {
      for (let i = 0; i < rows.length; i++) {
        const e = rows[i];
        if (!e || e.vod_id == null || !e.vod_name) continue;
        const item = { id: pathId(e.url || ('/detail/' + e.vod_id)), title: String(e.vod_name), type: 'anime' };
        if (e.vod_pic) item.cover = absUrl(e.vod_pic);
        if (e.vod_remarks) item.badge = String(e.vod_remarks).slice(0, 8);
        items.push(item);
      }
    }
    return items;
  }

  function parsePlayer(html) {
    const m = String(html).match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (_) { return null; }
  }

  function decryptPlay(ciphertext, key) {
    const raw = hg.codec.base64Decode(ciphertext);
    const iv = raw.slice(0, 16);
    const data = raw.slice(16);
    const plain = hg.crypto.aesDecrypt({
      mode: 'cbc',
      key: hg.codec.utf8Encode(key),
      iv,
      padding: 'pkcs7',
    }, data);
    return hg.codec.utf8Decode(plain);
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
        const items = await listVod('20', 1, ctx);
        return { items: [{ id: 'new', title: '新番', layout: 'grid', items }], next: null };
      },
    },

    catalog: {
      async getCategories() {
        return TABS.map(function (t) { return { id: t.id, label: t.label }; });
      },
      async list(params, ctx) {
        const id = (params && params.categoryId) || '20';
        const page = pageOf(params && params.cursor);
        const items = await listVod(id, page, ctx);
        return { items, next: items.length ? String(page + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const page = pageOf(params && params.cursor);
        let url = origin() + '/vods/?wd=' + encodeURIComponent(q);
        if (page > 1) url += '&page=' + page;
        const html = await fetchHtml(url, ctx);
        const doc = hg.html.parse(html);
        const items = [];
        const nodes = doc.select('.public-list-box, .module-item, li');
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i].first('a');
          const img = nodes[i].first('img');
          const title = (a && (a.attr('title') || a.text())) || (img && img.attr('alt'));
          const href = a && a.attr('href');
          if (!href || !title) continue;
          if (href.indexOf('/detail') < 0 && href.indexOf('/vod') < 0 && href.indexOf('/video') < 0) continue;
          const item = { id: pathId(href), title: title.trim(), type: 'anime' };
          if (img) {
            const cover = img.attr('data-src') || img.attr('data-original') || img.attr('src');
            if (cover) item.cover = absUrl(cover);
          }
          items.push(item);
        }
        return { items, next: items.length ? String(page + 1) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id;
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const html = await fetchHtml(absUrl(id), ctx);
        const doc = hg.html.parse(html);
        const titleEl = doc.first('h1') || doc.first('.slide-info-title');
        const title = titleEl ? titleEl.text().trim() : String(id);
        const from = [];
        const tabs = doc.select('.anthology-tab .swiper-slide');
        for (let i = 0; i < tabs.length; i++) from.push(tabs[i].text().trim() || ('线路' + (i + 1)));
        const boxes = doc.select('.anthology-list-box');
        const playlists = [];
        for (let i = 0; i < boxes.length; i++) {
          const links = boxes[i].select('li a');
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
          if (episodes.length) playlists.push({ id: String(i + 1), label: from[i] || ('线路' + (i + 1)), episodes });
        }
        if (!playlists.length) fail('UPSTREAM_CHANGED', '未解析到分集');
        return { id: pathId(id), title, type: 'anime', playlists };
      },

      async resolvePlayback(params, ctx) {
        const episodeId = params && params.episodeId;
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const pageUrl = absUrl(episodeId);
        const html = await fetchHtml(pageUrl, ctx);
        const cfg = parsePlayer(html);
        if (!cfg || !cfg.url) fail('UPSTREAM_CHANGED', '未解析到播放配置');
        let purl = cfg.url;
        if (Number(cfg.encrypt) === 2) {
          try { purl = unescape(hg.codec.utf8Decode(hg.codec.base64Decode(purl))); } catch (_) {}
        }
        const artPlayer = origin() + '/player/?url=' + encodeURIComponent(purl);
        const artHtml = await fetchHtml(artPlayer, ctx, { Referer: pageUrl });
        const keyM = artHtml.match(/const sessionKey\s=\s"([^"]+)"/);
        const encM = artHtml.match(/const encryptedUrl\s=\s"([^"]+)"/);
        if (!keyM || !encM) fail('UPSTREAM_CHANGED', '未解析到加密播放地址');
        const playUrl = decryptPlay(encM[1], keyM[1]);
        if (!playUrl) fail('UPSTREAM_CHANGED', '播放地址解密失败');
        return {
          streams: [{
            url: playUrl,
            kind: 'media',
            format: guessFormat(playUrl),
            headers: headers({ Referer: pageUrl }),
          }],
        };
      },
    },
  };
}
