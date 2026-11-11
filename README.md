# Extend HLOJ

为 HLOJ / Hydro 提供题源与难度、比赛工具、练习统计、个人资料和 Rating 的浏览器脚本。当前版本 **2.8.0**。

**[安装 / 更新脚本](https://raw.githubusercontent.com/sxmqwq/new-exhloj/main/dist/exhloj.user.js)** · **[下载与更新说明](https://github.com/sxmqwq/new-exhloj/releases/latest)** · [使用指南](docs/INSTALL.zh-CN.txt)

![Extend HLOJ 控制面板](docs/images/panel.png)

## 开始使用

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 点击上方的 **安装 / 更新脚本**，按浏览器提示完成安装。
3. 刷新 OJ，在用户名菜单中点击 **Extend HLOJ**。没有用户名菜单的页面会显示右下角入口。

所有工具集中在同一个面板中。升级现有脚本会沿用设置和本地资料，也可以在 **数据** 页面导出备份。

## 可以做什么

| 面板 | 功能 |
| --- | --- |
| 比赛 | 导出题面与附件、提交记录和 Ghost；检查报名、配置自动报名 |
| 卷王 | 汇总公开练习成绩，查看近期进度与快照变化 |
| 用户 | 管理本地资料、OIerDb 绑定、姓名显示和比赛 Rating |
| 题源 | 按题意搜索候选原题，查看原题链接、洛谷难度、翻译与题解 |
| 设置 | 界面增强、验证码识别、编辑器连接和模块开关 |
| 数据 | 备份与恢复设置、题源配置、用户资料和 Rating |

题目名称中的 `[QOJ18209]` 等标记可以自动识别为 QOJ 题源；洛谷难度按新版体系显示，包含青色“提高”。题目页的复制、CPH / CP Editor 和题源快捷按钮继续保留。

## 常用操作

**按题意找原题**：题目页 → 按题意搜索原题，或面板 → 题源 → 按题意搜索原题。编辑题面或简述，选择[原题机](https://yuantiji.ac/)和 / 或 [CPRet](https://cpret.online/)，点击开始搜索。两站的结果分别展示，支持展开同组候选；打开原题核对题意、限制和样例，点击 **核对并关联 → 确认并保存题源**。搜索和选择候选都不会自动覆盖已有题源。

搜索只在点击后发送输入框内容，不发送 OJ 账号或 Cookie。长题面建议先简述；CPRet 受查询长度和 2048 token 限制，原题机接受至多 16000 字符。单站失败不影响另一站，也可复制题意后打开检索网站。候选只在本次页面内缓存，确认的题源保存在本地；相似度不能代替人工判断，也不能跨网站比较。

**自动报名**：面板 → 比赛 → 自动报名设置。填写目标（例如 `pnoi/contest`），按需设置标题筛选，启用后保存。运行时保持 OJ 登录并开着一个 OJ 页面。

**OIerDb 导入**：面板 → 用户 → 编辑资料，粘贴选手主页链接。快捷导入可以从域排名页生成候选，由你确认后保存；已绑定资料可单人或批量刷新。

**比赛 Rating**：在比赛详情或榜单页点击 **加入 Rating 并结算**。普通结算接着已保存的分数计算，重复比赛自动跳过。**时间轴结算**可选择日期和比赛，从 1800 重新计算所选历史。[计算规则](docs/RATING.zh-CN.md)

用户资料、Rating 和设置保存在当前浏览器。读取榜单、原题和题解时使用当前账号可访问的数据。

## 下载

[最新发布页](https://github.com/sxmqwq/new-exhloj/releases/latest)提供安装脚本和离线安装包；一般直接安装 `.user.js` 即可。仓库的 `release/` 只保留当前版本安装包，历史改动见 [更新记录](CHANGELOG.md)。

## 开发

需要 Node.js 24 和 Python 3。源码位于 `src/`，安装脚本位于 `dist/`。

```bash
npm ci
npm run build
npm run check
```

构建、测试与目录说明见 [开发文档](docs/DEVELOPMENT.md)。遇到问题可提交 [Issue](https://github.com/sxmqwq/new-exhloj/issues)。

原版作者署名及参考来源见 [NOTICE.md](NOTICE.md)，第三方许可证见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。
