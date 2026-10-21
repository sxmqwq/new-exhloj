# 维护说明

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/exhloj.template.js` | 当前版本的可编辑业务源码和 userscript 头部 |
| `vendor/markdown-renderer.js` | 已打包的 Markdown/MathML 渲染器，默认构建直接使用 |
| `vendor/markdown-entry.mjs` | 渲染器的原始入口，用于重新打包第三方依赖 |
| `dist/exhloj.user.js` | 直接安装到油猴的完整单文件 |
| `scripts/build.cjs` | 把渲染器和第三方许可证插入源码模板，检查版本一致性 |
| `scripts/build-vendor.mjs` | 通过 esbuild 重建渲染器 |
| `scripts/package-release.py` | 生成用户安装 ZIP、版本说明与 SHA-256 |
| `tests/browser.cjs` | 61 组 Chromium 场景，接口由固定响应模拟 |
| `tests/fixtures/` | 测试输入，不包含真实账号会话 |
| `tests/output/` | 测试生成的 JSON/ZIP；不纳入版本控制 |
| `release/` | 可上传到 GitHub Release 的安装包 |

源码仍使用一个 IIFE，共用内部工具和事件委托；这里没有引入新的模块运行机制。默认构建只替换两个明确的标记，不更改业务逻辑。初次整理后的 `dist/exhloj.user.js` 与已经交付的 2.3.1 完全一致；2.3.2 修复用户链接范围与 CCF SVG 徽章。

## 源码位置

- `DEFAULTS`、`normalizeSettings`、`openSettings`：模块和参数设置。
- `core`、`broadcast`、`on`：事件与共用接口。
- `recognizeCaptcha`、`runCaptcha`：验证码识别与折叠。
- `remoteProblem`、`loadRemoteMeta`：题源读取和显示。
- `workRequest`、`runWork`、`listPages`：串行请求、取消与限额。
- `exportContestStatements`、`collectContestRecords`：比赛导出。
- `scanJuan`：卷王统计与快照。
- `userStore`、`writeUserStore`：本地用户数据及 Rating。
- `parseOIerPaste`、`fillUserFromOIer`：OIerDb 粘贴识别和表单预览。
- `profilePanelTarget`：定位主页最外层侧栏。
- `calculateUserRatings`：本地比赛结算。
- 最后的点击事件委托和 `refresh`：界面动作与动态页面刷新。

## 构建与版本

修改 `src/exhloj.template.js`，运行 `npm run build` 后提交源码和 `dist` 两部分。不要只改 `dist`，否则 `npm run check` 会报错。

两个构建标记必须各保留一处：`@EXHLOJ_MARKDOWN_VENDOR@` 与 `@EXHLOJ_THIRD_PARTY_LICENSES@`。版本同时存在于 `package.json`、userscript 头部、初始化标记和 `VERSION` 常量。

## 浏览器检查

`npm test` 默认使用 Playwright 安装的 Chromium。也支持：

```bash
EXHLOJ_CHROME=/usr/bin/chromium npm test
EXHLOJ_TEST_FILTER='oier:' npm test
```

筛选模式只运行名称包含指定文本的场景，输出中的 `passed` 是本次实际运行数。完整检查应不设置 `EXHLOJ_TEST_FILTER`。

测试不会访问真实 OJ 账号。`GM_*` 和剪贴板在页面内模拟，网页/附件/原站响应由路由拦截。只有测试浏览器本身需要预先安装。

发布前运行 `npm run check`、完整 `npm test` 和 `npm run package`。本次整理后的完整检查报告保存在 `docs/validation-result.json`。

## 兼容性

`exhloj.coreui.*` 是旧版保留的内部存储键，不是当前插件名称。不要在没有迁移逻辑的情况下重命名这些键，否则用户已有设置和资料会丢失。

本地资料编辑和 Rating 不设置固定 UID 的管理员门槛；需要读取 OJ 数据的操作仍遵循站点权限。不要将本地显示标记当作站点角色。
