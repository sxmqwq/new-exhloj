# Extend HLOJ

Extend HLOJ 的本地重制版，当前版本 **2.5.2**。安装在 Tampermonkey 中，增强 HLOJ / 部分 Hydro 页面的训练体验。

本版保留原脚本的作者信息，恢复了以下七个模块，不依赖原插件的共享后端。

| 模块 | 功能 |
| --- | --- |
| `core` | 设置、模块开关、缓存与 JSON 备份、事件接口 |
| `ui` | 界面调整、作业附件、榜单标记、Markdown 复制、头像链接、权限查看、CPH / CP Editor |
| `captcha` | 本地 SVG 验证码识别、折叠与展开、可选识别记录 |
| `remote-problem` | 题源链接、难度、翻译、题解、本地导出、原站公开提交查看 |
| `contest-helper` | 题面和附件 ZIP、提交 CSV/JSON、Ghost、手动或可选自动报名 |
| `juan-monitor` | 公开提交与比赛/作业榜单汇总、按域和题目去重、本地快照增量 |
| `user` | 本地资料、姓名颜色、CCF 标记、获奖信息、Rating 历史/排行/结算、OIerDb 链接导入、排名页快捷导入与刷新 |

## 安装与升级

1. 安装 Tampermonkey。
2. 打开仓库中的 [`dist/exhloj.user.js`](dist/exhloj.user.js)，点击 **Raw**，再由 Tampermonkey 安装；也可以把全文粘贴到油猴编辑器中保存。
3. 升级已有版本时，推荐直接在原脚本的编辑器中替换全文，以保留设置和缓存。作为新脚本安装时，先停用旧脚本，再按需导入旧版 JSON 备份。
4. 刷新 OJ，在用户菜单或右下角 **Extend HLOJ** 按钮打开设置。

现成的安装包位于 [`release/exhloj-2.5.2.zip`](release/exhloj-2.5.2.zip)，其中包含脚本、安装说明、版本信息和第三方许可证。

完整使用说明见 [`docs/INSTALL.zh-CN.txt`](docs/INSTALL.zh-CN.txt)。本仓库没有预设 GitHub 用户名，也没有自动更新地址；发布到自己的仓库后，可按需要自行配置。

## 用户资料与 OIerDb

用户菜单 → **用户工具** → **编辑资料**。所有本地编辑入口均无特定 UID 的管理员限制；资料只影响本机显示，不改变站点账号、角色或认证。

比赛 Rating 的命令和计算公式见 [`docs/RATING.zh-CN.md`](docs/RATING.zh-CN.md)。每次结算会从 1800 重算当前命令中的完整历史，成功后整体替换原记录；新增比赛需要保留原命令并在末尾追加。

单人编辑器只接受完整的选手页面链接，例如 `https://oier.baoshuo.dev/oier/12345`。粘贴链接后自动从 OIerDb 官方数据读取姓名、CCF 等级、毕业年份、排名/积分和获奖记录；核对后点击 **保存本地资料**。选手 ID 从链接记录，排名页、网页正文和 Markdown 不再作为导入输入。

编辑器、个人资料卡和已绑定名单均提供 **刷新**，用户工具中可 **刷新全部 OIerDb 资料**。刷新会更新并保存 OIerDb 字段，保留 OJ 用户名、教练标记、题目分和 Rating。名单显示每人的 OIerDb ID 与最后更新时间；未绑定、ID 已变化或读取失败的资料会保留并显示原因。

读取期间新保存的资料会保留，冲突项跳过并显示原因；在编辑框中继续输入时，返回结果不会覆盖这些新输入。用户资料或 Rating 格式异常时，两部分独立显示，普通保存停止；JSON 编辑和用户导出会保留异常原文，明确修复相应部分后可继续使用。

首次读取需下载官方数据，后续在当前页面按数据库版本复用；每次刷新都会重新检查官方版本。有进度显示和取消按钮。首次访问时按油猴提示允许 `oier.api.baoshuo.dev`。读取链接时只填入表单，保存后才建立本地绑定；刷新已绑定资料会直接保存。

