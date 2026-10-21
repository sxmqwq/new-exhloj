# 固定测试输入

- `captcha-real.json`：已有的 SVG 验证码样例，用于验证字形识别和折叠；不包含账号信息。
- `luogu-problem.response`：公开 P1001 响应中的题目字段及 `lentille-context` 容器。已去掉完整网页、CSRF 元素、会话上下文和其他无关数据。
- `cf-problems.response`：公开 Codeforces `problemset.problems` 响应的子集，仅保留测试用的 CF1A。
- `oier-paste-example.md`：用户提供的 24 条公开获奖记录示例，验证 Markdown、表格、小数分数、参赛年级和 ID 处理。

测试使用这些固定输入及代码内的模拟数据，不需要实时请求原站，也不读取本机真实浏览器的登录会话。
