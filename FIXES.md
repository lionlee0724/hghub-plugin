# 故障排查与修复记录

排查时间：2026-11-23
排查对象：本机 HGhub（`%APPDATA%\com.hghub.player\hpp`）已安装的 43 个插件
排查方式：用 HPP 1.0 宿主 API 的本地复刻（`hg.http` / `hg.html` / `hg.crypto` / `hg.storage` + 系统代理 127.0.0.1:7890）
逐个真实调用 `home` / `catalog` / `search` / `media.getDetail` / `media.resolvePlayback`，
再对返回的封面与播放地址做实际取流探测。下表结论全部来自复测，不是推测。

---

## 0. 两个全局性主因

### 0.1 本地插件版本落后，自动更新被跳过

`updates.json` 里 43 个插件的检查状态全部是 `status: "skipped"`，而本地副本比上游旧 6 个：

| 插件 | 本地 | 上游 | 上游修掉的问题 |
| --- | --- | --- | --- |
| appmovie.source | 1.0.0 | 1.0.2 | 封面取不到（缩略图全空） |
| bfzy.source | 1.0.0 | 1.0.4 | 取流失败不换分发域名 |
| chengguo.source | 1.0.0 | 1.0.2 | 封面加密图床不切明文镜像 |
| jisu.source | 1.0.0 | 1.0.1 | 频道与短剧入口 |
| juzong.source | 1.0.0 | 1.0.1 | 无封面条目未过滤 |
| netflixgc.source | 1.0.0 | 1.0.1 | 封面走百度图片代理 |

本仓库已直接收录上游最新版本，并用自家订阅地址取代原来的 3 个上游订阅即可解决这一类问题。

### 0.2 站点域名迁移 / WAF 升级

`4kmp.com → 4k-av.com`、`avtoday.io/ → /catalog`、`hdmoli.pro → hdmoli.com` 等；
hanime、hkdoll、saohuo、xiaohys、anfuns、jdys、jpyy 等站点上了 Cloudflare / JS 挑战 / 地区限制，
这些不是插件代码能绕过的（HPP 协议不提供页面脚本执行）。

---

## 1. 已在插件内修复

| 插件 | 版本 | 症状 | 根因 | 修复 |
| --- | --- | --- | --- | --- |
| 4kav | 1.0.1 → 1.0.2 | 缩略图全空；搜索报错 | 站点已 301 到 `4k-av.com`，但插件 Referer 仍是 `4kmp.com`，图片域名校验 Referer 返回 403；搜索入口已从 `/s?q=` 改为 `/en/s?u=` | `SITE`、`defaultHeaders.Referer` 改为 `4k-av.com`，搜索改 `/en/s?u=`，`linkDomains` 补充新域名 |
| apple | 1.0.1 → 1.0.2 | 首页/分类/搜索全报错（HTTP 400） | 上游 `c.xpgtv.net` 已强制 HTTPS，插件仍用 `http://`，返回 `400 The plain HTTP request was sent to HTTPS port` | `SITE` 改为 `https://c.xpgtv.net` |
| hdmoli | 1.0.1 → 1.0.2 | 缩略图全空（120/120 无封面） | 站点改版：封面从 `<a data-original>` 移到子节点 `<img class="vod-poster" src>`，插件只读 `<a>` 属性 | 封面回退链增加子节点 `img` 的 `data-original/data-src/src`；域名改 `www.hdmoli.com`。站点已改为网盘资源站，在线分集本身已不存在 |
| avtoday | 1.0.1 → 1.0.2 | 首页 404 | 站点根路径已 404，首页内容在 `/catalog` | `home.getSections` 改请求 `/catalog` |

### 复测结果（同一套探测）

| 插件 | 修复前 | 修复后 |
| --- | --- | --- |
| 4kav | 封面 4/4 全 403；搜索 403 | 106/106 封面 206；搜索 10 条 |
| apple | 首页/分类/搜索全 400 | 首页 60 条、分类 20、搜索 20 |
| hdmoli | 120 条 0 封面 | 40/40 封面 206；分类 20/20 |
| avtoday | 首页 0 条 | 首页 16 条 / 15 封面 |
| appmovie.source | 119 条 0 封面（本地 1.0.0） | 119/119 封面（上游 1.0.2） |

---

## 2. 站点侧故障（插件内改不动的）

复测证据（HTTP 状态与响应特征）：

