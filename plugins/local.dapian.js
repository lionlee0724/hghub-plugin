// HPP 插件：大片网（mxpro 模板，MacCMS 后端）
// 只用 E:\HGhub\huangguo-client\docs\plugin-protocol 公开接口。
export const meta = {
  id: 'local.dapian',
  name: '大片网',
  version: '0.1.1',
  protocol: 1,
  author: 'HPP 实测',
  description: 'mxpro 模板点播源，两条播放线路，播放地址需 base64 + URL 解码',
  linkDomains: ['www.77dpw.vip', 'www.66dpw.vip'],
};

const BASE = 'https://www.77dpw.vip';

export default function (hg) {
  const fail = (code, msg, extra) => { throw new hg.PluginError(code, msg, extra); };
  const origin = () => (hg.endpoint.current && hg.endpoint.current.url) || BASE;

  const abs = (u) => {
    if (!u) return null;
    const s = String(u).trim();
    if (!s) return null;
    if (s.startsWith('//')) return 'https:' + s;
    if (s.startsWith('/')) return origin() + s;
    if (s.startsWith('http://')) return 'https://' + s.slice(7);
    return s;
  };

  // 站点把封面放在 bilibili / 2345 图床，带站内 Referer 会 403；
  // HPP 的条目级 headers 只能加不能删，用空 Referer 抑制 meta.defaultHeaders。
  const img = (u) => { const url = abs(u); return url && /^https:\/\//.test(url) ? { url, headers: { Referer: '' } } : undefined; };
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
  const text = (n) => (n ? n.text().trim() : '');

  async function page(path, { referer, json, cache } = {}) {
    const res = await hg.http.fetch({
      url: path.startsWith('http') ? path : origin() + path,
      responseType: json ? 'json' : 'text',
      retry: 1,
      headers: referer ? { Referer: referer } : undefined,
      ...(cache === false ? {} : { cache: { ttlSec: 300 } }),
    });
    if (res.status === 404) fail('NOT_FOUND', '内容不存在');
    if (res.status === 429 || res.status === 503) fail('RATE_LIMITED', '来源限流，请稍后再试');
    if (!res.ok) fail('UPSTREAM_ERROR', `来源返回 ${res.status}`);
    return res.data;
  }

  const isChallenge = (doc) => !!(doc.first('.mx-mac_msg_jump') || doc.first('input[name="verify"]'));

  const TYPE = { 1: 'movie', 2: 'anime', 3: 'series', 4: 'short', 5: 'variety' };

  const card = (row) => ({
    id: String(row.vod_id),
    title: String(row.vod_name || '').trim(),
    type: TYPE[Number(row.type_id_1) || Number(row.type_id)] || 'other',
    cover: img(row.vod_pic),
    badge: row.vod_remarks ? String(row.vod_remarks).slice(0, 8) : undefined,
    score: (() => { const s = num(row.vod_score); return s && s > 0 && s <= 10 ? s : undefined; })(),
    year: num(String(row.vod_year || '').slice(0, 4)),
    totalEpisodes: num(row.vod_total) || undefined,
    description: row.vod_blurb ? String(row.vod_blurb) : undefined,
  });

  async function listByType(tid, pageNo, limit) {
    const d = await page(`/index.php/ajax/data?mid=1&tid=${tid}&page=${pageNo}&limit=${limit}`, { json: true });
    if (!d || !Array.isArray(d.list)) fail('UPSTREAM_CHANGED', '列表结构已变化');
    const pc = num(d.pagecount) || 0;
    return {
      items: d.list.map(card).filter((c) => c.title),
      next: pageNo < pc ? String(pageNo + 1) : null,
      total: num(d.total) || undefined,
    };
  }

  // mxpro 模板把每集写成 /vodplay/<id>-<line>-<n>.html，线路的显示名在 module-tab 里
  function lineLabels(doc) {
    const labels = {};
    for (const tab of doc.select('.module-tab-item')) {
      const at = tab.attr('data-dropdown-value') || tab.attr('data-target') || '';
      const href = tab.attr('href') || '';
      const m = href.match(/panel(\d+)/) || at.match(/^(\d+)$/);
      const label = tab.text().trim();
      if (m && label) labels[m[1]] = label;
    }
    return labels;
  }

  async function getDetail({ id }) {
    const html = await page(`/voddetail/${id}.html`);
    const doc = hg.html.parse(html);
    if (isChallenge(doc)) fail('INTERACTION_REQUIRED', '站点要求人机验证，请先在网页中完成验证');

    const title = text(doc.first('.module-info-heading h1')) || text(doc.first('h1'));
    if (!title) fail('UPSTREAM_CHANGED', '页面结构已变化');
    const labels = lineLabels(doc);

    const groups = new Map();
    for (const a of doc.select('a.module-play-list-link')) {
      const href = a.attr('href') || '';
      const m = href.match(/\/vodplay\/(\d+)-(\d+)-(\d+)\.html/);
      if (!m) continue;
      const line = m[2];
      if (!groups.has(line)) groups.set(line, []);
      groups.get(line).push({ id: `${m[1]}-${m[2]}-${m[3]}`, label: text(a) || m[3], n: Number(m[3]) });
    }
    if (!groups.size) fail('UPSTREAM_CHANGED', '未找到分集');

    const playlists = [];
    for (const [line, eps] of groups) {
      const sorted = eps.slice().sort((x, y) => x.n - y.n);
      playlists.push({
        id: line,
        label: labels[line] || `线路 ${line}`,
        kind: 'main',
        episodes: sorted.map((e, i) => ({ id: e.id, index: i + 1, label: e.label })),
      });
    }

    const info = doc.select('.module-info-item').map((n) => n.text());
    const metaOf = (label) => { const h = info.find((t) => t.startsWith(label)); return h ? h.slice(label.length).trim() : ''; };
    const year = (metaOf('年代').match(/\d{4}/) || metaOf('年份').match(/\d{4}/) || [])[0];
    const remarks = text(doc.first('.module-info-tag-link'));

    return {
      id: String(id),
      title,
      type: 'other',
      cover: img((doc.first('.module-item-pic img') || { attr: () => null }).attr('data-original') ||
                 (doc.first('.module-item-pic img') || { attr: () => null }).attr('src')),
      description: text(doc.first('.module-info-introduction-content')) || undefined,
      year: year ? Number(year) : undefined,
      tags: metaOf('类型') ? metaOf('类型').split(/[,，\/]/).map((s) => s.trim()).filter(Boolean) : undefined,
      badge: remarks ? remarks.slice(0, 8) : undefined,
      playlists,
    };
  }

  // encrypt=2：先 base64 一次得到 URL 编码串，再逐层 URL 解码；
  // 旧实现把解码结果又当 base64 解，导致拿到乱码后报「播放地址无效」
  function decodeUrl(raw, encrypt) {
    let s = String(raw || '').trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (encrypt === 2 || encrypt === 1) {
      try {
        const once = hg.codec.utf8Decode(hg.codec.base64Decode(s));
        if (/^(%[0-9A-Fa-f]{2}|https?:\/\/)/.test(once)) s = once;
      } catch { /* 不是 base64 就按明文处理 */ }
      for (let i = 0; i < 4 && /%[0-9A-Fa-f]{2}/.test(s); i++) {
        try {
          const next = decodeURIComponent(s);
          if (next === s) break;
          s = next;
        } catch { break; }
      }
    }
    return s;
  }

  async function resolvePlayback({ mediaId, episodeId, reason }) {
    const m = String(episodeId).match(/^(\d+)-(\d+)-(\d+)$/);
    if (!m) fail('INVALID_ARGUMENT', '分集 ID 无效');
    const html = await page(`/vodplay/${m[1]}-${m[2]}-${m[3]}.html`, {
      referer: `${origin()}/voddetail/${m[1]}.html`,
      cache: reason === 'refresh' ? false : undefined,
    });
    const cfg = html.match(/player_[a-z]+\s*=\s*(\{[\s\S]*?\})\s*(?:;|<\/script>)/);
    if (!cfg) fail('UPSTREAM_CHANGED', '未找到播放配置');
    let obj;
    try { obj = JSON.parse(cfg[1]); } catch { fail('UPSTREAM_CHANGED', '播放配置不是有效 JSON'); }

    const url = decodeUrl(obj.url, Number(obj.encrypt) || 0).trim();
    if (!/^https:\/\//.test(url)) fail('UPSTREAM_CHANGED', '播放地址无效');

    // 站点一半的线路指向大视频站的播放页，应用内无法解码
    const external = /^https:\/\/(v|www)\.(qq|youku)\.com\/|^https:\/\/www\.bilibili\.com\//.test(url);
    if (external) {
      return { streams: [{ url, kind: 'page' }] };
    }
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
        // /vodsearch 被验证码拦截，退回 suggest 接口
        const d = await page(`/index.php/ajax/suggest?mid=1&wd=${encodeURIComponent(query)}`, { json: true });
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
        for (const [tid, label] of [[1, '电影'], [3, '剧集'], [2, '动漫'], [5, '综艺']]) {
          const p = await listByType(tid, 1, 12);
          out.push({ id: String(tid), title: label, layout: 'row', items: p.items, more: true });
        }
        return { items: out, next: null };
      },
      async listSection({ sectionId, cursor, limit }) {
        return listByType(Number(sectionId), Number(cursor) || 1, limit || 24);
      },
    },
    catalog: {
      getCategories: () => [{ id: '1', label: '电影' }, { id: '3', label: '剧集' }, { id: '2', label: '动漫' }, { id: '5', label: '综艺' }],
      async list({ categoryId, cursor, limit }) {
        return listByType(Number(categoryId) || 1, Number(cursor) || 1, limit || 24);
      },
    },
  };
}

