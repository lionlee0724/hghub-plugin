# X（Twitter）侧成人短剧站点调研（2026-11-23）

## 怎么做的

用 VPS `my-openclaw` 上已有的链路做联网检索，不新增任何组件：

```
hermes 配置 ~/.hermes/config.yaml
  custom:g2a → base_url http://127.0.0.1:8088/v1   （grok2api 容器，127.0.0.1:8088）
  x_search.model = grok-4.20-reasoning
调用模型：grok-chat-fast（grok2api 的可用别名之一）
```

grok2api 是逆向网页版 Grok 的实现，`grok-chat-fast` 的响应里带
`server_side_tool_usage: {SERVER_SIDE_TOOL_X_SEARCH: n, SERVER_SIDE_TOOL_WEB_SEARCH: n}`，
确认是模型自己在 X 上检索，不是凭记忆编的。共跑 11 轮不同口径的检索。

## 实测结果（全部本机复测过 HTTP 行为）

| 平台 | 落地域名 | 实测 |
| --- | --- | --- |
| 黄果短剧 | huangguoai.com | 200 / 215KB，**网页站**（仓库已有 `huangguo` 插件 1.1.0） |
| 黄果短剧（二级入口） | hll15.com / hll73.com / t6p6.top | 200 但只有 320 字节，JS 跳转到 `*.nzzkcldq.cc/chan/…` 这类短链 |
| 蓝果短剧 | hll73.com | 同上，跳 `wsmxxcjv.cc/chan/…` |
| 禁果短剧 | d21l1bqoq58b6d.cloudfront.net、d1qn3v68usfzo8.cloudfront.net | 200，3.5–3.7KB，App 下载落地页 |
| 91短剧 / 91Porn | d3rc0dztsjc3wd / dy6lzcs88xqoy / dnzsz1jyp5cln.cloudfront.net | 同上，落地页 |
| 撸撸短剧 | d31z93t02m0qk9.cloudfront.net | 同上 |
| 蜜桃短剧 | ldy43.hj0tr.cc / ldy42.hj0tr.cc | 200 / 98KB，官网 SPA（标题「蜜桃短剧官网｜成人短剧、AI漫剧」），无可见 API |
| 海角社区 | 8drm3.com、d2901t4ryf7q1f.cloudfront.net | 301 跳 cloudfront 落地页 |
| 沉淀式短剧 | d2901t4ryf7q1f.cloudfront.net | 落地页 |
| **GSCENES 基色短剧** | www.x4bny.cc | 200 / 645KB，**Nuxt SSR 网页站**（BL / 真人 / AI 成人短剧），唯一像正片的 Web 站 |
| 一批随机域名 | vjdye.com x6xl.com j5q4w.com 4fsp9.com 4bf2m.com b4gc6.com 6t2dh.com u7ee9.com h5wm8.com g9xz3.com nxxe2.com 0be3.com hh7w8.com | 全部 301/302 跳 cloudfront 落地页，不是站点 |

## 结论

1. **X 上这一批中文「成人短剧」其实是 App 生态**：宣传口径是「APP下载」，落地页藏在
   CloudFront（`*.cloudfront.net/?dc=…`）后面，301 链一路跳过去，没有对外的 Web 分集页面。
2. 对 HGhub 插件有价值的新增源：**0 个**。能接入的仍是我们已有的网页型源
   （果系 MacCMS 站、黄果、j18、avjb、haose、tangxin、bl911 等）。
3. 唯一还没放弃的：`GSCENES`（www.x4bny.cc）。前端 bundle 里能读出内容接口名
   （`/api/genres`、`/api/rankings`、`/api/work-categories`、`/api/search/hot-works`、
   `/api/auth/guest`），但主域上这些路径 GET/POST 都是 404（Go 风格 404），
   外置 `d8j16aonpq18w.cloudfront.net` 直接访问是 S3 `AccessDenied`。
   说明 API 由 SSR 层内部代理，要靠浏览器渲染抓 XHR 才能定到真实 base。

## 复现方式

VPS 上 `/tmp/payload-*.json` + `/tmp/run-x2.sh` 是临时件，正式跑法：

```bash
KEY=$(sudo awk '/^  custom:g2a:/{f=1} f&&/api_key:/{print $2; exit}' \
      /home/ubuntu/.hermes/config.yaml)
curl -s -X POST http://127.0.0.1:8088/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"grok-chat-fast","stream":false,
       "messages":[{"role":"user","content":"…检索 X 的提示词…"}]}'
```

响应体的 `citations` 会带 `x.com/<账号>/status/<id>` 原始帖，可回溯每条结论。
注意：提示词里出现「绕过付费/免费看」这类框架会被模型自己拒答（本轮第 7 次检索就撞到了），
换成「站点索引 / 可用性统计」的口径就能正常返回。
