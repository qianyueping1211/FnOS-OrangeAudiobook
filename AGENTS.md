# ting-reader 私有维护约定

- 仓库保持 Private，唯一源码仓库为 qianyueping1211/ting-reader；不启用公开 Pages 或镜像。
- 直接使用 GitHub API、网页编辑或在线环境修改，所有检查、截图与打包在 GitHub Actions 运行，不在用户电脑克隆或编译。
- 每次功能发布更新 backend/Cargo.toml、Cargo.lock、frontend/package.json、package-lock.json、FPK manifest 与 CHANGELOG 的版本。变更记录先整体说明，再按首页、书架、播放、设置等实际菜单归纳。
- 前端沿用 React，业务路由、鉴权、数据库及插件接口保持兼容。设计变量与端内差异放 frontend/src/design/reader.css；不复制飞牛标题栏或手机外壳。
- 桌面使用侧栏，窄屏使用首页、书架、书单、设置四个入口。保留管理与插件入口，并遵循原有权限。
- 飞牛原生包只走 ting-reader.sock 内部网关、iframe 入口，不开放新 TCP 端口。独立部署仍使用原先的服务配置。
- 仅生成普通 x86_64 飞牛安装包与 SHA256SUMS.txt；不构建、不上传 FYGO 变体，不恢复 fygopack 步骤；不运行 Docker 镜像或 Docker FPK 构建工作流。
- 更新仅认本私有仓库的正式 Release、x86_64 FPK 及 SHA256SUMS.txt；不得把令牌提交到源码或返回前端。
- 应用服务保持专用用户 ting-reader。仅固定 root 安装入口具有应用中心更新权限，sudoers 只允许 install/status；不得授予 shell、任意路径或任意命令权限。
- 安装完成须核对实际 manifest 版本，不能仅以命令返回成功判定升级成功。提交结果未确认时禁止重复升级。
- GitHub 检查、界面截图、原生构建与发布通过后才能报告完成；真实 NAS、iPhone 播放及安装行为未实测时如实说明。
