# 内置书源插件

喜马拉雅书源随程序一起分发，不需要在插件市场里上传 `.tr`。

## 目录

| 路径 | 作用 |
| --- | --- |
| `plugins/ximalaya-book-source/` | 插件源码（`plugin.yml`、`plugin.js`、`aes-ecb.js`、`sdk.mjs`） |
| `plugins/ximalaya-book-source/dist/` | 本地打包产物（可忽略，构建时重新生成） |
| `plugins/pack-tr.mjs` | `.tr` 打包器（magic `TRPACK` + zstd 压缩的 tar + `.trpack/package.json`） |
| `plugins/verify-tr.mjs` | 反向校验器（解包、核对文件表与 sha256） |
| `plugins/test-ximalaya.mjs` | 对着真实接口跑四个操作的端到端脚本 |
| `backend/preinstalled-plugins/ximalaya-book-source.tr` | 预装包：服务启动时由 `install_preinstalled_packages` 安装 |

## 改了插件之后

```bash
node plugins/test-ximalaya.mjs
node plugins/pack-tr.mjs plugins/ximalaya-book-source backend/preinstalled-plugins/ximalaya-book-source.tr
node plugins/verify-tr.mjs backend/preinstalled-plugins/ximalaya-book-source.tr
```

FPK 构建（`.github/workflows/native-publish.yml`）在打包 App 目录时会重新执行上面两步，
所以构建出的安装包里的 `.tr` 一定和源码一致；仓库里的那份是给 `scripts/deploy.sh`
这类直接从源码目录部署的方式用的。

## 插件能力

`plugin.yml` 声明 `book_source: true`，实现四个操作：

- `search`：`search.ximalaya.com/front/v1`，返回专辑列表
- `detail`：`www.ximalaya.com/revision/album/v1/simple`，返回专辑元数据与首批章节
- `list_chapters`：`mobile.ximalaya.com/mobile/v1/album/track`（`isAsc=false` 为正序），
  主接口失败时退到 `mobile/others/ca/album/track` 接口
- `resolve_audio`：`www.ximalaya.com/mobile-playpage/track/v3/baseInfo`，
  播放地址是 AES-128-ECB 密文，用 `aes-ecb.js` 在插件内解密，再交给宿主媒体代理

免费章节无需登录；会员或已购买的内容由源站接口自行判定，插件不做任何绕过。
`author` 必须是非空字符串（宿主的 `BookItem.author` 不是 `Option`，空串会被
`publishSearch` 转成 `null` 而反序列化失败），所以没有主播名时回落到“喜马拉雅”。

## 前端行为（方案 B）

- 书架默认**不查**任何书源，只列 NAS 上的书；`library_type === 'source'` 的托管库
  在书架列表里被隐藏，分页按服务端行数推进，不会漏行。
- 搜索页多一行「来源」，默认「书架」；选中某个书源后才调用 `/api/v1/scraper/search`，
  本地结果始终排在上面。
- 在线结果点开时才入库（`POST /api/v1/scraper/books`），宿主按插件 ID 建 `source` 托管库，
  之后可以进书单、出现在最近播放、用现有播放体系播放。
- 在线书封面右上角带「在线」角标，详情页不提供「本地查看」。