| 插件 | 证据 | 结论 |
| --- | --- | --- |
| hanime | `hanime1.me` → Cloudflare `Attention Required` 403 | 站点风控，需人机验证 |
| hkdoll | `hongkongdollvideo.com` → `Edge IP Restricted` 403 | 地区/IP 限制 |
| saohuo | `shdy2.com` → 522 | Cloudflare 源站离线 |
| tiantian | `op.ysdqjs.cn` → 502 | 上游接口挂了 |
| kxyy.source | `www.kxyy1.cc` 及镜像 → 404（宝塔 404 页） | 域名已停用 |
| local.kxyy | 同上 | 域名已停用 |
| zhuiying.source | 6 个镜像全部 404 | 域名已停用 |
| anfuns | `/map.html` → 484 字节 JS `Loading...` 挑战页 | 站侧风控 |
| jdys | 首页 → 484 字节 JS 挑战页 | 站侧风控 |
| xiaohys | `/index.php/api/vod` → JS 挑战页；搜索 401 | 站侧风控 |
| jpyy | API → `/GE/CC/VALIDATOR?key=...` 403 | JS 验证器 |
| aowu | `www.aowu.tv/index.php/ds_api/vod` → ECONNRESET | TLS 被重置 |
| wwgz | `api.nmvod.me:520/player/` → ECONNRESET | 解析接口不可用 |
| hjkk | `hanjukankan.com` 请求超时（混淆路径） | 站点不可达 |
| duanjutt | 首页 200 但响应体 0 字节 | 站点空响应 |
| dhvideo.source | `dhvideo.cc` → 429 人机校验 | WAF 限速（插件已带 `attack_key` 重试） |
| xhamster | 页面正常，取流连接失败（0） | 播放地址需要站点侧会话 |
| local.dapian | 详情正常，播放页解析出「播放地址无效」 | 播放页加密变量已变 |
| local.kanmovie | 15/48 条有封面 | 上游部分条目本身无图 |
| appmovie.source | 1/4 封面所在 `shandianpic.vip` 连不通 | 死图床 |
| tangxin.vlog | `catalog.list` 收到父分类 `authors` | 非缺陷：宿主只会用子分类调用 |

---

## 3. 复测脚本

排查与复测使用 HPP 宿主 API 的最小复刻（Node 24 + cheerio + undici，走系统代理），
对每个插件依次执行：`import` → `factory` → `home` → `catalog` → `search` → `getDetail` →
`resolvePlayback`，再对封面与播放地址做 `Range: bytes=0-1023` 实际取流。
判定规则：

- `HOME_ERROR` / `CATALOG_ERROR` / `SEARCH_ERROR` / `DETAIL_ERROR` / `PLAYBACK_ERROR`：该入口抛错
- `NO_COVERS_AT_ALL`：条目有封面字段但全为空
- `COVER_UNREACHABLE`：封面 URL 实际取不到图（4xx/5xx/连接失败）
- `STREAM_UNREACHABLE`：播放地址实际取不到流

---

## 4. 维护方式

```bash
# 改完插件后（必须同时提升 meta.version）
node scripts/gen-manifest.mjs   # 从 plugins/*.js 的 meta 重新生成 manifest.json
git add -A && git commit -m "fix(插件ID): 说明" && git push
```

HGhub 里刷新订阅即可看到新版本。

---

## 5. 第二轮：按规范继续修复（含域名溯源）

