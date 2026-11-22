const origin = "https://ys.cxkjg.cn";
const api = `${origin}/api/provide/vod`;

export const meta = {
  id: "local.cxkjg", name: "创享影视", version: "0.1.0", protocol: 1,
  homepage: "https://ys.cxkjg.cn/",
};

export default function (hg) {
  async function request(query, ctx) {
    const res = await hg.http.fetch({ url: api, query, signal: ctx.signal, responseType: "text" });
    if (!res.ok) throw new hg.PluginError("UPSTREAM_ERROR", `创享影视 HTTP ${res.status}`);
    let data;
    try { data = JSON.parse(res.data); }
    catch { throw new hg.PluginError("UPSTREAM_CHANGED", "TVBox 主接口未返回 JSON"); }
    if (data.code !== 1 || !Array.isArray(data.list)) {
      throw new hg.PluginError("UPSTREAM_CHANGED", "TVBox 响应缺少条目列表");
    }
    return data;
  }

  function item(v) {
    const name = v.type_name || "";
    const type = /纪录片|记录片/.test(name) ? "documentary" : /动漫/.test(name) ? "anime"
      : /综艺/.test(name) ? "variety" : /剧$/.test(name) ? "series" : /电影|片$/.test(name) ? "movie" : undefined;
    return {
      id: String(v.vod_id), title: v.vod_name, type,
      cover: v.vod_pic?.startsWith("https://") ? v.vod_pic : undefined,
      year: Number(v.vod_year) || undefined,
    };
  }

  async function page(query, ctx) {
    const data = await request(query, ctx);
    return {
      items: data.list.map(item), total: Number(data.total),
      next: Number(data.page) < Number(data.pagecount) ? String(Number(data.page) + 1) : null,
    };
  }

  async function detail(id, ctx) {
    const { list } = await request({ ac: "detail", ids: id }, ctx);
    if (!list.length) throw new hg.PluginError("NOT_FOUND", "作品不存在");
    const v = list[0];
    const labels = (v.vod_play_from || "").split("$$$");
    const playlists = (v.vod_play_url || "").split("$$$").flatMap((entries, i) => {
      const seen = new Set();
      const episodes = [];
      for (const entry of entries.split("#")) {
        const split = entry.indexOf("$");
        if (split < 1) continue;
        const label = entry.slice(0, split).trim();
        const url = entry.slice(split + 1).trim();
        if (!label || seen.has(label) || !url.startsWith("https://")) continue;
        seen.add(label);
        const number = /^第(\d+(?:\.\d+)?)集$/.exec(label);
        episodes.push({ id: label, index: episodes.length + 1, label, episodeNumber: number ? Number(number[1]) : undefined, url });
      }
      return episodes.length ? [{ id: labels[i] || String(i + 1), label: labels[i], episodes }] : [];
    });
    if (!playlists.length) throw new hg.PluginError("NOT_FOUND", "上游未提供分集");
    return { item: item(v), playlists };
  }

  return {
    home: {
      async getSections(_, ctx) {
        const { items } = await page({}, ctx);
        return { items: [{ id: "latest", title: "最新更新", layout: "grid", items, more: true }] };
      },
      listSection({ cursor }, ctx) { return page({ pg: cursor }, ctx); },
    },
    catalog: {
      async getCategories(_, ctx) {
        const data = await request({}, ctx);
        const category = v => ({ id: String(v.type_id), label: v.type_name });
        return data.class.filter(v => !v.type_pid).map(v => ({
          ...category(v), children: data.class.filter(c => c.type_pid === v.type_id).map(category),
        }));
      },
      list({ categoryId, cursor }, ctx) { return page({ t: categoryId, pg: cursor }, ctx); },
    },
    search: {
      search({ query, cursor }, ctx) { return page({ wd: query, pg: cursor, ac: "detail" }, ctx); },
    },
    media: {
      async getDetail({ id }, ctx) {
        const result = await detail(id, ctx);
        return { ...result.item, playlists: result.playlists.map(p => ({
          ...p, episodes: p.episodes.map(({ url, ...episode }) => episode),
        })) };
      },
      async resolvePlayback({ mediaId, playlistId, episodeId }, ctx) {
        const { playlists } = await detail(mediaId, ctx);
        const playlist = playlistId ? playlists.find(p => p.id === playlistId) : playlists.find(p => p.episodes.some(e => e.id === episodeId));
        const episode = playlist?.episodes.find(e => e.id === episodeId);
        if (!episode) throw new hg.PluginError("NOT_FOUND", "分集已不存在");
        const path = new URL(episode.url).pathname;
        if (/\.m3u8$/i.test(path)) return { streams: [{ format: "hls", url: episode.url }] };
        if (/\.mp4$/i.test(path)) return { streams: [{ format: "progressive", url: episode.url }] };
        return { streams: [{ kind: "page", url: episode.url }] };
      },
    },
  };
}
