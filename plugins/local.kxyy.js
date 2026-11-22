// HPP 插件：快看影院（MacCMS v10 + Bootstrap 模板）
// 只用 E:\HGhub\huangguo-client\docs\plugin-protocol 公开接口。
export const meta = {
  id: 'local.kxyy',
  name: '快看影院',
  version: '0.1.0',
  protocol: 1,
  author: 'HPP 实测',
  description: '六条线路的点播源，列表走页面、搜索走 suggest 接口',
  linkDomains: ['www.kxyy1.cc', 'kxyy1.cc'],
};

const BASE = 'https://www.kxyy1.cc';

export default function (hg) {
  const origin = () => (hg.endpoint.current && hg.endpoint.current.url) || BASE;
  const fail = (code, msg) => { throw new hg.PluginError(code, msg); };

  const abs = (u) => {
    if (!u) return null;
    const s = String(u).trim();
    if (!s) return null;
    if (s.startsWith('//')) return 'https:' + s;
    if (s.startsWith('/')) return origin() + s;
    if (s.startsWith('http://')) return 'https://' + s.slice(7);
    return s;
  };
  // 封面在腾讯微云图床，带站点 Referer 会被拒；条目级 headers 只能加不能删，用空 Referer 抑制
  const img = (u) => { const url = abs(u); return url && /^https:\/\//.test(url) ? { url, headers: { Referer: '' } } : undefined; };
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
  const text = (n) => (n ? n.text().trim() : '');

  async function get(path, { json } = {}) {
    const res = await hg.http.fetch({
      url: path.startsWith('http') ? path : origin() + path,
      responseType: json ? 'json' : 'text',
      retry: 1,
      cache: { ttlSec: 240 },
    });
    if (res.status === 404) fail('NOT_FOUND', '内容不存在');
    if (res.status === 429 || res.status === 503) fail('RATE_LIMITED', '来源限流，请稍后再试');
    if (!res.ok) fail('UPSTREAM_ERROR', `来源返回 ${res.status}`);
    return res.data;
  }

  // 验证页没有结果卡片；正常详情页里的评论验证码是 name="verify"，不能作为判断依据
  const isChallenge = (raw) => /verify_check|mx-mac_msg_jump/.test(raw);

  // 列表页卡片：<a href="/voddetail/ID.html"><img><span class="badge">更新至..</span></a>
  //             <h3 class="card-title">名称</h3><p class="text-muted">2026-11-19</p>
  function cardOf(node) {
    const a = node.first('a[href*="/voddetail/"]');
    const id = a && (a.attr('href').match(/\/voddetail\/(\d+)\.html/) || [])[1];
    if (!id) return null;
    const title = text(node.first('.card-title'));
    if (!title) return null;
    const date = (text(node.first('.card-body p')).match(/^\d{4}-\d{2}-\d{2}$/) || [])[0];
    return {
      id,
      title,
      cover: img((node.first('img') || { attr: () => null }).attr('src')),
      badge: text(node.first('.badge')).slice(0, 8) || undefined,
      updatedAt: date ? Date.parse(date + 'T00:00:00') || undefined : undefined,
    };
  }

  // 分类页 URL 由 类型-地区-年份-语言-字母-排序-页码 组成，页码在第 7 段
  async function listByType(tid, pageNo) {
    const data = await get(`/vodshow/${tid}--------${pageNo}---.html`);
    const doc = hg.html.parse(data);
    if (isChallenge(data)) fail('INTERACTION_REQUIRED', '站点要求人机验证，请先在网页中完成验证');
    const items = doc.select('.col-lg-8.col-4, .col-6.col-md-4, .col-4').map(cardOf).filter(Boolean);
    if (!items.length) fail('UPSTREAM_CHANGED', '列表页结构已变化');
    // 模板没有可靠的页数输出，用满页判断还能翻
    return { items, next: items.length >= 20 ? String(pageNo + 1) : null };
  }

  const TYPE = { 1: 'movie', 2: 'series', 3: 'variety', 4: 'anime' };
  const CATS = [[2, '剧集'], [1, '电影'], [4, '动漫'], [3, '综艺']];

  async function getDetail({ id }) {
    const raw = await get(`/voddetail/${id}.html`);
    const doc = hg.html.parse(raw);
    if (isChallenge(raw)) fail('INTERACTION_REQUIRED', '站点要求人机验证，请先在网页中完成验证');

    const h1 = text(doc.first('h1'));
    if (!h1) fail('UPSTREAM_CHANGED', '页面结构已变化');
    const title = h1.replace(/\s*\(\d{4}\)\s*$/, '').trim();
    const year = (h1.match(/\((\d{4})\)\s*$/) || [])[1];

    // 线路名在导航标签里，分集在 #tabs-home-N 面板里，两边靠编号对上
    const labels = {};
    for (const nav of doc.select('a.nav-link[href^="#tabs-home-"]')) {
      const n = (nav.attr('href').match(/tabs-home-(\d+)/) || [])[1];
      // 标签内含 svg 图标与集数 badge，只取中文源名
      const label = nav.text().replace(/\d+\s*$/, '').replace(/\s+/g, ' ').trim();
      if (n && label) labels[n] = label;
    }

    const playlists = [];
    for (const pane of doc.select('div.tab-pane[id^="tabs-home-"]')) {
      const n = (pane.attr('id').match(/tabs-home-(\d+)/) || [])[1];
      const episodes = [];
      for (const a of pane.select('a[href*="/vodplay/"]')) {
        const m = (a.attr('href') || '').match(/\/vodplay\/(\d+)-(\d+)-(\d+)\.html/);
        if (!m) continue;
        episodes.push({ id: `${m[1]}-${m[2]}-${m[3]}`, index: Number(m[3]), label: text(a) || m[3] });
      }
      if (!episodes.length) continue;
      episodes.sort((x, y) => x.index - y.index);
      playlists.push({
        id: n,
        label: labels[n] || `线路 ${n}`,
        kind: 'main',
        episodes: episodes.map((e, i) => ({ id: e.id, index: i + 1, label: e.label })),
      });
    }
    if (!playlists.length) fail('UPSTREAM_CHANGED', '未找到分集');

    // 详情页没有独立的简介区块，简介只在 meta[name=description] / og:description 里
    const descMeta = doc.first('meta[property="og:description"]') || doc.first('meta[name="description"]');
    const plot = descMeta
      ? String(descMeta.attr('content') || '').replace(/^.*?剧情简介：/, '').replace(/^.*?剧情：/, '').replace(/\.\.\.$/, '').trim()
      : '';

    return {
      id: String(id),
      title,
      type: 'other',
      cover: img((doc.first('.cover2 img') || doc.first('img.object-cover') || { attr: () => null }).attr('src')),
      description: plot || undefined,
      year: year ? Number(year) : undefined,
      badge: text(doc.first('.badge.bg-pink')).slice(0, 8) || undefined,
      playlists,
    };
  }

  async function resolvePlayback({ episodeId, reason }) {
    const m = String(episodeId).match(/^(\d+)-(\d+)-(\d+)$/);
    if (!m) fail('INVALID_ARGUMENT', '分集 ID 无效');
    const res = await hg.http.fetch({
      url: `${origin()}/vodplay/${m[1]}-${m[2]}-${m[3]}.html`,
      retry: reason === 'refresh' ? 0 : 1,
      headers: { Referer: `${origin()}/voddetail/${m[1]}.html` },
      ...(reason === 'refresh' ? {} : { cache: { ttlSec: 120 } }),
    });
    if (!res.ok) fail('UPSTREAM_ERROR', `播放页返回 ${res.status}`);

    // 站点的 player_data 里 encrypt 恒为 0，但不同线路可能给出播放页而非直链
    const cfg = res.data.match(/player_[a-z]+\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
    if (!cfg) fail('UPSTREAM_CHANGED', '未找到播放配置');
    let obj;
    try { obj = JSON.parse(cfg[1]); } catch { fail('UPSTREAM_CHANGED', '播放配置不是有效 JSON'); }

    const url = String(obj.url || '').trim();
    if (!/^https:\/\//.test(url)) fail('UPSTREAM_CHANGED', '播放地址无效');

    const page = /^https:\/\/(v|www)\.(qq|youku|iqiyi)\.com\/|^https:\/\/www\.bilibili\.com\//.test(url);
    if (page) return { streams: [{ url, kind: 'page' }] };

    return {
      streams: [{
        url,
        format: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'progressive',
        headers: { Referer: `${origin()}/` },
      }],
      expiresAt: Date.now() + 3600 * 1000,
    };
  }

  return {
    endpoints: { list: () => [{ id: 'main', label: '主站', url: BASE }] },
    media: {
      getDetail,
      resolvePlayback,
      async matchUrl({ url }) {
        const m = String(url).match(/\/voddetail\/(\d+)\.html/);
        return m ? { mediaId: m[1] } : null;
      },
    },
    search: {
      async search({ query }) {
        const d = await get(`/index.php/ajax/suggest?mid=1&wd=${encodeURIComponent(query)}`, { json: true });
        if (!d || !Array.isArray(d.list)) fail('UPSTREAM_CHANGED', '搜索结构已变化');
        return {
          items: d.list.map((r) => ({ id: String(r.id), title: String(r.name || ''), cover: img(r.pic) })).filter((i) => i.title),
          next: null,
        };
      },
    },
    home: {
      async getSections() {
        const out = [];
        for (const [tid, label] of CATS) {
          const p = await listByType(tid, 1);
          out.push({ id: String(tid), title: label, layout: 'row', items: p.items, more: true });
        }
        return { items: out, next: null };
      },
      listSection: ({ sectionId, cursor }) => listByType(Number(sectionId) || 2, Number(cursor) || 1),
    },
    catalog: {
      getCategories: () => CATS.map(([tid, label]) => ({ id: String(tid), label })),
      list: ({ categoryId, cursor }) => listByType(Number(categoryId) || 2, Number(cursor) || 1),
    },
  };
}

