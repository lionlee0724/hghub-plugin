# guoapp 站源对照表

来源：`guoapp/native/core/provider_duanju.go` 的 `duanjuProviderCatalog` 与 `duanjuSourceForHost`，
外加 `provider_huangguo.go` 里的 `sourceHuangguoAI / sourceHuangguoVideo / sourceHongguo / sourceHuangdou / sourceHuangju / sourceYeguo / sourceDSD / sourceCloudFront`。
本仓库按 HPP 协议把它们逐个移植成插件，状态如下（2026-11 实测）。

## 已移植并实测通过

| 插件 | 站源 | 类型 | 接口 | 实测 |
| --- | --- | --- | --- | --- |
| `youguo` | 柚果 · youavhub.com | maccms | `/api.php/provide/vod/`（ac=list / ac=detail / wd=） | 首页 20+20+20、21 个分类、搜索 20、HLS 取流 200 |
| `fanguo` | 西饭 · xifan-api-cn.youlishipin.com | api | `/xifan/search/getSearchList`、`/xifan/drama/getDuanjuInfo` | 3 个题材分区各 10、详情 100 集、MP4 取流 206 |

## MacCMS 家族：接口被站点关闭，需改走页面/ajax

这些站的 `/api.php/provide/vod/` 统一返回 6 字节 `closed`（站点主动关掉 JSON 采集接口）：

| 源 | 域名 | 可用的替代路径 |
| --- | --- | --- |
| 米果 miguo | dmxq40.com | `/index.php/ajax/data?mid=1&tid=&page=N`；详情页 `player_aaaa` |
| 桃果 taoguo | lujj31.buzz | **已移植为 `taoguo` 插件**（ajax/data 列表 + 详情页 + 播放页 player_aaaa） |
| 榴果 liuguo | www.llsp.me | 同上 |
| 美果 meiguo | shiresm.lol | **已移植为 `meiguo` 插件**（同上模板） |
| 柠果 ningguo | toptv15.cyou | 同上 |
| 宵果 xiaoguo | yese.co | 同上 |
| 樱果 yingguo | missav02.xyz | 同上 |
| 露果 luguo | luyitian.com | 同上 |
| 荔果 liguo | ririlu.cc | 同上 |
| 芒果 mangguo | zsrqab03.zsrenqi.xyz | 同上 |
| 艳果 yanguo | xqxq1.cc | 同上 |
| 花果 huaguo | www.zywest263.com | 403（Cloudflare 拦截机房 IP） |
| 伍果 wuguo | www.duanju55.com | 403 |
| 爽果 shuangguo | www.duanju2.com | 403 |

## 需要签名 / 登录 / 特殊解析的源（未移植）

| 源 | 域名 | 卡点 |
| --- | --- | --- |
| 芽果 yaguo | app.whjzjx.cn | 目前 503；需先取 token（`provider_duanju_yaguo.go`），带 `authorization/platform/version_name` 头 |
| 猫果 maoguo | api-store.qmplaylet.com | 接口签名 `md5(参数拼接 + duanjuMaoguoKey)`（`duanjuMaoguoHeaders`） |
| 观果 guanguo | api.drama.9ddm.com | App 网关，根路径只回 nginx 欢迎页，需按其 API 约定调用 |
| 星果 xingguo | read.api.duodutek.com | 同上（http 站点） |
| 牛果 niuguo | ccc.chaojichaojichanga.com:35620 | 非标端口 + 类型表（5=短剧/1=电影/2=电视剧/4=动漫/3=综艺） |
| 河果 heguo | www.kuaikaw.cn | Next.js，数据在 `pageProps`（`nextPageProps`） |
| 超果 chaoguo | www.shanekids.com | 纯网页抓取（HTML 列表 + 详情） |
| 红果 hongguo | hongguoduanju.com | 自有签名接口（`provider_hongguo_sign.go`），还有 App 端接口 |
| 野果 yeguo | analyze.buxefaex.cc | JSON 但返回 `{"data":[],"status":0,"crypt":true}`，需带正确参数/签名 |
| 黄果系 huangguo-video / huangguoai | huangguo.video 等 | `huangguoai` 已由现有 `huangguo` 插件覆盖；`huangguo.video` 当前 Cloudflare 403 |
| 黄豆 huangdou | tideember.cc | 530（Cloudflare 源站错误） |
| 黄剧 huangju | huangju.net | Next.js 页面，需解析 pageProps |
| 帝果 dsd | www.dsd.com.se | 域名解析失败 |
| 橘果/枣果 | 4tw3gy653a.bulunhufait.buzz / www.yhsp5.yachts | 纯网页型，需逐站写解析 |
| 旧版 cloudfront | — | 旧 API，已废弃 |

## 说明

- 上表「卡点」都是读 Go 源码得到的，不是我猜的；要从零移植需要逐个还原签名/结构。
- `mature: true` 的插件在 HGhub 里默认隐藏，需要在设置里打开成人内容开关才可见。
- 站点会换域名：`duanjuSourceForHost` 里列了每个源的别名主机，换域名时优先按主机名匹配。
