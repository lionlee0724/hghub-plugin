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

国内网络如直连 raw.githubusercontent.com 失败，可用 jsDelivr 镜像：

```
https://cdn.jsdelivr.net/gh/lionlee0724/hghub-plugin@main/manifest.json
```

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

guoapp 全量站源对照（26 个「果」源 + 黄果系，逐个标注已移植 / 卡点）见 [`docs/guoapp-sources.md`](docs/guoapp-sources.md)。

明细与排查记录见 `FIXES.md` 第 6 节。

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
