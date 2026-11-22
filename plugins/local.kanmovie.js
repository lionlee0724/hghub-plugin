const origin = "https://www.kanmovie.com.cn";
const fields = { id: /^[\w.-]+~\d+$/, hls: /\.m3u8$/i, video: /\.mp4$/i };

export const meta = {
  id: "local.kanmovie", name: "西瓜影视", version: "0.1.1", protocol: 1,
  homepage: "https://www.kanmovie.com.cn/", linkDomains: ["www.kanmovie.com.cn"],
};

export default function (hg) {
  async function request(url, query, ctx) {
    const res = await hg.http.fetch({ url, query, signal: ctx.signal });
    if (!res.ok) throw new hg.PluginError(res.status === 404 ? "NOT_FOUND" : "UPSTREAM_ERROR", `西瓜影视 HTTP ${res.status}`);
    try { return JSON.parse(res.data); }
    catch { throw new hg.PluginError("UPSTREAM_CHANGED", "西瓜影视未返回 JSON"); }
  }

  function item(video, id = video.apiId) {
    const image = video.pic || video.picThumb;
    return { id, title: video.name,
      cover: /^https?:\/\//.test(image) ? `${origin}/api/image?url=${encodeURIComponent(image)}` : undefined,
      year: Number(video.year) || undefined, description: video.content };
  }

  function parsePlaylists(video) {
    const lines = (video.playFrom || "").split("$$$");
    return (video.playUrl || "").split("$$$").flatMap((line, i) => {
      const seen = new Set();
      const episodes = [];
      for (const entry of line.split("#")) {
        const split = entry.indexOf("$");
        if (split < 1) continue;
        const label = entry.slice(0, split).trim();
        const url = entry.slice(split + 1).trim();
        if (!label || seen.has(label) || !url.startsWith("https://")) continue;
        seen.add(label);
        const number = /^第(\d+(?:\.\d+)?)集$/.exec(label);
        episodes.push({ id: label, index: episodes.length + 1, label, episodeNumber: number ? Number(number[1]) : undefined, url });
      }
      return episodes.length ? [{ id: lines[i] || String(i + 1), label: lines[i], episodes }] : [];
    });
  }

  async function detail(id, ctx) {
    if (!fields.id.test(id)) throw new hg.PluginError("NOT_FOUND", "作品标识无效");
    try {
      const { video } = await request(`${origin}/api/detail-snapshot`, { id }, ctx);
      if (video?.apiId === id) {
        const playlists = parsePlaylists(video);
        if (playlists.length) return { item: item(video, id), playlists };
      }
    } catch (error) {
      if (error.code !== "NOT_FOUND") throw error;
    }

    const [sourceKey, vodId] = id.split("~");
    const { sources } = await request(`${origin}/admin-api/sources`, undefined, ctx);
    if (!Array.isArray(sources)) throw new hg.PluginError("UPSTREAM_CHANGED", "西瓜影视未返回来源列表");
    const source = sources.find(s => s.key === sourceKey);
    if (!source?.api) throw new hg.PluginError("NOT_FOUND", "作品的采集来源已不存在");
    const api = new URL(source.api);
    const query = { ac: "detail", ids: vodId };
    const wrapped = api.hostname === "pz.v88.qzz.io" && api.searchParams.get("url");
    if (wrapped) {
      const target = new URL(wrapped);
      for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
      api.searchParams.set("url", target.href);
    }
    const { list } = await request(api.href, wrapped ? undefined : query, ctx);
    const raw = Array.isArray(list) && list.find(v => String(v.vod_id) === vodId);
    if (!raw?.vod_name) throw new hg.PluginError("NOT_FOUND", "采集来源未找到该作品");
    const video = { name: raw.vod_name, pic: raw.vod_pic, picThumb: raw.vod_pic_thumb,
      year: raw.vod_year, content: raw.vod_content, playFrom: raw.vod_play_from, playUrl: raw.vod_play_url };
    const playlists = parsePlaylists(video);
    if (!playlists.length) throw new hg.PluginError("NOT_FOUND", "作品没有可用的播放列表");
    if (sourceKey === "lovedan.net") {
      // 该采集源的常用首选线路不可达，优先已验证可解码的金鹰线路。
      const index = playlists.findIndex(p => p.id === "jinyingm3u8");
      if (index > 0) playlists.unshift(...playlists.splice(index, 1));
    }
    return { item: item(video, id), playlists };
  }

  return {
    home: {
      async getSections(_, ctx) {
        const { videos } = await request(`${origin}/api/home`, undefined, ctx);
        return { items: [{ id: "featured", title: "最新更新", layout: "grid", items: videos.slice(0, 40).map(v => item(v)) }] };
      },
    },
    search: {
      async search({ query, limit }, ctx) {
        if ([...query.trim()].length < 2) return { items: [] };
        const { list } = await request(`${origin}/api/suggest`, { q: query, limit: Math.min(limit ?? 8, 8) }, ctx);
        return { items: list.map(v => item(v)) };
      },
    },
    media: {
      matchUrl({ url }) {
        const input = new URL(url);
        const id = input.pathname.match(/^\/detail\/([^/]+)$/)?.[1];
        return input.origin === origin && fields.id.test(id) ? { mediaId: id } : null;
      },
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
        if (fields.hls.test(path)) return { streams: [{ format: "hls", url: episode.url }] };
        if (fields.video.test(path)) return { streams: [{ format: "progressive", url: episode.url }] };
        return { streams: [{ kind: "page", url: episode.url }] };
      },
    },
  };
}