### 从排名页快捷导入

用户工具 → **OIerDb 快捷导入** → 填写域 ID → **扫描排名页并识别**。用于已同意关联资料的成员；只扫描该域排名页可见用户，不枚举站点其他账号。已绑定 OIerDb ID 的用户自动跳过。

- 提取用户名中的全部汉字，优先按完整姓名精确查找。
- 识别全拼、大小写及带声调拼音，并核对姓名的完整读音；用内嵌的离线拼音字典建立本地全拼索引，无需另行下载字典。支持常见多音字、数字前后缀及连续字母子串，例如 `zhanghaoxuan2024`、`DL24zhangyixin`。完整姓名全拼优先，也保留独立首字母片段的查询。
- 命中 **1～3 人**时进入折叠候选组，展开后由用户选择；2～3 人时默认不选中任何候选。超过 3 人不入队，未入队列表仍显示提取出的片段及原因。
- 队列展示 OJ 用户、提取片段、查询方式及可展开的 OIerDb 资料，包括 ID、学校、年级和获奖摘要。默认不勾选导入；选定候选后可逐人确认、批量确认或移除。候选分页展示，跨页保留选择和展开状态。批量确认会跳过尚未选择具体人的多候选组，不自动挑第一人。

扫描和识别只生成预览，确认时才写入本地资料；保留教练、题目分、Rating 及其他用户数据。确认时如果某人的本地资料已经改变，该项会跳过并显示原因。候选只保留在当前页面内存中，切换页面或账号后需重新扫描。

整轮识别只检查一次版本，基础资料与获奖记录各下载一次，之后均在本地搜索。同版本在当前页面继续复用；不会逐个用户名请求 OIerDb。分页不完整、权限错误或取消任务时不发布候选，也不改动原资料。

## 请求和数据

- 设置、用户资料、Rating 和扫描快照保存在当前浏览器的油猴存储。
- 用户资料编辑和 Rating 结算只写入本地；读取榜单、用户名时仍受站点权限限制。
- 验证码识别在本机完成，不提交登录；OIerDb 仅按手动入口读取官方公开数据，不携带登录 Cookie，不上传资料。
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
npm run package:check
```

输出为 `release/exhloj-<版本>.zip`，并更新 `VERSION.txt` 与 `SHA256SUMS`。调整版本时需要同时修改 `package.json` 与源码模板中的三个版本位置，构建器会检查一致性。

`package:check` 只读核对当前安装包内的脚本、说明、许可证、版本及 SHA-256，CI 在重新生成安装包前运行它，防止把仓库中过期的 ZIP 掩盖掉。固定 ZIP 时间戳使同一环境重复打包得到相同文件。升级版本时也要同步 `package-lock.json` 的项目版本和安装说明首行。

目录说明与维护要点见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。

## 验证

当前 **89 组 Chromium 浏览器场景通过**，覆盖七个模块及 OIerDb 的 24 条获奖记录示例。测试拦截页面和接口请求，使用固定响应，不需要 OJ 账号。测试输出在 `tests/output/`。

验证记录见 [`docs/validation-result.json`](docs/validation-result.json)。这些检查不代表已经完成 HLOJ 登录态实测；站点特有模板或权限差异仍可能影响实际效果。

仓库包含 `.github/workflows/test.yml`，在 push、PR 或手动触发时构建并运行浏览器检查。

## 发布到 GitHub

解压后，将目录内的文件上传到你的仓库根目录，包括 `.github`、`.gitignore` 和 `.gitattributes`。源码、构建产物、说明和测试已分开整理。

创建 GitHub Release 时，可以上传 `release/exhloj-2.5.2.zip` 和 `dist/exhloj.user.js`。更改功能后先构建、测试，再生成对应版本的安装包。

## 来源与许可证说明

原版 Extend HLOJ 的作者信息保留在脚本头部。重制范围和来源见 [`NOTICE.md`](NOTICE.md)，第三方代码许可证见 [`THIRD_PARTY_NOTICES.txt`](THIRD_PARTY_NOTICES.txt)。
