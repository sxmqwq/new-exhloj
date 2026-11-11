# 开发说明

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/exhloj.template.js` | 功能源码与统一控制面板 |
| `dist/exhloj.user.js` | 可安装脚本，包含所需依赖 |
| `vendor/` | Markdown、公式与拼音处理库 |
| `scripts/` | 构建、打包与发布说明生成 |
| `tests/` | 模拟页面、真实 Cookie 会话及打包检查 |
| `docs/` | 使用说明、算法说明与当前面板截图 |
| `release/` | 当前版本的离线安装包 |
| `artifacts/` | CI 使用的安装与源码产物，不纳入版本控制 |

## 构建与检查

使用 Node.js 24、Python 3 和 Chromium：

```bash
npm ci --ignore-scripts
npx playwright install chromium
npm run build
npm run package
npm run check
npm run package:check
npm test
npm run package:source
npm run package:source:check
```

`build` 将模板与依赖合并到 `dist`。版本需同步到 `package.json`、锁文件项目字段、脚本头部、初始化标记、`VERSION` 常量及安装说明首行。

安装包使用固定时间戳和权限，可重复生成。`package` 只保留当前安装包；`package:check` 为只读检查，会拒绝过期脚本、校验值或多余的旧包。

完整源码包包含构建所需目录、工作流与测试，不包含 Git 元数据、依赖安装目录、测试输出或历史安装包。缺少必需文件、内容过期或产物被修改时，检查会失败。

测试输出位于 `tests/output/`，不纳入版本控制。支持 `EXHLOJ_TEST_FILTER` 按场景名筛选，或使用 `EXHLOJ_CHROME` 指定 Chromium 路径；完整检查不设置过滤器。Cookie 会话测试使用本地 HTTP 服务，不使用真实 OJ 账号。站点对照步骤见 [SESSION.zh-CN.md](SESSION.zh-CN.md)。

## 控制面板

用户名菜单和右下角入口调用 `openHome`。`modal` 提供统一页头和导航，`openPanelSection` 切换首页、比赛、卷王、用户、题源、设置和数据；子工具沿用所在分类。禁用功能的页面提供设置入口。

题目页、比赛页、个人主页的快捷操作复用相同面板。不要在用户名菜单末尾追加工具条目；`installMenu` 会移除旧版自有标记的分散条目，保留站点原生菜单。

## 功能位置

- `DEFAULTS` / `normalizeSettings` / `openSettings`：设置和模块开关。
- `remoteProblem` / `loadRemoteMeta`：题源与原站资料。`qojTitleOrigin` 仅识别当前题名中的独立 QOJ 编号。
- `openSemanticSearch` / `semanticRequest` / `parseSearchResults`：原题机 POST JSON 与 CPRet GET JSON（其中候选 HTML 仅在惰性模板内解析）。输入明确提交后才请求，不附带凭据；按站点显示排名，默认不改写查询或调用重排。两个接口为上游网站自身使用的接口，变更或失败时保留打开原站的入口。
- `selectSearchCandidate` / `configureOrigin`：候选进入可编辑的确认配置，保存前检查题目、账号与原有映射，防止旧结果覆盖新页面。搜索缓存仅在内存中保留最近八组查询。
- `LUOGU_DIFFICULTIES`：新版洛谷难度 0–8。`difficultyScale` 区分缓存和手动配置版本，旧手动设置按原颜色转换。
- `runWork` / `workRequest` / `listPages`：串行请求、取消与请求限额。
- `exportContestStatements` / `collectContestRecords`：比赛导出。
- `scanJuan`：练习统计与快照。
- `userStore` / `writeUserStore`：本地资料和 Rating；兼容存储键 `exhloj.coreui.*` 保持不变。
- `calculateUserRatings`：普通结算恢复现有分数并追加记录；时间轴成功后整体替换。算法见 [RATING.zh-CN.md](RATING.zh-CN.md)。
- `loadOIerDatabase` / `readOIerProfiles`：OIerDb 版本化数据读取。快捷导入使用本地拼音索引和人工确认队列。

资料与 Rating 分别校验；普通写入保留格式异常的原文，只有显式 JSON 修复可以替换异常部分。异步任务保存前比较相关快照，合并独立修改；账号、页面、表单或时间轴选择变化时停止相关保存。这些检查不构成跨标签页事务锁。

## 发布流程

主分支版本变更、版本标签或手动触发会运行 `release.yml`。工作流先完成全部检查，再使用同次运行的已校验产物创建对应 Release；已有版本不覆盖。

`release-notes.py` 从当前 CHANGELOG 条目生成安装指引和更新说明。发布页仅附安装脚本、离线安装包和校验值；开发者可使用 GitHub 的版本源码下载。源码包仍作为 CI 产物保留。

脚本更新地址固定为本仓库 `main/dist/exhloj.user.js`。更新保持脚本名称、命名空间和存储键一致。
