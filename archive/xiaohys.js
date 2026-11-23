export const meta = {
  id: 'xiaohys',
  name: '小红影视',
  version: '1.0.1',
  protocol: 1,
  description: '小红影视：DS 列表接口、详情多线路与 AES 播放解析。',
  author: 'community',
  kind: 'source',
  linkDomains: ['xiaohys.com', 'www.xiaohys.com'],
  defaultHeaders: {
    Referer: 'https://www.xiaohys.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://www.xiaohys.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TABS = [
  { id: '1', label: '电影', type: 'movie' },
  { id: '2', label: '电视剧', type: 'series' },
  { id: '3', label: '综艺', type: 'variety' },
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

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function typeOf(id) {
    for (let i = 0; i < TABS.length; i++) if (TABS[i].id === id) return TABS[i].type;
    return 'other';
  }

  function md5hex(s) {
    return hg.codec.hexEncode(hg.crypto.digest('md5', s));
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

  async function listVod(type, page, ctx) {
    const time = Math.round(Date.now() / 1000);
    const key = md5hex('DS' + time + 'DCC147D11943AF75');
    const res = await hg.http.fetch({
      url: origin() + '/index.php/api/vod',
      method: 'POST',
      headers: headers(),
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
        const item = { id: String(e.vod_id), title: String(e.vod_name), type: typeOf(String(type)) };
        if (e.vod_pic) item.cover = absUrl(e.vod_pic);
        if (e.vod_remarks) item.badge = String(e.vod_remarks).slice(0, 8);
        items.push(item);
      }
    }
    return items;
  }

  function aesDecrypt(text, key, iv) {
    const plain = hg.crypto.aesDecrypt({
      mode: 'cbc',
      key: hg.codec.utf8Encode(key),
      iv: hg.codec.utf8Encode(iv),
      padding: 'pkcs7',
    }, hg.codec.base64Decode(text));
    return hg.codec.utf8Decode(plain);
  }

  function parsePlayer(html) {
    const m = String(html).match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*;/);
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
        const items = await listVod('1', 1, ctx);
        return { items: [{ id: 'movie', title: '电影', layout: 'grid', items }], next: null };
      },
    },

    catalog: {
      async getCategories() {
        return TABS.map(function (t) { return { id: t.id, label: t.label }; });
      },
      async list(params, ctx) {
        const id = (params && params.categoryId) || '1';
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
        const html = await fetchHtml(origin() + '/vodsearch/' + encodeURIComponent(q) + '----------' + page + '---.html', ctx);
        const doc = hg.html.parse(html);
        const items = [];
        const nodes = doc.select('.public-list-box, .module-search-item, .search-box');
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i].first('a');
          const title = a && (a.attr('title') || a.text());
          const href = a && a.attr('href');
          if (!href || !title) continue;
          const m = href.match(/\/detail\/(\d+)/);
          const id = m ? m[1] : pathId(href);
          const img = nodes[i].first('img');
          const item = { id: String(id), title: title.trim(), type: 'other' };
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
        const html = await fetchHtml(origin() + '/detail/' + encodeURIComponent(id), ctx);
        const doc = hg.html.parse(html);
        const titleEl = doc.first('h1') || doc.first('.slide-info-title');
        const title = titleEl ? titleEl.text().trim() : String(id);
        const from = [];
        const tabs = doc.select('.anthology-tab .swiper-wrapper a');
        for (let i = 0; i < tabs.length; i++) {
          from.push(tabs[i].text().trim() || ('线路' + (i + 1)));
        }
        const boxes = doc.select('.anthology-list .anthology-list-box');
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
        return { id: String(id), title, type: playlists[0].episodes.length > 1 ? 'series' : 'movie', playlists };
      },

      async resolvePlayback(params, ctx) {
        const episodeId = params && params.episodeId;
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const pageUrl = absUrl(episodeId);
        const html = await fetchHtml(pageUrl, ctx);
        const cfg = parsePlayer(html);
        if (!cfg || !cfg.url) fail('UPSTREAM_CHANGED', '未解析到播放配置');
        let playUrl = cfg.url;
        if (playUrl.indexOf('.m3u8') >= 0) {
          // direct
        } else if (playUrl.indexOf('jx.xiaohys') >= 0) {
          const pres = await fetchHtml(playUrl, ctx);
          const player = (pres.match(/var player = "(.*?)"/) || [])[1];
          const rand = (pres.match(/var rand = "(.*?)"/) || [])[1];
          if (!player || !rand) fail('UPSTREAM_CHANGED', '解析页缺少密钥');
          const decoded = aesDecrypt(player, 'VFBTzdujpR9FWBhe', rand);
          const json = JSON.parse(decoded);
          playUrl = json.url;
        } else {
          const res = await hg.http.fetch({
            url: origin() + '/static/player/artplayer/api.php?ac=getdate',
            method: 'POST',
            headers: headers(),
            body: { form: { url: playUrl, referer: pageUrl } },
            responseType: 'json',
            timeoutMs: 15000,
            signal: ctx && ctx.signal,
          });
          if (!res.ok || !res.data) fail('UPSTREAM_ERROR', '播放接口暂时不可用');
          const key = md5hex('www.xiaohys.com').slice(0, 16);
          const decoded = aesDecrypt(res.data.data, key, res.data.iv);
          const json = JSON.parse(decoded);
          playUrl = json.videoUrl;
        }
        if (!playUrl) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        return {
          streams: [{
            url: playUrl,
            kind: 'media',
            format: guessFormat(playUrl),
            headers: headers(),
          }],
        };
      },
    },
  };
}
