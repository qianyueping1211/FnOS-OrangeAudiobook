# 橙子听书

面向飞牛 fnOS 的私有有声书应用，基于 [Ting Reader](https://github.com/dqsq2e2/ting-reader) 维护，保留 AGPL-3.0-only 协议与原作者归属。

使用本仓库 Releases 中的普通 x86_64 原生 FPK。界面在飞牛内部窗口打开，不新增 NAS 端口；原应用 ID `ting-reader`、书架数据库和数据目录保持不变。

支持手机与 PC 书架、播放、刮削源、真实封面保存、单本文件刷新与 GitHub 更新。刮削配置可选择自动将元数据写入音频文件；编辑书籍保存后自动提交文件写入任务。

图标文件名和入口路径固定。仓库根目录 `image/` 仅为上游介绍文档，不会打包进应用。所有测试、界面检查和 FPK 构建由 GitHub Actions 完成。

历史 Python 版本备份在 [FnOS-OrangeAudiobook-Bak](https://github.com/qianyueping1211/FnOS-OrangeAudiobook-Bak)。
