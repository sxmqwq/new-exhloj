# 维护说明

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/exhloj.template.js` | 当前版本的可编辑业务源码和 userscript 头部 |
| `vendor/markdown-renderer.js` | 已打包的 Markdown/MathML 渲染器，默认构建直接使用 |
| `vendor/markdown-entry.mjs` | 渲染器的原始入口，用于重新打包第三方依赖 |
| `vendor/pinyin-entry.mjs`、`vendor/pinyin.js` | 离线拼音字典的入口和预打包代码 |
| `dist/exhloj.user.js` | 直接安装到油猴的完整单文件 |
| `scripts/build.cjs` | 把渲染器、拼音字典和第三方许可证插入源码模板，检查版本一致性 |
| `scripts/build-vendor.mjs` | 通过 esbuild 重建渲染器和拼音字典 |
| `scripts/package-release.py` | 生成用户安装 ZIP、版本说明与 SHA-256 |
| `scripts/package-source.py` | 生成包含 `.github` 的完整源码 ZIP，并暂存当前版本发布文件 |
| `tests/browser.cjs` | 89 组 Chromium 场景，接口由固定响应模拟 |
| `tests/session.cjs` | 5 组本地 HTTP 会话场景，使用真实 Cookie 和跳转 |
| `tests/package_test.py` | 3 组源码包完整性、可重复打包和过期文件检查 |
| `tests/fixtures/` | 测试输入，不包含真实账号会话 |
| `tests/output/` | 测试生成的 JSON/ZIP；不纳入版本控制 |
| `release/` | 可上传到 GitHub Release 的安装包 |
| `artifacts/` | 当前版本安装包、源码包和发布校验值；不纳入版本控制 |

源码仍使用一个 IIFE，共用内部工具和事件委托；这里没有引入新的模块运行机制。默认构建只替换三个明确的标记，不更改业务逻辑。初次整理后的 `dist/exhloj.user.js` 与已经交付的 2.3.1 完全一致；2.3.2 修复用户链接范围与 CCF SVG 徽章。

## 源码位置

- `DEFAULTS`、`normalizeSettings`、`openSettings`：模块和参数设置。
- `core`、`broadcast`、`on`：事件与共用接口。
- `recognizeCaptcha`、`runCaptcha`：验证码识别与折叠。
- `remoteProblem`、`loadRemoteMeta`：题源读取和显示。
- `workRequest`、`runWork`、`listPages`：串行请求、取消与限额。
- `exportContestStatements`、`collectContestRecords`：比赛导出。
- `scanJuan`：卷王统计与快照。
- `userStore`、`writeUserStore`：本地用户数据及 Rating。
- `loadOIerDatabase`、`readOIerProfiles`：读取 OIerDb 官方版本化静态数据，按 UID 解析选手与获奖记录。
- `fillUserFromOIerLink`、`refreshOIerUsers`：链接预览与保存、单人/批量刷新；使用任务取消与账号检查，提交前重读本地资料并检查绑定。
- `profilePanelTarget`：定位主页最外层侧栏。
- `calculateUserRatings`：本地比赛结算。
- 最后的点击事件委托和 `refresh`：界面动作与动态页面刷新。

## 构建与版本

Node.js 版本在 `.node-version` 固定为 24，`package.json` 和锁文件要求 >=24，Actions 从同一个版本文件读取。打包与包结构检查需要 Python 3。

修改 `src/exhloj.template.js`，运行 `npm run build` 后提交源码和 `dist` 两部分。不要只改 `dist`，否则 `npm run check` 会报错。

三个构建标记必须各保留一处：`@EXHLOJ_MARKDOWN_VENDOR@`、`@EXHLOJ_PINYIN_VENDOR@` 与 `@EXHLOJ_THIRD_PARTY_LICENSES@`。版本同时存在于 `package.json`、`package-lock.json` 的项目字段、userscript 头部、初始化标记和 `VERSION` 常量；安装说明首行也要同步。

## 浏览器检查

`npm test` 默认使用 Playwright 安装的 Chromium。也支持：

```bash
EXHLOJ_CHROME=/usr/bin/chromium npm test
EXHLOJ_TEST_FILTER='oier:' npm test
```

筛选模式只运行名称包含指定文本的场景，输出中的 `passed` 是本次实际运行数。完整检查应不设置 `EXHLOJ_TEST_FILTER`。

测试不会访问真实 OJ 账号。`GM_*` 和剪贴板在页面内模拟，网页/附件/原站响应由路由拦截。只有测试浏览器本身需要预先安装。

发布前运行 `npm run check`、完整 `npm test`、`npm run package` 和 `npm run package:check`。完整检查报告保存在 `docs/validation-result.json`。CI 在打包前执行 `package:check`，核对已提交的发布文件；打包使用固定时间戳和文件权限。

修改源码、版本或安装说明后，先运行 `npm run build`、`npm run package`，再运行上述只读检查和测试。`npm run package:source` / `package:source:check` 生成并验证 `artifacts/` 中的源码包和安装文件。源码包不用 `git archive`，解压后没有 `.git` 也可重新构建；打包仅包含明确的项目目录和根文件，不纳入 `node_modules`、Git 元数据、测试输出或历史安装包，必须包含两个工作流和全部测试入口。

CI 不再用 `release/*.zip` 混传历史版本。安装文件、源码包、测试报告分成三个 artifact，前两者只在检查全部成功后上传。报告在失败时仍上传，浏览器检查在异常退出时也写出已通过的检查和失败原因；截图统一写入 `tests/output/`。

`release.yml` 可由 `v*` 标签或手动触发，复用 `test.yml` 检查并下载同一运行的产物；发布前再次核对标签版本和 SHA-256。手动触发要选择已经存在的匹配版本标签。默认分支上的普通 push/PR 不会发布。发布权限仅在 `publish` job 中启用，检查 job 保持只读。

页面会话回归和真实站点对照步骤见 `docs/SESSION.zh-CN.md`。不要通过清 Cookie、强行延长会话或缓存旧 UserContext 掩盖站点登录错误。

2.5.2 的写入保护：`userStore` 独立解析资料和 Rating，异常字段在导出/JSON 编辑时保留原文；`writeUserStore` 普通写入先验证原数据，只有显式 JSON 修复可以替换异常部分。刷新比较每人的原资料快照，表单填入比较受影响输入框的快照；Rating 比较结算前后的 Rating 和草稿。比较及保存之间不允许加入异步操作。仅比较相关数据，独立的题目分、教练和资料编辑仍合并保留。这些保护检测读取期间可观察到的修改，不提供跨标签页的存储事务锁。

## 兼容性

`exhloj.coreui.*` 是旧版保留的内部存储键，不是当前插件名称。不要在没有迁移逻辑的情况下重命名这些键，否则用户已有设置和资料会丢失。

本地资料编辑和 Rating 不设置固定 UID 的管理员门槛；需要读取 OJ 数据的操作仍遵循站点权限。不要将本地显示标记当作站点角色。

OIerDb 数据来自 https://oier.api.baoshuo.dev ，只在手动读取/刷新时访问。按官方 SHA-512 版本名缓存当前页面数据，始终校验长度和结构；Web Crypto 可用时同时校验 SHA-512。HTTP 站点缺少 Web Crypto 时仍可读取。仅选手字段入本地存储，不保存完整数据库。OIerDb 的比赛/学校 ID 从 0 开始，选手 UID 从 1 开始。

## 排名页快捷导入（2.5.0）

- `indexOIerSearch`：按官方结果文件第 2 列首字母、第 3 列姓名构建当前页面索引，重复 ID 使任务失败。
- `matchOIerUser`：汉字完整姓名优先；使用内嵌 pinyin-pro 的逐字读音建立全拼索引，完整姓名拼音/子串优先于首字母。名字 2～12 字、读音组合最多 256 个，异常组合用汉字、首字母或链接确认；保留同音重名和分离片段候选。
- `scanQuickOIerImport`：通过 `/d/{domain}/ranking?page=N` 的 `udocs / upcount` 读取可见用户名；全轮仅调用一次数据库加载，选中资料只解析一次。
- `applyQuickOIerImport`：内存候选按账号、页面版本及域上下文限制；提交前重读用户存储，比较被更新人的原资料快照，合并保存且保留其他数据。
- 官方格式核对：OIerDb `apps/frontend-legacy/src/components/Search.tsx`、`packages/parser/result.ts`；Hydro `packages/hydrooj/src/handler/domain.ts`、`packages/ui-default/templates/ranking.html`（2026-10-22）。
- 快捷导入测试：`EXHLOJ_TEST_FILTER='oier: quick' npm test`。所有批量匹配测试使用构造的虚构姓名及 UID；未扫描实际 OJ 成员。

2.5.1：命中 1～3 个不同 ID 入队。`options / chosenId` 区分候选组与选择结果；多候选初始不选定，提交只允许保存所选候选。新增 `vendor/pinyin-entry.mjs`、`vendor/pinyin.js`，默认构建直接内嵌，运行时不请求字典。`build:vendor` 同时重建 Markdown 和拼音库。