依据 HPP 规范 [04 §9](https://github.com/Minireel/HGhub/blob/main/docs/plugin-protocol/04-host-api.md)
「需要执行页面脚本才能取得的数据，由插件自行还原其算法」，对每个报错站点逐个逆向。

### 5.1 新增修复

| 插件 | 版本 | 根因 | 修复与复测 |
| --- | --- | --- | --- |
| local.dapian（大片网） | 0.1.0 → 0.1.1 | `player_aaaa.encrypt=2` 的地址是 **base64(URL 编码)** 一层：`JTY4JTc0…` → base64 → `%68%74%74%70…` → URL 解码 → `https://vv.jisuzyv.com/play/e5yAKrxe/index.m3u8`。旧实现解完 base64 又把结果当 base64 解，拿到乱码后报「播放地址无效」 | `decodeUrl` 改为「base64 一次 + 校验前缀 + 逐层 decodeURIComponent」，复测插件全流程 ok |
| dhvideo.source（豆花电影网） | 1.0.0 → 1.0.1 | PoW 页要求 `sha1(hash+i)===target`，实测 i=24414 / 34799 均可解；但服务端在**首次成功**后才下发 `sion_id` Cookie，之后每个频道页都要带它。插件只重试 3 次，赶不上这个 cookie 往返 | 重试次数 3 → 5，并保留每次用最新挑战页求解；实测 `dianying.html?attack_key=<i>` 返回 200（109 KB 真实列表） |

### 5.2 域名溯源结论（实测证据）

对「站点不存在」逐个溯源，结论是有两类，不能一概当域名失效：

**A 类：域名被停放/劫持（插件无法修复）**

这些站点的人机校验页最终跳转是 `http://ww<随机>.域名/?tkn=…` 形式，属于域名停放页：

| 站点 | 证据 |
| --- | --- |
| anfuns（anfuns.org） | `/map.html` 返回 MacCMS `ch=1&js=<JWT>&sid=…` 二次跳转页；带 token 与 sid Cookie 重放后 **302 → `http://ww547.anfuns.org/?tkn=…`**（停放页），根路径 401 `Forbidden` |
| jdys（jdys.art） | 同上流程 → **302 → `http://ww19.jdys.art`**，落地页为 GDPR/广告停放模板 |
| xiaohys（xiaohys.com） | 同上流程 → **302 → `http://ww547.xiaohys.com/?tkn=…`**；直连时 400。`anfunsapp.cn` 只是 App 下载页（夸克网盘），不是站点 |

**B 类：域名仍然有效，是出口线路被站点拒绝**

| 站点 | 证据 |
| --- | --- |
| kxyy.source / local.kxyy（开心影院） | 官方发布页 `kxyy.app`（标题「开心影院 - 官方最新网址发布页」）当前仍指向 `kxyy1.cc`；`www.kxyy1.cc` 全路径返回 726 字节宝塔 404 页 |
| zhuiying.source（追影） | 6 个镜像（zhuiying1/2/3.cc 与 .com）全部同一张 726 字节宝塔 404 页 |

判定：这类国内站点对境外出口 IP 会直接吐 404/401（宝塔默认页）。HGhub 走系统代理时同样受 Clash 规则影响，
所以「换节点」比「换域名」更可能是解药：

```
# FlClash / Clash 规则里为这些域名指定直连（或国内节点）
DOMAIN-SUFFIX,kxyy1.cc,DIRECT
DOMAIN-SUFFIX,zhuiying1.cc,DIRECT
DOMAIN-SUFFIX,zhuiying2.cc,DIRECT
DOMAIN-SUFFIX,zhuiying3.cc,DIRECT
DOMAIN-SUFFIX,zhuiying1.com,DIRECT
DOMAIN-SUFFIX,zhuiying2.com,DIRECT
DOMAIN-SUFFIX,zhuiying3.com,DIRECT
```

**C 类：服务端自身故障或强风控（时间敏感，非代码问题）**

- `shdy2.com` → 522（Cloudflare 回源失败，源站离线）
- `op.ysdqjs.cn` → 502（接口挂了）
- `hanjukankan.com` → 请求超时
- `aowu.tv` → TLS ECONNRESET
- `hongkongdollvideo.com` → Cloudflare `Edge IP Restricted`（地区限制）
- `duanjutt.tv` → 200 但响应体 0 字节
- `dhvideo.cc` → 短时间大量请求后整站 429（需冷却，插件已带 40 秒 retryAfterSec）

### 5.3 复测方式

探测用的是按 HPP 规范自行实现的宿主模拟器（Node 24 + cheerio + undici，走系统代理）：
对每个插件依次调用 `home` → `catalog` → `search` → `getDetail` → `resolvePlayback`，
再对封面与播放地址发 `Range: bytes=0-1023` 实际取流。该工具仅本地使用，未随仓库发布。

---

## 6. 新增插件：香蕉短剧（`xj8`）

用户提供 `xj8.ai`，按 `huangguo`（黄果短剧）的写法实现，版本 `0.1.0`。

### 6.1 站点结构（实测）

| 层 | 地址 | 说明 |
| --- | --- | --- |
| 回家页 | `https://xj8.ai/` → `https://jn34.com/` | 落地页读 `/assets/home-config.js`，其中 `window.XJ_HOME.domains` 是当前可用应用域 |
| 应用域 | `xjai6.com` / `xjai7.com` / `xjai8.com` / `xjai9.com` / `26nj2.com` … | Next.js 前端，详情路由 `/dramas/<uuid>`，分集 `/dramas/<uuid>/episodes/<n>` |
| 接口 | `https://aimedia-api.1ybox.com` | 前端 JS 里硬编码，不随镜像变化 |
| 图床 | `https://mediacms.frqfwn.cn` | 封面直出，无防盗链（带 Referer 即可） |

### 6.2 用到的接口

| 接口 | 用途 |
| --- | --- |
| `GET /api/home/hot` | 首页热播（32 条） |
| `GET /api/discover` | `ranks.hot` / `ranks.fresh` 榜单 |
| `GET /api/categories` | 26 个分类 + drama_count |
| `GET /api/theater?category=&cursor=` | 分类列表，`next_cursor` 游标分页，总数 6626 |
| `GET /api/search?q=&cursor=` | 搜索，游标分页 |
| `GET /api/dramas/<id>` | 详情（标题、简介、封面、标签、集数、计费类型） |
| `GET /api/dramas/<id>/episodes` | 分集（`id`、`episode_number`、`duration_seconds`、`commerce.can_play`） |
| `POST /api/guest-sessions {device_id}` | 游客会话 → `access_token`（Bearer） |
| `POST /api/playback/sessions {episode_id}` | 播放会话 → `media.manifest_url`（direct_hls）+ `expires_at` |
| `POST /api/v1/playback/trial/sessions {episode_id}` | 试看会话；金币集返回 403 `PAYMENT_REQUIRED` |

### 6.3 实现要点

- **线路能力**：`endpoints.list` 先读回家页 `home-config.js` 解析 `domains`，结果缓存 6 小时；抓不到就用内置兜底线路。
- **游客会话**：`hg.storage` 存 `device:id`（随机 UUID）与 `guest:token`；`resolvePlayback` 遇 `AUTH_REQUIRED` 会换新令牌重试一次，符合「插件自行管理令牌」的约定。
- **错误映射**：404/410/`CONTENT_UNAVAILABLE` → `NOT_FOUND`；403/`PAYMENT_REQUIRED` → `CONTENT_LOCKED`；429 → `RATE_LIMITED`（`retryAfterSec: 30`）。
- **播放信息**：`format: hls`、`expiresAt` 取 `media.expires_at`、`resumeSec` 取 `progress_seconds`，流带 `Referer`/`User-Agent` 头。
- **匹配粘贴链接**：`/dramas/<uuid>` → `mediaId`。

### 6.4 复测结果（宿主模拟器）

```
✓ endpoints.list      4 条线路（xjai6/7/8/9），2.1s
✓ home.getSections    热播 32、热播榜 10、新上线 10，封面 52/52
✓ catalog.categories  27 项（含“全部”）
✓ catalog.list        全部 50 条 / 分类 50 条，封面 50/50，游标有效
✓ search“妈妈”        20 条，游标有效
✓ getDetail           标题/封面/6 个标签/2 集（episode_number 7、8，时长 135s）
✓ resolvePlayback     两集均返回 HLS，取流 206，#EXTM3U（EXTVERSION:6）
✓ 封面取流            200 image/jpeg
```

金币集（`commerce.can_play=false`）按设计抛 `CONTENT_LOCKED`，提示需要解锁。
### 6.5 计费机制（v0.2.0 修正）

黄果短剧为什么能直接播：huangguo.js 里没有任何 charge / commerce / coin 字样，站点本身没有计费层，
播放地址由页面或接口直接给出，插件只是搬运。

xj8 的计费在服务端，逐集判定（实测）：

1. 分集字段：commerce{charge_type:"coin", price_coins:10/20, can_play:false, preview_seconds:30}
2. POST /api/playback/sessions（收费集）→ 403 PAYMENT_REQUIRED「该集需要会员或购买」
3. POST /api/v1/playback/trial/sessions → 201，play_mode:"trial"，trial_seconds:30
4. 试看 manifest：路径 media-delivery/direct/v1/platform-trial/…，15 个分片、总长 30.0s、含 #EXT-X-ENDLIST
5. 重开会话仍是同一段 30 秒；正式地址为 platform/<数字id>/<签名hash>/720p.m3u8?ml_sign=…&t=…

结论：试看不是「前端截断完整片源」，服务端签发的就是物理 30 秒切片；签名与过期时间由服务端下发，
entitlement 也在服务端，插件层不存在绕过路径。

v0.2.0 因此改为把能用的做到最好：

1. catalog.getFilters 新增「计费：全部 / 只看免费」，list 内部按 charge_type 排序（免费优先）并支持只保留免费。
2. 收费集播放返回 CONTENT_LOCKED 时，自动降级到官方试看流，streams[0].label = "试看 30 秒"。
3. 新增设置项 trialPreview（默认开），关掉后收费集直接报 CONTENT_LOCKED。
4. 全库抽样 150 条里 129 条免费（86%）；首页热播与榜单推的多是金币剧，才让人误以为全站收费。

完整观看收费集只有服务端给的途径：站内充值金币或会员，或用宿主「聚合搜索 → 换源」找其他源的同名内容。

### 6.6 v0.2.0 复测

```
✓ getFilters          计费筛选（全部 / 只看免费）
✓ list(all)           50 条，金币 8 条，免费排前
✓ list(只看免费)      42 条，金币 0 条
✓ 免费剧播放          正常 HLS
✓ 金币剧播放          自动降级：label="试看 30 秒"，probe 206，片长 30.0s
✓ 关闭 trialPreview   按预期抛 CONTENT_LOCKED
```

## 7. MacCMS 果系四站 0.1.2（taoguo / meiguo / miguo / ningguo）

统一在 `taoguo` 母版里修，再用脚本生成另外三个（`miguo` 走 `alt-detail` 模式：站点用 `/voddetail/` rewrite 路径）。

| 问题 | 原因 | 修法 |
| --- | --- | --- |
| 分类只剩「电影 / 剧集」或全是「更多」 | 原来只按 `/vod/show/id/` 和 `/vodshow/` 猜，多数站导航是 `/vod/type/id/<tid>.html` | 按 `vod/type/id` → `vodtype` → `vod/show/id` → `vodshow` 依次匹配，取 `<a>` 文本当名称；「更多 / 查看更多视频」这类入口只进兜底池；跨域链接跳过 |
| 片名带「完整版免费在线观看-大米星球」尾巴 | 只认 `<title>` | 改为 `<h1>` → `<h3>` → `meta keywords` 首段 → `og:title` → `<title>` 依次取；清掉 `在线观看 / 迅雷下载 / 详情介绍 / 剧情介绍` 等尾巴与 `资源名称：` 前缀；尾部「-站点名」只在无数字且 ≤8 字时切掉，`START-582`、`MIKR-081` 这类番号不受影响 |
| `<h1>` 是「在线播放」「猜你喜欢」 | 模板把 `h1` 当小标题用 | 黑名单过滤，命中则跳下一个候选 |
| 站点偶发回「检测中 / 跳转中」JS 挑战页（200 + HTML） | 站点按频率限流 | `fetchJson` 最多 4 次尝试、退避 1.5s/3s/4.5s；连接被重置（ECONNRESET）同样重试；仍失败才抛 `UPSTREAM_ERROR` 并附页面片段 |
| 首页分区叫「分类 1 / 分类 2」 | 硬编码 `tid=1/2` | 首页改用导航里的真实分类（前两个），标题即分类名；分类结果按会话缓存 10 分钟，减少请求 |
| 多线路第一条常播不了 | 站点线路质量不一，只 1 集的线路多为预告或旧源 | 多线路按集数降序，完整片源排前面 |
| miguo 详情多打一次 404 | 站点用 `/voddetail/<id>.html` | 生成脚本 `alt-detail` 对调主备路径，`matchUrl` 也认 `/voddetail/` |

实测（宿主模拟器，2026-02）：

```
taoguo  0.1.2  home 最新/亚洲有码/亚洲无码  cats 20  detail 标题干净  stream 200 hls  search 20
meiguo  0.1.2  home 最新/制服诱惑/中文字幕  cats 8   detail 标题干净  stream 200 hls  search 20
miguo   0.1.2  home 最新/电影/电视剧        cats 5   detail 标题干净  stream 206 hls  search 10
ningguo 0.1.2  home 最新/国产自拍            cats 12  detail 标题干净  stream 206 hls  search 20
```

miguo 单个作品常有一条只 1 集的死链线路（如《天庭板砖侠》首条），换线路即可播，9 条线路实测 8 条 200/206。

## 9. 基色短剧 GScenes（x4bny.cc）0.1.0 —— 从 X 挖到的站点，逆向落地

来源：X 上 `@JayChbxe` 的域名更新帖（经 grok 的 X 搜索定位），全站只有这一个「能直接在浏览器看分集」的成人短剧站。

站点形态：Nuxt SPA + 自建 REST API，`__NEXT_DATA__`/`_payload.json` 都不存在，内容是客户端拿的。

### 9.1 接口全集（实测）

| 用途 | 请求 |
| --- | --- |
| 游客会话 | `POST /api/v1/auth/guest` → `data.access_token`（JWT，2h） |
| 列表 | `GET /api/v1/works?page=N&pageSize=20`（服务端固定 20/页）→ `{items,total}` |
| 分类过滤 | `GET /api/v1/works?category_id=<uuid>`（`category=` 无效） |
| 题材过滤 | `GET /api/v1/works?tag=<题材名>`（`genre=` 无效，会返回 0 条） |
| 分类 | `GET /api/v1/work-categories`（34 项：分类 14 + 题材 20） |
| 题材 | `GET /api/v1/genres`（`{name,count}`） |
| 榜单 | `GET /api/v1/rankings` |
| 热搜 | `GET /api/v1/search/hot-works` |
| 搜索 | `GET /api/v1/search?q=&page=` |
| 详情 | `GET /api/v1/works/<id>` |
| 分集 | `GET /api/v1/works/<id>/episodes` → `items[{id,no,title,duration_sec}]`（`hls_url` 恒为空） |
| 权限 | `GET /api/v1/works/<id>/episodes/<eid>/access` → `access.allowed / access_reason` |
| 取流 | `POST /api/v1/works/<id>/episodes/<eid>/playback` → `data.play_url` + 3 个 Set-Cookie |

### 9.2 踩到的两个坑

1. **API 前缀是 `/api/v1`**：前端 bundle 里写的是 `/auth/guest`、`/search` 这种片段，前缀在运行时拼。一开始按 `/api/genres` 探测全是 Go 风格 404，白试了七八个路径。
2. **播放地址带 CloudFront 签名 cookie**：`play_url`（`/hls/<资源id>/episodes/<集id>/index.m3u8`）裸请求 403 `MissingKey`；
   `playback` 响应里 `Set-Cookie` 给了 `CloudFront-Policy / CloudFront-Signature / CloudFront-Key-Pair-Id`，
   且 `Path` 精确限定在 `/hls/<资源id>/episodes/<集id>/`。把这三个 cookie 拼进 `stream.headers.Cookie` 后，
   m3u8 200、`#EXT-X-KEY` 的 16 字节 AES 密钥 200、分片 206 —— 清单内相对路径（`key`、`xxx.ts`）也在这条 Path 下，一并通过。

### 9.3 付费策略（实测，不做绕过）

- 作品 `access_mode` 有 `free` / `paid` 两种；`paid` 作品的前 1–2 集是官方免费试看（`access_reason:"free_preview"`）。
- 试看集之后 `access.allowed=false`，插件按协议抛 `CONTENT_LOCKED`（提示开通会员）。
- 实测：《烬临阙》28 集，第 1、2 集 OK，第 3 集起 `CONTENT_LOCKED`。

### 9.4 复测（宿主模拟器）

```
home      最新上架:20 / 总榜:24 / 热搜:12
cats      34（古风历史、成人、甜宠恋爱…）
list(cat) 20 条  next=2
list(tag=都市) 20 条
search    "直男" 20 条
detail    "刀口之蜜" 1 集 封面✓
play      206 hls（带 cookie）｜AES key 200（16B）｜分片 206（1024B）｜expiresAt 有值
VIP       第1、2 集播放成功，第 3 集 CONTENT_LOCKED
```

### 9.5 逆向工具链（用完即删）

VPS 的 hermes 容器里自带 `/opt/hermes/tools/chromium-1208/chrome-linux/chrome`，
用 `--log-net-log` 抓全量网络，再用 node 26 的全局 `WebSocket` 直连 CDP
（`--remote-debugging-port` + `Network.requestWillBeSent` + `Runtime.evaluate` 点播放按钮），
才拿到 `access` / `playback` 这两个只在点击播放时才发的请求。
年龄门（`age-gate-open`）不影响：直接导航 `/watch/<id>/<集号>/` 即可，播放要过人机验证时点一次播放器遮罩。
所有临时脚本、51MB netlog、chromium profile 已清理。
