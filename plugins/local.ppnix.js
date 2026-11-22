const origin = "https://www.ppnix.com";
const mediaPath = /^\/(movie|tv)\/(\d+)\.html$/;
const categories = [{ id: "movie", label: "Movie" }, { id: "tv", label: "TV Show" }];
const subtitleInfo = {
  en: { language: "en", label: "English" },
  cn: { language: "zh-Hans", label: "简体中文" },
  tw: { language: "zh-Hant", label: "繁體中文" },
};

export const meta = {
  id: "local.ppnix", name: "PPnix", version: "0.1.0", protocol: 1,
  homepage: "https://www.ppnix.com/", linkDomains: ["www.ppnix.com"],
  requires: [{ type: "api", name: "html.parse" }],
};

export default function (hg) {
  async function document(path, ctx) {
    const res = await hg.http.fetch({ url: new URL(path, origin).href, signal: ctx.signal });
    if (!res.ok) throw new hg.PluginError(res.status === 404 ? "NOT_FOUND" : "UPSTREAM_ERROR", `PPnix HTTP ${res.status}`);
    return hg.html.parse(res.data);
  }

  function type(path) { return path.startsWith("/tv/") ? "series" : "movie"; }

  async function page(path, ctx) {
    const doc = await document(path, ctx);
    const items = [];
    const seen = new Set();
    for (const a of doc.select("a.thumbnail")) {
      const id = a.attr("href");
      const img = a.first("img");
      const title = img?.attr("alt");
      const cover = img?.attr("src");
      if (!mediaPath.test(id) || !title || seen.has(id)) continue;
      seen.add(id);
      items.push({ id, title, type: type(id), cover: cover ? new URL(cover, origin).href : undefined });
    }
    const next = doc.first(".pagination .next-page a")?.attr("href");
    return { items, next: /^\/(?:movie|tv|search)\//.test(next) ? next : null };
  }

  async function detail(id, ctx) {
    const match = mediaPath.exec(id);
    if (!match) throw new hg.PluginError("NOT_FOUND", "PPnix 作品地址无效");
    const doc = await document(id, ctx);
    const title = doc.first(".product-title");
    const script = doc.select("script:not([src])").map(n => n.html()).find(s => /\binfoid=\d+;/.test(s));
    const rawEpisodes = /\bm3u8=\[([\s\S]*?)\]/.exec(script)?.[1];
    if (!title || !rawEpisodes) throw new hg.PluginError("UPSTREAM_CHANGED", "PPnix 页面缺少标题或分集");
    const episodes = [...rawEpisodes.matchAll(/'([\w-]+)'/g)].map((m, i) => ({
      id: m[1], index: i + 1, label: m[1], episodeNumber: /^\d+$/.test(m[1]) ? Number(m[1]) : undefined,
    }));
    if (!episodes.length) throw new hg.PluginError("NOT_FOUND", "PPnix 暂无分集");
    const cover = doc.first(".product-header img.thumb")?.attr("src");
    return {
      item: { id, title: title.ownText(), type: type(id), cover: cover ? new URL(cover, origin).href : undefined,
        year: Number(/\((\d{4})\)/.exec(title.text())?.[1]) || undefined,
        description: doc.first(".product-excerpt span")?.text(),
        playlists: [{ id: "main", episodes }] },
      videoId: match[2],
      languages: (/\bsub='([^']*)'/.exec(script)?.[1] || "").split("|").filter(code => Object.hasOwn(subtitleInfo, code)),
    };
  }

  return {
    home: {
      async getSections(_, ctx) {
        const { items } = await page("/", ctx);
        return { items: [{ id: "featured", title: "Featured", layout: "grid", items: items.slice(0, 40) }] };
      },
    },
    catalog: {
      getCategories() { return categories; },
      list({ categoryId, cursor }, ctx) { return page(cursor || `/${categoryId}/`, ctx); },
    },
    search: {
      search({ query, cursor }, ctx) {
        return page(cursor || `/search/${encodeURIComponent(query.replaceAll("-", " "))}--.html`, ctx);
      },
    },
    media: {
      matchUrl({ url }) {
        const input = new URL(url);
        return input.origin === origin && mediaPath.test(input.pathname) ? { mediaId: input.pathname } : null;
      },
      async getDetail({ id }, ctx) { return (await detail(id, ctx)).item; },
      async resolvePlayback({ mediaId, episodeId }, ctx) {
        const { item, videoId, languages } = await detail(mediaId, ctx);
        if (!item.playlists[0].episodes.some(e => e.id === episodeId)) throw new hg.PluginError("NOT_FOUND", "分集已不存在");
        return {
          streams: [{ format: "hls", url: `${origin}/info/m3u8/${videoId}/${episodeId}.m3u8` }],
          subtitles: languages.map(code => ({
            ...subtitleInfo[code], format: "srt", url: `${origin}/info/subtitle/${videoId}/${episodeId}/${code}.srt`,
          })),
        };
      },
    },
  };
}
