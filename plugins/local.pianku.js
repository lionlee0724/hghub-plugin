// HPP 插件：片库（MacCMS 风格页面）
// 依据 E:\HGhub\huangguo-client\docs\plugin-protocol 公开文档实现，只用 hg.* 公开接口。
export const meta = {
  id: 'local.pianku',
  name: '片库',
  version: '0.1.0',
  protocol: 1,
  author: 'HPP 实测',
  description: '页面解析型点播源，含多条播放线路',
  linkDomains: ['4k01.pianku.online'],
  // 站点图片全在第三方 CDN，带上站内 Referer 会被防盗链拦截（见报告 §缺陷），
  // 这里故意不设 defaultHeaders，靠插件在条目上逐条覆盖。
  settings: [
    { key: 'lineOrder', type: 'select', label: '优先播放线路', default: 'auto',
      options: [{ value: 'auto', label: '自动' }, { value: '2', label: '备用线路' }, { value: '1', label: '腾讯' }] },
  ],
};

const BASE = 'https://4k01.pianku.online';

export default function (hg) {
  const origin = () => (hg.endpoint.current && hg.endpoint.current.url) || BASE;

  // ---------- 小工具 ----------
  const abs = (u) => {
    if (!u) return null;
    const s = String(u).trim();
    if (!s) return null;
    if (s.startsWith('//')) return 'https:' + s;
    if (s.startsWith('/')) return origin() + s;
    // 站点大量封面写死 http://，HPP 只接受 https
    if (s.startsWith('http://')) return 'https://' + s.slice(7);
    return s;
  };

  // 第三方 CDN 对站内 Referer 返回 403；条目级 headers 只能加、不能删，
  // 因此显式给空 Referer 抑制默认头（实测宿主按字面发送空 Referer）。
  const img = (u) => {
    const url = abs(u);
    if (!url) return undefined;
    return /^https:\/\//.test(url) ? { url, headers: { Referer: '' } } : undefined;
  };

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const text = (node) => (node ? node.text().trim() : '');
  const fail = (code, msg) => { throw new hg.PluginError(code, msg); };

  async function get(path, { json = false, referer } = {}) {
    const res = await hg.http.fetch({
      url: path.startsWith('http') ? path : origin() + path,
      responseType: json ? 'json' : 'text',
      headers: referer ? { Referer: referer } : undefined,
      retry: 1,
      cache: { ttlSec: 300 },
    });
    if (!res.ok) {
      if (res.status === 404) fail('NOT_FOUND', '内容不存在');
      if (res.status === 429 || res.status === 503) fail('RATE_LIMITED', '请求过于频繁，请稍后再试');
      fail('UPSTREAM_ERROR', `来源返回 ${res.status}`);
    }
    return res.data;
  }

  // 站点在列表接口上开了搜索验证码：返回 HTML 校验页而不是正常页面
  const assertNotChallenge = (doc) => {
    if (doc.first('.mx-mac_msg_jump') || doc.first('input[name="verify"]')) {
      fail('INTERACTION_REQUIRED', '站点要求人机验证，请在网页中打开站点完成验证后重试');
    }
  };

  // ---------- 映射 ----------
  const TYPE_BY_TID = { 20: 'movie', 37: 'series', 43: 'anime', 45: 'variety' };

  function cardFromJson(row) {
    const tid = Number(row.type_id_1) || Number(row.type_id);
    const item = {
      id: String(row.vod_id),
      title: String(row.vod_name || '').trim(),
      type: TYPE_BY_TID[tid] || 'other',
      cover: img(row.vod_pic),
      description: row.vod_blurb ? String(row.vod_blurb) : undefined,
      tags: row.vod_class ? String(row.vod_class).split(/[,\/]/).map((s) => s.trim()).filter(Boolean) : undefined,
      score: (() => { const s = num(row.vod_score); return s && s > 0 && s <= 10 ? s : undefined; })(),
      year: num(String(row.vod_year || '').slice(0, 4)),
      updatedAt: row.vod_time ? Date.parse(String(row.vod_time).replace(' ', 'T')) || undefined : undefined,
      badge: row.vod_remarks ? String(row.vod_remarks).slice(0, 8) : undefined,
    };
    const total = num(row.vod_total);
    if (total) item.totalEpisodes = total;
    return item;
  }

  function detailOf(id) {
    return `/voddetail/${id}.html`;
  }

  // ---------- 详情 ----------
  async function getDetail({ id }) {
    const res = await hg.http.fetch({ url: origin() + detailOf(id), retry: 1 });
    if (!res.ok) fail(res.status === 404 ? 'NOT_FOUND' : 'UPSTREAM_ERROR', res.status === 404 ? '内容不存在' : `来源返回 ${res.status}`);
    const doc = hg.html.parse(res.data);
    assertNotChallenge(doc);

    const title = text(doc.first('.detail-title')).replace(/\s+$/, '');
    const h1 = doc.first('.detail-title');
    const remarks = h1 ? text(h1.first('.detail-remarks')) : '';
    const cleanTitle = (title.replace(remarks, '') || '').trim();
    if (!cleanTitle) fail('UPSTREAM_CHANGED', '页面结构已变化');

    const metas = doc.select('.detail-meta span').map((s) => s.text());
    const metaOf = (label) => {
      const hit = metas.find((m) => m.startsWith(label));
      return hit ? hit.slice(label.length).trim() : '';
    };
    const year = (metaOf('年份').match(/\d{4}/) || [])[0];

    // 站点的线路标签与分集分属两处 DOM，用 data-target / id 对上
    const tabs = doc.select('.source-tab-item').map((t) => ({ target: (t.attr('data-target') || '').replace(/^playlist-/, ''), label: t.text().trim() }));
    const playlists = [];
    for (const tab of tabs) {
      const pane = doc.first('#playlist-' + tab.target);
      if (!pane) continue;
      const episodes = [];
      let index = 0;
      for (const a of pane.select('a.play-btn-item')) {
        const href = a.attr('href') || '';
        const m = href.match(/\/vodplay\/(\d+)-(\d+)-(\d+)\.html/);
        if (!m) continue;
        index += 1;
        episodes.push({
          id: `${m[1]}-${m[2]}-${m[3]}`,
          index,
          label: (a.attr('title') || a.text() || String(index)).trim(),
        });
      }
      if (!episodes.length) continue;
      playlists.push({ id: tab.target, label: tab.label || `线路 ${tab.target}`, kind: 'main', episodes });
    }
    if (!playlists.length) fail('UPSTREAM_CHANGED', '未找到分集，页面结构可能已变化');

    const descNode = doc.first('.detail-desc');
    return {
      id: String(id),
      title: cleanTitle,
      type: 'series',
      cover: img((doc.first('.detail-poster img') || { attr: () => null }).attr('src')),
      description: descNode ? text(descNode.first('p')) || text(descNode) : undefined,
      year: year ? Number(year) : undefined,
      tags: metaOf('分类') ? [metaOf('分类')] : undefined,
      badge: remarks ? remarks.slice(0, 8) : undefined,
      people: [],
      playlists,
    };
  }

  // ---------- 播放 ----------
  async function resolvePlayback({ episodeId, reason }) {
    const m = String(episodeId).match(/^(\d+)-(\d+)-(\d+)$/);
    if (!m) fail('INVALID_ARGUMENT', '分集 ID 无效');
    const playUrl = `${origin()}/vodplay/${m[1]}-${m[2]}-${m[3]}.html`;
    // reason: refresh 时不走缓存
    const res = await hg.http.fetch({
      url: playUrl, retry: reason === 'refresh' ? 0 : 1,
      headers: { Referer: origin() + detailOf(m[1]) },
      cache: reason === 'refresh' ? undefined : { ttlSec: 120 },
    });
    if (!res.ok) fail('UPSTREAM_ERROR', `播放页返回 ${res.status}`);

    const doc = hg.html.parse(res.data);
    const holder = doc.first('[data-player], .mac_player, .player-wrap') || doc.first('body');
    const raw = holder ? holder.html() : res.data;
    const cfg = raw.match(/player_[a-z]+\s*=\s*(\{[\s\S]*?\})\s*(?:;|<\/script>)/);
    if (!cfg) fail('UPSTREAM_CHANGED', '播放页结构已变化，未找到播放配置');

    let obj;
    try { obj = JSON.parse(cfg[1]); } catch { fail('UPSTREAM_CHANGED', '播放配置不是有效 JSON'); }
    // 本站这个模板的 encrypt 恒为 0；非 0 时地址是多层 URL 编码
    let url = String(obj.url || '');
    if (obj.encrypt && obj.encrypt !== 0) {
      for (let i = 0; i < 4; i++) {
        const next = decodeURIComponent(url);
        if (next === url) break;
        url = next;
      }
    }
    if (!/^https?:\/\//.test(url)) fail('UPSTREAM_CHANGED', '播放地址无效');

    // 大站点的地址是播放页而不是流，交给解析器插件
    const bigSite = /^https:\/\/(v|www)\.qq\.com\/|^https:\/\/(v|www)\.youku\.com\/|^https:\/\/www\.bilibili\.com\//.test(url);
    if (bigSite) {
      return { streams: [{ url, kind: 'page' }] };
    }

    const isHls = /\.m3u8(\?|$)/i.test(url);
    return {
      streams: [{
        url,
        format: isHls ? 'hls' : 'progressive',
        headers: { Referer: origin() + '/' },
      }],
      servers: [],
      expiresAt: Date.now() + 2 * 60 * 60 * 1000,
    };
  }

  // ---------- 浏览 ----------

  async function listByType(tid, page, limit) {
    const data = await get(`/index.php/ajax/data?mid=1&tid=${tid}&page=${page}&limit=${limit}`, { json: true });
    if (!data || !Array.isArray(data.list)) fail('UPSTREAM_CHANGED', '列表结构已变化');
    const total = num(data.total) || 0;
    const pageCount = num(data.pagecount) || 0;
    return {
      items: data.list.map(cardFromJson).filter((c) => c.title),
      next: page < pageCount ? String(page + 1) : null,
      total: total || undefined,
    };
  }

  return {
    endpoints: {
      list() {
        return [{ id: 'main', label: '主站', url: BASE }];
      },
    },

    media: {
      getDetail,
      resolvePlayback,
      async matchUrl({ url }) {
        const m = String(url).match(/\/voddetail\/(\d+)\.html/);
        if (!m) return null;
        return { mediaId: m[1] };
      },
    },

    search: {
      async search({ query, cursor }) {
        const page = Number(cursor) || 1;
        const enc = encodeURIComponent(query);
        // 站点搜索被验证码拦截；先走 suggest 接口拿到 id，再回填为条目
        const data = await get(`/index.php/ajax/suggest?mid=1&wd=${enc}`, { json: true });
        if (!data || !Array.isArray(data.list)) fail('UPSTREAM_CHANGED', '搜索结构已变化');
        return {
          items: data.list.map((r) => ({
            id: String(r.id), title: String(r.name || ''), cover: img(r.pic),
          })).filter((i) => i.title),
          next: null,
        };
      },
    },

    home: {
      async getSections() {
        const sections = [];
        for (const [tid, label] of [[20, '最新电影'], [37, '最新剧集'], [43, '动漫'], [45, '综艺']]) {
          const page = await listByType(tid, 1, 12);
          sections.push({ id: String(tid), title: label, layout: 'row', imageAspect: 'portrait', items: page.items, more: true });
        }
        return { items: sections, next: null };
      },
      async listSection({ sectionId, cursor, limit }) {
        return listByType(Number(sectionId), Number(cursor) || 1, limit || 24);
      },
    },

    catalog: {
      getCategories() {
        return [
          { id: '20', label: '电影' },
          { id: '37', label: '剧集' },
          { id: '43', label: '动漫' },
          { id: '45', label: '综艺' },
        ];
      },
      async list({ categoryId, cursor, limit }) {
        return listByType(Number(categoryId) || 20, Number(cursor) || 1, limit || 24);
      },
    },
  };
}

