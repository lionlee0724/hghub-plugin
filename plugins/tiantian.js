export const meta = {
  id: 'tiantian',
  name: '天天影视',
  version: '1.0.1',
  protocol: 1,
  description: '天天影视 App 接口：分类、搜索、详情与播放。上游为 HTTP，请求带 MD5 签名。',
  author: 'community',
  kind: 'source',
  allowInsecureHttp: true,
  linkDomains: ['op.ysdqjs.cn'],
  defaultHeaders: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'http://op.ysdqjs.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
const SIGN_KEY = 'kj5649ertj84ks89r4jh8s45hf84hjfds04k';
const FALLBACK_TABS = [
  { id: '1', label: '电影' },
  { id: '2', label: '电视剧' },
  { id: '3', label: '综艺' },
  { id: '4', label: '动漫' },
];

export default function (hg) {
  function origin() {
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return SITE;
  }

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function signForm(extra) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sign = hg.codec.hexEncode(hg.crypto.digest('md5', SIGN_KEY + timestamp));
    const form = Object.assign({ sign, timestamp }, extra || {});
    const out = {};
    Object.keys(form).forEach(function (k) {
      if (form[k] != null) out[k] = String(form[k]);
    });
    return out;
  }

  async function post(path, extra, ctx, label) {
    const res = await hg.http.fetch({
      url: origin() + path,
      method: 'POST',
      headers: {
        'User-Agent': UA,
        cookie: 'PHPSESSID=eebef1362fc5312a330b700fc4fafbd0',
      },
      body: { form: signForm(extra) },
      responseType: 'json',
      timeoutMs: 15000,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) fail('UPSTREAM_ERROR', (label || '接口') + '暂时不可用（HTTP ' + res.status + '）');
    if (!res.data || typeof res.data !== 'object') fail('UPSTREAM_CHANGED', (label || '接口') + '返回结构已变化');
    return res.data;
  }

  function mapCards(rows) {
    const out = [];
    if (!Array.isArray(rows)) return out;
    for (let i = 0; i < rows.length; i++) {
      const e = rows[i];
      if (!e || e.vod_id == null || !e.vod_name) continue;
      const item = { id: String(e.vod_id), title: String(e.vod_name), type: 'other' };
      if (e.vod_pic) item.cover = e.vod_pic;
      if (e.vod_remarks) item.badge = String(e.vod_remarks).slice(0, 8);
      out.push(item);
    }
    return out;
  }

  function guessFormat(url) {
    if (/\.m3u8(\?|$)/i.test(url)) return 'hls';
    if (/\.mp4(\?|$)/i.test(url)) return 'progressive';
    return 'hls';
  }

  async function loadTabs(ctx) {
    try {
      const body = await post('/v2/type/top_type', undefined, ctx, '分类');
      const list = body.data && body.data.list;
      const items = [];
      if (Array.isArray(list)) {
        for (let i = 0; i < list.length; i++) {
          const name = list[i].type_name;
          if (!name || name.includes('首页') || name.includes('公告')) continue;
          items.push({ id: String(list[i].type_id), label: String(name) });
        }
      }
      if (items.length) return items;
    } catch (_) {}
    return FALLBACK_TABS.slice();
  }

  return {
    endpoints: { list() { return [{ id: 'main', label: '主站', url: SITE }]; } },

    home: {
      async getSections(params, ctx) {
        const tabs = await loadTabs(ctx);
        const body = await post('/v2/home/type_search', { type_id: tabs[0].id, page: 1, limit: 12 }, ctx, '首页');
        const items = mapCards(body.data && body.data.list);
        return { items: [{ id: 'latest', title: tabs[0].label, layout: 'grid', items }], next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        return loadTabs(ctx);
      },
      async list(params, ctx) {
        const id = (params && params.categoryId) || '1';
        const page = pageOf(params && params.cursor);
        const body = await post('/v2/home/type_search', { type_id: id, page, limit: 12 }, ctx, '分类');
        const items = mapCards(body.data && body.data.list);
        return { items, next: items.length >= 12 ? String(page + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const page = pageOf(params && params.cursor);
        const body = await post('/v2/home/search', { keyword: q, page, limit: 12 }, ctx, '搜索');
        const items = mapCards(body.data && body.data.list);
        return { items, next: items.length >= 12 ? String(page + 1) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id;
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const body = await post('/v2/home/vod_details', { vod_id: id }, ctx, '详情');
        const data = body.data || {};
        const playlist = Array.isArray(data.vod_play_list) ? data.vod_play_list : [];
        const playlists = [];
        for (let i = 0; i < playlist.length; i++) {
          const e = playlist[i];
          const parse = (e.parse_urls && e.parse_urls[0]) || '';
          const urls = Array.isArray(e.urls) ? e.urls : [];
          const episodes = [];
          for (let j = 0; j < urls.length; j++) {
            let play = urls[j].url;
            if (parse) play = parse + play;
            episodes.push({
              id: String(i) + ':' + encodeURIComponent(play),
              index: j + 1,
              episodeNumber: j + 1,
              label: String(urls[j].name || j + 1),
            });
          }
          if (episodes.length) {
            playlists.push({ id: String(i + 1), label: String(e.flag || ('线路' + (i + 1))), episodes });
          }
        }
        if (!playlists.length) fail('UPSTREAM_CHANGED', '未解析到分集');
        const item = {
          id: String(id),
          title: String(data.vod_name || id),
          type: 'other',
          playlists,
        };
        if (data.vod_pic) item.cover = data.vod_pic;
        if (data.vod_content) item.description = String(data.vod_content);
        return item;
      },

      async resolvePlayback(params, ctx) {
        const episodeId = params && params.episodeId;
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const raw = episodeId.indexOf(':') >= 0 ? episodeId.slice(episodeId.indexOf(':') + 1) : episodeId;
        let url = decodeURIComponent(raw);
        if (url.indexOf('url=') >= 0) {
          const res = await hg.http.fetch({
            url,
            headers: { 'User-Agent': UA },
            responseType: 'json',
            timeoutMs: 15000,
            signal: ctx && ctx.signal,
          });
          if (res.ok && res.data && res.data.url) url = res.data.url;
          else url = url.split('url=')[1];
        }
        if (!url) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        return {
          streams: [{
            url,
            kind: 'media',
            format: guessFormat(url),
            headers: { 'User-Agent': UA },
          }],
        };
      },
    },
  };
}
