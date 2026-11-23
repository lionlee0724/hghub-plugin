// HPP 插件：基色短剧 GScenes（www.x4bny.cc）
// 站点是 Nuxt SPA + 自建 REST API（/api/v1/*），792 部 BL / 真人 / AI 成人短剧。
// 关键链路：
//   游客：POST /api/v1/auth/guest → data.access_token（JWT，2 小时）
//   列表：GET  /api/v1/works?page=N&category_id=<uuid>
//   详情：GET  /api/v1/works/<id>  分集：GET /api/v1/works/<id>/episodes
//   权限：GET  /api/v1/works/<id>/episodes/<id>/access
//   取流：POST /api/v1/works/<id>/episodes/<id>/playback
//         → data.play_url + Set-Cookie（CloudFront-Policy/Signature/Key-Pair-Id，
//           Path 限定在 /hls/<资源>/episodes/<集>/ 下）
//   play_url 不带这三个 cookie 会 403 MissingKey，所以要把 cookie 写进 stream.headers。
export const meta = {
  id: 'gscenes',
  name: '基色短剧',
  version: '0.1.0',
  protocol: 1,
  description: '基色短剧 GScenes（x4bny.cc）：BL / 真人 / AI 成人短剧，分类、搜索、详情与 HLS 播放。VIP 作品按协议返回 CONTENT_LOCKED。',
  author: 'lionlee0724',
  kind: 'source',
  mature: true,
  linkDomains: ['www.x4bny.cc', 'x4bny.cc'],
  defaultHeaders: {
    Referer: 'https://www.x4bny.cc/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://www.x4bny.cc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TOKEN_KEY = 'gscenes:token';

export default function (hg) {
  function origin() {
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return SITE;
  }

  function fail(code, message) {
    throw new hg.PluginError(code, message);
  }

  function headers(extra) {
    return Object.assign({ 'User-Agent': UA, Accept: 'application/json', Origin: origin(), Referer: origin() + '/' }, extra || {});
  }

  let cachedToken = '';

  async function guestToken(ctx, force) {
    if (!force) {
      if (cachedToken) return cachedToken;
      const saved = await hg.storage.get(TOKEN_KEY).catch(() => null);
      if (saved && saved.token && Date.now() - saved.at < 55 * 60 * 1000) {
        cachedToken = saved.token;
        return cachedToken;
      }
    }
    const res = await hg.http.fetch({
      url: origin() + '/api/v1/auth/guest',
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: '{}',
      responseType: 'text',
      timeoutMs: 15000,
      retry: 1,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) fail(res.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR', '游客会话创建失败（HTTP ' + res.status + '）');
    let body;
    try { body = JSON.parse(res.data); } catch (e) { fail('UPSTREAM_CHANGED', '游客接口返回的不是 JSON'); }
    const token = body && body.data && body.data.access_token;
    if (!token) fail('UPSTREAM_CHANGED', '游客接口没有返回 access_token');
    cachedToken = token;
    await hg.storage.set(TOKEN_KEY, { token: token, at: Date.now() }).catch(() => {});
    return token;
  }

  async function api(path, ctx, options) {
    const opts = options || {};
    const attempt = async (token) => hg.http.fetch({
      url: origin() + '/api/v1' + path,
      method: opts.method || 'GET',
      headers: headers(Object.assign({ Authorization: 'Bearer ' + token }, opts.contentType ? { 'Content-Type': opts.contentType } : {})),
      body: opts.body,
      responseType: 'text',
      timeoutMs: opts.timeoutMs || 18000,
      retry: 1,
      signal: ctx && ctx.signal,
    });
    let res = await attempt(await guestToken(ctx, false));
    if (res.status === 401) res = await attempt(await guestToken(ctx, true));
    if (res.status === 404) fail('NOT_FOUND', '内容不存在或已下架');
    if (res.status === 403) fail('CONTENT_LOCKED', '该内容需要开通会员');
    if (!res.ok) fail(res.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR', '接口返回 ' + res.status);
    let body;
    try { body = JSON.parse(res.data); } catch (e) { fail('UPSTREAM_CHANGED', '接口返回的不是 JSON'); }
    if (body && typeof body.code === 'number' && body.code !== 0) fail('UPSTREAM_ERROR', body.message || '接口返回错误');
    return body ? body.data : null;
  }

  function toItem(work) {
    if (!work || !work.id || !work.title) return null;
    const item = { id: work.id, title: work.title, type: work.total_episodes > 1 ? 'series' : 'movie' };
    if (work.cover_url) item.cover = work.cover_url;
    const badge = work.access_mode === 'paid' ? 'VIP' : (work.total_episodes > 1 ? work.total_episodes + ' 集' : '');
    if (badge) item.badge = badge;
    if (work.year) item.publishedAt = new Date(String(work.year) + '-01-01T00:00:00Z').getTime();
    return item;
  }

  function itemsOf(list) {
    const out = [];
    const seen = {};
    for (const work of list || []) {
      const item = toItem(work);
      if (!item || seen[item.id]) continue;
      seen[item.id] = 1;
      out.push(item);
    }
    return out;
  }

  async function listWorks(query, ctx) {
    const data = await api('/works?' + query, ctx);
    const items = itemsOf(data && data.items);
    const total = Number(data && data.total) || 0;
    return { items: items, total: total };
  }

  return {
    endpoints: { list() { return [{ id: 'main', label: '主站', url: SITE }]; } },

    home: {
      async getSections(params, ctx) {
        const sections = [];
        try {
          const rec = await listWorks('page=1&pageSize=20', ctx);
          if (rec.items.length) sections.push({ id: 'latest', title: '最新上架', layout: 'grid', imageAspect: 'portrait', items: rec.items });
        } catch (e) { /* 单分区失败忽略 */ }
        try {
          const rank = await api('/rankings', ctx);
          const list = (rank && rank.items ? rank.items : []).map(function (row) { return row.work || row; });
          const items = itemsOf(list);
          if (items.length) sections.push({ id: 'ranking', title: '总榜', layout: 'grid', imageAspect: 'portrait', items: items });
        } catch (e) { /* 单分区失败忽略 */ }
        try {
          const hot = await api('/search/hot-works', ctx);
          const list = (hot && hot.items ? hot.items : []).map(function (row) { return row.item || row.work || row; });
          const items = itemsOf(list);
          if (items.length) sections.push({ id: 'hot', title: '热搜', layout: 'grid', imageAspect: 'portrait', items: items });
        } catch (e) { /* 单分区失败忽略 */ }
        if (!sections.length) fail('UPSTREAM_CHANGED', '首页没有取到内容');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const out = [];
        const cats = await api('/work-categories', ctx);
        for (const c of (cats && cats.items ? cats.items : [])) {
          if (!c.id || !c.name || c.is_active === false) continue;
          out.push({ id: 'cat:' + c.id, label: c.name });
        }
        try {
          const genres = await api('/genres', ctx);
          for (const g of (genres && genres.items ? genres.items : []).slice(0, 20)) {
            if (!g.name) continue;
            out.push({ id: 'genre:' + g.name, label: '题材·' + g.name });
          }
        } catch (e) { /* 题材失败不影响分类 */ }
        if (!out.length) fail('UPSTREAM_CHANGED', '没有取到分类');
        return out;
      },

      async list(params, ctx) {
        const raw = String((params && params.categoryId) || '');
        const page = Math.max(1, parseInt(String((params && params.cursor) || '1'), 10) || 1);
        let query = 'page=' + page + '&pageSize=20';
        if (raw.indexOf('cat:') === 0) query += '&category_id=' + encodeURIComponent(raw.slice(4));
        else if (raw.indexOf('genre:') === 0) query += '&tag=' + encodeURIComponent(raw.slice(6));
        const res = await listWorks(query, ctx);
        const hasMore = res.total > page * 20;
        return { items: res.items, next: hasMore && res.items.length ? String(page + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const page = Math.max(1, parseInt(String((params && params.cursor) || '1'), 10) || 1);
        const data = await api('/search?q=' + encodeURIComponent(q) + '&page=' + page, ctx);
        const items = itemsOf(data && data.items);
        return { items: items, next: items.length >= 20 ? String(page + 1) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id ? String(params.id) : '';
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const work = await api('/works/' + encodeURIComponent(id), ctx);
        if (!work) fail('NOT_FOUND', '作品不存在');
        const eps = await api('/works/' + encodeURIComponent(id) + '/episodes', ctx);
        const rows = eps && eps.items ? eps.items : [];
        if (!rows.length) fail('UPSTREAM_CHANGED', '没有解析到分集');
        const episodes = rows.map(function (row, i) {
          const ep = {
            id: row.id,
            index: i + 1,
            episodeNumber: Number(row.no) || i + 1,
            label: row.title || ('第 ' + (Number(row.no) || i + 1) + ' 集'),
          };
          if (Number(row.duration_sec)) ep.durationSec = Number(row.duration_sec);
          return ep;
        });
        const detail = {
          id: id,
          title: work.title || id,
          type: episodes.length > 1 ? 'series' : 'movie',
          playlists: [{ id: 'main', label: work.access_mode === 'paid' ? '正片（VIP）' : '正片', kind: 'main', episodes: episodes }],
        };
        if (work.cover_url) detail.cover = work.cover_url;
        if (work.synopsis) detail.description = String(work.synopsis).slice(0, 2000);
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const mediaId = params && params.mediaId ? String(params.mediaId) : '';
        const episodeId = params && params.episodeId ? String(params.episodeId) : '';
        if (!mediaId || !episodeId) fail('INVALID_ARGUMENT', '缺少作品或分集 ID');
        const base = '/works/' + encodeURIComponent(mediaId) + '/episodes/' + encodeURIComponent(episodeId);
        const access = await api(base + '/access', ctx);
        const allowed = access && access.access ? access.access.allowed : false;
        if (!allowed) {
          const reason = access && access.access && access.access.access_reason;
          fail('CONTENT_LOCKED', reason === 'login_required' ? '该集需要登录后观看' : '该集需要开通会员（VIP）');
        }
        const res = await hg.http.fetch({
          url: origin() + '/api/v1' + base + '/playback',
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await guestToken(ctx, false)) }),
          body: '{}',
          responseType: 'text',
          timeoutMs: 25000,
          retry: 1,
          signal: ctx && ctx.signal,
        });
        if (res.status === 403) fail('CONTENT_LOCKED', '该集需要开通会员（VIP）');
        if (!res.ok) fail('UPSTREAM_ERROR', '取流失败（HTTP ' + res.status + '）');
        let body;
        try { body = JSON.parse(res.data); } catch (e) { fail('UPSTREAM_CHANGED', '取流接口返回的不是 JSON'); }
        const data = body && body.data;
        const playUrl = data && data.play_url;
        if (!playUrl) fail('UPSTREAM_CHANGED', '取流接口没有返回播放地址');
        // CloudFront 签名 cookie 只在 /hls/<资源>/episodes/<集>/ 生效，必须随流带上
        const cookies = (res.setCookies || []).map(function (raw) { return String(raw).split(';')[0]; }).filter(Boolean);
        const streamHeaders = { Referer: origin() + '/', 'User-Agent': UA };
        if (cookies.length) streamHeaders.Cookie = cookies.join('; ');
        const out = {
          streams: [{
            url: playUrl,
            kind: 'media',
            format: /\.m3u8(\?|$)/i.test(playUrl) ? 'hls' : 'progressive',
            label: data.access_reason === 'free' ? '免费' : '',
            headers: streamHeaders,
          }],
        };
        if (data.expires_at) {
          const ts = Date.parse(data.expires_at);
          if (Number.isFinite(ts)) out.expiresAt = ts;
        }
        return out;
      },

      matchUrl(params) {
        const raw = params && params.url ? String(params.url) : '';
        const m = raw.match(/\/watch\/([0-9a-f-]{36})/i);
        return m ? { mediaId: m[1] } : null;
      },
    },
  };
}
