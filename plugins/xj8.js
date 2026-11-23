// HPP 插件：香蕉短剧（xj8.ai 官方入口 → xjai6.com 等应用域）
// 站点是 Next.js 前端 + aimedia-api.1ybox.com 后端，播放需要游客会话换 playback session。
// 只使用 HPP 1.0 公开接口：hg.http / hg.storage / hg.crypto / hg.PluginError。
export const meta = {
  id: 'xj8',
  name: '香蕉短剧',
  version: '0.1.0',
  protocol: 1,
  description: '香蕉短剧（xj8.ai 官方入口）：首页热播/榜单、分类、搜索、详情、分集与 HLS 播放。插件自动注册游客会话；金币解锁集返回 CONTENT_LOCKED。',
  author: 'lionlee0724',
  kind: 'source',
  mature: true,
  linkDomains: [
    'xj8.ai', 'www.xj8.ai',
    'xjai6.com', 'xjai7.com', 'xjai8.com', 'xjai9.com', 'xjai4.com',
    '26nj2.com', 'xkytz.com', 'gxsfl.com', '51ebc.com', 'akt01.com',
  ],
  defaultHeaders: {
    Referer: 'https://xjai6.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const PORTAL = 'https://xj8.ai';                       // 回家页，/assets/home-config.js 里是当前可用域名
const SITE = 'https://xjai6.com';                      // 默认线路
const API = 'https://aimedia-api.1ybox.com';           // 前端调用的接口域（固定，不随镜像变化）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 回家页抓不到时的兜底线路（2026-11 抓取 home-config.js 得到）
const FALLBACK_ENDPOINTS = [
  { id: 'xjai6', label: '线路 1（xjai6）', url: 'https://xjai6.com' },
  { id: 'xjai7', label: '线路 2（xjai7）', url: 'https://xjai7.com' },
  { id: 'xjai8', label: '线路 3（xjai8）', url: 'https://xjai8.com' },
  { id: 'xjai9', label: '线路 4（xjai9）', url: 'https://xjai9.com' },
  { id: 'nj2', label: '线路 5（26nj2）', url: 'https://26nj2.com' },
];

const RANK_LABELS = { hot: '热播榜', fresh: '新上线' };
const TOKEN_KEY = 'guest:token';
const DEVICE_KEY = 'device:id';

export default function (hg) {
  let tokenCache = null;

  function origin() {
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return SITE;
  }

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  function str(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  function pageCursor(cursor) {
    return str(cursor) || '';
  }

  // ---- 网络 ----------------------------------------------------------------

  async function call(apiPath, opts) {
    const o = opts || {};
    const res = await hg.http.fetch({
      url: API + apiPath,
      method: o.method || 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': UA,
        Referer: origin() + '/',
        Origin: origin(),
        ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}),
        ...(o.headers || {}),
      },
      ...(o.query ? { query: o.query } : {}),
      ...(o.body !== undefined ? { body: { json: o.body } } : {}),
      responseType: 'json',
      timeoutMs: o.timeoutMs || 15000,
      retry: o.method === 'POST' ? 0 : 1,
      signal: o.ctx && o.ctx.signal,
    });
    if (res.status >= 200 && res.status < 300) return res.data;
    const err = res.data && res.data.error ? res.data.error : {};
    const code = str(err.code);
    if (res.status === 404 || res.status === 410 || code === 'CONTENT_UNAVAILABLE') {
      fail('NOT_FOUND', '该内容已下架或不可用', { details: { status: res.status, code } });
    }
    if (res.status === 401) fail('AUTH_REQUIRED', '需要登录（游客会话失效）', { details: { code } });
    if (res.status === 403 || code === 'PAYMENT_REQUIRED') {
      fail('CONTENT_LOCKED', '该集需要金币或会员解锁', { details: { code } });
    }
    if (res.status === 429) fail('RATE_LIMITED', '站点限流，稍后再试', { retryAfterSec: 30 });
    fail('UPSTREAM_ERROR', (err.message || '接口返回 ' + res.status), { details: { status: res.status, code } });
  }

  // ---- 游客会话 ------------------------------------------------------------

  async function deviceId() {
    let id = await hg.storage.get(DEVICE_KEY);
    if (typeof id !== 'string' || !id) {
      id = hg.crypto.randomUUID();
      await hg.storage.set(DEVICE_KEY, id);
    }
    return id;
  }

  async function guestToken(ctx, force) {
    if (!force) {
      if (tokenCache) return tokenCache;
      const saved = await hg.storage.get(TOKEN_KEY);
      if (saved && typeof saved.token === 'string' && saved.token) {
        tokenCache = saved;
        return saved;
      }
    }
    const data = await call('/api/guest-sessions', {
      method: 'POST',
      body: { device_id: await deviceId() },
      ctx,
      timeoutMs: 15000,
    });
    const token = data && data.data && data.data.access_token;
    if (!token) fail('UPSTREAM_CHANGED', '游客会话接口没有返回令牌');
    const record = { token, subject: (data.data.subject && data.data.subject.id) || '' };
    tokenCache = record;
    await hg.storage.set(TOKEN_KEY, record);
    return record;
  }

  // ---- 数据映射 ------------------------------------------------------------

  function toItem(row) {
    if (!row || typeof row !== 'object') return null;
    const id = str(row.id);
    const title = str(row.title) || str(row.name);
    if (!id || !title) return null;
    const cover = str(row.cover_url) || str(row.coverUrl) || str(row.image_url);
    const count = num(row.episode_count) || num(row.latest_episode_number);
    const item = { id, title, type: 'short' };
    if (cover) item.cover = cover;
    const desc = str(row.description);
    if (desc) item.description = desc.length > 500 ? desc.slice(0, 500) : desc;
    const tags = Array.isArray(row.tags) ? row.tags.map((t) => str(t && t.name)).filter(Boolean) : [];
    if (tags.length) item.tags = tags.slice(0, 8);
    if (count) item.badge = str(row.serial_status) === 'completed' ? '全 ' + count + ' 集' : '更至 ' + count + ' 集';
    const commerce = row.commerce || {};
    if (commerce.charge_type === 'coin') item.badge = (item.badge ? item.badge + ' · ' : '') + '金币';
    const updated = str(row.updated_at) || str(row.listed_at);
    if (updated) {
      const ms = Date.parse(updated);
      if (Number.isFinite(ms)) item.publishedAt = ms;
    }
    return item;
  }

  function itemsOf(rows) {
    const out = [];
    const seen = new Set();
    for (const row of rows || []) {
      const item = toItem(row && row.drama ? { ...row.drama, image_url: row.image_url } : row);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }

  function nextOf(data) {
    const cursor = data && (data.next_cursor || data.nextCursor);
    return str(cursor) || null;
  }

  // ---- 能力 ----------------------------------------------------------------

  return {
    // 线路：优先读回家页的 home-config.js，失败用兜底列表
    endpoints: {
      async list(params, ctx) {
        const refresh = params && params.refresh;
        if (!refresh) {
          const cached = await hg.storage.get('endpoints:cache');
          if (cached && Array.isArray(cached.list) && cached.list.length) return cached.list;
        }
        try {
          const res = await hg.http.fetch({
            url: PORTAL + '/assets/home-config.js',
            headers: { 'User-Agent': UA, Accept: 'application/javascript,*/*' },
            responseType: 'text',
            timeoutMs: 12000,
            retry: 1,
            signal: ctx && ctx.signal,
          });
          const text = typeof res.data === 'string' ? res.data : '';
          const block = text.match(/domains\s*:\s*\[([\s\S]*?)\]/);
          const hosts = block
            ? [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/\/+$/, '')).filter((u) => /^https:\/\//.test(u))
            : [];
          const list = [];
          const seen = new Set();
          for (const url of hosts.slice(0, 20)) {
            let host = '';
            try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { continue; }
            if (!host || seen.has(host)) continue;
            seen.add(host);
            list.push({ id: host, label: '线路 ' + (list.length + 1) + '（' + host + '）', url });
          }
          if (list.length) {
            await hg.storage.set('endpoints:cache', { list, at: Date.now() }, { ttlSec: 6 * 3600 });
            return list;
          }
        } catch (_) { /* 回家页不可达时退回兜底 */ }
        return FALLBACK_ENDPOINTS;
      },
    },

    home: {
      async getSections(params, ctx) {
        const sections = [];
        try {
          const hot = await call('/api/home/hot', { ctx, timeoutMs: 12000 });
          const items = itemsOf(hot && hot.data && hot.data.items);
          if (items.length) sections.push({ id: 'hot', title: '热播', layout: 'grid', items });
        } catch (_) { /* 单分区失败不影响其它分区 */ }
        try {
          const discover = await call('/api/discover', { ctx, timeoutMs: 12000 });
          const ranks = (discover && discover.data && discover.data.ranks) || {};
          for (const key of ['hot', 'fresh']) {
            const items = itemsOf(ranks[key]);
            if (items.length) sections.push({ id: 'rank:' + key, title: RANK_LABELS[key] || key, layout: 'row', items });
          }
        } catch (_) { /* 忽略 */ }
        if (!sections.length) fail('UPSTREAM_CHANGED', '首页没有取到内容');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const data = await call('/api/categories', { ctx, timeoutMs: 12000 });
        const rows = Array.isArray(data && data.data) ? data.data : [];
        const list = rows
          .filter((c) => c && c.id && c.name && !(num(c.drama_count) === 0))
          .map((c) => ({ id: str(c.id), label: str(c.name) }));
        return [{ id: 'all', label: '全部' }, ...list];
      },

      async list(params, ctx) {
        const categoryId = str(params && params.categoryId);
        const query = {};
        if (categoryId && categoryId !== 'all') query.category = categoryId;
        const cursor = pageCursor(params && params.cursor);
        if (cursor) query.cursor = cursor;
        const data = await call('/api/theater', { ctx, query, timeoutMs: 15000 });
        const body = (data && data.data) || {};
        return { items: itemsOf(body.items), next: nextOf(body) };
      },
    },

    search: {
      async search(params, ctx) {
        const q = str(params && params.query);
        if (!q) return { items: [], next: null };
        const query = { q };
        const cursor = pageCursor(params && params.cursor);
        if (cursor) query.cursor = cursor;
        const data = await call('/api/search', { ctx, query, timeoutMs: 15000 });
        const body = (data && data.data) || {};
        return {
          items: itemsOf((body.items || []).map((row) => ({ ...row, cover_url: row.cover_url }))),
          next: nextOf(body),
        };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = str(params && params.id);
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const [detail, eps] = await Promise.all([
          call('/api/dramas/' + encodeURIComponent(id), { ctx, timeoutMs: 15000 }),
          call('/api/dramas/' + encodeURIComponent(id) + '/episodes', { ctx, timeoutMs: 15000 })
            .catch(() => null),
        ]);
        const d = (detail && detail.data) || {};
        const rows = Array.isArray(eps && eps.data) ? eps.data : [];
        const episodes = [];
        for (let i = 0; i < rows.length; i++) {
          const ep = rows[i] || {};
          const epId = str(ep.id) || str(ep.commerce && ep.commerce.episode_id);
          if (!epId) continue;
          const commerce = ep.commerce || {};
          const locked = commerce.charge_type === 'coin' && commerce.can_play === false;
          const label = str(ep.title) || ('第 ' + (num(ep.episode_number) || i + 1) + ' 集');
          episodes.push({
            id: epId,
            index: i + 1,
            episodeNumber: num(ep.episode_number) || i + 1,
            label,
            ...(num(ep.duration_seconds) ? { durationSec: num(ep.duration_seconds) } : {}),
            ...(locked ? { badge: '需解锁' } : {}),
          });
        }
        if (!episodes.length && num(d.episode_count)) {
          for (let i = 1; i <= Math.min(num(d.episode_count), 200); i++) {
            episodes.push({ id: 'n:' + i, index: i, episodeNumber: i, label: '第 ' + i + ' 集' });
          }
        }
        if (!episodes.length) fail('UPSTREAM_CHANGED', '未取到分集列表');

        const tags = Array.isArray(d.tags) ? d.tags.map((t) => str(t && t.name)).filter(Boolean) : [];
        const cover = str(d.cover_url);
        const desc = str(d.description);
        return {
          id,
          title: str(d.title) || String(id),
          type: 'short',
          ...(cover ? { cover } : {}),
          ...(desc ? { description: desc } : {}),
          ...(tags.length ? { tags: tags.slice(0, 8) } : {}),
          ...(num(d.episode_count) ? { totalEpisodes: num(d.episode_count) } : {}),
          playlists: [{ id: 'main', label: '默认', episodes }],
        };
      },

      async resolvePlayback(params, ctx) {
        const episodeId = str(params && params.episodeId);
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        if (episodeId.startsWith('n:')) {
          fail('UPSTREAM_CHANGED', '该集缺少内部 ID，请刷新详情后重试');
        }
        const record = await guestToken(ctx);
        let data;
        try {
          data = await call('/api/playback/sessions', {
            method: 'POST',
            body: { episode_id: episodeId },
            token: record.token,
            ctx,
            timeoutMs: 20000,
          });
        } catch (error) {
          // 游客令牌过期：换一个再试一次
          if (error && error.code === 'AUTH_REQUIRED') {
            const fresh = await guestToken(ctx, true);
            data = await call('/api/playback/sessions', {
              method: 'POST',
              body: { episode_id: episodeId },
              token: fresh.token,
              ctx,
              timeoutMs: 20000,
            });
          } else {
            throw error;
          }
        }
        const payload = (data && data.data) || {};
        const media = payload.media || {};
        const url = str(media.manifest_url) || str(media.url);
        if (!url) fail('UPSTREAM_CHANGED', '播放会话没有返回地址');
        const headers = { Referer: origin() + '/', 'User-Agent': UA };
        const expiresAt = media.expires_at ? Date.parse(media.expires_at) : NaN;
        return {
          streams: [{
            url,
            kind: 'media',
            format: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'progressive',
            headers,
          }],
          ...(Number.isFinite(expiresAt) ? { expiresAt } : {}),
          ...(num(payload.progress_seconds) ? { resumeSec: num(payload.progress_seconds) } : {}),
        };
      },

      matchUrl(params) {
        const raw = str(params && params.url);
        if (!raw) return null;
        try {
          const u = new URL(raw);
          const m = u.pathname.match(/\/dramas\/([0-9a-f-]{36})/i);
          if (!m) return null;
          return { mediaId: m[1] };
        } catch (_) {
          return null;
        }
      },
    },
  };
}
