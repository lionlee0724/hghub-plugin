// HPP 插件：西饭短剧（xifan / fanguo）
// 站点是 App 接口（xifan-api-cn.youlishipin.com），列表=关键词搜索，详情直接给 playUrl。
// 参考 guoapp 的 provider_duanju_sources.go（fetchFanguoCatalogPage / fetchFanguoDetail）。
export const meta = {
  id: 'fanguo',
  name: '西饭短剧',
  version: '0.1.0',
  protocol: 1,
  description: '西饭短剧（fanguo）：按题材关键词浏览、搜索、详情与直链播放。接口为 App 端 JSON，无需签名。',
  author: 'lionlee0724',
  kind: 'source',
  mature: false,
  linkDomains: ['xifan-api-cn.youlishipin.com', 'dj.youlishipin.com'],
  defaultHeaders: {
    Referer: 'https://xifan-api-cn.youlishipin.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://xifan-api-cn.youlishipin.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 站点没有分类树，"分类"就是搜索关键词（App 里也是这么翻的）
const TOPICS = ['都市', '战神', '逆袭', '甜宠', '悬疑', '古装', '复仇', '重生', '豪门', '穿越'];

export default function (hg) {
  function origin() {
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return SITE;
  }

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  function str(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  async function api(path, query, ctx) {
    const res = await hg.http.fetch({
      url: origin() + path,
      headers: { Accept: 'application/json', 'User-Agent': UA, Referer: origin() + '/' },
      query,
      responseType: 'json',
      timeoutMs: 15000,
      retry: 1,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) {
      if (res.status === 404) fail('NOT_FOUND', '内容不存在');
      fail(res.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR', '接口返回 ' + res.status);
    }
    const body = res.data || {};
    if (body.ret !== undefined && body.ret !== 0) fail('UPSTREAM_CHANGED', '接口返回 ret=' + body.ret);
    return body.result || {};
  }

  // 站点 ID = "<duanjuId>@<source>"
  function makeId(duanjuId, source) {
    return String(duanjuId) + '@' + String(source || '');
  }

  function parseId(id) {
    const raw = str(id);
    const at = raw.indexOf('@');
    if (at < 0) return { duanjuId: raw, source: '' };
    return { duanjuId: raw.slice(0, at), source: raw.slice(at + 1) };
  }

  function toItem(vo) {
    const duanjuId = str(vo.duanjuId) || str(vo.id);
    const title = str(vo.title) || str(vo.name);
    if (!duanjuId || !title) return null;
    const item = { id: makeId(duanjuId, vo.source), title, type: 'short' };
    const cover = str(vo.coverImageUrl) || str(vo.cover);
    if (cover) item.cover = cover;
    const desc = str(vo.desc) || str(vo.description);
    if (desc) item.description = desc.length > 500 ? desc.slice(0, 500) : desc;
    const total = num(vo.total) || num(vo.totalEpisodeNum);
    if (total) item.badge = (str(vo.updateStatus) === 'over' ? '全 ' : '更至 ') + total + ' 集';
    const cats = Array.isArray(vo.categories) ? vo.categories.map((c) => str(c && (c.name || c))).filter(Boolean) : [];
    if (cats.length) item.tags = cats.slice(0, 6);
    return item;
  }

  async function searchPage(keyword, page, ctx) {
    const result = await api('/xifan/search/getSearchList', {
      reqType: 'search',
      offset: '0',
      keyword,
      quickEngineVersion: '-1',
      scene: '',
      pageIndex: String(page),
    }, ctx);
    const items = [];
    for (const block of result.elements || []) {
      for (const entry of block.contents || []) {
        const item = toItem(entry.duanjuVo || entry);
        if (item) items.push(item);
      }
    }
    return { items, hasMore: !!(result.hasMore || (result.elements && result.elements[0] && result.elements[0].hasMore)) };
  }

  return {
    endpoints: { list() { return [{ id: 'main', label: '主站', url: SITE }]; } },

    home: {
      async getSections(params, ctx) {
        const sections = [];
        for (const topic of ['都市', '战神', '逆袭']) {
          try {
            const page = await searchPage(topic, 1, ctx);
            if (page.items.length) sections.push({ id: 'topic:' + topic, title: topic, layout: 'grid', items: page.items });
          } catch (_) { /* 单分区失败忽略 */ }
        }
        if (!sections.length) fail('UPSTREAM_CHANGED', '首页没有取到内容');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories() {
        return TOPICS.map((t) => ({ id: t, label: t }));
      },
      async list(params, ctx) {
        const topic = str(params && params.categoryId) || TOPICS[0];
        const page = Math.max(1, parseInt(str(params && params.cursor) || '1', 10) || 1);
        const result = await searchPage(topic, page, ctx);
        return { items: result.items, next: result.hasMore ? String(page + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = str(params && params.query);
        if (!q) return { items: [], next: null };
        const page = Math.max(1, parseInt(str(params && params.cursor) || '1', 10) || 1);
        const result = await searchPage(q, page, ctx);
        return { items: result.items, next: result.hasMore ? String(page + 1) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const { duanjuId, source } = parseId(params && params.id);
        if (!duanjuId) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const data = await api('/xifan/drama/getDuanjuInfo', { duanjuId, source }, ctx);
        const title = str(data.title) || duanjuId;
        const episodes = [];
        let index = 0;
        for (const ep of data.episodeList || []) {
          const playUrl = str(ep.playUrl) || str(ep.play_url) || str(ep.videoUrl);
          if (!playUrl) continue;
          index += 1;
          episodes.push({
            id: String(num(ep.index) || num(ep.episode) || index) + '|' + playUrl,
            index,
            episodeNumber: num(ep.index) || index,
            label: str(ep.title) || ('第 ' + (num(ep.index) || index) + ' 集'),
          });
        }
        if (!episodes.length) fail('UPSTREAM_CHANGED', '未取到可播放分集');
        const cover = str(data.coverImageUrl) || str(data.cover);
        const desc = str(data.desc) || str(data.description);
        const total = num(data.total) || episodes.length;
        return {
          id: makeId(duanjuId, source),
          title,
          type: 'short',
          ...(cover ? { cover } : {}),
          ...(desc ? { description: desc } : {}),
          ...(total ? { totalEpisodes: total } : {}),
          playlists: [{ id: 'main', label: '默认', episodes }],
        };
      },

      async resolvePlayback(params, ctx) {
        const episodeId = str(params && params.episodeId);
        const cut = episodeId.indexOf('|');
        const url = cut >= 0 ? episodeId.slice(cut + 1) : '';
        if (!/^https?:\/\//i.test(url)) fail('UPSTREAM_CHANGED', '该集缺少播放地址');
        return {
          streams: [{
            url,
            kind: 'media',
            format: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'progressive',
            headers: { Referer: origin() + '/', 'User-Agent': UA },
          }],
        };
      },

      matchUrl() { return null; },
    },
  };
}
