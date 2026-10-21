# Extend HLOJ

Extend HLOJ 的本地重制版，当前版本 **2.3.2**。安装在 Tampermonkey 中，增强 HLOJ / 部分 Hydro 页面的训练体验。

本版保留原脚本的作者信息，恢复了以下七个模块，不依赖原插件的共享后端。

| 模块 | 功能 |
| --- | --- |
| `core` | 设置、模块开关、缓存与 JSON 备份、事件接口 |
| `ui` | 界面调整、作业附件、榜单标记、Markdown 复制、头像链接、权限查看、CPH / CP Editor |
| `captcha` | 本地 SVG 验证码识别、折叠与展开、可选识别记录 |
| `remote-problem` | 题源链接、难度、翻译、题解、本地导出、原站公开提交查看 |
| `contest-helper` | 题面和附件 ZIP、提交 CSV/JSON、Ghost、手动或可选自动报名 |
| `juan-monitor` | 公开提交与比赛/作业榜单汇总、按域和题目去重、本地快照增量 |
| `user` | 本地资料、姓名颜色、CCF 标记、获奖信息、Rating 历史/排行/结算、OIerDb 粘贴识别 |

## 安装与升级

1. 安装 Tampermonkey。
2. 打开仓库中的 [`dist/exhloj.user.js`](dist/exhloj.user.js)，点击 **Raw**，再由 Tampermonkey 安装；也可以把全文粘贴到油猴编辑器中保存。
3. 升级已有版本时，推荐直接在原脚本的编辑器中替换全文，以保留设置和缓存。作为新脚本安装时，先停用旧脚本，再按需导入旧版 JSON 备份。
4. 刷新 OJ，在用户菜单或右下角 **Extend HLOJ** 按钮打开设置。

现成的安装包位于 [`release/exhloj-2.3.2.zip`](release/exhloj-2.3.2.zip)，其中包含脚本、安装说明、版本信息和第三方许可证。

完整使用说明见 [`docs/INSTALL.zh-CN.txt`](docs/INSTALL.zh-CN.txt)。本仓库没有预设 GitHub 用户名，也没有自动更新地址；发布到自己的仓库后，可按需要自行配置。

## 用户资料与 OIerDb

用户菜单 → **用户工具** → **编辑资料**。所有本地编辑入口均无特定 UID 的管理员限制；资料只影响本机显示，不改变站点账号、角色或认证。

可以复制 OIerDb 选手页面，粘贴到编辑器的识别区域。支持 HTML 表格、普通文本和 Markdown，自动填入姓名、CCF 等级、当前年级及获奖记录。分数上限、比赛名次、学校等字段也会保留。核对后点击 **保存本地资料**。

OIerDb 排名不等于选手 ID。页面内容没有选手 ID 时会保留原值；如需识别 ID，可另外粘贴选手页链接。

## 请求和数据

- 设置、用户资料、Rating 和扫描快照保存在当前浏览器的油猴存储。
- 用户资料编辑和 Rating 结算只写入本地；读取榜单、用户名时仍受站点权限限制。
- 验证码识别和 OIerDb 粘贴识别在本机完成，不提交登录、不执行粘贴内容中的脚本。
- 自动报名默认关闭。启用后仅处理明确配置的目标。
- 附件链接、头像保存、报名、发送 CPH / CP Editor 等操作按对应入口触发；题源模块按设置读取原站。
- JSON 备份为明文，不包含旧版密码/token 导入功能。

## 开发

建议 Node.js 22 或更新版本；本包用 Node.js 24 验证。安装包生成脚本另需 Python 3。

```bash
npm ci --ignore-scripts
npx playwright install chromium
npm run check
npm test
```

Linux 缺少浏览器依赖时可以运行 `npx playwright install --with-deps chromium`。已有 Chromium 的环境可通过 `EXHLOJ_CHROME` 指定可执行文件。

默认构建使用仓库中已打包的 Markdown 渲染器，无需下载业务运行依赖：

```bash
npm run build
npm run build:check
```

`build:check` 验证源码生成结果与 `dist/exhloj.user.js` 逐字一致。维护第三方渲染器时，可在安装开发依赖后运行：

```bash
npm run build:vendor
npm run build
npm test
```

依赖变更时同步更新 `THIRD_PARTY_NOTICES.txt`。生成安装包：

```bash
npm run package
```

输出为 `release/exhloj-<版本>.zip`，并更新 `VERSION.txt` 与 `SHA256SUMS`。调整版本时需要同时修改 `package.json` 与源码模板中的三个版本位置，构建器会检查一致性。

目录说明与维护要点见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。

## 验证

当前 **61 组 Chromium 浏览器场景通过**，覆盖七个模块及 OIerDb 的 24 条获奖记录示例。测试拦截页面和接口请求，使用固定响应，不需要 OJ 账号。测试输出在 `tests/output/`。

验证记录见 [`docs/validation-result.json`](docs/validation-result.json)。这些检查不代表已经完成 HLOJ 登录态实测；站点特有模板或权限差异仍可能影响实际效果。

仓库包含 `.github/workflows/test.yml`，在 push、PR 或手动触发时构建并运行浏览器检查。

## 发布到 GitHub

解压后，将目录内的文件上传到你的仓库根目录，包括 `.github`、`.gitignore` 和 `.gitattributes`。源码、构建产物、说明和测试已分开整理。

创建 GitHub Release 时，可以上传 `release/exhloj-2.3.2.zip` 和 `dist/exhloj.user.js`。更改功能后先构建、测试，再生成对应版本的安装包。

## 来源与许可证说明

原版 Extend HLOJ 的作者信息保留在脚本头部。重制范围和来源见 [`NOTICE.md`](NOTICE.md)，第三方代码许可证见 [`THIRD_PARTY_NOTICES.txt`](THIRD_PARTY_NOTICES.txt)。
