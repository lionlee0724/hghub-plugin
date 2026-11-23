# HGhub 插件仓库（lionlee0724 维护）

本仓库是 [HGhub](https://github.com/Minireel/HGhub)（HPP 1.0 协议）的自用插件集合，
由以下 3 个上游订阅的插件合并、去重并修复后统一发布，供 HGhub 直接订阅更新：

- `https://cdn.jsdelivr.net/gh/CoderL98/hghub-plugins@main/manifest.json`
- `https://raw.githubusercontent.com/poisonhs/HGhub-Plugin/main/manifest/manifest.json`
- `https://gitea.com/WEP-56/HGhub-Plugin/raw/branch/main/manifest.json`

## 订阅地址

```
https://raw.githubusercontent.com/lionlee0724/hghub-plugin/main/manifest.json
```

国内网络如直连 raw.githubusercontent.com 失败，可用以下的镜像地址（2026-02 实测都能取到最新 47 条）：

```
https://fastly.jsdelivr.net/gh/lionlee0724/hghub-plugin@main/manifest.json
https://gcore.jsdelivr.net/gh/lionlee0724/hghub-plugin@main/manifest.json
https://cdn.jsdelivr.net/gh/lionlee0724/hghub-plugin@4ef1c7e/manifest.json   # 按提交钉住，见下
```

`cdn.jsdelivr.net/...@main` 的分支缓存最长 12 小时，实测会滞后（曾出现仍返回已归档的 11 个旧插件）。
要立刻拿到新内容，用上面的 fastly/gcore，或把地址里的版本换成最新提交号（`git log -1 --format=%h`）。

## 目录结构

```
manifest.json          插件列表（HGhub 订阅入口）
plugins/<插件ID>.js    单文件插件源码，ES 模块，meta.id/version 与列表一致
```

## 维护规则

1. 插件 ID 是身份：改名等于换插件，片库、进度、设置都按 ID 记录，不要动。
2. 修改插件必须同时提升 `meta.version` 与 `manifest.json` 里的 `version`，否则 HGhub 不会自动更新。
3. 版本号必须是三段十进制数字（如 `1.0.3`），比较按数字段逐段进行。
4. `plugins/<ID>.js` 只允许 `export const meta` 与 `export default`；不能有静态导入、动态 `import()`。
5. 不提交任何账号 Cookie、令牌或登录态数据。

## 当前修复记录

见 `FIXES.md`。

## 自建插件

| 插件 | 说明 |
| --- | --- |
| `xj8`（香蕉短剧） | `xj8.ai` 官方入口 → `xjai6.com` 等应用域；接口为 `aimedia-api.1ybox.com`。首页热播/榜单、27 个分类、游标分页搜索、详情分集、HLS 播放。播放需游客会话（插件自动注册 `device_id` 并缓存 Bearer 令牌）；金币解锁集返回 `CONTENT_LOCKED`。线路列表从回家页 `assets/home-config.js` 动态读取，6 小时缓存 + 内置兜底线路。 |
| `fanguo`（西饭短剧） | App 接口 `xifan-api-cn.youlishipin.com`，无需签名。首页按题材关键词分区，10 个题材分类，详情直接给 `playUrl`（MP4 直链）。移植自 guoapp 的 `fetchFanguoCatalogPage` / `fetchFanguoDetail`。 |
| `youguo`（柚果） | 标准 MacCMS JSON 接口（`/api.php/provide/vod/`），21 个分类、分页列表、搜索、详情与 m3u8 直连。移植自 guoapp 的 `duanjuProviderCatalog`（Kind: maccms）。 |
| `taoguo`（桃果） | `lujj31.buzz`。站点关掉了 `api.php`（返回 `closed`），改走 `/index.php/ajax/data` 列表 + 详情页分集 + 播放页 `player_aaaa` 取 m3u8；搜索用 `ajax/suggest`。 |
| `meiguo`（美果） | `shiresm.lol`，与桃果同一套 MacCMS 模板（同一份代码换域名）。 |
| `miguo`（米果） | `dmxq40.com`，同一套 MacCMS 模板；列表走 `ajax/data`，详情 `<title>` 取片名，播放页 `player_aaaa` 取 m3u8。 |
| `ningguo`（柠果） | `toptv15.cyou`，同一套 MacCMS 模板，实测 HLS 206 可取流。 |

guoapp 全量站源对照（26 个「果」源 + 黄果系，逐个标注已移植 / 卡点）见 [`docs/guoapp-sources.md`](docs/guoapp-sources.md)。

明细与排查记录见 `FIXES.md` 第 6 节。

## 外部来源补充（2026-11，对比 `leohenshuai/hghub-plugins`）

### 一、同名插件版本对齐（对方更新，已合入并实测）

| 插件 | 原版本 → 现版本 | 对方修的点 / 实测结果 |
| --- | --- | --- |
| `xhamster` | 1.0.1 → 1.0.2 | 补了流地址还原用的 PRNG（`xhPrng`）。之前取流失败，现在 **206 出流** |
| `pornhub` | 1.0.1 → 1.0.2 | 推荐位与列表去重。之前取流 410，现在 **206 出流** |
| `hanime` | 1.0.1 → 1.0.4 | 主域换成 `hanimeone.me`（`hanime1.me` 仍 403）。现在 **全链路 206** |
| `hkdoll` | 1.0.1 → 1.0.5 | 补 `CDN_NODE='t33'` 与 URL 编码处理；站点侧仍 403（按出口 IP 拦） |
| `4kav` | 1.0.2 → 1.0.3 | 补 `Accept-Language`，域名合并 4kmp/4k-av。**206 出流** |
| `madou` | 1.0.1 → 1.0.3 | 跳过空的热门分区、修正「更多」判断。**206 出流** |
| `wwgz` | 1.0.1 → 1.0.3 | 搜索模板缺失检测 + 直链识别。之前 ECONNRESET，现在 **206 出流** |
| `xingya` | 1.0.1 → 1.0.4 | 超时 25s + 重试 2。**206 出流** |
| `hdmoli` | 1.0.2 → 2.0.0 | 站点已改网盘站，补搜索页 `.myui-vodlist__media` 与去重；播放为 `kind: external`（跳夸克/百度网盘） |
| `avtoday` | 1.0.2 → **1.0.6** | 对方到 1.0.4；我方再修首页与分类（见下） |

未动的：`apple`（我方 1.0.2 更新）、`huangguo`（我方 1.1.0 更新）、`jpyy`（同版本）。

### 二、新增成人源（14 个，全部实测到可取流）

| id | 名称 | 域名 | 实测 |
| --- | --- | --- | --- |
| `j18` | 18J.TV | 18j.tv | 首页含「最新短剧」频道，list 24 / stream 200 hls |
| `avjb` | AVJB | avjb.com | 首条详情即「AI 成人短剧」，stream 200 hls |
| `haose` | 好色TV | boot.pirvmpmir.cc | 首页含「好色短剧」频道，stream 200 hls |
| `tangxin` | 糖心Vlog | tangxinvlog.pro | 剧情向短片，stream 206 hls |
| `bl911` | 911爆料网 | blw66.com 等 | 详情 5 集连播，stream 206 hls |
| `mrds` | 每日大赛 | mrds.com | stream 200 hls |
| `91porn` | 91porn | 91porn.com / sp2026.com | stream 206 progressive |
| `porna91` | 91Porna | 91porna.com | stream 200 hls |
| `porny` | 91Porny（九色） | 91porny.com | stream 206 hls |
| `pornlulu` | 撸撸视频 | pornlulu.net | 66 个分类，stream 206 hls |
| `duobo` | 多播 | duobo.vip | 含虎牙/CC 定制频道，stream 206 progressive |
| `mwxk62` | KKAV | 62mwxk.com | stream 206 hls |
| `xx9` | 主播视频 | xx9.com | 14 个首页分区，stream 206 hls |
| `rou` | Rou Video（肉視頻） | rou.video | 流被包在 PNG 自定义块里，插件自带解包，stream 206 hls |
| `gscenes` | 基色短剧 GScenes（BL/真人/AI） | www.x4bny.cc | 792 部作品、34 个分类；自建 REST API（`/api/v1/*`）走游客 JWT；前 1–2 集官方免费试看，VIP 集返回 `CONTENT_LOCKED`；HLS 取流需带上 playback 下发的 CloudFront 签名 cookie |

试过但没入订阅：`haijiao`（海角，播放要登录，`AUTH_REQUIRED`）、`hkdoll`（站点 403，保留观察）。

### 三、我方在对方版本上继续修的点

| 插件 | 问题 | 修法 |
| --- | --- | --- |
| `avtoday` | 首页 `/` 被站点 302 到 `/*/index.html` 后 404；分类链接被改写成 `/*/catalog/…` 也 404 | 首页改抓 `/catalog`（失败回退 `/`）；`absUrl` 统一剥掉 `/*/` 前缀 |
| `j18` / `avjb` / `rou` | 宿主传分组节点（`g1` / `fixed` / `main`）当分类时直接报「未知分类」 | `list` 遇到分组节点时取它的第一个子分类再解析 |

## 已归档（站点确认死亡，不再订阅）

以下 11 个插件已从 `manifest.json` 摘除，源码保留在 `archive/`，站点恢复或换域名后可 `git mv` 回 `plugins/` 再跑一次 `gen-manifest`。

| 插件 | 站点 | 判定依据 |
| --- | --- | --- |
| anfuns | anfuns.org | 302 跳 `http://ww547.anfuns.org/?tkn=…` 停放页 |
| jdys | jdys.art | 302 跳 `http://ww19.jdys.art` 停放页 |
| xiaohys | xiaohys.com | 302 跳 `www*.xiaohys.com/?tkn=…` 停放页 |
| duanjutt | duanjutt.tv | 首页 200 但响应体 0 字节 |
| kxyy.source | kxyy1.cc | 全路径宝塔 404；官方发布页 kxyy.app 仍指同一域名 |
| local.kxyy | kxyy1.cc | 同上 |
| zhuiying.source | zhuiying1~3.cc/.com | 6 个镜像全部 404 |
| aowu | aowu.tv | TLS ECONNRESET（源站关停） |
| hjkk | hanjukankan.com | 请求持续超时 |
| saohuo | shdy2.com | HTTP 522（Cloudflare 回源失败） |
| tiantian | op.ysdqjs.cn | HTTP 502（接口停摆） |

保留观察的：`hanime` / `hkdoll` / `jpyy`（403，疑似按出口 IP 拦截，换节点可再验证）、
`avtoday` / `hdmoli` / `pornhub` / `xhamster` / `wwgz` / `hhkan.source`（部分功能可用）。
