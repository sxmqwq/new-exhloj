# 来源说明

本项目按用户提供的 Extend HLOJ 1.16.1 的功能进行本地重制。原版作者署名 **Extend HLOJ Dev Team** 保留在脚本头部。

恢复范围为 core、ui、captcha、remote-problem、contest-helper、juan-monitor、user。代码不包含旧插件共享后端的服务实现，不使用其密码/token 通道。

本次源码整理保持 2.3.1 的业务逻辑和可安装脚本不变。没有在整理过程中为业务代码另行指定开源许可证。

第三方渲染器包含：

- marked 18.1.1
- DOMPurify 3.4.17
- KaTeX 0.18.10
- marked-katex-extension 5.1.13
- 打包代码中的 Babel / regenerator-runtime 辅助代码

这些第三方代码的版权和许可证随 `THIRD_PARTY_NOTICES.txt` 提供，并嵌入发布脚本。该文件不替代各组件原有的署名和授权。

参考页面布局和粘贴格式时核对了以下项目源码：

- [Hydro 的用户主页模板](https://github.com/hydro-dev/Hydro/blob/master/packages/ui-default/templates/user_detail.html)
- [OIerDb 的选手信息组件](https://github.com/OIerDb-ng/OIerDb/blob/master/apps/frontend-legacy/src/components/PersonInfo.tsx)
- [OIerDb 的年级换算](https://github.com/OIerDb-ng/OIerDb/blob/master/apps/frontend-legacy/src/utils/getGrade.ts)
