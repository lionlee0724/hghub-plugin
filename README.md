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

明细与排查记录见 `FIXES.md` 第 6 节。
