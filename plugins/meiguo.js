// HPP 插件：美果（shiresm.lol）——MacCMS 模板站
// 站点关掉了 api.php 的 JSON 采集接口（返回 "closed"），改用：
//   列表  /index.php/ajax/data?mid=1&tid=&page=N&limit=20
//   详情  /index.php/vod/detail/id/<id>.html
//   播放  /index.php/vod/play/id/<id>/sid/<sid>/nid/<nid>.html 里的 player_aaaa
//   搜索  /index.php/ajax/suggest?mid=1&wd=<关键词>
// 参考 guoapp 的 duanjuProviderCatalog（ID: meiguo, Kind: maccms）。
export const meta = {
  id: 'meiguo',
  name: '美果',
  version: '0.1.0',
  protocol: 1,
  description: '美果（shiresm.lol）：MacCMS 页面站，分类、列表、搜索、详情与 m3u8 直连播放。',
  author: 'lionlee0724',
  kind: 'source',
  mature: true,
  linkDomains: ['shiresm.lol', 'www.shiresm.lol'],
  defaultHeaders: {
    Referer: 'https://shiresm.lol/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://shiresm.lol';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DETAIL_RE = /\/vod\/detail\/id\/(\d+)\.html/;
const PLAY_RE = /\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/(\d+)\.html/;

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

  async function fetchText(path, ctx, expectJson) {
    const res = await hg.http.fetch({
      url: path.startsWith('http') ? path : origin() + path,
      headers: {
        'User-Agent': UA,
        Referer: origin() + '/',
        Accept: expectJson ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml',
      },
      responseType: expectJson ? 'json' : 'text',
      timeoutMs: 18000,
      retry: 1,
      signal: ctx && ctx.signal,
    });
    if (res.status === 404) fail('NOT_FOUND', '内容不存在或已下架');
    if (!res.ok) fail(res.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR', '站点返回 ' + res.status);
    return res.data;
  }

  function absUrl(href) {
    const raw = str(href);
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('//')) return 'https:' + raw;
    return raw.startsWith('/') ? origin() + raw : origin() + '/' + raw;
  }

  function toItem(row) {
    const id = str(row.vod_id) || String(num(row.vod_id) || '');
    const title = str(row.vod_name);
    if (!id || !title) return null;
    const item = { id, title, type: 'movie' };
    const cover = absUrl(row.vod_pic);
    if (cover) item.cover = cover;
    const remark = str(row.vod_remarks);
    if (remark) item.badge = remark.slice(0, 8);
    const pub = num(row.vod_time);
    if (pub) item.publishedAt = pub > 1e12 ? pub : pub * 1000;
    return item;
  }

  function itemsOf(rows) {
    const out = [];
    const seen = new Set();
    for (const row of rows || []) {
      const item = toItem(row);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }

  async function ajaxList(tid, page, ctx) {
    const data = await fetchText(
      `/index.php/ajax/data?mid=1&tid=${encodeURIComponent(tid || '')}&page=${page}&limit=24`,
      ctx,
      true,
    );
    const list = Array.isArray(data && data.list) ? data.list : [];
    const pageCount = num(data && data.pagecount) || 0;
    return { items: itemsOf(list), next: pageCount > page ? String(page + 1) : null };
  }

  return {
    endpoints: { list() { return [{ id: 'main', label: '主站', url: SITE }]; } },

    home: {
      async getSections(params, ctx) {
        const latest = await ajaxList('', 1, ctx);
        const sections = [];
        if (latest.items.length) sections.push({ id: 'latest', title: '最新', layout: 'grid', items: latest.items });
        for (const tid of ['1', '2']) {
          try {
            const page = await ajaxList(tid, 1, ctx);
            if (page.items.length) sections.push({ id: 'tid:' + tid, title: '分类 ' + tid, layout: 'row', items: page.items });
          } catch (_) { /* 单分区失败忽略 */ }
        }
        if (!sections.length) fail('UPSTREAM_CHANGED', '首页没有取到内容');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const html = str(await fetchText('/', ctx, false));
        const doc = hg.html.parse(html);
        const list = [];
        const seen = new Set();
        for (const a of doc.select('a')) {
          const href = str(a.attr('href'));
          const m = href.match(/\/vod\/(?:show|type)\/id\/(\d+)\.html/) || href.match(/\/vodshow\/(\d+)[-.].*\.html/);
          if (!m || seen.has(m[1])) continue;
          const label = str(a.text()).replace(/\s+/g, '');
          if (!label || label.length > 12) continue;
          seen.add(m[1]);
          list.push({ id: m[1], label });
        }
        return list.length ? list.slice(0, 20) : [{ id: '1', label: '电影' }, { id: '2', label: '剧集' }];
      },

      async list(params, ctx) {
        const tid = str(params && params.categoryId);
        const page = Math.max(1, parseInt(str(params && params.cursor) || '1', 10) || 1);
        return ajaxList(tid, page, ctx);
      },
    },

    search: {
      async search(params, ctx) {
        const q = str(params && params.query);
        if (!q) return { items: [], next: null };
        const data = await fetchText('/index.php/ajax/suggest?mid=1&wd=' + encodeURIComponent(q), ctx, true);
        const rows = Array.isArray(data && data.list) ? data.list : [];
        const items = [];
        for (const row of rows) {
          const id = str(row.id) || String(num(row.id) || '');
          const title = str(row.name);
          if (!id || !title) continue;
          const item = { id, title, type: 'movie' };
          const cover = absUrl(row.pic);
          if (cover) item.cover = cover;
          items.push(item);
        }
        return { items, next: null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = str(params && params.id);
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const html = str(await fetchText('/index.php/vod/detail/id/' + encodeURIComponent(id) + '.html', ctx, false));
        const doc = hg.html.parse(html);
        let title = '';
        const titleTag = doc.first('title');
        if (titleTag) {
          const raw = str(titleTag.text());
          // 只在「空格-空格」这种站点后缀处切分，避免把 START-582 这类编号砍掉
          title = (raw.split(/[ ]+[-|_][ ]+/)[0] || '').replace(/在线播放|详情|高清/g, '').trim();
        }
        if (!title) title = id;
        let cover = '';
        const coverEl = doc.first('meta[property="og:image"]');
        if (coverEl) cover = absUrl(coverEl.attr('content'));
        if (!cover) {
          for (const sel of ['img.lazyload', '.detail img', '.pic img', '.poster img', 'img']) {
            const el = doc.first(sel);
            const v = el && (el.attr('data-original') || el.attr('data-src') || el.attr('src'));
            if (v) { cover = absUrl(v); break; }
          }
        }
        const descEl = doc.first('.content') || doc.first('.desc') || doc.first('meta[name="description"]');
        const desc = descEl ? str(descEl.attr && descEl.tag === 'meta' ? descEl.attr('content') : descEl.text()) : '';

        const groups = new Map();
        for (const a of doc.select('a')) {
          const href = str(a.attr('href'));
          const m = href.match(PLAY_RE);
          if (!m) continue;
          const sid = m[2];
          if (!groups.has(sid)) groups.set(sid, []);
          const label = str(a.text()).replace(/\s+/g, ' ') || ('第 ' + m[3] + ' 集');
          groups.get(sid).push({
            id: m[1] + '-' + m[2] + '-' + m[3],
            index: groups.get(sid).length + 1,
            episodeNumber: num(m[3]) || groups.get(sid).length + 1,
            label,
          });
        }
        if (!groups.size) fail('UPSTREAM_CHANGED', '未解析到分集');
        const playlists = [];
        let n = 0;
        for (const [sid, episodes] of groups) {
          n += 1;
          playlists.push({ id: sid, label: '线路 ' + n, episodes });
        }
        return {
          id,
          title,
          type: playlists[0].episodes.length > 1 ? 'series' : 'movie',
          ...(cover ? { cover } : {}),
          ...(desc ? { description: desc.slice(0, 2000) } : {}),
          playlists,
        };
      },

      async resolvePlayback(params, ctx) {
        const episodeId = str(params && params.episodeId);
        const m = episodeId.match(/^(\d+)-(\d+)-(\d+)$/);
        if (!m) fail('INVALID_ARGUMENT', '分集 ID 无效');
        const html = str(await fetchText(`/index.php/vod/play/id/${m[1]}/sid/${m[2]}/nid/${m[3]}.html`, ctx, false));
        const cfg = html.match(/player_[a-z]+\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
        if (!cfg) fail('UPSTREAM_CHANGED', '未找到播放配置');
        let obj;
        try { obj = JSON.parse(cfg[1]); } catch (_) { fail('UPSTREAM_CHANGED', '播放配置不是有效 JSON'); }
        let url = str(obj.url);
        if (!url) fail('UPSTREAM_CHANGED', '播放配置没有地址');
        const encrypt = num(obj.encrypt) || 0;
        if (encrypt === 1) {
          try { url = hg.codec.utf8Decode(hg.codec.base64Decode(url)); } catch (_) { /* 保持原值 */ }
        }
        if (!/^https?:\/\//i.test(url)) fail('UPSTREAM_CHANGED', '播放地址不可用');
        return {
          streams: [{
            url,
            kind: 'media',
            format: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'progressive',
            headers: { Referer: origin() + '/', 'User-Agent': UA },
          }],
        };
      },

      matchUrl(params) {
        const raw = str(params && params.url);
        const m = raw.match(DETAIL_RE);
        return m ? { mediaId: m[1] } : null;
      },
    },
  };
}
