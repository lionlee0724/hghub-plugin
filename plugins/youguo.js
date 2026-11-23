// HPP 插件：柚果（Youavhub）——标准 MacCMS JSON 接口
// 参考 guoapp 的 duanjuProviderCatalog：{ID: youguo, Base: youavhub.com, Kind: maccms, Single: true}
export const meta = {
  id: 'youguo',
  name: '柚果',
  version: '0.1.0',
  protocol: 1,
  description: '柚果（Youavhub）：MacCMS JSON 接口，分类、列表、搜索、详情与 m3u8 直连播放。',
  author: 'lionlee0724',
  kind: 'source',
  mature: true,
  linkDomains: ['youavhub.com', 'www.youavhub.com'],
  defaultHeaders: {
    Referer: 'https://youavhub.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://youavhub.com';
const PATH = '/api.php/provide/vod/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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

  async function api(query, ctx) {
    const res = await hg.http.fetch({
      url: origin() + PATH,
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
    const list = Array.isArray(body.list) ? body.list : [];
    if (!list.length && body.code && Number(body.code) !== 1) {
      fail('UPSTREAM_CHANGED', str(body.msg) || '接口返回异常');
    }
    return body;
  }

  function toItem(row) {
    const id = str(row.vod_id) || String(num(row.vod_id) || '');
    const title = str(row.vod_name);
    if (!id || !title) return null;
    const item = { id, title, type: 'movie' };
    const cover = str(row.vod_pic);
    if (cover) item.cover = cover;
    const remark = str(row.vod_remarks);
    if (remark) item.badge = remark.slice(0, 8);
    const year = num(String(row.vod_year || '').match(/\d{4}/)?.[0]);
    if (year) item.year = year;
    for (const key of ['vod_name', 'vod_sub']) {
      if (!str(row[key])) continue;
    }
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

  function categoriesOf(classes) {
    const rows = Array.isArray(classes) ? classes : [];
    const parents = rows.filter((c) => Number(c.type_pid) === 0);
    const children = rows.filter((c) => Number(c.type_pid) !== 0);
    const list = [];
    for (const p of parents) {
      const kids = children
        .filter((c) => Number(c.type_pid) === Number(p.type_id))
        .map((c) => ({ id: String(c.type_id), label: str(c.type_name) }));
      list.push({
        id: String(p.type_id),
        label: str(p.type_name),
        ...(kids.length ? { children: kids } : {}),
      });
    }
    return list;
  }

  return {
    endpoints: { list() { return [{ id: 'main', label: '主站', url: SITE }]; } },

    home: {
      async getSections(params, ctx) {
        const body = await api({ ac: 'list', pg: '1' }, ctx);
        const sections = [];
        const latest = itemsOf(body.list);
        if (latest.length) sections.push({ id: 'latest', title: '最新', layout: 'grid', items: latest });
        const cats = categoriesOf(body.class).slice(0, 2);
        for (const cat of cats) {
          try {
            const sub = await api({ ac: 'list', t: cat.id, pg: '1' }, ctx);
            const items = itemsOf(sub.list);
            if (items.length) sections.push({ id: 'cat:' + cat.id, title: cat.label, layout: 'row', items });
          } catch (_) { /* 单分区失败忽略 */ }
        }
        if (!sections.length) fail('UPSTREAM_CHANGED', '首页没有取到内容');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const body = await api({ ac: 'list', pg: '1' }, ctx);
        return categoriesOf(body.class);
      },
      async list(params, ctx) {
        const tid = str(params && params.categoryId);
        const pg = Math.max(1, parseInt(str(params && params.cursor) || '1', 10) || 1);
        const body = await api({ ac: 'list', ...(tid ? { t: tid } : {}), pg: String(pg) }, ctx);
        const pageCount = num(body.pagecount) || 0;
        return { items: itemsOf(body.list), next: pageCount > pg ? String(pg + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = str(params && params.query);
        if (!q) return { items: [], next: null };
        const pg = Math.max(1, parseInt(str(params && params.cursor) || '1', 10) || 1);
        const body = await api({ wd: q, pg: String(pg) }, ctx);
        const pageCount = num(body.pagecount) || 0;
        return { items: itemsOf(body.list), next: pageCount > pg ? String(pg + 1) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = str(params && params.id);
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const body = await api({ ac: 'detail', ids: id }, ctx);
        const row = (body.list || [])[0];
        if (!row) fail('NOT_FOUND', '内容不存在');
        const playRaw = str(row.vod_play_url);
        const episodes = [];
        let index = 0;
        for (const seg of playRaw.split('#').filter(Boolean)) {
          const cut = seg.indexOf('$');
          const label = cut >= 0 ? seg.slice(0, cut) : String(index + 1);
          const url = cut >= 0 ? seg.slice(cut + 1) : seg;
          if (!/^https?:\/\//i.test(url)) continue;
          index += 1;
          episodes.push({
            id: String(index) + '|' + url,
            index,
            episodeNumber: index,
            label: label.trim() || ('第 ' + index + ' 集'),
          });
        }
        if (!episodes.length) fail('UPSTREAM_CHANGED', '未取到播放地址');
        const cover = str(row.vod_pic);
        const desc = str(row.vod_blurb) || str(row.vod_content);
        const tags = str(row.vod_class).split(/[,，/]/).map((s) => s.trim()).filter(Boolean);
        return {
          id,
          title: str(row.vod_name) || id,
          type: episodes.length > 1 ? 'series' : 'movie',
          ...(cover ? { cover } : {}),
          ...(desc ? { description: desc.replace(/<[^>]+>/g, '').slice(0, 2000) } : {}),
          ...(tags.length ? { tags: tags.slice(0, 8) } : {}),
          ...(num(String(row.vod_year || '').match(/\d{4}/)?.[0]) ? { year: num(String(row.vod_year).match(/\d{4}/)[0]) } : {}),
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

      matchUrl(params) {
        const raw = str(params && params.url);
        if (!raw) return null;
        const m = raw.match(/[?&]\/?vod\/detail\/id\/(\d+)/i) || raw.match(/\/detail\/(\d+)/i);
        return m ? { mediaId: m[1] } : null;
      },
    },
  };
}
