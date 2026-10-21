// ==UserScript==
// @name         Extend HLOJ
// @namespace    exhloj-local
// @version      2.3.2
// @description  core/ui/captcha/remote-problem/contest-helper/juan-monitor/user；本地重制，无旧后端依赖。
// @author       Extend HLOJ Dev Team (original); Local restoration
// @match        *://oj.hailiangedu.com/*
// @match        *://www.nfls.com.cn/*
// @match        *://oifha.com/*
// @match        *://*.oifha.com/*
// @run-at       document-end
// @noframes
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      127.0.0.1
// @connect      www.luogu.com.cn
// @connect      codeforces.com
// @connect      qoj.ac
// ==/UserScript==

/*
 * 安装：先停用旧 Extend HLOJ，再将本文件安装到 Tampermonkey，刷新 OJ。
 * 入口：右上角菜单的「Extend HLOJ」；油猴菜单亦可打开设置。
 * 范围：core 的设置、缓存导入导出、事件系统；ui 的圆角、作业、榜单、
 *       Markdown 复制、头像链接、权限查看、CPH / CP Editor；
 *       captcha 本地 SVG 识别；remote-problem 题源/难度/翻译/题解/导出；
 *       contest-helper 比赛导出与可选报名；juan-monitor 练习统计与本地快照；user 本地资料和 Rating。
 * 请求：当前 OJ 的页面 JSON（GET）；导出附件时 POST 获取下载链接，报名时 POST attend；
 *       自动报名默认关闭。保存头像及发送 CPH / CP Editor 时才执行对应 POST。题源模块只读取原站；
 *       验证码识别不联网、不自动提交登录；不访问原插件后端。
 *       user 仅按需 GET 榜单或用户名；资料编辑与 Rating 结算只保存到本地，无指定 UID 的管理员限制。
 * 缓存使用明文 JSON。旧版 AES 密文不在本版导入范围内；不读取旧 token/密码。
 * 此文件按原 1.16.1 的功能重制，内嵌 marked / DOMPurify / KaTeX 及 marked-katex-extension（第三方许可证随 ZIP 提供）；
 * 无远程依赖和远程更新地址。升级建议在油猴编辑器中替换现有脚本全文，以保留存储。
 * 若作为新脚本安装，请停用旧版，并按需导入之前的 JSON 备份。
 */

(() => {
  'use strict';
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  if (window.top !== window.self) return;
  if (!(location.hostname === 'oj.hailiangedu.com' ||
      location.host === 'www.nfls.com.cn:10611' || /(^|\.)oifha\.com$/.test(location.hostname))) return;
  if (document.documentElement.dataset.exhlojCoreUi) return;
  document.documentElement.dataset.exhlojCoreUi = '2.3.2';

  const VERSION = '2.3.2';
  const SETTINGS_KEY = 'exhloj.coreui.settings.v1';
  const CACHE_KEY = 'exhloj.coreui.cache.v1';
  const CAPTCHA_KEY = 'exhloj.local.captcha.history';
  const LIMIT = 2 * 1024 * 1024;
  const LEGACY_KEYS = ['exhloj.problemOriginCache', 'exhloj.juan', 'exhloj.enabledPlugins',
    'exhloj.weeklyRoundsData', 'exhloj.user', 'exhloj.userStoreVersion', 'exhloj.nfls', 'exhloj.remoteOrigins',
    'exhloj.ratedcontests', 'exhloj.ratedcontests.version', 'model.user.display-name', 'model.user.display-ccflevel'];
  const OPTIONS = {
    rounded: ['卡片圆角与布局', true], homework: ['作业标题与附件', true],
    scoreboard: ['榜单奖牌、标题链接与最早提交标记', true],
    markdown: ['复制题面 / 题解 Markdown', true], cph: ['发送样例到 CPH / CP Editor', true],
    avatar: ['头像链接设置入口', true], permissions: ['查看用户权限', true],
    cleanMenu: ['隐藏失效菜单链接', true],
  };
  const DEFAULTS = { ui: true, captcha: true, remote: true, contestHelper: true, juanMonitor: true,
    userModule: true, userDisplay: 'no-change', userCCF: false,
    helperDelay: 250, helperPageLimit: 100, helperRequestLimit: 2000, contestFiles: true, contestDetails: false,
    autoAttend: false, autoAttendInterval: 60, autoAttendTargets: '', autoAttendTitle: '', autoAttendRules: '',
    juanDomains: '', juanRecords: true, juanContests: true, juanHomeworks: true, juanPeriod: 7,
    captchaHide: true, captchaRemember: false,
    remoteAuto: true, remoteContest: 'hide', remoteColor: 'text', options: Object.fromEntries(
    Object.entries(OPTIONS).map(([key, value]) => [key, value[1]])), cphPort: 27121, editorPort: 10045 };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  function stored(key, fallback) {
    try {
      const value = GM_getValue(key, null);
      if (value === null || value === undefined) return clone(fallback);
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch { return clone(fallback); }
  }
  function save(key, value) { GM_setValue(key, JSON.stringify(value)); }
  function normalizeSettings(value) {
    if (!isObject(value)) throw new Error('设置必须是 JSON 对象');
    const result = clone(DEFAULTS);
    for (const key of ['ui', 'captcha', 'remote', 'captchaHide', 'captchaRemember', 'remoteAuto', 'contestHelper', 'juanMonitor',
      'contestFiles', 'contestDetails', 'autoAttend', 'juanRecords', 'juanContests', 'juanHomeworks', 'userModule', 'userCCF']) {
      if (typeof value[key] === 'boolean') result[key] = value[key];
    }
    if (['hide', 'shortcut', 'show'].includes(value.remoteContest)) result.remoteContest = value.remoteContest;
    if (['text', 'background', 'none'].includes(value.remoteColor)) result.remoteColor = value.remoteColor;
    if (['no-change', 'display-realname', 'display-realname-color', 'display-username', 'display-username-color', 'display-username-realname', 'display-username-realname-color'].includes(value.userDisplay)) result.userDisplay = value.userDisplay;
    for (const [key, min, max] of [['helperDelay', 100, 5000], ['helperPageLimit', 1, 1000], ['helperRequestLimit', 10, 10000], ['autoAttendInterval', 10, 86400]]) {
      if (value[key] === undefined) continue;
      if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) throw new Error(`${key} 必须是 ${min}–${max} 的整数`);
      result[key] = value[key];
    }
    for (const key of ['autoAttendTargets', 'autoAttendTitle', 'autoAttendRules', 'juanDomains']) {
      if (typeof value[key] === 'string') result[key] = value[key].trim().slice(0, 4000);
    }
    if (result.autoAttend) {
      if (!result.autoAttendTargets) throw new Error('启用自动报名时必须填写目标');
      for (const line of result.autoAttendTargets.split(/[\s,]+/).filter(Boolean)) {
        const [domain, kind, extra] = line.split('/'); domainList(domain);
        if (extra || !['contest', 'homework'].includes(kind)) throw new Error('报名目标格式应为 域ID/contest 或 域ID/homework');
      }
    }
    if ([0.25, 1, 3, 7, 30, 90, 365].includes(+value.juanPeriod)) result.juanPeriod = +value.juanPeriod;
    for (const key of Object.keys(OPTIONS)) {
      if (typeof value.options?.[key] === 'boolean') result.options[key] = value.options[key];
    }
    for (const key of ['cphPort', 'editorPort']) {
      if (value[key] === undefined) continue;
      if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > 65535) {
        throw new Error('端口必须是 1–65535 的整数');
      }
      result[key] = value[key];
    }
    return result;
  }
  let settings;
  try { settings = normalizeSettings(stored(SETTINGS_KEY, DEFAULTS)); }
  catch { settings = clone(DEFAULTS); }
  function enabled(key) { return settings.ui && settings.options[key]; }
  function ui() { return page.UiContext || {}; }
  function user() { return page.UserContext || {}; }
  function pageName() { return document.documentElement.dataset.page || ''; }
  function domainId() { return ui().domain?._id || location.pathname.match(/^\/d\/([^/]+)/)?.[1] || 'system'; }
  function translate(text) {
    try { return page.Hydro?.utils?.i18n?.(text) || text; } catch { return text; }
  }
  function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function button(text, action, attrs = {}) {
    return el('button', { type: 'button', class: 'button exhloj-local-button', 'data-exh-action': action, ...attrs }, text);
  }
  function notify(message, error = false) {
    console[error ? 'warn' : 'info']('[Extend HLOJ]', message);
    let box = $('#exhloj-local-toast');
    if (!box) { box = el('div', { id: 'exhloj-local-toast', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
    box.textContent = message;
    box.dataset.error = String(error);
    box.hidden = false;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => { box.hidden = true; }, 4500);
  }
  async function task(work) {
    try { return await work(); } catch (error) { notify(error.message || String(error), true); }
  }

  // 每个事件的最近一次广播可被后注册的模块接收；无监听器时也可安全广播。
  const listeners = new Map(), lastEvents = new Map(), models = new Map();
  function broadcast(name, value) {
    lastEvents.set(name, value);
    for (const fn of listeners.get(name) || []) Promise.resolve().then(() => fn(value)).catch(console.error);
  }
  function on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    if (lastEvents.has(name)) Promise.resolve().then(() => fn(lastEvents.get(name))).catch(console.error);
    return () => listeners.get(name)?.delete(fn);
  }
  const core = Object.freeze({ version: VERSION, getDomainId: domainId, pageName,
    getUserId: () => user()._id || 0, broadcast, on,
    inject(name, value) { if (!models.has(name)) models.set(name, []); models.get(name).push(value); },
    getModel: name => [...(models.get(name) || [])],
    getTimeByObjectId: id => /^[\da-f]{24}$/i.test(String(id)) ? new Date(parseInt(id.slice(0, 8), 16) * 1000) : null,
  });

  const baseStyle = el('style', { id: 'exhloj-local-style' });
  baseStyle.textContent = `
    #exhloj-local-toast{position:fixed;bottom:25px;left:50%;transform:translateX(-50%);z-index:2147483647;
      background:#234537;color:white;padding:12px 20px;border-radius:8px;max-width:90vw;box-shadow:0 4px 20px #0003}
    #exhloj-local-toast[data-error="true"]{background:#842d2d}
    #exhloj-local-dialog{color:#263445;background:#fff;border:1px solid #c7d0d9;border-radius:12px;
      width:min(720px,92vw);max-height:85vh;padding:0;box-shadow:0 10px 50px #0004}
    #exhloj-local-dialog::backdrop{background:#0006}
    #exhloj-local-dialog header{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid #ddd}
    #exhloj-local-dialog h2{margin:0;font-size:21px}#exhloj-local-dialog h3{margin:20px 0 10px}
    #exhloj-local-dialog .exhloj-dialog-body{padding:5px 22px 22px;overflow:auto;max-height:65vh;font-size:14px;line-height:1.7}
    #exhloj-local-dialog label{display:block;margin:9px 0}#exhloj-local-dialog input[type=checkbox]{margin-right:9px}
    #exhloj-local-dialog textarea{box-sizing:border-box;width:100%;height:150px;font:12px/1.6 monospace;color:#263445;background:#f7f9fb}
    #exhloj-local-dialog input[type=number]{width:90px;color:#263445;background:white;border:1px solid #aaa;padding:3px}
    #exhloj-local-dialog summary{cursor:pointer}#exhloj-local-dialog pre{white-space:pre-wrap;overflow-wrap:anywhere}
    #exhloj-local-dialog table{border-collapse:collapse;width:100%}#exhloj-local-dialog td,#exhloj-local-dialog th{padding:6px;text-align:left;border-bottom:1px solid #ddd}
    .exhloj-local-button{cursor:pointer;margin:4px 8px 4px 0;padding:6px 12px}
    .exhloj-local-toolbar{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:10px 0}
    .exhloj-local-medal{font-size:1.25em;vertical-align:middle}
    .exhloj-local-earliest{background-color:rgb(217,240,199)!important}
    [data-exh-fallback]{position:fixed;right:16px;bottom:18px;z-index:9999}
    html.exhloj-local-rounded .section{border-radius:8px!important}
    html.exhloj-local-rounded .section__table-header{border-radius:8px 8px 0 0}
    html.exhloj-local-rounded .contest-sidebar__bg,html.exhloj-local-rounded .profile-header.user-profile-bg{border-radius:8px}
    html.exhloj-local-rounded :is(.search>button,.search>input,.widget--category-filter__tag,button.button,input.textbox,ol.menu.dropdown-target,select.select){border-radius:5px}
    html.exhloj-local-rounded div.dialog__content{border-radius:10px}
    html.exhloj-local-ui :is(.page--contest_scoreboard,.page--homework_scoreboard) .col--user{min-width:15rem}
    html.exhloj-local-ui .page--homework_detail .col--size{width:100px}
    html.exhloj-local-ui .contest-type--codeforces .contest-type-tag{background:#ffa646}
    .exhloj-captcha-tools{font-size:13px;line-height:1.7;margin:6px 0}
    [data-exhloj-captcha-folded]{display:none!important}
    .exhloj-remote-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:10px 0}
    .exhloj-remote-tools a,.exhloj-remote-chip{display:inline-block;padding:4px 9px;border-radius:5px;background:#f0f4f8;color:#245173}
    .exhloj-remote-status{font-size:12px;opacity:.8;flex-basis:100%;overflow-wrap:anywhere}
    .exhloj-remote-article{margin:12px 0;padding:16px;border:1px solid #d8e0e8;border-radius:8px;overflow-wrap:anywhere}
    .exhloj-remote-article pre{overflow:auto;white-space:pre}.exhloj-remote-article img{max-width:100%}
    .exhloj-work-progress{padding:8px 12px;background:#eef5fb;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere}
    .exhloj-work-results{overflow:auto;max-height:45vh}.exhloj-work-results table{min-width:500px}
    .exhloj-work-errors{color:#9a3939;white-space:pre-wrap;max-height:150px;overflow:auto}
    #exhloj-local-dialog .exhloj-remote-article textarea{height:180px}
    #exhloj-local-dialog input[type=text],#exhloj-local-dialog select{box-sizing:border-box;max-width:100%;padding:5px 8px;border:1px solid #b5bfca;background:#fff;color:#263445}
    #exhloj-local-dialog .exhloj-source-input{width:100%}
    .exhloj-user-name,.exhloj-user-rating{font-weight:700}
    .exhloj-user-level-1{color:grey!important}.exhloj-user-level-2{color:green!important}.exhloj-user-level-3{color:#03a89e!important}
    .exhloj-user-level-4{color:#00f!important}.exhloj-user-level-5{color:#a0a!important}.exhloj-user-level-6{color:#ff8c00!important}
    :is(.exhloj-user-level-7,.exhloj-user-level-8,.exhloj-user-level-9,.exhloj-user-level-10){color:red!important}.exhloj-user-level-teacher{color:#000!important}
    .exhloj-user-ccf{display:inline-flex;width:1em;height:1em;margin-inline-start:.25em;vertical-align:-.125em;line-height:1;white-space:nowrap}
    .exhloj-user-ccf>svg{display:block;width:100%;height:100%;fill:currentColor}
    .exhloj-user-ccf-green{color:#5eb95e}.exhloj-user-ccf-blue{color:#3498db}.exhloj-user-ccf-gold{color:#f1c40f}
    .exhloj-user-gain{color:green}.exhloj-user-loss{color:#c33}.exhloj-user-data{display:grid;grid-template-columns:auto 1fr;gap:4px 12px}
    .exhloj-user-data dt,.exhloj-user-data dd{margin:0;overflow-wrap:anywhere}#exhloj-local-user-card{padding:12px}
    [data-exh-user-column]{text-align:center;white-space:nowrap}#exhloj-user-commands,#exhloj-user-json{height:230px!important}
  `;
  document.head.append(baseStyle);

  function modal(title) {
    $('#exhloj-local-dialog')?.close();
    $('#exhloj-local-dialog')?.remove();
    const dialog = el('dialog', { id: 'exhloj-local-dialog', 'aria-label': title });
    const header = el('header');
    const close = button('关闭', 'close');
    header.append(el('h2', {}, title), close);
    const body = el('div', { class: 'exhloj-dialog-body' });
    dialog.append(header, body); document.body.append(dialog);
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.showModal();
    return body;
  }
  function download(name, content, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = el('a', { href: url, download: name });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function validateCache(value) {
    if (!isObject(value)) throw new Error('缓存必须是 JSON 对象');
    const safe = {};
    for (const key of LEGACY_KEYS) if (Object.hasOwn(value, key)) safe[key] = value[key];
    return safe;
  }
  function exportData() {
    return { format: 'exhloj', schemaVersion: 1, version: VERSION,
      exportedAt: new Date().toISOString(), settings, cache: validateCache(stored(CACHE_KEY, {})) };
  }
  function importData(text) {
    if (new Blob([text]).size > LIMIT) throw new Error('导入文件超过 2 MiB');
    const data = JSON.parse(text);
    if (!isObject(data)) throw new Error('无效的 JSON 对象');
    let nextSettings = settings, cache;
    if (['exhloj', 'exhloj-core-ui'].includes(data.format)) {
      if (data.schemaVersion !== 1) throw new Error('不支持的备份版本');
      nextSettings = normalizeSettings(data.settings);
      cache = validateCache(data.cache);
    } else {
      cache = validateCache(data);
      if (Object.keys(cache).length === 0) throw new Error('没有找到可导入的旧版缓存字段');
    }
    if (data.settings?.userDisplay === undefined && typeof cache['model.user.display-name'] === 'string') nextSettings = normalizeSettings({ ...nextSettings, userDisplay: cache['model.user.display-name'] });
    if (data.settings?.userCCF === undefined && typeof cache['model.user.display-ccflevel'] === 'boolean') nextSettings = normalizeSettings({ ...nextSettings, userCCF: cache['model.user.display-ccflevel'] });
    // 先完整校验，再写入；模块仅使用已恢复的本地字段。
    const merged = { ...validateCache(stored(CACHE_KEY, {})), ...cache };
    const oldSettings = settings, oldCache = stored(CACHE_KEY, {});
    try { save(CACHE_KEY, merged); save(SETTINGS_KEY, nextSettings); }
    catch (error) { try { save(CACHE_KEY, oldCache); save(SETTINGS_KEY, oldSettings); } catch {} throw error; }
    settings = nextSettings;
    refresh();
  }
  function openSettings() {
    const body = modal(`Extend HLOJ ${VERSION}`);
    body.append(el('p', {}, '模块：core / ui / captcha / remote-problem / contest-helper / juan-monitor / user。core 始终启用。'));
    const coreLabel = el('label'), coreInput = el('input', { type: 'checkbox', disabled: '' });
    coreInput.checked = true; coreLabel.append(coreInput, 'core — 设置、缓存与事件系统'); body.append(coreLabel);
    const form = el('form', { id: 'exhloj-local-settings' });
    const moduleLabel = el('label');
    const moduleInput = el('input', { type: 'checkbox', name: 'ui' }); moduleInput.checked = settings.ui;
    moduleLabel.append(moduleInput, 'ui — 界面增强'); form.append(moduleLabel);
    for (const [key, [text]] of Object.entries(OPTIONS)) {
      const label = el('label'), input = el('input', { type: 'checkbox', name: key });
      input.checked = settings.options[key]; label.append(input, text); form.append(label);
    }
    for (const [key, text] of [['cphPort', 'CPH 端口'], ['editorPort', 'CP Editor 端口']]) {
      const label = el('label');
      label.append(text + ' ', el('input', { type: 'number', min: 1, max: 65535, name: key, value: settings[key], required: true }));
      form.append(label);
    }
    for (const [key, text] of [['captcha', 'captcha — 本地验证码识别'], ['captchaHide', '识别成功后折叠验证码'],
      ['captchaRemember', '识别成功后勾选“记住我”'], ['remote', 'remote-problem — 题源与题解工具'],
      ['remoteAuto', '自动读取已识别题目的难度（缓存 24 小时）'],
      ['contestHelper', 'contest-helper — 比赛助手'], ['juanMonitor', 'juan-monitor — 卷王监视器'], ['userModule', 'user — 本地用户资料与 Rating']]) {
      const label = el('label'), input = el('input', { type: 'checkbox', name: key });
      input.checked = settings[key]; label.append(input, text); form.append(label);
    }
    for (const [key, text, choices] of [
      ['remoteContest', '比赛页面题源', [['hide', '隐藏'], ['shortcut', '按 Ctrl+Q 显示'], ['show', '显示']]],
      ['remoteColor', '难度颜色', [['text', '文字颜色'], ['background', '背景颜色'], ['none', '不着色']]]]) {
      const label = el('label', {}, text + ' '), select = el('select', { name: key });
      for (const [value, title] of choices) select.append(el('option', { value }, title));
      select.value = settings[key]; label.append(select); form.append(label);
    }
    const advanced = el('details'); advanced.append(el('summary', {}, '比赛助手 / 监视器参数'));
    for (const [key, title, min, max] of [['helperDelay', '请求间隔（毫秒）', 100, 5000], ['helperPageLimit', '每类列表最多页数', 1, 1000], ['helperRequestLimit', '单次任务最多请求数', 10, 10000], ['autoAttendInterval', '自动报名检查间隔（秒）', 10, 86400]]) {
      const label = el('label', {}, title + ' '); label.append(el('input', { type: 'number', name: key, value: settings[key], min, max, required: true })); advanced.append(label);
    }
    for (const [key, title] of [['autoAttend', '启用自动报名（只处理下方明确配置的目标）']]) {
      const label = el('label'), input = el('input', { type: 'checkbox', name: key }); input.checked = settings[key]; label.append(input, title); advanced.append(label);
    }
    for (const [key, title, placeholder] of [['autoAttendTargets', '报名目标，每行 域ID/contest 或 域ID/homework', 'system/contest'], ['autoAttendTitle', '标题必须包含（留空不限）', ''], ['autoAttendRules', '允许的赛制，逗号分隔（留空不限）', 'oi,acm']]) {
      const label = el('label', {}, title); const input = el('input', { type: 'text', class: 'exhloj-source-input', name: key, value: settings[key], placeholder });
      if (key === 'autoAttendTargets') { const field = el('textarea', { name: key, placeholder }); field.value = settings[key]; label.append(field); } else label.append(input);
      advanced.append(label);
    }
    advanced.append(el('p', {}, '自动报名默认关闭。手动检查和报名入口在比赛助手中；筛选条件为普通文本，不执行脚本。'));
    form.append(advanced, button('保存设置', 'save-settings'), button('刷新页面', 'reload'));
    body.append(form, el('h3', {}, '缓存与备份'));
    body.append(button('验证码识别记录', 'captcha-history'));
    const remoteRow = el('div');
    remoteRow.append(el('input', { id: 'exhloj-luogu-id', type: 'text', placeholder: '洛谷题号，例如 P1001', 'aria-label': '洛谷题号' }), button('打开洛谷工具', 'luogu-tool'));
    body.append(remoteRow);
    body.append(button('比赛助手', 'contest-helper'), button('卷王监视器', 'juan-open'), button('用户工具', 'user-open'));
    body.append(el('p', {}, '导出为明文 JSON。可导入本版备份或旧版缓存 JSON；不会导入密码、token。旧版 AES 密文暂不支持。'));
    body.append(button('导出设置和缓存', 'export'), button('读取旧版缓存（同一脚本存储）', 'legacy'));
    body.append(el('p', {}, '作为新脚本安装时无法访问另一脚本的油猴存储；旧缓存需要从旧版导出。保留的其他模块缓存不会恢复其服务器功能。'));
    body.append(el('input', { type: 'file', accept: '.json,application/json', id: 'exhloj-local-import-file', 'aria-label': '选择 JSON 备份' }));
    body.append(el('textarea', { id: 'exhloj-local-import', placeholder: '在此粘贴 JSON 备份', 'aria-label': '导入 JSON' }));
    body.append(button('导入 JSON', 'import'), button('查看缓存', 'view-cache'));
    const details = el('details'); details.append(el('summary', {}, '功能范围与故障信息'));
    details.append(el('p', {}, '页面资料按需读取当前 OJ 的 JSON 接口。复制和榜单处理不访问第三方服务。CPH / CP Editor 只在点击后连接 localhost。'));
    details.append(el('p', {}, 'captcha 复用原版字形表，无法识别时保留手动输入，不自动登录。题源工具使用本地映射与原站公开页面；题解读取受原站登录与访问权限限制。原站故障时仍可打开题源链接。'));
    details.append(el('p', {}, '榜单绿色表示当前页面可见记录中按 ObjectId 时间判断的最早提交（秒级，同秒并列），不代表全站首个 AC。头像只有点击保存时才更新。'));
    details.append(el('pre', {}, JSON.stringify({ version: VERSION, page: pageName(), domain: domainId(),
      hasUiContext: !!page.UiContext, hasHydro: !!page.Hydro, lastPageError }, null, 2)));
    body.append(details);
  }

  async function copyText(text) {
    if (typeof text !== 'string' || !text.length) throw new Error('未找到可复制的原始 Markdown');
    try { await navigator.clipboard.writeText(text); }
    catch {
      const area = el('textarea', { readonly: '', style: 'position:fixed;left:-10000px;top:0' }); area.value = text;
      document.body.append(area); area.select();
      const ok = document.execCommand('copy'); area.remove();
      if (!ok) {
        const body = modal('复制 Markdown');
        const field = el('textarea', { 'aria-label': 'Markdown 原文' }); field.value = text; body.append(field);
        field.focus(); field.select();
        notify('浏览器拒绝自动复制，请按 Ctrl+C'); return;
      }
    }
    notify('已复制 Markdown');
  }
  function markdownContent(content) {
    if (typeof content !== 'string') {
      if (isObject(content)) return content.zh || content['zh-CN'] || Object.values(content).find(v => typeof v === 'string') || '';
      return '';
    }
    try { const parsed = JSON.parse(content); if (isObject(parsed)) return markdownContent(parsed); } catch {}
    return content;
  }

  let route = location.href, routeEpoch = 0, contextBody = {}, pageRequest, lastPageError = '';
  function current(name) { return contextBody[name] ?? ui()[name]; }
  async function requestJSON(path = location.href, options = {}) {
    const url = new URL(path, location.href);
    if (url.origin !== location.origin) throw new Error('只允许请求当前 OJ');
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 12000);
    const cancel = () => abort.abort();
    if (options.signal?.aborted) cancel();
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      const response = await fetch(url.href, { credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        ...options, signal: abort.signal, headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...options.headers } });
      if (!response.ok) throw new Error(`OJ 接口返回 HTTP ${response.status}`);
      const body = await response.json();
      if (!isObject(body) || body.error) throw new Error(body.error?.message || 'OJ 返回了无效页面数据');
      return body;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(options.signal?.aborted ? '任务已取消' : 'OJ 接口请求超时');
      if (error instanceof SyntaxError) throw new Error('OJ 没有返回 JSON；请检查登录状态或站点版本');
      throw error;
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
  }
  async function loadPage() {
    if (!pageRequest) {
      const epoch = routeEpoch;
      pageRequest = requestJSON().then(body => {
        if (epoch !== routeEpoch) throw new Error('页面已切换，请在新页面重试');
        contextBody = body; lastPageError = ''; return body;
      }).catch(error => { if (epoch === routeEpoch) lastPageError = error.message; throw error; });
    }
    return pageRequest;
  }

  function installMenu() {
    const menu = $('#menu-nav-user');
    if (menu && !$('.exhloj-local-menu', menu)) {
      const li = el('li', { class: 'menu__item exhloj-local-menu' });
      const link = el('a', { class: 'menu__link', href: '#exhloj-settings', 'data-exh-action': 'settings' }, '⚙ Extend HLOJ');
      li.append(link);
      const anchor = $$('li', menu).find(item => $('a', item)?.getAttribute('href')?.replace(/\/$/, '').endsWith('/file'));
      if (anchor) anchor.after(li); else menu.append(li);
      broadcast('menu.open');
    }
    if (menu) $('[data-exh-fallback]')?.remove();
    if (!menu && !$('[data-exh-fallback]')) {
      const fallback = button('Extend HLOJ', 'settings', { 'data-exh-fallback': '' }); document.body.append(fallback);
    }
    if (enabled('cleanMenu') && menu) {
      for (const link of $$('a[href]', menu)) {
        if ((link.getAttribute('href') || '').includes('Error: No route found for name:')) link.closest('li')?.remove();
      }
    }
    installWorkMenu(menu);
  }
  function niceSize(value) {
    const size = Number(value);
    if (!Number.isFinite(size) || size < 0) return '—';
    if (size < 1024) return `${size} B`;
    const n = Math.min(3, Math.floor(Math.log(size) / Math.log(1024)));
    return `${(size / 1024 ** n).toFixed(1)} ${['B', 'KiB', 'MiB', 'GiB'][n]}`;
  }
  let homeworkStarted = false, recordStarted = false, solutionStarted = false;
  function mainColumn() { return $('.main .medium-9.columns, .medium-9.columns, main, .main'); }
  function profilePanelTarget() {
    const primary = $('.main .medium-9.columns') || $('.medium-9.columns') || mainColumn(), row = primary?.parentElement;
    if (row?.classList.contains('row')) {
      const sidebar = [...row.children].find(node => node.matches('.medium-3.columns'));
      if (sidebar) return sidebar;
      if (primary.matches('.medium-9.columns')) { const aside = el('aside', { class: 'medium-3 columns', 'data-exh-profile-sidebar': '' }); row.append(aside); return aside; }
    }
    return primary;
  }
  async function homework() {
    if (homeworkStarted || !mainColumn()) return;
    homeworkStarted = true;
    const epoch = routeEpoch;
    try {
      let tdoc = current('tdoc');
      if (!tdoc || !Object.hasOwn(tdoc, 'files')) { await loadPage(); tdoc = current('tdoc'); }
      if (epoch !== routeEpoch || !enabled('homework') || !tdoc) return;
      const heading = $('.medium-9.columns > .section:first-child .section__header h1, .medium-9.columns h1, main h1');
      const title = `${translate('Homework Introduction')} - ${tdoc.title || ''}`;
      if (heading && heading.textContent !== title) heading.textContent = title;
      if (Array.isArray(tdoc.files) && tdoc.files.length && !$('#exhloj-local-homework-files')) {
        // 有原生附件表时不再重复插入。
        if (!$('[data-fragment-id="files"]', mainColumn())) {
          const section = el('div', { class: 'section visible', id: 'exhloj-local-homework-files' });
          const header = el('div', { class: 'section__header' }); header.append(el('h1', { class: 'section__title' }, translate('Files')));
          const body = el('div', { class: 'section__body no-padding files' }), table = el('table', { class: 'data-table' });
          const head = el('thead'), tr = el('tr');
          tr.append(el('th', {}, translate('Filename')), el('th', {}, translate('Size'))); head.append(tr); table.append(head);
          const tbody = el('tbody');
          for (const file of tdoc.files) {
            if (!file || typeof file.name !== 'string') continue;
            const row = el('tr'), name = el('td', { class: 'col--name' });
            const id = tdoc._id || tdoc.docId;
            if (!id) continue;
            const href = `/d/${encodeURIComponent(domainId())}/homework/${encodeURIComponent(id)}/file/${encodeURIComponent(file.name)}`;
            name.append(el('a', { href }, file.name)); row.append(name, el('td', { class: 'col--size' }, niceSize(file.size))); tbody.append(row);
          }
          table.append(tbody); body.append(table); section.append(header, body); mainColumn().append(section);
        }
      }
      broadcast('homework_detail.prepare', tdoc);
    } catch (error) { if (epoch === routeEpoch) notify(`作业增强：${error.message}`, true); }
  }
  function scoreboard() {
    for (const rank of $$('td.col--rank')) {
      const text = rank.textContent.trim();
      if (/^[123]$/.test(text)) {
        const medal = el('span', { class: 'exhloj-local-medal', title: `第 ${text} 名`, 'aria-label': `第 ${text} 名` }, ['', '🥇', '🥈', '🥉'][+text]);
        rank.replaceChildren(medal);
      }
    }
    const title = $('h2.text-center');
    if (title && !$('a', title) && /\/scoreboard\/?$/.test(location.pathname)) {
      const link = el('a', { href: location.pathname.replace(/\/scoreboard\/?$/, '') }, title.textContent);
      title.replaceChildren(link);
    }
    if (pageName() !== 'homework_scoreboard') return;
    for (const table of $$('.section__table-container > .data-table, table[data-exh-scoreboard]')) {
      const first = new Map(), winners = new Set();
      for (const row of $$('tbody > tr', table)) {
        [...row.children].forEach((cell, index) => {
          if (!cell.matches('td.col--problem')) return;
          const text = cell.textContent.trim();
          if (!text || text.split('\n')[0].includes('-')) return;
          const id = $('a[href*="/record/"]', cell)?.getAttribute('href')?.match(/\/record\/([\da-f]{24})(?:[/?#]|$)/i)?.[1];
          if (!id) return;
          const time = parseInt(id.slice(0, 8), 16);
          if (!first.has(index) || time < first.get(index).time) first.set(index, { time, cells: [cell] });
          else if (time === first.get(index).time) first.get(index).cells.push(cell);
        });
      }
      for (const { cells } of first.values()) for (const cell of cells) winners.add(cell);
      for (const cell of $$('td.col--problem', table)) {
        const wanted = winners.has(cell);
        if (cell.classList.contains('exhloj-local-earliest') !== wanted) cell.classList.toggle('exhloj-local-earliest', wanted);
        if (wanted && !$('.exhloj-local-earliest-label', cell)) {
          cell.dataset.exhEarliest = '1';
          cell.append(el('span', { class: 'exhloj-local-earliest-label', title: '本页可见记录中的最早提交（秒级，同秒并列）；不保证为 AC', 'aria-label': '本页最早提交' }, ' ◷'));
        } else if (!wanted && cell.dataset.exhEarliest) {
          delete cell.dataset.exhEarliest; $('.exhloj-local-earliest-label', cell)?.remove();
        }
      }
    }
  }

  function problemToolbar() {
    if ($('#exhloj-local-problem-tools')) return;
    const target = $('div.section__body > ul.problem__tags:first-child, .problem__tags');
    const container = target?.parentElement || mainColumn();
    if (!container) return;
    const tools = el('div', { id: 'exhloj-local-problem-tools', class: 'exhloj-local-toolbar' });
    if (enabled('markdown')) tools.append(button('复制题面 Markdown', 'problem-copy'));
    if (enabled('cph')) tools.append(button('发送到 CPH', 'cph'), button('发送到 CP Editor', 'editor'));
    if (tools.children.length) { if (target) target.after(tools); else container.prepend(tools); }
  }
  async function problemDocument(needConfig = false) {
    if (!current('pdoc')?.content || (needConfig && !current('pdoc')?.config)) await loadPage();
    const pdoc = current('pdoc');
    if (!pdoc) throw new Error('页面未提供题目资料');
    return pdoc;
  }
  function samples() {
    const result = [];
    for (const input of $$('code[class*="language-input"]')) {
      const suffix = [...input.classList].find(c => /^language-input\d*$/.test(c))?.replace('language-input', '');
      if (suffix === undefined) continue;
      const output = $(`code.language-output${suffix}`);
      if (output) result.push({ input: input.textContent, output: output.textContent });
    }
    if (!result.length) {
      const inputs = $$('.sample .input pre, .sample-input pre');
      const outputs = $$('.sample .output pre, .sample-output pre');
      inputs.forEach((input, i) => { if (outputs[i]) result.push({ input: input.textContent, output: outputs[i].textContent }); });
    }
    return result;
  }
  async function cphPayload() {
    const pdoc = await problemDocument(true), config = isObject(pdoc.config) ? pdoc.config : {};
    const tdoc = current('tdoc');
    const oj = location.hostname === 'oj.hailiangedu.com' ? 'HLOJ' : location.hostname.includes('nfls') ? 'NFLSOJ' : 'OIFHA';
    const subType = typeof config.subType === 'string' ? config.subType : '';
    const fileBase = /^[\w.-]+$/.test(subType) ? subType : '';
    const problemId = pdoc._id || pdoc.docId || pdoc.pid || location.pathname;
    return { name: pdoc.title || document.title, group: oj + (tdoc?.title ? ` - ${tdoc.title}` : ''),
      url: location.href, interactive: config.type === 'interactive',
      memoryLimit: Number(config.memoryMax ?? config.memoryLimit) || 256,
      timeLimit: Number(config.timeMax ?? config.timeLimit) || 1000,
      tests: samples(), testType: 'single', input: fileBase ? { type: 'file', fileName: `${fileBase}.in` } : { type: 'stdin' },
      output: fileBase ? { type: 'file', fileName: `${fileBase}.out` } : { type: 'stdout' }, languages: {},
      // 每次点击只发送一道题，所以接收端的批次大小也必须是 1。
      batch: { id: `${oj}/${domainId()}/${problemId}/${Date.now()}`, size: 1 } };
  }
  function sendLocal(port, payload) {
    return new Promise((resolve, reject) => {
      let finished = false;
      const fail = message => { if (!finished) { finished = true; reject(new Error(message)); } };
      const timer = setTimeout(() => fail(`本机 ${port} 端口连接超时`), 6000);
      const done = fn => value => { if (finished) return; clearTimeout(timer); fn(value); };
      try {
        GM_xmlhttpRequest({ method: 'POST', url: `http://localhost:${port}/`, timeout: 5000,
          headers: { 'Content-Type': 'application/json' }, data: JSON.stringify(payload),
          onload: done(response => { if ([200, 201, 202, 204].includes(response.status)) { finished = true; resolve(); }
            else fail(`本机接收端返回 HTTP ${response.status}`); }),
          onerror: done(() => fail(`无法连接 localhost:${port}，请先启动对应扩展并允许本机连接`)),
          ontimeout: done(() => fail(`本机 ${port} 端口连接超时`)), onabort: done(() => fail('本机请求已取消')) });
      } catch (error) { clearTimeout(timer); fail(error.message); }
    });
  }

  async function solutionTools() {
    if (solutionStarted) return;
    const entries = $$('ul.dczcomments__list.view--solution > li.dczcomments__item > div.media, .solution-section .media');
    if (!entries.length) return;
    solutionStarted = true;
    // 原文在点击时才读取，初次打开题解页不额外抓取内容。
    for (const entry of entries) {
      if (!$('.typo.richmedia', entry) || $('[data-exh-action="solution-copy"]', entry)) continue;
      const raw = $('[data-raw-url]', entry)?.getAttribute('data-raw-url') || '';
      const id = entry.closest('[data-doc-id]')?.getAttribute('data-doc-id') || raw.replace(/\/raw\/?$/, '').split('/').pop() || '';
      const tool = button('复制 Markdown', 'solution-copy', { 'data-solution-id': id });
      ($('.media__left.top', entry) || entry).append(tool);
    }
    solutionStarted = false;
  }
  async function copySolution(control) {
    const id = control.dataset.solutionId;
    let docs = current('psdocs');
    if (!Array.isArray(docs)) { await loadPage(); docs = current('psdocs'); }
    const doc = docs?.find(item => String(item._id ?? item.docId) === id);
    if (!doc || typeof doc.content !== 'string') throw new Error('没有找到这篇题解的 Markdown（可能没有查看权限）');
    await copyText(doc.content);
  }

  function avatarTools() {
    if ($('#exhloj-local-avatar')) return;
    const target = $('.main .medium-10.columns > .section:first-child, .main .section, main');
    if (!target) return;
    const section = el('div', { id: 'exhloj-local-avatar', class: 'section__body typo' });
    section.append(el('h3', {}, '链接头像'), el('p', {}, '填入图片的 HTTP(S) 链接，或“我的文件”中的 /file/... 路径。点击保存后更新 OJ 头像。'));
    const label = el('label', {}, '图片链接');
    label.append(el('input', { class: 'textbox', type: 'text', name: 'exhloj-local-avatar-url', placeholder: `/file/${user()._id || ''}/avatar.png` }));
    section.append(label, button('保存头像', 'avatar-save')); target.append(section);
  }
  async function saveAvatar() {
    const input = $('[name="exhloj-local-avatar-url"]');
    const value = input?.value.trim();
    if (!value) throw new Error('请填写头像链接');
    const url = new URL(value, location.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('头像必须是普通 HTTP(S) 链接');
    const payload = { avatar: `url:${url.href}` };
    const csrf = $('input[name="_csrf"]')?.value || $('meta[name="csrf-token"]')?.content;
    if (csrf) payload._csrf = csrf;
    const body = await requestJSON('/home/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!body.url) throw new Error('服务器未确认头像更新，请检查链接或站点兼容性');
    notify('头像已更新，刷新页面查看');
  }

  // captcha: 原 1.16.1 的 137 个字形特征；只识别本机页面已有的 SVG。
  const CAPTCHA_GLYPHS = {"986":["I","l"],"998":["1"],"1068":["I","l"],"1081":["1"],"1082":["v"],"1130":["Y"],"1134":["Y"],"1172":["v"],"1224":["Y"],"1274":["L","y"],"1298":["V"],"1311":["V"],"1360":["i"],"1380":["L","y"],"1406":["V"],"1473":["i"],"1478":["T"],"1491":["r"],"1598":["N","X"],"1601":["T"],"1604":["X"],"1610":["J","x"],"1613":["x"],"1614":["N"],"1615":["r","N"],"1616":["N"],"1617":["N"],"1618":["N"],"1634":["k"],"1637":["k"],"1694":["z","t"],"1706":["K"],"1709":["K"],"1731":["X","N"],"1744":["x","J"],"1754":["F"],"1770":["k"],"1835":["z","t"],"1838":["u"],"1840":["A"],"1844":["A"],"1848":["K"],"1850":["Z"],"1853":["Z"],"1886":["h"],"1900":["F"],"1922":["H"],"1928":["H"],"1960":["P"],"1991":["u"],"1993":["A"],"1996":["D"],"2004":["Z"],"2018":["w"],"2035":["w"],"2042":["7"],"2043":["h"],"2080":["j"],"2082":["H"],"2104":["R"],"2107":["R"],"2123":["P"],"2140":["4"],"2162":["D"],"2164":["O"],"2183":["w"],"2198":["n","C"],"2199":["C"],"2200":["C"],"2201":["C"],"2202":["C"],"2210":["f"],"2212":["7"],"2246":["E"],"2253":["j"],"2260":["o"],"2272":["d"],"2279":["R","M"],"2282":["M"],"2294":["U"],"2301":["U"],"2310":["W"],"2318":["4","W"],"2321":["M"],"2332":["a"],"2344":["O"],"2345":["W"],"2346":["W"],"2366":["s"],"2380":["b"],"2381":["n","C"],"2382":["0"],"2394":["f"],"2433":["E"],"2448":["o"],"2461":["d"],"2464":["p"],"2466":["M"],"2485":["U"],"2498":["c"],"2501":["e"],"2503":["W"],"2512":["q"],"2526":["a"],"2546":["2"],"2563":["s"],"2578":["b"],"2580":["0"],"2606":["5"],"2632":["6"],"2669":["p"],"2706":["c"],"2709":["e"],"2721":["q"],"2758":["2"],"2800":["9"],"2823":["5"],"2851":["6"],"3033":["9"],"3038":["S"],"3054":["B"],"3160":["g"],"3244":["Q"],"3254":["Q"],"3266":["G"],"3291":["S"],"3308":["B"],"3414":["8"],"3423":["g"],"3514":["Q"],"3538":["G"],"3663":["m"],"3667":["m"],"3698":["8"],"3878":["3"],"3968":["m"],"4201":["3"]};
  const CAPTCHA_RULES = {
    986: ['minY', 13, 'I', 'l'], 1068: ['minY', 13, 'I', 'l'],
    1274: ['moveY', 30, 'y', 'L'], 1380: ['moveY', 30, 'y', 'L'],
    1610: ['minY', 19, 'x', 'J'], 1744: ['minY', 19, 'x', 'J'],
    1615: ['minY', 18, 'r', 'N'], 2198: ['minY', 19, 'n', 'C'],
    2381: ['minY', 19, 'n', 'C'], 2318: ['width', 30, 'W', '4'],
    1598: ['minY', 13, 'X', 'N'], 1731: ['minY', 13, 'X', 'N'],
    1694: ['minY', 22, 'z', 't'], 1835: ['minY', 22, 'z', 't'],
    2279: ['minY', 13, 'R', 'M'],
  };
  function recognizeCaptcha(svg) {
    if (typeof svg !== 'string' || svg.length > 150000) return { answer: '', lengths: [] };
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return { answer: '', lengths: [] };
    const paths = [...doc.querySelectorAll('path[d]')].map(p => p.getAttribute('d')).filter(d => d.length > 450);
    paths.sort((a, b) => Number(a.match(/[\d.]+/)?.[0]) - Number(b.match(/[\d.]+/)?.[0]));
    const letters = paths.map(d => {
      const rule = CAPTCHA_RULES[d.length];
      if (!rule) return CAPTCHA_GLYPHS[d.length]?.length === 1 ? CAPTCHA_GLYPHS[d.length][0] : '';
      const nums = (d.match(/\d+(?:\.\d*)?/g) || []).map(Number);
      const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
      const value = rule[0] === 'minY' ? Math.min(...ys) : rule[0] === 'width' ? Math.max(...xs) - Math.min(...xs) :
        Number(d.match(/M(\d+(?:\.\d*)?)\s+(\d+(?:\.\d*)?)/)?.[2]);
      return Number.isFinite(value) ? value > rule[1] ? rule[2] : rule[3] : '';
    });
    return { answer: paths.length >= 3 && paths.length <= 8 && letters.every(Boolean) ? letters.join('') : '', lengths: paths.map(d => d.length) };
  }
  const captchaStates = new WeakMap();
  function captchaGroup(input) {
    const form = input.closest('form');
    const controls = 'input:not([type="hidden"]),textarea,select,button[type="submit"],button:not([type])';
    const safe = node => node !== form && node !== document.body &&
      !(node !== input && node.matches(controls)) && !$$(controls, node).some(control => control !== input);
    let anchor = input;
    for (let node = input.parentElement; node && node !== form && node !== document.body; node = node.parentElement) {
      if (!safe(node)) break;
      if (node === input.parentElement || node.matches('.row,.form__item,.form-group,.field,.captcha,[data-captcha]')) anchor = node;
    }
    const dedicated = $$('.captcha,.captcha-container,.captcha-image,.captcha__image,[data-captcha]', form || anchor).filter(safe);
    // 选择完整且只含验证码控件的行；其他布局仅折叠输入组与明确标识的验证码图像。
    const nodes = [...new Set([anchor, ...dedicated])];
    return { anchor, targets: nodes.filter(node => !nodes.some(parent => parent !== node && parent.contains(node))) };
  }
  function captchaSVG(input) {
    const group = captchaGroup(input), scope = input.closest('form') || group.anchor;
    const localImages = $$('img[src^="data:image/svg+xml"]', group.anchor);
    const image = localImages[0] || $('img[src^="data:image/svg+xml"]', scope);
    if (image) {
      try {
        const src = image.getAttribute('src');
        return /;base64,/.test(src) ? atob(src.split(',')[1]) : decodeURIComponent(src.slice(src.indexOf(',') + 1));
      } catch {}
    }
    const inline = $('svg.captcha, .captcha svg, svg[data-captcha]', scope) ||
      $$('svg', group.anchor).find(svg => $$('path[d]', svg).filter(path => path.getAttribute('d').length > 450).length >= 3);
    return inline ? new XMLSerializer().serializeToString(inline) : typeof ui().captcha === 'string' ? ui().captcha : '';
  }
  function restoreCaptchaNode(node, original) {
    if (original.value) node.style.setProperty('display', original.value, original.priority);
    else node.style.removeProperty('display');
    node.removeAttribute('data-exhloj-captcha-folded');
    node.removeAttribute('data-exhloj-captcha-display');
  }
  function syncCaptchaTargets(state, group = captchaGroup(state.input)) {
    state.anchor = group.anchor;
    state.styles ||= new Map();
    for (const [node, original] of state.styles) {
      if (!group.targets.includes(node)) { restoreCaptchaNode(node, original); state.styles.delete(node); }
    }
    state.targets = group.targets;
    if (state.collapsed) {
      for (const node of state.targets) {
        if (!node.isConnected) continue;
        if (!state.styles.has(node)) {
          let original = { value: node.style.getPropertyValue('display'), priority: node.style.getPropertyPriority('display') };
          // 原站克隆验证码 DOM 时也可能复制我们的隐藏样式，保留快照才能正确展开。
          try {
            const snapshot = JSON.parse(node.getAttribute('data-exhloj-captcha-display') || 'null');
            if (node.hasAttribute('data-exhloj-captcha-folded') && typeof snapshot?.value === 'string' && ['', 'important'].includes(snapshot.priority)) original = snapshot;
          } catch {}
          state.styles.set(node, original);
          node.setAttribute('data-exhloj-captcha-display', JSON.stringify(original));
        }
        node.setAttribute('data-exhloj-captcha-folded', '');
        node.style.setProperty('display', 'none', 'important');
      }
    }
  }
  function captchaVisible(state, visible) {
    state.collapsed = !visible;
    if (visible) {
      for (const [node, original] of state.styles || []) restoreCaptchaNode(node, original);
      state.styles?.clear();
    } else syncCaptchaTargets(state);
    const toggle = $('[data-exh-action="captcha-toggle"]', state.tools);
    if (toggle) {
      toggle.textContent = visible ? '折叠验证码' : '展开验证码';
      toggle.setAttribute('aria-expanded', String(visible));
    }
  }
  function runCaptcha(force = false) {
    if (!settings.captcha) return;
    for (const input of $$('input[name="captcha"]')) {
      if (input.disabled) continue;
      const svg = captchaSVG(input);
      if (!svg) continue;
      const prior = captchaStates.get(input);
      if (!force && prior?.svg === svg) {
        syncCaptchaTargets(prior);
        if (prior.anchor.nextElementSibling !== prior.tools) prior.anchor.after(prior.tools);
        continue;
      }
      if (prior) { captchaVisible(prior, true); prior.tools.remove(); }
      const result = recognizeCaptcha(svg), tools = el('div', { class: 'exhloj-captcha-tools' });
      const group = captchaGroup(input);
      const state = { svg, tools, result, input, anchor: group.anchor, targets: group.targets, styles: new Map(), collapsed: false }; captchaStates.set(input, state);
      const previousAuto = prior?.filled && prior.result.answer === input.value;
      if (!result.answer && previousAuto) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
      const canFill = result.answer && (force || !input.value || previousAuto);
      state.filled = !!canFill;
      if (canFill) {
        input.value = result.answer;
        input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
        if (settings.captchaRemember) {
          const remember = $('input[name="rememberme"]', input.closest('form') || document);
          if (remember && !remember.checked) { remember.checked = true; remember.dispatchEvent(new Event('change', { bubbles: true })); }
        }
        if (settings.captchaHide) captchaVisible(state, false);
      }
      tools.append(el('span', {}, canFill ? `验证码已填入 ${result.answer}。` : result.answer ? '保留你已输入的验证码。' : '此验证码未识别，请手动输入。'));
      if (result.answer) tools.append(button('折叠验证码', 'captcha-toggle'));
      tools.append(button('重新识别', 'captcha-retry'));
      state.anchor.after(tools);
      captchaVisible(state, !state.collapsed);
      const history = stored(CAPTCHA_KEY, []);
      save(CAPTCHA_KEY, [...(Array.isArray(history) ? history : []).slice(-49), { time: Date.now(), answer: result.answer, lengths: result.lengths }]);
    }
  }
  function showCaptchaHistory() {
    const body = modal('验证码识别记录');
    body.append(el('p', {}, '最多保留 50 条本地识别记录，仅含识别结果与字形长度，不保存账号或密码。'));
    const records = stored(CAPTCHA_KEY, []);
    for (const item of (Array.isArray(records) ? records : []).slice().reverse()) {
      body.append(el('p', {}, `${new Date(item.time).toLocaleString()} · ${item.answer || '未识别'} · ${(item.lengths || []).join(', ')}`));
    }
    body.append(button('清空记录', 'captcha-clear'));
  }

  // remote-problem: 站内配置 / 本地映射 + 原站读取，不依赖共享插件服务器。
  var ExhlojMarkdown=(()=>{var ma=Object.defineProperty;var _l=Object.getOwnPropertyDescriptor;var Hl=Object.getOwnPropertyNames;var $l=Object.prototype.hasOwnProperty;var Ul=(r,e)=>{for(var t in e)ma(r,t,{get:e[t],enumerable:!0})},Gl=(r,e,t,a)=>{if(e&&typeof e=="object"||typeof e=="function")for(let n of Hl(e))!$l.call(r,n)&&n!==t&&ma(r,n,{get:()=>e[n],enumerable:!(a=_l(e,n))||a.enumerable});return r};var jl=r=>Gl(ma({},"__esModule",{value:!0}),r);var _4={};Ul(_4,{render:()=>F4});function ga(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var K0=ga();function mi(r){K0=r}var X0={exec:()=>null};function dt(r){let e=[];return t=>{let a=Math.max(0,Math.min(3,t-1)),n=e[a];return n||(n=r(a),e[a]=n),n}}function Y(r,e=""){let t=typeof r=="string"?r:r.source,a={replace:(n,i)=>{let l=typeof i=="string"?i:i.source;return l=l.replace(Te.caret,"$1"),t=t.replace(n,l),a},getRegex:()=>new RegExp(t,e)};return a}var Wl=((r="")=>{try{return!!new RegExp("(?<=1)(?<!1)"+r)}catch{return!1}})(),Te={codeRemoveIndent:/^(?: {0,3}\t| {1,4})/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,endingSpaceTabChar:/[ \t]$/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,leadingSpaceTab:/^[ \t]+/,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] +\S/,listReplaceTask:/^\[[ xX]\] +/,listTaskCheckbox:/\[[ xX]\]/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,numericCharacterReference:/&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/,numericCharacterReferenceOrAmpersand:/&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:r=>new RegExp(`^( {0,3}${r})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:dt(r=>new RegExp(`^ {0,${r}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)),hrRegex:dt(r=>new RegExp(`^ {0,${r}}((?:-[ 	]*){3,}|(?:_[ 	]*){3,}|(?:\\*[ 	]*){3,})(?:\\n+|$)`)),fencesBeginRegex:dt(r=>new RegExp(`^ {0,${r}}(?:\`\`\`|~~~)`)),headingBeginRegex:dt(r=>new RegExp(`^ {0,${r}}#`)),htmlBeginRegex:dt(r=>new RegExp(`^ {0,${r}}(?:</?(?:${Bt})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`,"i")),blockquoteBeginRegex:dt(r=>new RegExp(`^ {0,${r}}>`))},Vl=/^(?:[ \t]*(?:\n|$))+/,Yl=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,Xl=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,Ot=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,Zl=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,ba=/ {0,3}(?:[*+-]|\d{1,9}[.)])/,di=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,pi=Y(di).replace(/bull/g,ba).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}(?:\s|$)/).replace(/hr/g,/ {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),Kl=Y(di).replace(/bull/g,ba).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}(?:\s|$)/).replace(/hr/g,/ {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),ya=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/,Ql=/^[^\n]+/,xa=/(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/,Jl=Y(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",xa).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),e1=Y(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g,ba).getRegex(),Bt="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",wa=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,t1=Y("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",wa).replace("tag",Bt).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),fi=r=>Y(ya).replace("hr",Ot).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list",r).replace("html"," {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag",Bt).getRegex(),r1=fi(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/),a1=fi(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/),n1=Y(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",a1).getRegex(),ka={blockquote:n1,code:Yl,def:Jl,fences:Xl,heading:Zl,hr:Ot,html:t1,lheading:pi,list:e1,newline:Vl,paragraph:r1,table:X0,text:Ql},ri=Y("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",Ot).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html"," {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag",Bt).getRegex(),i1={...ka,lheading:Kl,table:ri,paragraph:Y(ya).replace("hr",Ot).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",ri).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html"," {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag",Bt).getRegex()},s1={...ka,html:Y(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",wa).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:X0,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:Y(ya).replace("hr",Ot).replace("heading",` *#{1,6} *[^
]`).replace("lheading",pi).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},l1=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,o1=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,vi=/^( {2,}|\\)\n(?!\s*$)[ \t]*/,u1=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,h0=/[\p{P}\p{S}]/u,pt=/[\s\p{P}\p{S}]/u,Nt=/[^\s\p{P}\p{S}]/u,c1=Y(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,pt).getRegex(),h1=/[\p{Pi}\p{Ps}"']/u,gi=/(?!~)[\p{P}\p{S}]/u,m1=/(?!~)[\s\p{P}\p{S}]/u,d1=/(?:[^\s\p{P}\p{S}]|~)/u,p1=Y(/link|precode-code|html/,"g").replace("link",/\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-",Wl?"(?<!`)()":"(^^|[^`])").replace("code",/(?<b>`+)[^`]+\k<b>(?!`)/).replace("html",/<(?! )[^<>]*?>/).getRegex(),bi=/^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/,f1=Y(bi,"u").replace(/punct/g,h0).getRegex(),v1=Y(bi,"u").replace(/punct/g,gi).getRegex(),g1=/^(?:\*+(?:((?!\*)(?!openQuote)punct)|([^\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\s_]))?/,b1=Y(g1,"u").replace(/openQuote/g,h1).replace(/punct/g,h0).getRegex(),yi="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",y1=Y(yi,"gu").replace(/notPunctSpace/g,Nt).replace(/punctSpace/g,pt).replace(/punct/g,h0).getRegex(),x1=Y(yi,"gu").replace(/notPunctSpace/g,d1).replace(/punctSpace/g,m1).replace(/punct/g,gi).getRegex(),w1="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)[\\s](\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|(?:(?!\\*)punct|notPunctSpace)(\\*+)(?!\\*)(?=notPunctSpace)",k1=Y(w1,"gu").replace(/notPunctSpace/g,Nt).replace(/punctSpace/g,pt).replace(/punct/g,h0).getRegex(),S1=Y("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,Nt).replace(/punctSpace/g,pt).replace(/punct/g,h0).getRegex(),T1="^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\s](_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)",A1=Y(T1,"gu").replace(/notPunctSpace/g,Nt).replace(/punctSpace/g,pt).replace(/punct/g,h0).getRegex(),z1=Y(/^~~?(?:((?!~)punct)|[^\s~])/,"u").replace(/punct/g,h0).getRegex(),M1="^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)",E1=Y(M1,"gu").replace(/notPunctSpace/g,Nt).replace(/punctSpace/g,pt).replace(/punct/g,h0).getRegex(),R1=Y(/\\(punct)/,"gu").replace(/punct/g,h0).getRegex(),D1=Y(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/,"gu").replace(/punct/g,h0).getRegex(),C1=Y(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),I1=Y(wa).replace("(?:-->|$)","-->").getRegex(),O1=Y("^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",I1).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),xi=/\[(?:\\[\s\S]|[^\[\]\\])*\]/,vr=Y(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/).replace("brackets",xi).getRegex(),B1=Y(/^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/).replace("label",vr).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),N1=Y(/^!?\[(label)\]\[(ref)\]/).replace("label",vr).replace("ref",xa).getRegex(),L1=Y(/^!?\[(ref)\](?:\[\])?/).replace("ref",xa).getRegex(),ai=/(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/,q1=Y(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/).replace("brackets",xi).getRegex(),P1=Y("reflink|nolink(?!\\()","g").replace("reflink",Y(/^!?\[(label)\]\[(ref)\]/).replace("label",q1).replace("ref",ai).getRegex()).replace("nolink",Y(/^!?\[(ref)\](?:\[\])?/).replace("ref",ai).getRegex()).getRegex(),ni=/[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,F1=/[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/,_1=Y(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/).replace(/email/g,F1).getRegex(),Sa={_backpedal:X0,anyPunctuation:R1,anyPunctuationOutsideCode:D1,autolink:C1,blockSkip:p1,br:vi,code:o1,del:X0,delLDelim:X0,delRDelim:X0,emStrongLDelim:f1,emStrongRDelimAst:y1,emStrongRDelimUnd:S1,escape:l1,link:B1,nolink:L1,punctuation:c1,reflink:N1,reflinkSearch:P1,tag:O1,text:u1,url:X0},H1={...Sa,emStrongLDelim:b1,emStrongRDelimAst:k1,emStrongRDelimUnd:A1,link:Y(/^!?\[(label)\]\((.*?)\)/).replace("label",vr).getRegex(),reflink:Y(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",vr).getRegex()},pa={...Sa,emStrongRDelimAst:x1,emStrongLDelim:v1,delLDelim:z1,delRDelim:E1,url:Y(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("emailProtocol",_1).replace("protocol",ni).replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,text:Y(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/).replace("protocol",ni).replace(/emailProtocol/g,/(?:mailto|xmpp):/).getRegex()},$1={...pa,br:Y(vi).replace("{2,}","*").getRegex(),text:Y(pa.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},fr={normal:ka,gfm:i1,pedantic:s1},Ct={normal:Sa,gfm:pa,breaks:$1,pedantic:H1},U1={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},ii=r=>U1[r];function Ve(r,e){if(e){if(Te.escapeTest.test(r))return r.replace(Te.escapeReplace,ii)}else if(Te.escapeTestNoEncode.test(r))return r.replace(Te.escapeReplaceNoEncode,ii);return r}function G1(r){return Te.numericCharacterReference.test(r)?r.replace(Te.numericCharacterReferenceOrAmpersand,(e,t,a)=>{if(t===void 0&&a===void 0)return"&amp;";let n=t===void 0?Number.parseInt(a,16):Number.parseInt(t,10);return n===0||n>1114111||n>=55296&&n<=57343?"\uFFFD":n===38?"&amp;":String.fromCodePoint(n)}):r}function si(r){try{r=encodeURI(r).replace(Te.percentDecode,"%")}catch{return null}return r}function li(r,e){let t=r.replace(Te.findPipe,(i,l,u)=>{let h=!1,d=l;for(;--d>=0&&u[d]==="\\";)h=!h;return h?"|":" |"}),a=t.split(Te.splitPipe),n=0;if(a[0].trim()||a.shift(),a.length>0&&!a.at(-1)?.trim()&&a.pop(),e)if(a.length>e)a.splice(e);else for(;a.length<e;)a.push("");for(;n<a.length;n++)a[n]=a[n].trim().replace(Te.slashPipe,"|");return a}function O0(r,e,t){let a=r.length;if(a===0)return"";let n=0;for(;n<a;){let i=r.charAt(a-n-1);if(i===e&&!t)n++;else if(i!==e&&t)n++;else break}return r.slice(0,a-n)}function oi(r){let e=r.split(`
`),t=e.length-1;for(;t>=0&&Te.blankLine.test(e[t]);)t--;return e.length-t<=2?r:e.slice(0,t+1).join(`
`)}function gr(r){return r.trim().toLowerCase().toUpperCase().toLowerCase()}function ui(r,e){if(r.indexOf(e[0])===-1&&r.indexOf(e[1])===-1)return-1;let t=0;for(let a=0;a<r.length;a++)if(r[a]==="\\")a++;else if(r[a]===e[0])t++;else if(r[a]===e[1]&&(t--,t<0))return a;return t>0?-2:-1}function da(r,e=0){let t=e,a="";for(let n of r)if(n==="	"){let i=4-t%4;a+=" ".repeat(i),t+=i}else a+=n,t++;return a}function ci(r,e,t,a,n){let i=e.href,l=e.title||null,u=r[1].replace(n.other.outputLinkReplace,"$1"),h=r[0].charAt(0)==="!",d=a.state.inLink,f=a.state.linkEmitted,b=a.state.inRawBlock;a.state.inLink=!0,a.state.linkEmitted=!1;let k=a.inlineTokens(u),w=a.state.linkEmitted;if(a.state.linkEmitted=f,a.state.inLink=d,!h){if(w){a.state.inRawBlock=b;return}a.state.linkEmitted=!0}return{type:h?"image":"link",raw:t,href:i,title:l,text:u,tokens:k}}function j1(r,e,t){let a=r.match(t.other.indentCodeCompensation);if(a===null)return e;let n=a[1];return e.split(`
`).map(i=>{let l=i.match(t.other.beginningSpace);if(l===null)return i;let[u]=l;return i.slice(Math.min(u.length,n.length))}).join(`
`)}function hi(r,e,t,a){if(!e.includes("<"))return!1;for(let n=0;n<e.length;n++){if(e[n]==="\\"){n++;continue}if(e[n]==="`"){let u=a.inline.code.exec(e.slice(n));if(u){n+=u[0].length-1;continue}}if(e[n]!=="<")continue;let i=r.slice(t+n),l=a.inline.tag.exec(i)||a.inline.autolink.exec(i);if(l){if(l[0].length>e.length-n)return!0;n+=l[0].length-1}}return!1}var br=class{options;rules;lexer;constructor(r){this.options=r||K0}space(r){let e=this.rules.block.newline.exec(r);if(e&&e[0].length>0)return{type:"space",raw:e[0]}}code(r){let e=this.rules.block.code.exec(r);if(e){let t=this.options.pedantic?e[0]:oi(e[0]),a=t.replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:t,codeBlockStyle:"indented",text:a}}}fences(r){let e=this.rules.block.fences.exec(r);if(e){let t=e[0],a=j1(t,e[3]||"",this.rules);return{type:"code",raw:t,lang:e[2]?e[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):e[2],text:a}}}heading(r){let e=this.rules.block.heading.exec(r);if(e){let t=e[2].trim();if(this.rules.other.endingHash.test(t)){let a=O0(t,"#");(this.options.pedantic||!a||this.rules.other.endingSpaceTabChar.test(a))&&(t=a.trim())}return{type:"heading",raw:O0(e[0],`
`),depth:e[1].length,text:t,tokens:this.lexer.inline(t)}}}hr(r){let e=this.rules.block.hr.exec(r);if(e)return{type:"hr",raw:O0(e[0],`
`)}}blockquote(r){let e=this.rules.block.blockquote.exec(r);if(e){let t=O0(e[0],`
`).split(`
`),a="",n="",i=[];for(;t.length>0;){let l=!1,u=[],h;for(h=0;h<t.length;h++)if(this.rules.other.blockquoteStart.test(t[h]))u.push(t[h]),l=!0;else if(!l)u.push(t[h]);else break;t=t.slice(h);let d=u.join(`
`),f=d.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");a=a?`${a}
${d}`:d,n=n?`${n}
${f}`:f;let b=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(f,i,!0),this.lexer.state.top=b,t.length===0)break;let k=i.at(-1);if(k?.type==="code"||k?.type==="heading"||k?.type==="hr"||k?.type==="html")break;if(k?.type==="blockquote"){let w=k,M=t.join(`
`),D=w.raw+`
`+M.replace(this.rules.other.blockquoteSetextReplace2,""),E=this.blockquote(D);i[i.length-1]=E;let N=D.substring(E.raw.length).replace(/^\n/,""),B=N?N.split(`
`).length:0,F=B?t.slice(0,-B):t;F.length>0&&(a=`${a}
${F.join(`
`)}`),n=n.substring(0,n.length-w.text.length)+E.text;break}else if(k?.type==="list"){let w=k,M=w.raw+`
`+t.join(`
`),D=this.list(M);i[i.length-1]=D,a=a.substring(0,a.length-k.raw.length)+D.raw,n=n.substring(0,n.length-w.raw.length)+D.raw,t=M.substring(i.at(-1).raw.length).split(`
`);continue}}return{type:"blockquote",raw:a,tokens:i,text:n}}}list(r){let e=this.rules.block.list.exec(r);if(e){let t=r,a=()=>t.length-r.length,n=e[1].trim(),i=n.length>1,l={type:"list",raw:"",ordered:i,start:i?+n.slice(0,-1):"",loose:!1,items:[]};n=i?`\\d{1,9}\\${n.slice(-1)}`:`\\${n}`,this.options.pedantic&&(n=i?n:"[*+-]");let u=this.rules.other.listItemRegex(n),h=!1;for(;r;){let f=!1,b="";if(!(e=u.exec(r))||this.rules.block.hr.test(r))break;let k=a();r=r.substring(e[0].length);let w=e[2].split(`
`,1)[0],M=e[1].length,D=this.options.pedantic?da(w,M):w.replace(this.rules.other.leadingSpaceTab,H=>da(H,M)),E=r.split(`
`,1)[0],N=!D.trim(),B=0;if(this.options.pedantic?(B=2,b=D.trimStart()):N?B=M+1:(B=D.search(this.rules.other.nonSpaceChar),B=B>4?1:B,b=D.slice(B),B+=M),N&&this.rules.other.blankLine.test(E)&&(r=r.substring(E.length+1),f=!0),!f){let H=this.rules.other.nextBulletRegex(B),V=this.rules.other.hrRegex(B),j=this.rules.other.fencesBeginRegex(B),$=this.rules.other.headingBeginRegex(B),X=this.rules.other.htmlBeginRegex(B),ee=this.rules.other.blockquoteBeginRegex(B);for(;r;){let ae=r.split(`
`,1)[0],Q;if(E=ae,this.options.pedantic?(E=E.replace(this.rules.other.listReplaceNesting,"  "),Q=E):Q=E.replace(this.rules.other.leadingSpaceTab,ie=>da(ie)),j.test(E)||$.test(E)||X.test(E)||ee.test(E)||H.test(E)||V.test(E))break;if(Q.search(this.rules.other.nonSpaceChar)>=B||!E.trim())b+=`
`+Q.slice(B);else{if(N||D.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||j.test(D)||$.test(D)||V.test(D))break;b+=`
`+E}N=!E.trim(),r=r.substring(ae.length+1),D=Q.slice(B)}}let F=t.slice(k,a());l.loose||(h?l.loose=!0:this.rules.other.doubleBlankLine.test(F)&&(h=!0)),l.items.push({type:"list_item",raw:F,task:!!this.options.gfm&&this.rules.other.listIsTask.test(b),loose:!1,text:b,tokens:[]})}let d=l.items.at(-1);if(d)d.raw=d.raw.trimEnd(),d.text=d.text.trimEnd();else return;l.raw=t.slice(0,a()).trimEnd();for(let f of l.items)if(this.lexer.state.top=!1,f.tokens=this.lexer.blockTokens(f.text,[]),!l.loose){let b=f.tokens.filter(w=>w.type==="space"),k=b.length>0&&b.some(w=>this.rules.other.anyLine.test(w.raw));l.loose=k}for(let f of l.items){let b=f.tokens[0];if(f.task&&(b?.type==="text"||b?.type==="paragraph")){f.text=f.text.replace(this.rules.other.listReplaceTask,""),b.raw=b.raw.replace(this.rules.other.listReplaceTask,""),b.text=b.text.replace(this.rules.other.listReplaceTask,"");for(let w=this.lexer.inlineQueue.length-1;w>=0;w--)if(this.rules.other.listIsTask.test(this.lexer.inlineQueue[w].src)){this.lexer.inlineQueue[w].src=this.lexer.inlineQueue[w].src.replace(this.rules.other.listReplaceTask,"");break}let k=this.rules.other.listTaskCheckbox.exec(f.raw);if(k){let w={type:"checkbox",raw:k[0]+" ",checked:k[0]!=="[ ]"};f.checked=w.checked,l.loose?f.tokens[0]&&["paragraph","text"].includes(f.tokens[0].type)&&"tokens"in f.tokens[0]&&f.tokens[0].tokens?(f.tokens[0].raw=w.raw+f.tokens[0].raw,f.tokens[0].text=w.raw+f.tokens[0].text,f.tokens[0].tokens.unshift(w)):f.tokens.unshift({type:"paragraph",raw:w.raw,text:w.raw,tokens:[w]}):f.tokens.unshift(w)}}else f.task&&(f.task=!1)}if(l.loose)for(let f of l.items){f.loose=!0;for(let b of f.tokens)b.type==="text"&&(b.type="paragraph")}return l}}html(r){let e=this.rules.block.html.exec(r);if(e){let t=oi(e[0]);return{type:"html",block:!0,raw:t,pre:e[1]==="pre"||e[1]==="script"||e[1]==="style",text:t}}}def(r){let e=this.rules.block.def.exec(r);if(e){if(!this.rules.other.startAngleBracket.test(e[2])&&ui(e[2],"()")!==-1)return;let t=gr(e[1]).replace(this.rules.other.multipleSpaceGlobal," "),a=e[2]?e[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",n=e[3]?e[3].substring(1,e[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):e[3];return{type:"def",tag:t,raw:O0(e[0],`
`),href:a,title:n}}}table(r){let e=this.rules.block.table.exec(r);if(!e||!this.rules.other.tableDelimiter.test(e[2]))return;let t=li(e[1]),a=e[2].replace(this.rules.other.tableAlignChars,"").split("|"),n=e[3]?.trim()?e[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],i={type:"table",raw:O0(e[0],`
`),header:[],align:[],rows:[]};if(t.length===a.length){for(let l of a)this.rules.other.tableAlignRight.test(l)?i.align.push("right"):this.rules.other.tableAlignCenter.test(l)?i.align.push("center"):this.rules.other.tableAlignLeft.test(l)?i.align.push("left"):i.align.push(null);for(let l=0;l<t.length;l++)i.header.push({text:t[l],tokens:this.lexer.inline(t[l]),header:!0,align:i.align[l]});for(let l of n)i.rows.push(li(l,i.header.length).map((u,h)=>({text:u,tokens:this.lexer.inline(u),header:!1,align:i.align[h]})));return i}}lheading(r){let e=this.rules.block.lheading.exec(r);if(e){let t=e[1].trim();return{type:"heading",raw:O0(e[0],`
`),depth:e[2].charAt(0)==="="?1:2,text:t,tokens:this.lexer.inline(t)}}}paragraph(r){let e=this.rules.block.paragraph.exec(r);if(e){let t=e[1].charAt(e[1].length-1)===`
`?e[1].slice(0,-1):e[1];return{type:"paragraph",raw:e[0],text:t,tokens:this.lexer.inline(t)}}}text(r){let e=this.rules.block.text.exec(r);if(e)return{type:"text",raw:e[0],text:e[0],tokens:this.lexer.inline(e[0])}}escape(r){let e=this.rules.inline.escape.exec(r);if(e)return{type:"escape",raw:e[0],text:e[1]}}tag(r){let e=this.rules.inline.tag.exec(r);if(e)return!this.lexer.state.inLink&&this.rules.other.startATag.test(e[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(e[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(e[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(e[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:e[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:e[0]}}link(r){if(this.lexer.state.linkParenPossible===!1)return;let e=this.rules.inline.link.exec(r);if(e){let t=e[0].charAt(0)==="!"?2:1;if(!this.options.pedantic&&hi(r,e[1],t,this.rules))return;let a=e[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(a)){if(!this.rules.other.endAngleBracket.test(a))return;let l=O0(a.slice(0,-1),"\\");if((a.length-l.length)%2===0)return}else{let l=ui(e[2],"()");if(l===-2)return;if(l>-1){let u=(e[0].indexOf("!")===0?5:4)+e[1].length+l;e[2]=e[2].substring(0,l),e[0]=e[0].substring(0,u).trim(),e[3]=""}}let n=e[2],i="";if(this.options.pedantic){let l=this.rules.other.pedanticHrefTitle.exec(n);l&&(n=l[1],i=l[3])}else i=e[3]?e[3].slice(1,-1):"";return n=n.trim(),this.rules.other.startAngleBracket.test(n)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(a)?n=n.slice(1):n=n.slice(1,-1)),ci(e,{href:n&&n.replace(this.rules.inline.anyPunctuation,"$1"),title:i&&i.replace(this.rules.inline.anyPunctuation,"$1")},e[0],this.lexer,this.rules)}}reflink(r,e){let t;if((t=this.rules.inline.reflink.exec(r))||(t=this.rules.inline.nolink.exec(r))){let a=t[0].charAt(0)==="!"?2:1;if(!this.options.pedantic&&hi(r,t[1],a,this.rules))return;let n=(t[2]||t[1]).replace(this.rules.other.multipleSpaceGlobal," "),i=e[gr(n)];if(!i){let l=t[0].charAt(0);return{type:"text",raw:l,text:l}}return ci(t,i,t[0],this.lexer,this.rules)}}emStrong(r,e,t=""){let a=this.rules.inline.emStrongLDelim.exec(r);if(!(!a||!a[1]&&!a[2]&&!a[3]&&!a[4]||a[4]&&t.match(this.rules.other.unicodeAlphaNumeric))&&(!(a[1]||a[3])||!t||this.rules.inline.punctuation.exec(t))){let n=[...a[0]].length-1,i,l,u=n,h=0,d=a[0][0],f=t===d,b=d==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(b.lastIndex=0,e=e.slice(-1*r.length+n);(a=b.exec(e))!==null;){if(i=a[1]||a[2]||a[3]||a[4]||a[5]||a[6],!i)continue;if(l=[...i].length,a[3]||a[4]){u+=l;continue}else if(a[5]||a[6]){if(n%3&&!((n+l)%3)){h+=l;continue}if(f)break}if(u-=l,u>0)continue;l=Math.min(l,l+u+h);let k=[...a[0]][0].length,w=r.slice(0,n+a.index+k+l);if(Math.min(n,l)%2){let D=w.slice(1,-1);return{type:"em",raw:w,text:D,tokens:this.lexer.inlineTokens(D)}}let M=w.slice(2,-2);return{type:"strong",raw:w,text:M,tokens:this.lexer.inlineTokens(M)}}}}codespan(r){let e=this.rules.inline.code.exec(r);if(e){let t=e[2].replace(this.rules.other.newLineCharGlobal," "),a=this.rules.other.nonSpaceChar.test(t),n=this.rules.other.startingSpaceChar.test(t)&&this.rules.other.endingSpaceChar.test(t);return a&&n&&(t=t.substring(1,t.length-1)),{type:"codespan",raw:e[0],text:t}}}br(r){let e=this.rules.inline.br.exec(r);if(e)return{type:"br",raw:e[0]}}del(r,e,t=""){let a=this.rules.inline.delLDelim.exec(r);if(a&&(!a[1]||!t||this.rules.inline.punctuation.exec(t))){let n=[...a[0]].length-1,i,l,u=n,h=this.rules.inline.delRDelim;for(h.lastIndex=0,e=e.slice(-1*r.length+n);(a=h.exec(e))!==null;){if(i=a[1]||a[2]||a[3]||a[4]||a[5]||a[6],!i||(l=[...i].length,l!==n))continue;if(a[3]||a[4]){u+=l;continue}if(u-=l,u>0)continue;l=Math.min(l,l+u);let d=[...a[0]][0].length,f=r.slice(0,n+a.index+d+l),b=f.slice(n,-n);return{type:"del",raw:f,text:b,tokens:this.lexer.inlineTokens(b)}}}}autolink(r){let e=this.rules.inline.autolink.exec(r);if(e){let t,a;return e[2]==="@"?(t=e[1],a="mailto:"+t):(t=e[1],a=t),{type:"link",raw:e[0],text:t,href:a,autolink:!0,tokens:[{type:"text",raw:t,text:t}]}}}url(r){let e;if(e=this.rules.inline.url.exec(r)){let t,a;if(e[2]==="@")t=e[0],a="mailto:"+t;else{let n;do n=e[0],e[0]=this.rules.inline._backpedal.exec(e[0])?.[0]??"";while(n!==e[0]);t=e[0],e[1]==="www."?a="http://"+e[0]:a=e[0]}return{type:"link",raw:e[0],text:t,href:a,autolink:!0,tokens:[{type:"text",raw:t,text:t}]}}}inlineText(r){let e=this.rules.inline.text.exec(r);if(e){let t=this.lexer.state.inRawBlock;return{type:"text",raw:e[0],text:t?e[0]:G1(e[0]),escaped:t}}}},s0=class fa{tokens;options;state;inlineQueue;tokenizer;constructor(e){this.tokens=[],this.tokens.links=Object.create(null),this.options=e||K0,this.options.tokenizer=this.options.tokenizer||new br,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,linkEmitted:!1,linkParenPossible:!0,top:!0};let t={other:Te,block:fr.normal,inline:Ct.normal};this.options.pedantic?(t.block=fr.pedantic,t.inline=Ct.pedantic):this.options.gfm&&(t.block=fr.gfm,this.options.breaks?t.inline=Ct.breaks:t.inline=Ct.gfm),this.tokenizer.rules=t}static get rules(){return{block:fr,inline:Ct}}static lex(e,t){return new fa(t).lex(e)}static lexInline(e,t){return new fa(t).inlineTokens(e)}lex(e){e=e.replace(Te.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let t=0;t<this.inlineQueue.length;t++){let a=this.inlineQueue[t];this.inlineTokens(a.src,a.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,t=[],a=!1){this.tokenizer.lexer=this,this.options.pedantic&&(e=e.replace(Te.tabCharGlobal,"    ").replace(Te.spaceLine,""));let n=1/0;for(;e;){if(e.length<n)n=e.length;else{this.infiniteLoopError(e.charCodeAt(0));break}let i;if(this.options.extensions?.block?.some(u=>(i=u.call({lexer:this},e,t))?(e=e.substring(i.raw.length),t.push(i),!0):!1))continue;if(i=this.tokenizer.space(e)){e=e.substring(i.raw.length);let u=t.at(-1);i.raw.length===1&&u!==void 0?u.raw+=`
`:t.push(i);continue}if(i=this.tokenizer.code(e)){e=e.substring(i.raw.length);let u=t.at(-1);u?.type==="paragraph"||u?.type==="text"?(u.raw+=(u.raw.endsWith(`
`)?"":`
`)+i.raw,u.text+=`
`+i.text,this.inlineQueue.at(-1).src=u.text):t.push(i);continue}if(i=this.tokenizer.fences(e)){e=e.substring(i.raw.length),t.push(i);continue}if(i=this.tokenizer.heading(e)){e=e.substring(i.raw.length),t.push(i);continue}if(i=this.tokenizer.hr(e)){e=e.substring(i.raw.length),t.push(i);continue}if(i=this.tokenizer.blockquote(e)){e=e.substring(i.raw.length),t.push(i);continue}if(i=this.tokenizer.list(e)){e=e.substring(i.raw.length),t.push(i);continue}if(i=this.tokenizer.html(e)){e=e.substring(i.raw.length),t.push(i);continue}if(i=this.tokenizer.def(e)){e=e.substring(i.raw.length);let u=t.at(-1);u?.type==="paragraph"||u?.type==="text"?(u.raw+=(u.raw.endsWith(`
`)?"":`
`)+i.raw,u.text+=`
`+i.raw,this.inlineQueue.at(-1).src=u.text):this.tokens.links[i.tag]||(this.tokens.links[i.tag]={href:i.href,title:i.title},t.push(i));continue}if(i=this.tokenizer.table(e)){e=e.substring(i.raw.length),t.push(i);continue}if(i=this.tokenizer.lheading(e)){e=e.substring(i.raw.length),t.push(i);continue}let l=e;if(this.options.extensions?.startBlock){let u=1/0,h=e.slice(1),d;this.options.extensions.startBlock.forEach(f=>{d=f.call({lexer:this},h),typeof d=="number"&&d>=0&&(u=Math.min(u,d))}),u<1/0&&u>=0&&(l=e.substring(0,u+1))}if(this.state.top&&(i=this.tokenizer.paragraph(l))){let u=t.at(-1);a&&u?.type==="paragraph"?(u.raw+=(u.raw.endsWith(`
`)?"":`
`)+i.raw,u.text+=`
`+i.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=u.text):t.push(i),a=l.length!==e.length,e=e.substring(i.raw.length);continue}if(i=this.tokenizer.text(e)){e=e.substring(i.raw.length);let u=t.at(-1);u?.type==="text"?(u.raw+=(u.raw.endsWith(`
`)?"":`
`)+i.raw,u.text+=`
`+i.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=u.text):t.push(i);continue}if(e){this.infiniteLoopError(e.charCodeAt(0));break}}return this.state.top=!0,t}inline(e,t=[]){return this.inlineQueue.push({src:e,tokens:t}),t}linkInText(e){if(!e.includes("["))return!1;let t=this.tokenizer.rules.inline.link;for(let a of e.matchAll(this.tokenizer.rules.inline.blockSkip))if(t.test(a[0])&&e.charAt(a.index-1)!=="!")return!0;for(let a of e.matchAll(this.tokenizer.rules.inline.reflinkSearch)){let n=a[0],i=n.lastIndexOf("[");if(!(n.charAt(0)==="!"||!Object.hasOwn(this.tokens.links,gr(n.slice(i+1,-1))))&&!(i>1&&this.linkInText(n.slice(1,i-1))))return!0}return!1}inlineTokens(e,t=[]){this.tokenizer.lexer=this;let a=this.state.linkParenPossible;this.state.linkParenPossible=a&&e.includes(")");try{return this.#e(e,t)}finally{this.state.linkParenPossible=a}}#e(e,t){let a=e;if(this.tokens.links&&e.includes("[")){let u=this.tokenizer.rules.inline.reflinkSearch,h=d=>{let f=d.lastIndexOf("[");if(!Object.hasOwn(this.tokens.links,gr(d.slice(f+1,-1))))return d;if(f>1&&d.charAt(0)!=="!"){let b=d.slice(1,f-1);if(this.linkInText(b))return"["+b.replace(u,h)+"]["+"a".repeat(d.length-f-2)+"]"}return"["+"a".repeat(d.length-2)+"]"};a=a.replace(u,h)}a=a.replace(this.tokenizer.rules.inline.anyPunctuationOutsideCode,(u,h,d)=>d?"+".repeat(u.length):h?h+u.slice(h.length,-h.length).replace(/`/g,"+")+h:u),a=a.replace(this.tokenizer.rules.inline.blockSkip,(u,h,d)=>{let f=d?d.length:0;return u.slice(0,f)+"["+"a".repeat(u.length-f-2)+"]"}),a=this.options.hooks?.emStrongMask?.call({lexer:this},a)??a;let n=!1,i="",l=1/0;for(;e;){if(e.length<l)l=e.length;else{this.infiniteLoopError(e.charCodeAt(0));break}n||(i=""),n=!1;let u;if(this.options.extensions?.inline?.some(d=>(u=d.call({lexer:this},e,t))?(e=e.substring(u.raw.length),t.push(u),!0):!1))continue;if(u=this.tokenizer.escape(e)){e=e.substring(u.raw.length),t.push(u);continue}if(u=this.tokenizer.tag(e)){e=e.substring(u.raw.length),t.push(u);continue}if(u=this.tokenizer.link(e)){e=e.substring(u.raw.length),t.push(u);continue}if(u=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(u.raw.length);let d=t.at(-1);u.type==="text"&&d?.type==="text"?(d.raw+=u.raw,d.text+=u.text):t.push(u);continue}if(u=this.tokenizer.emStrong(e,a,i)){e=e.substring(u.raw.length),t.push(u);continue}if(u=this.tokenizer.codespan(e)){e=e.substring(u.raw.length),t.push(u);continue}if(u=this.tokenizer.br(e)){e=e.substring(u.raw.length),t.push(u);continue}if(u=this.tokenizer.del(e,a,i)){e=e.substring(u.raw.length),t.push(u);continue}if(u=this.tokenizer.autolink(e)){e=e.substring(u.raw.length),t.push(u);continue}if(!this.state.inLink&&(u=this.tokenizer.url(e))){e=e.substring(u.raw.length),t.push(u);continue}let h=e;if(this.options.extensions?.startInline){let d=1/0,f=e.slice(1),b;this.options.extensions.startInline.forEach(k=>{b=k.call({lexer:this},f),typeof b=="number"&&b>=0&&(d=Math.min(d,b))}),d<1/0&&d>=0&&(h=e.substring(0,d+1))}if(u=this.tokenizer.inlineText(h)){e=e.substring(u.raw.length),u.raw.slice(-1)!=="_"&&(i=u.raw.slice(-1)),n=!0;let d=t.at(-1);d?.type==="text"?(d.raw+=u.raw,d.text+=u.text):t.push(u);continue}if(e){this.infiniteLoopError(e.charCodeAt(0));break}}return t}infiniteLoopError(e){let t="Infinite loop on byte: "+e;if(this.options.silent)console.error(t);else throw new Error(t)}},yr=class{options;parser;constructor(r){this.options=r||K0}space(r){return""}code({text:r,lang:e,escaped:t}){let a=(e||"").match(Te.notSpaceStart)?.[0],n=r?r.replace(Te.endingNewline,"")+`
`:"";return a?'<pre><code class="language-'+Ve(a)+'">'+(t?n:Ve(n,!0))+`</code></pre>
`:"<pre><code>"+(t?n:Ve(n,!0))+`</code></pre>
`}blockquote({tokens:r}){return`<blockquote>
${this.parser.parse(r)}</blockquote>
`}html({text:r}){return r}def(r){return""}heading({tokens:r,depth:e}){return`<h${e}>${this.parser.parseInline(r)}</h${e}>
`}hr(r){return`<hr>
`}list(r){let e=r.ordered,t=r.start,a="";for(let l=0;l<r.items.length;l++){let u=r.items[l];a+=this.listitem(u)}let n=e?"ol":"ul",i=e&&t!==1?' start="'+t+'"':"";return"<"+n+i+`>
`+a+"</"+n+`>
`}listitem(r){return`<li>${this.parser.parse(r.tokens)}</li>
`}checkbox({checked:r}){return"<input "+(r?'checked="" ':"")+'disabled="" type="checkbox"> '}paragraph({tokens:r}){return`<p>${this.parser.parseInline(r)}</p>
`}table(r){let e="",t="";for(let n=0;n<r.header.length;n++)t+=this.tablecell(r.header[n]);e+=this.tablerow({text:t});let a="";for(let n=0;n<r.rows.length;n++){let i=r.rows[n];t="";for(let l=0;l<i.length;l++)t+=this.tablecell(i[l]);a+=this.tablerow({text:t})}return a&&(a=`<tbody>${a}</tbody>`),`<table>
<thead>
`+e+`</thead>
`+a+`</table>
`}tablerow({text:r}){return`<tr>
${r}</tr>
`}tablecell(r){let e=this.parser.parseInline(r.tokens),t=r.header?"th":"td";return(r.align?`<${t} align="${r.align}">`:`<${t}>`)+e+`</${t}>
`}strong({tokens:r}){return`<strong>${this.parser.parseInline(r)}</strong>`}em({tokens:r}){return`<em>${this.parser.parseInline(r)}</em>`}codespan({text:r}){return`<code>${Ve(r,!0)}</code>`}br(r){return"<br>"}del({tokens:r}){return`<del>${this.parser.parseInline(r)}</del>`}link({href:r,title:e,text:t,tokens:a,autolink:n}){let i=n?Ve(t,!0):this.parser.parseInline(a),l=si(r);if(l===null)return i;r=Ve(l,n);let u='<a href="'+r+'"';return e&&(u+=' title="'+Ve(e)+'"'),u+=">"+i+"</a>",u}image({href:r,title:e,text:t,tokens:a}){a&&(t=this.parser.parseInline(a,this.parser.textRenderer));let n=si(r);if(n===null)return Ve(t);r=n;let i=`<img src="${Ve(r)}" alt="${Ve(t)}"`;return e&&(i+=` title="${Ve(e)}"`),i+=">",i}text(r){return"tokens"in r&&r.tokens?this.parser.parseInline(r.tokens):"escaped"in r&&r.escaped?r.text:Ve(r.text)}},Ta=class{strong({text:r}){return r}em({text:r}){return r}codespan({text:r}){return r}del({text:r}){return r}html({text:r}){return r}text({text:r}){return r}link({text:r}){return""+r}image({text:r}){return""+r}br(){return""}checkbox({raw:r}){return r}},l0=class va{options;renderer;textRenderer;constructor(e){this.options=e||K0,this.options.renderer=this.options.renderer||new yr,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new Ta}static parse(e,t){return new va(t).parse(e)}static parseInline(e,t){return new va(t).parseInline(e)}parse(e){this.renderer.parser=this;let t="";for(let a=0;a<e.length;a++){let n=e[a];if(this.options.extensions?.renderers?.[n.type]){let l=n,u=this.options.extensions.renderers[l.type].call({parser:this},l);if(u!==!1||!["space","hr","heading","code","table","blockquote","list","checkbox","html","def","paragraph","text"].includes(l.type)){t+=u||"";continue}}let i=n;switch(i.type){case"space":{t+=this.renderer.space(i);break}case"hr":{t+=this.renderer.hr(i);break}case"heading":{t+=this.renderer.heading(i);break}case"code":{t+=this.renderer.code(i);break}case"table":{t+=this.renderer.table(i);break}case"blockquote":{t+=this.renderer.blockquote(i);break}case"list":{t+=this.renderer.list(i);break}case"checkbox":{t+=this.renderer.checkbox(i);break}case"html":{t+=this.renderer.html(i);break}case"def":{t+=this.renderer.def(i);break}case"paragraph":{t+=this.renderer.paragraph(i);break}case"text":{t+=this.renderer.text(i);break}default:{let l='Token with "'+i.type+'" type was not found.';if(this.options.silent)return console.error(l),"";throw new Error(l)}}}return t}parseInline(e,t=this.renderer){this.renderer.parser=this;let a="";for(let n=0;n<e.length;n++){let i=e[n];if(this.options.extensions?.renderers?.[i.type]){let u=this.options.extensions.renderers[i.type].call({parser:this},i);if(u!==!1||!["escape","html","link","image","checkbox","strong","em","codespan","br","del","text"].includes(i.type)){a+=u||"";continue}}let l=i;switch(l.type){case"escape":{a+=t.text(l);break}case"html":{a+=t.html(l);break}case"link":{a+=t.link(l);break}case"image":{a+=t.image(l);break}case"checkbox":{a+=t.checkbox(l);break}case"strong":{a+=t.strong(l);break}case"em":{a+=t.em(l);break}case"codespan":{a+=t.codespan(l);break}case"br":{a+=t.br(l);break}case"del":{a+=t.del(l);break}case"text":{a+=t.text(l);break}default:{let u='Token with "'+l.type+'" type was not found.';if(this.options.silent)return console.error(u),"";throw new Error(u)}}}return a}},It=class{options;block;constructor(r){this.options=r||K0}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens","emStrongMask"]);static passThroughHooksRespectAsync=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(r){return r}postprocess(r){return r}processAllTokens(r){return r}emStrongMask(r){return r}provideLexer(r=this.block){return r?s0.lex:s0.lexInline}provideParser(r=this.block){return r?l0.parse:l0.parseInline}};function Y0(r,e){if(Array.isArray(e))for(let t=0;t<e.length;t++)r.push(e[t]);else r.push(e)}var W1=class{defaults=ga();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=l0;Renderer=yr;TextRenderer=Ta;Lexer=s0;Tokenizer=br;Hooks=It;constructor(...r){this.use(...r)}walkTokens(r,e){let t=[];for(let a of r)switch(Y0(t,e.call(this,a)),a.type){case"table":{let n=a;for(let i of n.header)Y0(t,this.walkTokens(i.tokens,e));for(let i of n.rows)for(let l of i)Y0(t,this.walkTokens(l.tokens,e));break}case"list":{let n=a;Y0(t,this.walkTokens(n.items,e));break}default:{let n=a;this.defaults.extensions?.childTokens?.[n.type]?this.defaults.extensions.childTokens[n.type].forEach(i=>{let l=n[i].flat(1/0);Y0(t,this.walkTokens(l,e))}):n.tokens&&Y0(t,this.walkTokens(n.tokens,e))}}return t}use(...r){let e=this.defaults.extensions||{renderers:{},childTokens:{}};return r.forEach(t=>{let a={...t};if(a.async=this.defaults.async||a.async||!1,t.extensions&&(t.extensions.forEach(n=>{if(!n.name)throw new Error("extension name required");if("renderer"in n){let i=e.renderers[n.name];i?e.renderers[n.name]=function(...l){let u=n.renderer.apply(this,l);return u===!1&&(u=i.apply(this,l)),u}:e.renderers[n.name]=n.renderer}if("tokenizer"in n){if(!n.level||n.level!=="block"&&n.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");let i=e[n.level];i?i.unshift(n.tokenizer):e[n.level]=[n.tokenizer],n.start&&(n.level==="block"?e.startBlock?e.startBlock.push(n.start):e.startBlock=[n.start]:n.level==="inline"&&(e.startInline?e.startInline.push(n.start):e.startInline=[n.start]))}"childTokens"in n&&n.childTokens&&(e.childTokens[n.name]=n.childTokens)}),a.extensions=e),t.renderer){let n=this.defaults.renderer||new yr(this.defaults);for(let i in t.renderer){if(!(i in n))throw new Error(`renderer '${i}' does not exist`);if(["options","parser"].includes(i))continue;let l=i,u=t.renderer[l],h=n[l];n[l]=(...d)=>{let f=u.apply(n,d);return f===!1&&(f=h.apply(n,d)),f||""}}a.renderer=n}if(t.tokenizer){let n=this.defaults.tokenizer||new br(this.defaults);for(let i in t.tokenizer){if(!(i in n))throw new Error(`tokenizer '${i}' does not exist`);if(["options","rules","lexer"].includes(i))continue;let l=i,u=t.tokenizer[l],h=n[l];n[l]=(...d)=>{let f=u.apply(n,d);return f===!1&&(f=h.apply(n,d)),f}}a.tokenizer=n}if(t.hooks){let n=this.defaults.hooks||new It;for(let i in t.hooks){if(!(i in n))throw new Error(`hook '${i}' does not exist`);if(["options","block"].includes(i))continue;let l=i,u=t.hooks[l],h=n[l];It.passThroughHooks.has(i)?n[l]=d=>{if(this.defaults.async&&It.passThroughHooksRespectAsync.has(i))return(async()=>{let b=await u.call(n,d);return h.call(n,b)})();let f=u.call(n,d);return h.call(n,f)}:n[l]=(...d)=>{if(this.defaults.async)return(async()=>{let b=await u.apply(n,d);return b===!1&&(b=await h.apply(n,d)),b})();let f=u.apply(n,d);return f===!1&&(f=h.apply(n,d)),f}}a.hooks=n}if(t.walkTokens){let n=this.defaults.walkTokens,i=t.walkTokens;a.walkTokens=function(l){let u=[];return u.push(i.call(this,l)),n&&Y0(u,n.call(this,l)),u}}this.defaults={...this.defaults,...a}}),this}setOptions(r){return this.defaults={...this.defaults,...r},this}lexer(r,e){return s0.lex(r,e??this.defaults)}parser(r,e){return l0.parse(r,e??this.defaults)}parseMarkdown(r){return(e,t)=>{let a={...t},n={...this.defaults,...a},i=this.onError(!!n.silent,!!n.async);if(this.defaults.async===!0&&a.async===!1)return i(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof e>"u"||e===null)return i(new Error("marked(): input parameter is undefined or null"));if(typeof e!="string")return i(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(e)+", string expected"));if(n.hooks&&(n.hooks.options=n,n.hooks.block=r),n.async)return(async()=>{let l=n.hooks?await n.hooks.preprocess(e):e,u=await(n.hooks?await n.hooks.provideLexer(r):r?s0.lex:s0.lexInline)(l,n),h=n.hooks?await n.hooks.processAllTokens(u):u;n.walkTokens&&await Promise.all(this.walkTokens(h,n.walkTokens));let d=await(n.hooks?await n.hooks.provideParser(r):r?l0.parse:l0.parseInline)(h,n);return n.hooks?await n.hooks.postprocess(d):d})().catch(i);try{n.hooks&&(e=n.hooks.preprocess(e));let l=(n.hooks?n.hooks.provideLexer(r):r?s0.lex:s0.lexInline)(e,n);n.hooks&&(l=n.hooks.processAllTokens(l)),n.walkTokens&&this.walkTokens(l,n.walkTokens);let u=(n.hooks?n.hooks.provideParser(r):r?l0.parse:l0.parseInline)(l,n);return n.hooks&&(u=n.hooks.postprocess(u)),u}catch(l){return i(l)}}}onError(r,e){return t=>{if(t.message+=`
Please report this to https://github.com/markedjs/marked.`,r){let a="<p>An error occurred:</p><pre>"+Ve(t.message+"",!0)+"</pre>";return e?Promise.resolve(a):a}if(e)return Promise.reject(t);throw t}}},Z0=new W1;function ne(r,e){return Z0.parse(r,e)}ne.options=ne.setOptions=function(r){return Z0.setOptions(r),ne.defaults=Z0.defaults,mi(ne.defaults),ne};ne.getDefaults=ga;ne.defaults=K0;function V1(...r){return Z0.use(...r),ne.defaults=Z0.defaults,mi(ne.defaults),ne}ne.use=V1;ne.walkTokens=function(r,e){return Z0.walkTokens(r,e)};ne.parseInline=Z0.parseInline;ne.Parser=l0;ne.parser=l0.parse;ne.Renderer=yr;ne.TextRenderer=Ta;ne.Lexer=s0;ne.lexer=s0.lex;ne.Tokenizer=br;ne.Hooks=It;ne.parse=ne;var $4=ne.options,U4=ne.setOptions,G4=ne.walkTokens,j4=ne.parseInline;var W4=l0.parse,V4=s0.lex;/*! @license DOMPurify 3.4.17 | (c) Cure53 and other contributors | Released under the Apache license 2.0 and Mozilla Public License 2.0 | github.com/cure53/DOMPurify/blob/3.4.17/LICENSE */function Y1(r,e){this.v=r,this.k=e}function wi(r,e){(e==null||e>r.length)&&(e=r.length);for(var t=0,a=Array(e);t<e;t++)a[t]=r[t];return a}function X1(r){if(Array.isArray(r))return r}function Z1(r,e){var t=r==null?null:typeof Symbol<"u"&&r[Symbol.iterator]||r["@@iterator"];if(t!=null){var a,n,i,l,u=[],h=!0,d=!1;try{if(i=(t=t.call(r)).next,e===0){if(Object(t)!==t)return;h=!1}else for(;!(h=(a=i.call(t)).done)&&(u.push(a.value),u.length!==e);h=!0);}catch(f){d=!0,n=f}finally{try{if(!h&&t.return!=null&&(l=t.return(),Object(l)!==l))return}finally{if(d)throw n}}return u}}function K1(){throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}/*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE */function Q1(r,e){return X1(r)||Z1(r,e)||J1(r,e)||K1()}function J1(r,e){if(r){if(typeof r=="string")return wi(r,e);var t={}.toString.call(r).slice(8,-1);return t==="Object"&&r.constructor&&(t=r.constructor.name),t==="Map"||t==="Set"?Array.from(r):t==="Arguments"||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t)?wi(r,e):void 0}}function xr(r){var e,t;function a(i,l){try{var u=r[i](l),h=u.value,d=h instanceof Y1;Promise.resolve(d?h.v:h).then(function(f){if(d){var b=i==="return"&&h.k?i:"next";if(!h.k||f.done)return a(b,f);f=r[b](f).value}n(!!u.done,f)},function(f){a("throw",f)})}catch(f){n(2,f)}}function n(i,l){i===2?e.reject(l):e.resolve({value:l,done:i}),(e=e.next)?a(e.key,e.arg):t=null}this._invoke=function(i,l){return new Promise(function(u,h){var d={key:i,arg:l,resolve:u,reject:h,next:null};t?t=t.next=d:(e=t=d,a(i,l))})},typeof r.return!="function"&&(this.return=void 0)}xr.prototype[typeof Symbol=="function"&&Symbol.asyncIterator||"@@asyncIterator"]=function(){return this},xr.prototype.next=function(r){return this._invoke("next",r)},xr.prototype.throw=function(r){return this._invoke("throw",r)},xr.prototype.return=function(r){return this._invoke("return",r)};var Li=Object.entries,ki=Object.setPrototypeOf,eo=Object.isFrozen,qi=Object.getPrototypeOf,Pi=Object.getOwnPropertyDescriptor,Ae=Object.freeze,Ee=Object.seal,ft=Object.create,Fi=typeof Reflect<"u"&&Reflect,Ba=Fi.apply,Na=Fi.construct;Ae||(Ae=function(e){return e});Ee||(Ee=function(e){return e});Ba||(Ba=function(e,t){for(var a=arguments.length,n=new Array(a>2?a-2:0),i=2;i<a;i++)n[i-2]=arguments[i];return e.apply(t,n)});Na||(Na=function(e){for(var t=arguments.length,a=new Array(t>1?t-1:0),n=1;n<t;n++)a[n-1]=arguments[n];return new e(...a)});var y0=ce(Array.prototype.forEach);Array.prototype.indexOf;var to=ce(Array.prototype.lastIndexOf),Si=ce(Array.prototype.pop),Lt=ce(Array.prototype.push),ro=ce(Array.prototype.slice),ao=ce(Array.prototype.splice),vt=Array.isArray,Aa=_i(Set),za=ce(Set.prototype.add),qt=ce(Set.prototype.has),Q0=ce(String.prototype.toLowerCase),Ma=ce(String.prototype.toString),Ti=ce(String.prototype.match),Pt=ce(String.prototype.replace),Ai=ce(String.prototype.indexOf),no=ce(String.prototype.trim),io=ce(Number.prototype.toString),so=ce(Boolean.prototype.toString),zi=typeof BigInt>"u"?null:ce(BigInt.prototype.toString),Mi=typeof Symbol>"u"?null:ce(Symbol.prototype.toString),_e=ce(Object.prototype.hasOwnProperty),Ft=ce(Object.prototype.toString),Me=ce(RegExp.prototype.test),x0=_i(TypeError);function ce(r){return function(e){e instanceof RegExp&&(e.lastIndex=0);for(var t=arguments.length,a=new Array(t>1?t-1:0),n=1;n<t;n++)a[n-1]=arguments[n];return Ba(r,e,a)}}function _i(r){return function(){for(var e=arguments.length,t=new Array(e),a=0;a<e;a++)t[a]=arguments[a];return Na(r,t)}}function J(r,e){let t=arguments.length>2&&arguments[2]!==void 0?arguments[2]:Q0;if(ki&&ki(r,null),!vt(e))return r;let a=e.length;for(;a--;){let n=e[a];if(typeof n=="string"){let i=t(n);i!==n&&(eo(e)||(e[a]=i),n=i)}r[n]=!0}return r}function lo(r){for(let e=0;e<r.length;e++)_e(r,e)||(r[e]=null);return r}function Ye(r){let e=ft(null);for(let a of Li(r)){var t=Q1(a,2);let n=t[0],i=t[1];_e(r,n)&&(vt(i)?e[n]=lo(i):i&&typeof i=="object"&&i.constructor===Object?e[n]=Ye(i):e[n]=i)}return e}function oo(r){switch(typeof r){case"string":return r;case"number":return io(r);case"boolean":return so(r);case"bigint":return zi?zi(r):"0";case"symbol":return Mi?Mi(r):"Symbol()";case"undefined":return Ft(r);case"function":case"object":{if(r===null)return Ft(r);let e=r,t=t0(e,"toString");if(typeof t=="function"){let a=t(e);return typeof a=="string"?a:Ft(a)}return Ft(r)}default:return Ft(r)}}function t0(r,e){for(;r!==null;){let a=Pi(r,e);if(a){if(a.get)return ce(a.get);if(typeof a.value=="function")return ce(a.value)}r=qi(r)}function t(){return null}return t}function uo(r,e){for(;r!==null;){let t=Pi(r,e);if(t)return t.get?ce(t.get):null;r=qi(r)}return null}function co(r){try{return Me(r,""),!0}catch{return!1}}var Ei=Ae(["a","abbr","acronym","address","area","article","aside","audio","b","bdi","bdo","big","blink","blockquote","body","br","button","canvas","caption","center","cite","code","col","colgroup","content","data","datalist","dd","decorator","del","details","dfn","dialog","dir","div","dl","dt","element","em","fieldset","figcaption","figure","font","footer","form","h1","h2","h3","h4","h5","h6","head","header","hgroup","hr","html","i","img","input","ins","kbd","label","legend","li","main","map","mark","marquee","menu","menuitem","meter","nav","nobr","ol","optgroup","option","output","p","picture","pre","progress","q","rp","rt","ruby","s","samp","search","section","select","shadow","slot","small","source","spacer","span","strike","strong","style","sub","summary","sup","table","tbody","td","template","textarea","tfoot","th","thead","time","tr","track","tt","u","ul","var","video","wbr"]),Ea=Ae(["svg","a","altglyph","altglyphdef","altglyphitem","animatecolor","animatemotion","animatetransform","circle","clippath","defs","desc","ellipse","enterkeyhint","exportparts","filter","font","g","glyph","glyphref","hkern","image","inputmode","line","lineargradient","marker","mask","metadata","mpath","part","path","pattern","polygon","polyline","radialgradient","rect","stop","style","switch","symbol","text","textpath","title","tref","tspan","view","vkern"]),Ra=Ae(["feBlend","feColorMatrix","feComponentTransfer","feComposite","feConvolveMatrix","feDiffuseLighting","feDisplacementMap","feDistantLight","feDropShadow","feFlood","feFuncA","feFuncB","feFuncG","feFuncR","feGaussianBlur","feImage","feMerge","feMergeNode","feMorphology","feOffset","fePointLight","feSpecularLighting","feSpotLight","feTile","feTurbulence"]),ho=Ae(["animate","color-profile","cursor","discard","font-face","font-face-format","font-face-name","font-face-src","font-face-uri","foreignobject","hatch","hatchpath","mesh","meshgradient","meshpatch","meshrow","missing-glyph","script","set","solidcolor","unknown","use"]),Da=Ae(["math","menclose","merror","mfenced","mfrac","mglyph","mi","mlabeledtr","mmultiscripts","mn","mo","mover","mpadded","mphantom","mroot","mrow","ms","mspace","msqrt","mstyle","msub","msup","msubsup","mtable","mtd","mtext","mtr","munder","munderover","mprescripts"]),mo=Ae(["maction","maligngroup","malignmark","mlongdiv","mscarries","mscarry","msgroup","mstack","msline","msrow","semantics","annotation","annotation-xml","mprescripts","none"]),Ri=Ae(["#text"]),Di=Ae(["accept","action","align","alt","autocapitalize","autocomplete","autopictureinpicture","autoplay","background","bgcolor","border","capture","cellpadding","cellspacing","checked","cite","class","clear","color","cols","colspan","command","commandfor","controls","controlslist","coords","crossorigin","datetime","decoding","default","dir","disabled","disablepictureinpicture","disableremoteplayback","download","draggable","enctype","enterkeyhint","exportparts","face","for","headers","height","hidden","high","href","hreflang","id","inert","inputmode","integrity","ismap","kind","label","lang","list","loading","loop","low","max","maxlength","media","method","min","minlength","multiple","muted","name","nonce","noshade","novalidate","nowrap","open","optimum","part","pattern","placeholder","playsinline","popover","popovertarget","popovertargetaction","poster","preload","pubdate","radiogroup","readonly","rel","required","rev","reversed","role","rows","rowspan","spellcheck","scope","selected","shape","size","sizes","slot","span","srclang","start","src","srcset","step","style","summary","tabindex","title","translate","type","usemap","valign","value","width","wrap","xmlns"]),Ca=Ae(["accent-height","accumulate","additive","alignment-baseline","amplitude","ascent","attributename","attributetype","azimuth","basefrequency","baseline-shift","begin","bias","by","class","clip","clippathunits","clip-path","clip-rule","color","color-interpolation","color-interpolation-filters","color-profile","color-rendering","cx","cy","d","dx","dy","diffuseconstant","direction","display","divisor","dominant-baseline","dur","edgemode","elevation","end","exponent","fill","fill-opacity","fill-rule","filter","filterunits","flood-color","flood-opacity","font-family","font-size","font-size-adjust","font-stretch","font-style","font-variant","font-weight","fx","fy","g1","g2","glyph-name","glyphref","gradientunits","gradienttransform","height","href","id","image-rendering","in","in2","intercept","k","k1","k2","k3","k4","kerning","keypoints","keysplines","keytimes","lang","lengthadjust","letter-spacing","kernelmatrix","kernelunitlength","lighting-color","local","marker-end","marker-mid","marker-start","markerheight","markerunits","markerwidth","maskcontentunits","maskunits","max","mask","mask-type","media","method","mode","min","name","numoctaves","offset","operator","opacity","order","orient","orientation","origin","overflow","paint-order","path","pathlength","patterncontentunits","patterntransform","patternunits","pointer-events","points","preservealpha","preserveaspectratio","primitiveunits","r","rx","ry","radius","refx","refy","repeatcount","repeatdur","restart","result","rotate","scale","seed","shape-rendering","slope","specularconstant","specularexponent","spreadmethod","startoffset","stddeviation","stitchtiles","stop-color","stop-opacity","stroke-dasharray","stroke-dashoffset","stroke-linecap","stroke-linejoin","stroke-miterlimit","stroke-opacity","stroke","stroke-width","style","surfacescale","systemlanguage","tabindex","tablevalues","targetx","targety","transform","transform-origin","text-anchor","text-decoration","text-orientation","text-rendering","textlength","type","u1","u2","unicode","values","vector-effect","viewbox","visibility","version","vert-adv-y","vert-origin-x","vert-origin-y","width","word-spacing","wrap","writing-mode","xchannelselector","ychannelselector","x","x1","x2","xmlns","y","y1","y2","z","zoomandpan"]),Ci=Ae(["accent","accentunder","align","bevelled","close","columnalign","columnlines","columnspacing","columnspan","denomalign","depth","dir","display","displaystyle","encoding","fence","frame","height","href","id","largeop","length","linethickness","lquote","lspace","mathbackground","mathcolor","mathsize","mathvariant","maxsize","minsize","movablelimits","notation","numalign","open","rowalign","rowlines","rowspacing","rowspan","rspace","rquote","scriptlevel","scriptminsize","scriptsizemultiplier","selection","separator","separators","stretchy","subscriptshift","supscriptshift","symmetric","voffset","width","xmlns"]),wr=Ae(["xlink:href","xml:id","xlink:title","xml:space","xmlns:xlink"]),po=Ee(/{{[\w\W]*|^[\w\W]*}}/g),fo=Ee(/<%[\w\W]*|^[\w\W]*%>/g),vo=Ee(/\${[\w\W]*/g),go=Ee(/^data-[\-\w.\u00B7-\uFFFF]+$/),bo=Ee(/^aria-[\-\w]+$/),Ii=Ee(/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i),yo=Ee(/^(?:\w+script|data):/i),xo=Ee(/[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g),wo=Ee(/^html$/i),ko=Ee(/^[a-z][.\w]*(-[.\w]+)+$/i),Ia=Ee(/<[/\w!]/g),Oi=Ee(/<[/\w]/g),So=Ee(/<\/no(script|embed|frames)/i),Bi=Ee(/\/>/i),be={element:1,attribute:2,text:3,cdataSection:4,entityReference:5,entityNode:6,processingInstruction:7,comment:8,document:9,documentType:10,documentFragment:11,notation:12},To=Ae(J({},["style","script","xmp","iframe","noembed","noframes","plaintext","noscript"])),Ao=function(){return typeof window>"u"?null:window},zo=function(e,t){if(typeof e!="object"||typeof e.createPolicy!="function")return null;let a=null,n="data-tt-policy-suffix";t&&t.hasAttribute(n)&&(a=t.getAttribute(n));let i="dompurify"+(a?"#"+a:"");try{return e.createPolicy(i,{createHTML(l){return l},createScriptURL(l){return l}})}catch{return console.warn("TrustedTypes policy "+i+" could not be created."),null}},Ni=function(){return{afterSanitizeAttributes:[],afterSanitizeElements:[],afterSanitizeShadowDOM:[],beforeSanitizeAttributes:[],beforeSanitizeElements:[],beforeSanitizeShadowDOM:[],uponSanitizeAttribute:[],uponSanitizeElement:[],uponSanitizeShadowNode:[]}},B0=function(e,t,a,n){return _e(e,t)&&vt(e[t])?J(n.base?Ye(n.base):{},e[t],n.transform):a},Oa=function(e,t,a){let n=_e(e,t)?e[t]:void 0;return n&&typeof n=="object"?Ye(n):a()};function Hi(){let r=arguments.length>0&&arguments[0]!==void 0?arguments[0]:Ao(),e=A=>Hi(A);if(e.version="3.4.17",e.removed=[],!r||!r.document||r.document.nodeType!==be.document||!r.Element)return e.isSupported=!1,e;let t=r.document,a=t,n=a.currentScript;r.DocumentFragment;let i=r.HTMLTemplateElement,l=r.Node,u=r.Element,h=r.NodeFilter;r.NamedNodeMap===void 0&&(r.NamedNodeMap||r.MozNamedAttrMap),r.HTMLFormElement;let d=r.DOMParser,f=r.trustedTypes,b=u.prototype,k=t0(b,"cloneNode"),w=t0(b,"remove"),M=t0(b,"removeAttributeNode"),D=t0(b,"nextSibling"),E=t0(b,"childNodes"),N=t0(b,"parentNode"),B=t0(b,"shadowRoot"),F=t0(b,"attributes"),H=l&&l.prototype?t0(l.prototype,"nodeType"):null,V=l&&l.prototype?t0(l.prototype,"nodeName"):null,j=l&&l.prototype?t0(l.prototype,"ownerDocument"):null,$=function(p){return H?H(p):p.nodeType},X=function(p){return V?V(p):p.nodeName},ee=uo(b,"namespaceURI"),ae=function(p){return ee?ee(p):p.namespaceURI};if(typeof i=="function"){let A=t.createElement("template");A.content&&A.content.ownerDocument&&(t=A.content.ownerDocument)}let Q,ie="",$e,Ue=!1,ze=0,n0=function(){if(ze>0)throw x0('A configured TRUSTED_TYPES_POLICY callback (createHTML or createScriptURL) must not call DOMPurify.sanitize, as that causes infinite recursion. Do not pass a policy whose callbacks wrap DOMPurify as TRUSTED_TYPES_POLICY; see the "DOMPurify and Trusted Types" section of the README.')},Ge=function(p){n0(),ze++;try{return Q.createHTML(p)}finally{ze--}},M0=function(p){n0(),ze++;try{return Q.createScriptURL(p)}finally{ze--}},Tt=function(){return Ue||($e=zo(f,n),Ue=!0),$e},je=t,Qe=je.implementation,E0=je.createNodeIterator,We=je.createDocumentFragment,rt=je.getElementsByTagName,Qt=a.importNode,le=Ni();e.isSupported=typeof Li=="function"&&typeof N=="function"&&Qe&&Qe.createHTMLDocument!==void 0;let R0=po,Jt=fo,D0=vo,er=go,tr=bo,rr=yo,U0=xo,at=ko,ar=Ii,ue=null,At=J({},[...Ei,...Ea,...Ra,...Da,...Ri]),oe=null,nt=J({},[...Di,...Ca,...Ci,...wr]),Ce=Object.seal(ft(null,{tagNameCheck:{writable:!0,configurable:!1,enumerable:!0,value:null},attributeNameCheck:{writable:!0,configurable:!1,enumerable:!0,value:null},allowCustomizedBuiltInElements:{writable:!0,configurable:!1,enumerable:!0,value:!1}})),G0=null,nr=null,Je=Object.seal(ft(null,{tagCheck:{writable:!0,configurable:!1,enumerable:!0,value:null},attributeCheck:{writable:!0,configurable:!1,enumerable:!0,value:null}})),zt=!0,it=!0,ir=!1,Mt=!0,qe=!1,e0=!0,j0=!1,Yr=!1,sr=null,lr=null,Xr=!1,st=!1,or=!1,ur=!1,In=!0,On=!1,Bn="user-content-",Zr=!0,Kr=!1,W0=null,lt={},V0=null,Nn=J({},["annotation-xml","audio","colgroup","desc","foreignobject","head","iframe","math","mi","mn","mo","ms","mtext","noembed","noframes","noscript","plaintext","script","selectedcontent","style","svg","template","thead","title","video","xmp"]),Ln=null,qn=J({},["audio","video","img","source","image","track"]),Pn=null,Fn=J({},["alt","class","for","id","label","name","pattern","placeholder","role","summary","title","value","style","xmlns"]),cr="http://www.w3.org/1998/Math/MathML",hr="http://www.w3.org/2000/svg",u0="http://www.w3.org/1999/xhtml",ot=u0,Qr=!1,Jr=null,xl=J({},[cr,hr,u0],Ma),_n=Ae(["mi","mo","mn","ms","mtext"]),ea=J({},_n),Hn=Ae(["annotation-xml"]),ta=J({},Hn),wl=J({},["title","style","font","a","script"]),Et=null,kl=["application/xhtml+xml","text/html"],Sl="text/html",ge=null,ut=null,Tl=t.createElement("form"),$n=function(p){return p instanceof RegExp||p instanceof Function},ra=function(){let p=arguments.length>0&&arguments[0]!==void 0?arguments[0]:{};if(ut&&ut===p)return;(!p||typeof p!="object")&&(p={}),p=Ye(p),Et=kl.indexOf(p.PARSER_MEDIA_TYPE)===-1?Sl:p.PARSER_MEDIA_TYPE,ge=Et==="application/xhtml+xml"?Ma:Q0,ue=B0(p,"ALLOWED_TAGS",At,{transform:ge}),oe=B0(p,"ALLOWED_ATTR",nt,{transform:ge}),Jr=B0(p,"ALLOWED_NAMESPACES",xl,{transform:Ma}),Pn=B0(p,"ADD_URI_SAFE_ATTR",Fn,{transform:ge,base:Fn}),Ln=B0(p,"ADD_DATA_URI_TAGS",qn,{transform:ge,base:qn}),V0=B0(p,"FORBID_CONTENTS",Nn,{transform:ge}),G0=B0(p,"FORBID_TAGS",Ye({}),{transform:ge}),nr=B0(p,"FORBID_ATTR",Ye({}),{transform:ge}),lt=_e(p,"USE_PROFILES")?p.USE_PROFILES&&typeof p.USE_PROFILES=="object"?Ye(p.USE_PROFILES):p.USE_PROFILES:!1,zt=p.ALLOW_ARIA_ATTR!==!1,it=p.ALLOW_DATA_ATTR!==!1,ir=p.ALLOW_UNKNOWN_PROTOCOLS||!1,Mt=p.ALLOW_SELF_CLOSE_IN_ATTR!==!1,qe=p.SAFE_FOR_TEMPLATES||!1,e0=p.SAFE_FOR_XML!==!1,j0=p.WHOLE_DOCUMENT||!1,st=p.RETURN_DOM||!1,or=p.RETURN_DOM_FRAGMENT||!1,ur=p.RETURN_TRUSTED_TYPE||!1,Xr=p.FORCE_BODY||!1,In=p.SANITIZE_DOM!==!1,On=p.SANITIZE_NAMED_PROPS||!1,Zr=p.KEEP_CONTENT!==!1,Kr=p.IN_PLACE||!1,ar=co(p.ALLOWED_URI_REGEXP)?p.ALLOWED_URI_REGEXP:Ii,ot=typeof p.NAMESPACE=="string"?p.NAMESPACE:u0,ea=Oa(p,"MATHML_TEXT_INTEGRATION_POINTS",()=>J({},_n)),ta=Oa(p,"HTML_INTEGRATION_POINTS",()=>J({},Hn));let x=Oa(p,"CUSTOM_ELEMENT_HANDLING",()=>ft(null));if(Ce=ft(null),_e(x,"tagNameCheck")&&$n(x.tagNameCheck)&&(Ce.tagNameCheck=x.tagNameCheck),_e(x,"attributeNameCheck")&&$n(x.attributeNameCheck)&&(Ce.attributeNameCheck=x.attributeNameCheck),_e(x,"allowCustomizedBuiltInElements")&&typeof x.allowCustomizedBuiltInElements=="boolean"&&(Ce.allowCustomizedBuiltInElements=x.allowCustomizedBuiltInElements),Ee(Ce),qe&&(it=!1),or&&(st=!0),lt&&(ue=J({},Ri),oe=ft(null),lt.html===!0&&(J(ue,Ei),J(oe,Di)),lt.svg===!0&&(J(ue,Ea),J(oe,Ca),J(oe,wr)),lt.svgFilters===!0&&(J(ue,Ra),J(oe,Ca),J(oe,wr)),lt.mathMl===!0&&(J(ue,Da),J(oe,Ci),J(oe,wr))),Je.tagCheck=null,Je.attributeCheck=null,_e(p,"ADD_TAGS")&&(typeof p.ADD_TAGS=="function"?Je.tagCheck=p.ADD_TAGS:vt(p.ADD_TAGS)&&(ue===At&&(ue=Ye(ue)),J(ue,p.ADD_TAGS,ge))),_e(p,"ADD_ATTR")&&(typeof p.ADD_ATTR=="function"?Je.attributeCheck=p.ADD_ATTR:vt(p.ADD_ATTR)&&(oe===nt&&(oe=Ye(oe)),J(oe,p.ADD_ATTR,ge))),_e(p,"ADD_FORBID_CONTENTS")&&vt(p.ADD_FORBID_CONTENTS)&&(V0===Nn&&(V0=Ye(V0)),J(V0,p.ADD_FORBID_CONTENTS,ge)),Zr&&(ue["#text"]=!0),j0&&J(ue,["html","head","body"]),ue.table&&(J(ue,["tbody"]),delete G0.tbody),p.TRUSTED_TYPES_POLICY){if(typeof p.TRUSTED_TYPES_POLICY.createHTML!="function")throw x0('TRUSTED_TYPES_POLICY configuration option must provide a "createHTML" hook.');if(typeof p.TRUSTED_TYPES_POLICY.createScriptURL!="function")throw x0('TRUSTED_TYPES_POLICY configuration option must provide a "createScriptURL" hook.');let S=Q;Q=p.TRUSTED_TYPES_POLICY;try{ie=Ge("")}catch(T){throw Q=S,T}}else p.TRUSTED_TYPES_POLICY===null?(Q=void 0,ie=""):(Q===void 0&&(Q=Tt()),Q&&typeof ie=="string"&&(ie=Ge("")));Ae&&Ae(p),ut=p},Un=J({},[...Ea,...Ra,...ho]),Gn=J({},[...Da,...mo]),Al=function(p,x,S){return x.namespaceURI===u0?p==="svg":x.namespaceURI===cr?p==="svg"&&(S==="annotation-xml"||ea[S]):!!Un[p]},zl=function(p,x,S){return x.namespaceURI===u0?p==="math":x.namespaceURI===hr?p==="math"&&ta[S]:!!Gn[p]},Ml=function(p,x,S){return x.namespaceURI===hr&&!ta[S]||x.namespaceURI===cr&&!ea[S]?!1:!Gn[p]&&(wl[p]||!Un[p])},El=function(p){let x=ae(p),S=Q0(X(p)),T=N(p),P,U;return T&&$(T)===be.element?(P={namespaceURI:ae(T)},U=Q0(X(T))):(P={namespaceURI:ot},U="template"),Jr[x]?x===hr?Al(S,P,U):x===cr?zl(S,P,U):x===u0?Ml(S,P,U):!!(Et==="application/xhtml+xml"&&Jr[x]):!1},C0=function(p){Lt(e.removed,{element:p});try{N(p).removeChild(p)}catch{if(w(p),!N(p))throw x0("a node selected for removal could not be detached from its tree and cannot be safely returned; refusing to sanitize in place")}},jn=function(p,x,S){try{M(p,x)}catch{try{p.removeAttribute(S)}catch{}}},aa=function(p){ia(p);let x=E(p);x&&y0(ro(x),T=>{try{w(T)}catch{}});let S=$(p)===be.element?F(p):null;if(S)for(let T=S.length-1;T>=0;--T){let P=S[T],U=P&&P.name;typeof U=="string"&&jn(p,P,U)}},ct=function(p,x,S){if(!S)try{S=x.getAttributeNode(p)}catch{S=null}Lt(e.removed,{attribute:S||null,from:x});try{S?M(x,S):x.removeAttribute(p)}catch{try{x.removeAttribute(p)}catch{}}if(p==="is")if(st||or)try{C0(x)}catch{}else try{x.setAttribute(p,"")}catch{}},Wn=function(p){let x=F(p);if(x)for(let S=x.length-1;S>=0;--S){let T=x[S],P=T&&T.name;typeof P!="string"||oe[ge(P)]||jn(p,T,P)}},na=function(p,x){let S=arguments.length>2&&arguments[2]!==void 0?arguments[2]:!1,T=[p];for(;T.length>0;){let P=T.pop();if(x(P)===!1)continue;if(S&&$(P)===be.element){let Z=B(P);I0(Z)&&T.push(Z)}let U=E(P);if(U)for(let Z=U.length-1;Z>=0;--Z)T.push(U[Z])}},ia=function(p){na(p,x=>{$(x)===be.element&&Wn(x)})},sa=function(p){let x=[];return na(p,S=>{x.push(S)},!0),x},Rl=function(p,x){let S=Aa();y0(sa(p),T=>{$(T)===be.element&&za(S,T)}),y0(x,T=>{$(T)===be.element&&!qt(S,T)&&Wn(T)})},Vn=function(p,x){let S=!1;return y0(e.removed,T=>{T.element&&(S=S||T.element===p,ia(T.element))}),Rl(p,x),S},Dl=8,Cl=function(p,x){let S=W0,T=null,P=()=>(T||(T=Aa(),y0(x,U=>{za(T,U)})),T);for(let U=0;;U++){let Z=sa(p),we=[p],c0=!1;if(y0(Z,Ie=>{$(Ie)===be.documentFragment?Lt(we,Ie):!c0&&!qt(S,Ie)&&(c0=qt(P(),Ie))}),!c0)return;if(U>=Dl)throw x0("the tree kept changing during in-place sanitization; refusing to return it");y0(we,(Ie,Pe)=>{Il(Ie,Pe>0,p,P())})}},Il=function(p,x,S,T){let P=la(p),U;for(;U=P.nextNode();)!qt(T,U)||qt(W0,U)||(x&&i0(le.uponSanitizeShadowNode,U,null),ua(U,S),ca(U,S),I0(U.content)&&Dt(U.content))},Ol=function(p){W0&&za(W0,p)},Yn=function(p,x){return e0?p==="patchsrc"?!0:p==="for"&&x!=="label"&&x!=="output":!1},Bl=function(p){e0&&na(p,x=>{let S=$(x);if(S===be.processingInstruction||S===be.comment&&Me(Oi,x.data)){try{w(x)}catch{}return!1}if(S===be.element){let T=x,P=ge(X(x));try{T.hasAttribute&&T.hasAttribute("patchsrc")&&T.removeAttribute("patchsrc"),T.hasAttribute&&T.hasAttribute("for")&&Yn("for",P)&&T.removeAttribute("for")}catch{}}return!0})},Xn=function(p){let x=null,S=null;if(Xr)p="<remove></remove>"+p;else{let U=Ti(p,/^[\r\n\t ]+/);S=U&&U[0]}Et==="application/xhtml+xml"&&ot===u0&&(p='<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>'+p+"</body></html>");let T=Q?Ge(p):p;if(ot===u0)try{x=new d().parseFromString(T,Et)}catch{}if(!x||!x.documentElement){x=Qe.createDocument(ot,"template",null);try{x.documentElement.innerHTML=Qr?ie:T}catch{}}let P=x.body||x.documentElement;return p&&S&&P.insertBefore(t.createTextNode(S),P.childNodes[0]||null),ot===u0?rt.call(x,j0?"html":"body")[0]:j0?x.documentElement:P},la=function(p){let x=j?j(p):p.ownerDocument;return E0.call(x||p,p,h.SHOW_ELEMENT|h.SHOW_COMMENT|h.SHOW_TEXT|h.SHOW_PROCESSING_INSTRUCTION|h.SHOW_CDATA_SECTION,null)},mr=function(p){return p=Pt(p,R0," "),p=Pt(p,Jt," "),p=Pt(p,D0," "),p},oa=function(p){var x;Zn(p);let S=(x=p.querySelectorAll)===null||x===void 0?void 0:x.call(p,"template");S&&y0(S,T=>{I0(T.content)&&oa(T.content)})},Zn=function(p){p.normalize();let x=j?j(p):p.ownerDocument,S=E0.call(x||p,p,h.SHOW_TEXT|h.SHOW_COMMENT|h.SHOW_CDATA_SECTION|h.SHOW_PROCESSING_INSTRUCTION,null),T=S.nextNode();for(;T;)T.data=mr(T.data),T=S.nextNode()},dr=function(p){let x=V?V(p):null;return typeof x!="string"||ge(x)!=="form"?!1:typeof p.nodeName!="string"||typeof p.textContent!="string"||typeof p.removeChild!="function"||p.attributes!==F(p)||typeof p.removeAttribute!="function"||typeof p.removeAttributeNode!="function"||typeof p.getAttributeNode!="function"||typeof p.setAttribute!="function"||typeof p.namespaceURI!="string"||typeof p.insertBefore!="function"||typeof p.hasChildNodes!="function"||p.nodeType!==H(p)||p.childNodes!==E(p)},I0=function(p){if(!H||typeof p!="object"||p===null)return!1;try{return H(p)===be.documentFragment}catch{return!1}},Rt=function(p){if(!H||typeof p!="object"||p===null)return!1;try{return typeof H(p)=="number"}catch{return!1}};function i0(A,p,x){A.length!==0&&y0(A,S=>{S.call(e,p,x,ut)})}let Nl=function(p,x){return!!(e0&&p.hasChildNodes()&&!Rt(p.firstElementChild)&&Me(Ia,p.textContent)&&Me(Ia,p.innerHTML)||e0&&To[x]&&$(p)===be.element&&ae(p)===u0&&(Rt(p.firstElementChild)||typeof p.textContent=="string"&&Me(Ia,p.textContent))||p.nodeType===be.processingInstruction||e0&&p.nodeType===be.comment&&Me(Oi,p.data))},pr=function(p,x){if(p instanceof RegExp)return Me(p,x);if(p instanceof Function){for(var S=arguments.length,T=new Array(S>2?S-2:0),P=2;P<S;P++)T[P-2]=arguments[P];return!!p(x,...T)}return!1},Ll=function(p,x,S){if(!G0[x]&&Jn(x)&&pr(Ce.tagNameCheck,x))return!1;if(Zr&&!V0[x]&&!V0[Q0(x)]){let T=N(p),P=E(p);if(P&&T){let U=P.length;for(let Z=U-1;Z>=0;--Z){let we=p===S?k(P[Z],!0):P[Z];T.insertBefore(we,D(p))}}}return C0(p),!0},Kn=function(p,x,S,T){return p.length===0?x:x===S||x===T?Ye(x):x},ht=function(p,x){return p===x||N(p)!==null?!1:(Kr&&ia(p),!0)},ua=function(p,x){if(Ol(p),i0(le.beforeSanitizeElements,p,null),ht(p,x))return!0;if(dr(p))return C0(p),!0;let S=ge(X(p));if(ue=Kn(le.uponSanitizeElement,ue,At,sr),i0(le.uponSanitizeElement,p,{tagName:S,allowedTags:ue}),ht(p,x))return!0;if(Nl(p,S))return C0(p),!0;if(G0[S]||!(Je.tagCheck instanceof Function&&Je.tagCheck(S))&&!ue[S]){let T=Ll(p,S,x);return T===!1&&(i0(le.afterSanitizeElements,p,null),ht(p,x))?!0:T}if($(p)===be.element&&!El(p)||(S==="noscript"||S==="noembed"||S==="noframes")&&Me(So,p.innerHTML))return C0(p),!0;if(qe&&p.nodeType===be.text){let T=mr(p.textContent);p.textContent!==T&&(Lt(e.removed,{element:p.cloneNode()}),p.textContent=T)}return i0(le.afterSanitizeElements,p,null),ht(p,x)},Qn=function(p,x,S){if(nr[x]||Yn(x,p)||In&&(x==="id"||x==="name")&&(S in t||S in Tl))return!1;let T=oe[x]||Je.attributeCheck instanceof Function&&Je.attributeCheck(x,p);return it&&Me(er,x)||zt&&Me(tr,x)?!0:T?Pn[x]||Me(ar,Pt(S,U0,""))||(x==="src"||x==="xlink:href"||x==="href")&&p!=="script"&&Ai(S,"data:")===0&&Ln[p]||ir&&!Me(rr,Pt(S,U0,""))?!0:!S:Jn(p)&&pr(Ce.tagNameCheck,p)&&pr(Ce.attributeNameCheck,x,p)||x==="is"&&Ce.allowCustomizedBuiltInElements&&pr(Ce.tagNameCheck,S)},ql=J({},["annotation-xml","color-profile","font-face","font-face-format","font-face-name","font-face-src","font-face-uri","missing-glyph"]),Jn=function(p){return!ql[Q0(p)]&&Me(at,p)},Pl=function(p,x,S,T){if(Q&&typeof f=="object"&&typeof f.getAttributeType=="function"&&!S)switch(f.getAttributeType(p,x)){case"TrustedHTML":return Ge(T);case"TrustedScriptURL":return M0(T)}return T},Fl=function(p,x,S,T){try{return S?p.setAttributeNS(S,x,T):p.setAttribute(x,T),dr(p)?(C0(p),!1):!0}catch{return ct(x,p),!1}},ei=function(p,x){return e0&&Me(/((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i,x)?!0:Q0(p)==="attributename"&&Ti(x,"href")!==null},ca=function(p,x){if(i0(le.beforeSanitizeAttributes,p,null),ht(p,x))return;let S=p.attributes;if(!S||dr(p))return;oe=Kn(le.uponSanitizeAttribute,oe,nt,lr);let T={attrName:"",attrValue:"",keepAttr:!0,allowedAttributes:oe,forceKeepAttr:void 0},P=S.length,U=ge(p.nodeName);for(;P--;){let Z=S[P],we=Z.name,c0=Z.namespaceURI,Ie=Z.value,Pe=ge(we),mt=Ie,Fe=we==="value"?mt:no(mt),ti=!1;if(T.attrName=Pe,T.attrValue=Fe,T.keepAttr=!0,T.forceKeepAttr=void 0,i0(le.uponSanitizeAttribute,p,T),Fe=T.attrValue,On&&(Pe==="id"||Pe==="name")&&Ai(Fe,Bn)!==0&&(ct(we,p,Z),Fe=Bn+Fe,ti=!0),ei(we,Fe)){ct(we,p,Z);continue}if(!T.forceKeepAttr){if(!T.keepAttr){ct(we,p,Z);continue}if(!Mt&&Me(Bi,Fe)){ct(we,p,Z);continue}if(qe&&(Fe=mr(Fe)),!Qn(U,Pe,Fe)){ct(we,p,Z);continue}Fe=Pl(U,Pe,c0,Fe),Fe!==mt&&Fl(p,we,c0,Fe)&&ti&&Si(e.removed)}}i0(le.afterSanitizeAttributes,p,null),ht(p,x)},Dt=function(p){let x=null,S=la(p);for(i0(le.beforeSanitizeShadowDOM,p,null);x=S.nextNode();)if(i0(le.uponSanitizeShadowNode,x,null),ua(x,p),ca(x,p),I0(x.content)&&Dt(x.content),$(x)===be.element){let T=B(x);I0(T)&&(ha(T),Dt(T))}qe&&Zn(p),i0(le.afterSanitizeShadowDOM,p,null)},ha=function(p){let x=[{node:p,shadow:null}];for(;x.length>0;){let S=x.pop();if(S.shadow){Dt(S.shadow);continue}let T=S.node,P=$(T)===be.element,U=E(T);if(U)for(let Z=U.length-1;Z>=0;--Z)x.push({node:U[Z],shadow:null});if(P){let Z=V?V(T):null;if(typeof Z=="string"&&ge(Z)==="template"){let we=T.content;I0(we)&&x.push({node:we,shadow:null})}}if(P){let Z=B(T);I0(Z)&&x.push({node:null,shadow:Z},{node:Z,shadow:null})}}};return e.sanitize=function(A){let p=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},x=null,S=null,T=null,P=null;if(Qr=!A,Qr&&(A="<!-->"),typeof A!="string"&&!Rt(A)&&(A=oo(A),typeof A!="string"))throw x0("dirty is not a string, aborting");if(!e.isSupported)return A;Yr?(ue=sr,oe=lr):ra(p),(le.uponSanitizeElement.length>0||le.uponSanitizeAttribute.length>0)&&(ue=Ye(ue)),le.uponSanitizeAttribute.length>0&&(oe=Ye(oe)),e.removed=[];let U=Kr&&typeof A!="string"&&Rt(A),Z=[],we=W0;if(U){Bl(A);let Pe=X(A);if(typeof Pe=="string"){let mt=ge(Pe);if(!ue[mt]||G0[mt])throw aa(A),x0("root node is forbidden and cannot be sanitized in-place")}if(dr(A))throw aa(A),x0("root node is clobbered and cannot be sanitized in-place");Z=sa(A),W0=Aa()}else if(Rt(A))x=Xn("<!---->"),S=x.ownerDocument.importNode(A,!0),S.nodeType===be.element&&S.nodeName==="BODY"||S.nodeName==="HTML"?x=S:x.appendChild(S),ha(x);else{if(!st&&!qe&&!j0&&A.indexOf("<")===-1)return Q&&ur?Ge(A):A;if(x=Xn(A),!x)return st?null:ur?ie:""}x&&Xr&&C0(x.firstChild);let c0=U?A:x;try{U&&ha(A);let Pe=la(c0);for(;T=Pe.nextNode();)ua(T,c0),ca(T,c0),I0(T.content)&&Dt(T.content);U&&Cl(A,Z)}catch(Pe){throw U&&(aa(A),Vn(A,Z)),Pe}finally{W0=we}if(U){if(Vn(A,Z))throw x0("a node selected for removal could not be safely returned; refusing to sanitize in place");return qe&&oa(A),A}if(st){if(qe&&oa(x),or)for(P=We.call(x.ownerDocument);x.firstChild;)P.appendChild(x.firstChild);else P=x;return(oe.shadowroot||oe.shadowrootmode)&&(P=Qt.call(a,P,!0)),P}let Ie=j0?x.outerHTML:x.innerHTML;return j0&&ue["!doctype"]&&x.ownerDocument&&x.ownerDocument.doctype&&x.ownerDocument.doctype.name&&Me(wo,x.ownerDocument.doctype.name)&&(Ie="<!DOCTYPE "+x.ownerDocument.doctype.name+`>
`+Ie),qe&&(Ie=mr(Ie)),Q&&ur?Ge(Ie):Ie},e.setConfig=function(){let A=arguments.length>0&&arguments[0]!==void 0?arguments[0]:{};ra(A),Yr=!0,sr=ue,lr=oe},e.clearConfig=function(){ut=null,Yr=!1,sr=null,lr=null,Q=$e,ie=""},e.isValidAttribute=function(A,p,x){ut||ra({});let S=ge(A),T=ge(p);return typeof x=="string"&&(ei(p,x)||!Mt&&Me(Bi,x))?!1:Qn(S,T,x)},e.addHook=function(A,p){typeof p=="function"&&_e(le,A)&&Lt(le[A],p)},e.removeHook=function(A,p){if(_e(le,A)){if(p!==void 0){let x=to(le[A],p);return x===-1?void 0:ao(le[A],x,1)[0]}return Si(le[A])}},e.removeHooks=function(A){_e(le,A)&&(le[A]=[])},e.removeAllHooks=function(){le=Ni()},e}var $i=Hi();var C=class r extends Error{constructor(e,t){var a="KaTeX parse error: "+e,n,i,l=t&&t.loc;if(l&&l.start<=l.end){var u=l.lexer.input;n=l.start,i=l.end,n===u.length?a+=" at end of input: ":a+=" at position "+(n+1)+": ";var h=u.slice(n,i).replace(/[^]/g,"$&\u0332"),d;n>15?d="\u2026"+u.slice(n-15,n):d=u.slice(0,n);var f;i+15<u.length?f=u.slice(i,i+15)+"\u2026":f=u.slice(i),a+=d+h+f}super(a),this.name="ParseError",this.position=void 0,this.length=void 0,this.rawMessage=void 0,Object.setPrototypeOf(this,r.prototype),this.position=n,n!=null&&i!=null&&(this.length=i-n),this.rawMessage=e}},Mo=/([A-Z])/g,Eo=r=>r.replace(Mo,"-$1").toLowerCase(),Ro={"&":"&amp;",">":"&gt;","<":"&lt;",'"':"&quot;","'":"&#x27;"},Do=/[&><"']/g,De=r=>String(r).replace(Do,e=>Ro[e]),Cr=r=>r.type==="ordgroup"||r.type==="color"?r.body.length===1?Cr(r.body[0]):r:r.type==="font"?Cr(r.body):r,Co=new Set(["mathord","textord","atom"]),T0=r=>Co.has(Cr(r).type),Io=r=>{var e=/^[\x00-\x20]*([^\\/#?]*?)(:|&#0*58|&#x0*3a|&colon)/i.exec(r);return e?e[2]!==":"||!/^[a-zA-Z][a-zA-Z0-9+\-.]*$/.test(e[1])?null:e[1].toLowerCase():"_relative"},Xa={displayMode:{type:"boolean",description:"Render math in display mode, which puts the math in display style (so \\int and \\sum are large, for example), and centers the math on the page on its own line.",cli:"-d, --display-mode"},output:{type:{enum:["htmlAndMathml","html","mathml"]},description:"Determines the markup language of the output.",cli:"-F, --format <type>"},leqno:{type:"boolean",description:"Render display math in leqno style (left-justified tags)."},fleqn:{type:"boolean",description:"Render display math flush left."},throwOnError:{type:"boolean",default:!0,cli:"-t, --no-throw-on-error",cliDescription:"Render errors (in the color given by --error-color) instead of throwing a ParseError exception when encountering an error."},errorColor:{type:"string",default:"#cc0000",cli:"-c, --error-color <color>",cliDescription:"A color string given in the format 'rgb' or 'rrggbb' (no #). This option determines the color of errors rendered by the -t option.",cliProcessor:r=>"#"+r},macros:{type:"object",cli:"-m, --macro <def>",cliDescription:"Define custom macro of the form '\\foo:expansion' (use multiple -m arguments for multiple macros).",cliDefault:[],cliProcessor:(r,e)=>(e.push(r),e)},minRuleThickness:{type:"number",description:"Specifies a minimum thickness, in ems, for fraction lines, `\\sqrt` top lines, `{array}` vertical lines, `\\hline`, `\\hdashline`, `\\underline`, `\\overline`, and the borders of `\\fbox`, `\\boxed`, and `\\fcolorbox`.",processor:r=>Math.max(0,r),cli:"--min-rule-thickness <size>",cliProcessor:parseFloat},colorIsTextColor:{type:"boolean",description:"Makes \\color behave like LaTeX's 2-argument \\textcolor, instead of LaTeX's one-argument \\color mode change.",cli:"-b, --color-is-text-color"},strict:{type:[{enum:["warn","ignore","error"]},"boolean","function"],description:"Turn on strict / LaTeX faithfulness mode, which throws an error if the input uses features that are not supported by LaTeX.",cli:"-S, --strict",cliDefault:!1},trust:{type:["boolean","function"],description:"Trust the input, enabling all HTML features such as \\url.",cli:"-T, --trust"},maxSize:{type:"number",default:1/0,description:"If non-zero, all user-specified sizes, e.g. in \\rule{500em}{500em}, will be capped to maxSize ems. Otherwise, elements and spaces can be arbitrarily large",processor:r=>Math.max(0,r),cli:"-s, --max-size <n>",cliProcessor:parseInt},maxExpand:{type:"number",default:1e3,description:"Limit the number of macro expansions to the specified number, to prevent e.g. infinite macro loops. If set to Infinity, the macro expander will try to fully expand as in LaTeX.",processor:r=>Math.max(0,r),cli:"-e, --max-expand <n>",cliProcessor:r=>r==="Infinity"?1/0:parseInt(r)},globalGroup:{type:"boolean",cli:!1}};function Oo(r){if(typeof r!="string")return r.enum[0];switch(r){case"boolean":return!1;case"string":return"";case"number":return 0;case"object":return{};default:throw new Error("Unexpected schema type; settings must declare an explicit default.")}}function Bo(r){if(Object.prototype.hasOwnProperty.call(r,"default")&&r.default!==void 0)return r.default;var e=Array.isArray(r.type)?r.type[0]:r.type;return Oo(e)}function No(r,e,t,a){var n=Object.prototype.hasOwnProperty.call(t,e)?t[e]:void 0,i=Object.prototype.hasOwnProperty.call(a,"processor")?a.processor:void 0;r[e]=n!==void 0?i?i(n):n:Bo(a)}var Gt=class{constructor(e){e===void 0&&(e={}),this.displayMode=void 0,this.output=void 0,this.leqno=void 0,this.fleqn=void 0,this.throwOnError=void 0,this.errorColor=void 0,this.macros=void 0,this.minRuleThickness=void 0,this.colorIsTextColor=void 0,this.strict=void 0,this.trust=void 0,this.maxSize=void 0,this.maxExpand=void 0,this.globalGroup=void 0,e=e||{};for(var t of Object.keys(Xa)){var a=Xa[t];a&&No(this,t,e,a)}}reportNonstrict(e,t,a){var n=this.strict;if(typeof n=="function"&&(n=n(e,t,a)),!(!n||n==="ignore")){if(n===!0||n==="error")throw new C("LaTeX-incompatible input and strict mode is set to 'error': "+(t+" ["+e+"]"),a);n==="warn"?typeof console<"u"&&console.warn("LaTeX-incompatible input and strict mode is set to 'warn': "+(t+" ["+e+"]")):typeof console<"u"&&console.warn("LaTeX-incompatible input and strict mode is set to "+("unrecognized '"+n+"': "+t+" ["+e+"]"))}}useStrictBehavior(e,t,a){var n=this.strict;if(typeof n=="function")try{n=n(e,t,a)}catch{n="error"}return!n||n==="ignore"?!1:n===!0||n==="error"?!0:n==="warn"?(typeof console<"u"&&console.warn("LaTeX-incompatible input and strict mode is set to 'warn': "+(t+" ["+e+"]")),!1):(typeof console<"u"&&console.warn("LaTeX-incompatible input and strict mode is set to "+("unrecognized '"+n+"': "+t+" ["+e+"]")),!1)}isTrusted(e){if("url"in e&&e.url&&!e.protocol){var t=Io(e.url);if(t==null)return!1;e.protocol=t}var a=typeof this.trust=="function"?this.trust(e):this.trust;return!!a}},m0=class{constructor(e,t,a){this.id=void 0,this.size=void 0,this.cramped=void 0,this.id=e,this.size=t,this.cramped=a}sup(){return d0[Lo[this.id]]}sub(){return d0[qo[this.id]]}fracNum(){return d0[Po[this.id]]}fracDen(){return d0[Fo[this.id]]}cramp(){return d0[_o[this.id]]}text(){return d0[Ho[this.id]]}isTight(){return this.size>=2}},gn=0,Or=1,bt=2,S0=3,jt=4,r0=5,yt=6,Be=7,d0=[new m0(gn,0,!1),new m0(Or,0,!0),new m0(bt,1,!1),new m0(S0,1,!0),new m0(jt,2,!1),new m0(r0,2,!0),new m0(yt,3,!1),new m0(Be,3,!0)],Lo=[jt,r0,jt,r0,yt,Be,yt,Be],qo=[r0,r0,r0,r0,Be,Be,Be,Be],Po=[bt,S0,jt,r0,yt,Be,yt,Be],Fo=[S0,S0,r0,r0,Be,Be,Be,Be],_o=[Or,Or,S0,S0,r0,r0,Be,Be],Ho=[gn,Or,bt,S0,bt,S0,bt,S0],W={DISPLAY:d0[gn],TEXT:d0[bt],SCRIPT:d0[jt],SCRIPTSCRIPT:d0[yt]},Za=[{name:"latin",blocks:[[256,591],[768,879]]},{name:"cyrillic",blocks:[[1024,1279]]},{name:"armenian",blocks:[[1328,1423]]},{name:"brahmic",blocks:[[2304,4255]]},{name:"georgian",blocks:[[4256,4351]]},{name:"cjk",blocks:[[12288,12543],[19968,40879],[65280,65376]]},{name:"hangul",blocks:[[44032,55215]]}];function $o(r){for(var e=0;e<Za.length;e++)for(var t=Za[e],a=0;a<t.blocks.length;a++){var n=t.blocks[a];if(r>=n[0]&&r<=n[1])return t.name}return null}var Ir=[];Za.forEach(r=>r.blocks.forEach(e=>Ir.push(...e)));function zs(r){for(var e=0;e<Ir.length;e+=2)if(r>=Ir[e]&&r<=Ir[e+1])return!0;return!1}var ke=r=>r+" "+r,gt=80,Uo=function(e,t){return"M95,"+(622+e+t)+`
c-2.7,0,-7.17,-2.7,-13.5,-8c-5.8,-5.3,-9.5,-10,-9.5,-14
c0,-2,0.3,-3.3,1,-4c1.3,-2.7,23.83,-20.7,67.5,-54
c44.2,-33.3,65.8,-50.3,66.5,-51c1.3,-1.3,3,-2,5,-2c4.7,0,8.7,3.3,12,10
s173,378,173,378c0.7,0,35.3,-71,104,-213c68.7,-142,137.5,-285,206.5,-429
c69,-144,104.5,-217.7,106.5,-221
l`+e/2.075+" -"+e+`
c5.3,-9.3,12,-14,20,-14
H400000v`+(40+e)+`H845.2724
s-225.272,467,-225.272,467s-235,486,-235,486c-2.7,4.7,-9,7,-19,7
c-6,0,-10,-1,-12,-3s-194,-422,-194,-422s-65,47,-65,47z
M`+(834+e)+" "+t+"h400000v"+(40+e)+"h-400000z"},Go=function(e,t){return"M263,"+(601+e+t)+`c0.7,0,18,39.7,52,119
c34,79.3,68.167,158.7,102.5,238c34.3,79.3,51.8,119.3,52.5,120
c340,-704.7,510.7,-1060.3,512,-1067
l`+e/2.084+" -"+e+`
c4.7,-7.3,11,-11,19,-11
H40000v`+(40+e)+`H1012.3
s-271.3,567,-271.3,567c-38.7,80.7,-84,175,-136,283c-52,108,-89.167,185.3,-111.5,232
c-22.3,46.7,-33.8,70.3,-34.5,71c-4.7,4.7,-12.3,7,-23,7s-12,-1,-12,-1
s-109,-253,-109,-253c-72.7,-168,-109.3,-252,-110,-252c-10.7,8,-22,16.7,-34,26
c-22,17.3,-33.3,26,-34,26s-26,-26,-26,-26s76,-59,76,-59s76,-60,76,-60z
M`+(1001+e)+" "+t+"h400000v"+(40+e)+"h-400000z"},jo=function(e,t){return"M983 "+(10+e+t)+`
l`+e/3.13+" -"+e+`
c4,-6.7,10,-10,18,-10 H400000v`+(40+e)+`
H1013.1s-83.4,268,-264.1,840c-180.7,572,-277,876.3,-289,913c-4.7,4.7,-12.7,7,-24,7
s-12,0,-12,0c-1.3,-3.3,-3.7,-11.7,-7,-25c-35.3,-125.3,-106.7,-373.3,-214,-744
c-10,12,-21,25,-33,39s-32,39,-32,39c-6,-5.3,-15,-14,-27,-26s25,-30,25,-30
c26.7,-32.7,52,-63,76,-91s52,-60,52,-60s208,722,208,722
c56,-175.3,126.3,-397.3,211,-666c84.7,-268.7,153.8,-488.2,207.5,-658.5
c53.7,-170.3,84.5,-266.8,92.5,-289.5z
M`+(1001+e)+" "+t+"h400000v"+(40+e)+"h-400000z"},Wo=function(e,t){return"M424,"+(2398+e+t)+`
c-1.3,-0.7,-38.5,-172,-111.5,-514c-73,-342,-109.8,-513.3,-110.5,-514
c0,-2,-10.7,14.3,-32,49c-4.7,7.3,-9.8,15.7,-15.5,25c-5.7,9.3,-9.8,16,-12.5,20
s-5,7,-5,7c-4,-3.3,-8.3,-7.7,-13,-13s-13,-13,-13,-13s76,-122,76,-122s77,-121,77,-121
s209,968,209,968c0,-2,84.7,-361.7,254,-1079c169.3,-717.3,254.7,-1077.7,256,-1081
l`+e/4.223+" -"+e+`c4,-6.7,10,-10,18,-10 H400000
v`+(40+e)+`H1014.6
s-87.3,378.7,-272.6,1166c-185.3,787.3,-279.3,1182.3,-282,1185
c-2,6,-10,9,-24,9
c-8,0,-12,-0.7,-12,-2z M`+(1001+e)+" "+t+`
h400000v`+(40+e)+"h-400000z"},Vo=function(e,t){return"M473,"+(2713+e+t)+`
c339.3,-1799.3,509.3,-2700,510,-2702 l`+e/5.298+" -"+e+`
c3.3,-7.3,9.3,-11,18,-11 H400000v`+(40+e)+`H1017.7
s-90.5,478,-276.2,1466c-185.7,988,-279.5,1483,-281.5,1485c-2,6,-10,9,-24,9
c-8,0,-12,-0.7,-12,-2c0,-1.3,-5.3,-32,-16,-92c-50.7,-293.3,-119.7,-693.3,-207,-1200
c0,-1.3,-5.3,8.7,-16,30c-10.7,21.3,-21.3,42.7,-32,64s-16,33,-16,33s-26,-26,-26,-26
s76,-153,76,-153s77,-151,77,-151c0.7,0.7,35.7,202,105,604c67.3,400.7,102,602.7,104,
606zM`+(1001+e)+" "+t+"h400000v"+(40+e)+"H1017.7z"},Yo=function(e){var t=e/2;return"M400000 "+e+" H0 L"+t+" 0 l65 45 L145 "+(e-80)+" H400000z"},Xo=function(e,t,a){var n=a-54-t-e;return"M702 "+(e+t)+"H400000"+(40+e)+`
H742v`+n+`l-4 4-4 4c-.667.7 -2 1.5-4 2.5s-4.167 1.833-6.5 2.5-5.5 1-9.5 1
h-12l-28-84c-16.667-52-96.667 -294.333-240-727l-212 -643 -85 170
c-4-3.333-8.333-7.667-13 -13l-13-13l77-155 77-156c66 199.333 139 419.667
219 661 l218 661zM702 `+t+"H400000v"+(40+e)+"H742z"},Zo=function(e,t,a){t=1e3*t;var n="";switch(e){case"sqrtMain":n=Uo(t,gt);break;case"sqrtSize1":n=Go(t,gt);break;case"sqrtSize2":n=jo(t,gt);break;case"sqrtSize3":n=Wo(t,gt);break;case"sqrtSize4":n=Vo(t,gt);break;case"sqrtTall":n=Xo(t,gt,a)}return n},Ko=function(e,t){switch(e){case"\u239C":return ke("M291 0 H417 V"+t+" H291z");case"\u2223":return ke("M145 0 H188 V"+t+" H145z");case"\u2225":return ke("M145 0 H188 V"+t+" H145z")+ke("M367 0 H410 V"+t+" H367z");case"\u239F":return ke("M457 0 H583 V"+t+" H457z");case"\u23A2":return ke("M319 0 H403 V"+t+" H319z");case"\u23A5":return ke("M263 0 H347 V"+t+" H263z");case"\u23AA":return ke("M384 0 H504 V"+t+" H384z");case"\u23D0":return ke("M312 0 H355 V"+t+" H312z");case"\u2016":return ke("M257 0 H300 V"+t+" H257z")+ke("M478 0 H521 V"+t+" H478z");default:return""}},Ui={doubleleftarrow:`M262 157
l10-10c34-36 62.7-77 86-123 3.3-8 5-13.3 5-16 0-5.3-6.7-8-20-8-7.3
 0-12.2.5-14.5 1.5-2.3 1-4.8 4.5-7.5 10.5-49.3 97.3-121.7 169.3-217 216-28
 14-57.3 25-88 33-6.7 2-11 3.8-13 5.5-2 1.7-3 4.2-3 7.5s1 5.8 3 7.5
c2 1.7 6.3 3.5 13 5.5 68 17.3 128.2 47.8 180.5 91.5 52.3 43.7 93.8 96.2 124.5
 157.5 9.3 8 15.3 12.3 18 13h6c12-.7 18-4 18-10 0-2-1.7-7-5-15-23.3-46-52-87
-86-123l-10-10h399738v-40H218c328 0 0 0 0 0l-10-8c-26.7-20-65.7-43-117-69 2.7
-2 6-3.7 10-5 36.7-16 72.3-37.3 107-64l10-8h399782v-40z
m8 0v40h399730v-40zm0 194v40h399730v-40z`,doublerightarrow:`M399738 392l
-10 10c-34 36-62.7 77-86 123-3.3 8-5 13.3-5 16 0 5.3 6.7 8 20 8 7.3 0 12.2-.5
 14.5-1.5 2.3-1 4.8-4.5 7.5-10.5 49.3-97.3 121.7-169.3 217-216 28-14 57.3-25 88
-33 6.7-2 11-3.8 13-5.5 2-1.7 3-4.2 3-7.5s-1-5.8-3-7.5c-2-1.7-6.3-3.5-13-5.5-68
-17.3-128.2-47.8-180.5-91.5-52.3-43.7-93.8-96.2-124.5-157.5-9.3-8-15.3-12.3-18
-13h-6c-12 .7-18 4-18 10 0 2 1.7 7 5 15 23.3 46 52 87 86 123l10 10H0v40h399782
c-328 0 0 0 0 0l10 8c26.7 20 65.7 43 117 69-2.7 2-6 3.7-10 5-36.7 16-72.3 37.3
-107 64l-10 8H0v40zM0 157v40h399730v-40zm0 194v40h399730v-40z`,leftarrow:`M400000 241H110l3-3c68.7-52.7 113.7-120
 135-202 4-14.7 6-23 6-25 0-7.3-7-11-21-11-8 0-13.2.8-15.5 2.5-2.3 1.7-4.2 5.8
-5.5 12.5-1.3 4.7-2.7 10.3-4 17-12 48.7-34.8 92-68.5 130S65.3 228.3 18 247
c-10 4-16 7.7-18 11 0 8.7 6 14.3 18 17 47.3 18.7 87.8 47 121.5 85S196 441.3 208
 490c.7 2 1.3 5 2 9s1.2 6.7 1.5 8c.3 1.3 1 3.3 2 6s2.2 4.5 3.5 5.5c1.3 1 3.3
 1.8 6 2.5s6 1 10 1c14 0 21-3.7 21-11 0-2-2-10.3-6-25-20-79.3-65-146.7-135-202
 l-3-3h399890zM100 241v40h399900v-40z`,leftbrace:`M6 548l-6-6v-35l6-11c56-104 135.3-181.3 238-232 57.3-28.7 117
-45 179-50h399577v120H403c-43.3 7-81 15-113 26-100.7 33-179.7 91-237 174-2.7
 5-6 9-10 13-.7 1-7.3 1-20 1H6z`,leftbraceunder:`M0 6l6-6h17c12.688 0 19.313.3 20 1 4 4 7.313 8.3 10 13
 35.313 51.3 80.813 93.8 136.5 127.5 55.688 33.7 117.188 55.8 184.5 66.5.688
 0 2 .3 4 1 18.688 2.7 76 4.3 172 5h399450v120H429l-6-1c-124.688-8-235-61.7
-331-161C60.687 138.7 32.312 99.3 7 54L0 41V6z`,leftgroup:`M400000 80
H435C64 80 168.3 229.4 21 260c-5.9 1.2-18 0-18 0-2 0-3-1-3-3v-38C76 61 257 0
 435 0h399565z`,leftgroupunder:`M400000 262
H435C64 262 168.3 112.6 21 82c-5.9-1.2-18 0-18 0-2 0-3 1-3 3v38c76 158 257 219
 435 219h399565z`,leftharpoon:`M0 267c.7 5.3 3 10 7 14h399993v-40H93c3.3
-3.3 10.2-9.5 20.5-18.5s17.8-15.8 22.5-20.5c50.7-52 88-110.3 112-175 4-11.3 5
-18.3 3-21-1.3-4-7.3-6-18-6-8 0-13 .7-15 2s-4.7 6.7-8 16c-42 98.7-107.3 174.7
-196 228-6.7 4.7-10.7 8-12 10-1.3 2-2 5.7-2 11zm100-26v40h399900v-40z`,leftharpoonplus:`M0 267c.7 5.3 3 10 7 14h399993v-40H93c3.3-3.3 10.2-9.5
 20.5-18.5s17.8-15.8 22.5-20.5c50.7-52 88-110.3 112-175 4-11.3 5-18.3 3-21-1.3
-4-7.3-6-18-6-8 0-13 .7-15 2s-4.7 6.7-8 16c-42 98.7-107.3 174.7-196 228-6.7 4.7
-10.7 8-12 10-1.3 2-2 5.7-2 11zm100-26v40h399900v-40zM0 435v40h400000v-40z
m0 0v40h400000v-40z`,leftharpoondown:`M7 241c-4 4-6.333 8.667-7 14 0 5.333.667 9 2 11s5.333
 5.333 12 10c90.667 54 156 130 196 228 3.333 10.667 6.333 16.333 9 17 2 .667 5
 1 9 1h5c10.667 0 16.667-2 18-6 2-2.667 1-9.667-3-21-32-87.333-82.667-157.667
-152-211l-3-3h399907v-40zM93 281 H400000 v-40L7 241z`,leftharpoondownplus:`M7 435c-4 4-6.3 8.7-7 14 0 5.3.7 9 2 11s5.3 5.3 12
 10c90.7 54 156 130 196 228 3.3 10.7 6.3 16.3 9 17 2 .7 5 1 9 1h5c10.7 0 16.7
-2 18-6 2-2.7 1-9.7-3-21-32-87.3-82.7-157.7-152-211l-3-3h399907v-40H7zm93 0
v40h399900v-40zM0 241v40h399900v-40zm0 0v40h399900v-40z`,lefthook:`M400000 281 H103s-33-11.2-61-33.5S0 197.3 0 164s14.2-61.2 42.5
-83.5C70.8 58.2 104 47 142 47 c16.7 0 25 6.7 25 20 0 12-8.7 18.7-26 20-40 3.3
-68.7 15.7-86 37-10 12-15 25.3-15 40 0 22.7 9.8 40.7 29.5 54 19.7 13.3 43.5 21
 71.5 23h399859zM103 281v-40h399897v40z`,leftlinesegment:ke("M40 281 V428 H0 V94 H40 V241 H400000 v40z"),leftbracketunder:ke("M0 0 h120 V290 H399995 v120 H0z"),leftbracketover:ke("M0 440 h120 V150 H399995 v-120 H0z"),leftmapsto:ke("M40 281 V448H0V74H40V241H400000v40z"),leftToFrom:`M0 147h400000v40H0zm0 214c68 40 115.7 95.7 143 167h22c15.3 0 23
-.3 23-1 0-1.3-5.3-13.7-16-37-18-35.3-41.3-69-70-101l-7-8h399905v-40H95l7-8
c28.7-32 52-65.7 70-101 10.7-23.3 16-35.7 16-37 0-.7-7.7-1-23-1h-22C115.7 265.3
 68 321 0 361zm0-174v-40h399900v40zm100 154v40h399900v-40z`,longequal:ke("M0 50 h400000 v40H0z m0 194h40000v40H0z"),midbrace:`M200428 334
c-100.7-8.3-195.3-44-280-108-55.3-42-101.7-93-139-153l-9-14c-2.7 4-5.7 8.7-9 14
-53.3 86.7-123.7 153-211 199-66.7 36-137.3 56.3-212 62H0V214h199568c178.3-11.7
 311.7-78.3 403-201 6-8 9.7-12 11-12 .7-.7 6.7-1 18-1s17.3.3 18 1c1.3 0 5 4 11
 12 44.7 59.3 101.3 106.3 170 141s145.3 54.3 229 60h199572v120z`,midbraceunder:`M199572 214
c100.7 8.3 195.3 44 280 108 55.3 42 101.7 93 139 153l9 14c2.7-4 5.7-8.7 9-14
 53.3-86.7 123.7-153 211-199 66.7-36 137.3-56.3 212-62h199568v120H200432c-178.3
 11.7-311.7 78.3-403 201-6 8-9.7 12-11 12-.7.7-6.7 1-18 1s-17.3-.3-18-1c-1.3 0
-5-4-11-12-44.7-59.3-101.3-106.3-170-141s-145.3-54.3-229-60H0V214z`,oiintSize1:`M512.6 71.6c272.6 0 320.3 106.8 320.3 178.2 0 70.8-47.7 177.6
-320.3 177.6S193.1 320.6 193.1 249.8c0-71.4 46.9-178.2 319.5-178.2z
m368.1 178.2c0-86.4-60.9-215.4-368.1-215.4-306.4 0-367.3 129-367.3 215.4 0 85.8
60.9 214.8 367.3 214.8 307.2 0 368.1-129 368.1-214.8z`,oiintSize2:`M757.8 100.1c384.7 0 451.1 137.6 451.1 230 0 91.3-66.4 228.8
-451.1 228.8-386.3 0-452.7-137.5-452.7-228.8 0-92.4 66.4-230 452.7-230z
m502.4 230c0-111.2-82.4-277.2-502.4-277.2s-504 166-504 277.2
c0 110 84 276 504 276s502.4-166 502.4-276z`,oiiintSize1:`M681.4 71.6c408.9 0 480.5 106.8 480.5 178.2 0 70.8-71.6 177.6
-480.5 177.6S202.1 320.6 202.1 249.8c0-71.4 70.5-178.2 479.3-178.2z
m525.8 178.2c0-86.4-86.8-215.4-525.7-215.4-437.9 0-524.7 129-524.7 215.4 0
85.8 86.8 214.8 524.7 214.8 438.9 0 525.7-129 525.7-214.8z`,oiiintSize2:`M1021.2 53c603.6 0 707.8 165.8 707.8 277.2 0 110-104.2 275.8
-707.8 275.8-606 0-710.2-165.8-710.2-275.8C311 218.8 415.2 53 1021.2 53z
m770.4 277.1c0-131.2-126.4-327.6-770.5-327.6S248.4 198.9 248.4 330.1
c0 130 128.8 326.4 772.7 326.4s770.5-196.4 770.5-326.4z`,rightarrow:`M0 241v40h399891c-47.3 35.3-84 78-110 128
-16.7 32-27.7 63.7-33 95 0 1.3-.2 2.7-.5 4-.3 1.3-.5 2.3-.5 3 0 7.3 6.7 11 20
 11 8 0 13.2-.8 15.5-2.5 2.3-1.7 4.2-5.5 5.5-11.5 2-13.3 5.7-27 11-41 14.7-44.7
 39-84.5 73-119.5s73.7-60.2 119-75.5c6-2 9-5.7 9-11s-3-9-9-11c-45.3-15.3-85
-40.5-119-75.5s-58.3-74.8-73-119.5c-4.7-14-8.3-27.3-11-40-1.3-6.7-3.2-10.8-5.5
-12.5-2.3-1.7-7.5-2.5-15.5-2.5-14 0-21 3.7-21 11 0 2 2 10.3 6 25 20.7 83.3 67
 151.7 139 205zm0 0v40h399900v-40z`,rightbrace:`M400000 542l
-6 6h-17c-12.7 0-19.3-.3-20-1-4-4-7.3-8.3-10-13-35.3-51.3-80.8-93.8-136.5-127.5
s-117.2-55.8-184.5-66.5c-.7 0-2-.3-4-1-18.7-2.7-76-4.3-172-5H0V214h399571l6 1
c124.7 8 235 61.7 331 161 31.3 33.3 59.7 72.7 85 118l7 13v35z`,rightbraceunder:`M399994 0l6 6v35l-6 11c-56 104-135.3 181.3-238 232-57.3
 28.7-117 45-179 50H-300V214h399897c43.3-7 81-15 113-26 100.7-33 179.7-91 237
-174 2.7-5 6-9 10-13 .7-1 7.3-1 20-1h17z`,rightgroup:`M0 80h399565c371 0 266.7 149.4 414 180 5.9 1.2 18 0 18 0 2 0
 3-1 3-3v-38c-76-158-257-219-435-219H0z`,rightgroupunder:`M0 262h399565c371 0 266.7-149.4 414-180 5.9-1.2 18 0 18
 0 2 0 3 1 3 3v38c-76 158-257 219-435 219H0z`,rightharpoon:`M0 241v40h399993c4.7-4.7 7-9.3 7-14 0-9.3
-3.7-15.3-11-18-92.7-56.7-159-133.7-199-231-3.3-9.3-6-14.7-8-16-2-1.3-7-2-15-2
-10.7 0-16.7 2-18 6-2 2.7-1 9.7 3 21 15.3 42 36.7 81.8 64 119.5 27.3 37.7 58
 69.2 92 94.5zm0 0v40h399900v-40z`,rightharpoonplus:`M0 241v40h399993c4.7-4.7 7-9.3 7-14 0-9.3-3.7-15.3-11
-18-92.7-56.7-159-133.7-199-231-3.3-9.3-6-14.7-8-16-2-1.3-7-2-15-2-10.7 0-16.7
 2-18 6-2 2.7-1 9.7 3 21 15.3 42 36.7 81.8 64 119.5 27.3 37.7 58 69.2 92 94.5z
m0 0v40h399900v-40z m100 194v40h399900v-40zm0 0v40h399900v-40z`,rightharpoondown:`M399747 511c0 7.3 6.7 11 20 11 8 0 13-.8 15-2.5s4.7-6.8
 8-15.5c40-94 99.3-166.3 178-217 13.3-8 20.3-12.3 21-13 5.3-3.3 8.5-5.8 9.5
-7.5 1-1.7 1.5-5.2 1.5-10.5s-2.3-10.3-7-15H0v40h399908c-34 25.3-64.7 57-92 95
-27.3 38-48.7 77.7-64 119-3.3 8.7-5 14-5 16zM0 241v40h399900v-40z`,rightharpoondownplus:`M399747 705c0 7.3 6.7 11 20 11 8 0 13-.8
 15-2.5s4.7-6.8 8-15.5c40-94 99.3-166.3 178-217 13.3-8 20.3-12.3 21-13 5.3-3.3
 8.5-5.8 9.5-7.5 1-1.7 1.5-5.2 1.5-10.5s-2.3-10.3-7-15H0v40h399908c-34 25.3
-64.7 57-92 95-27.3 38-48.7 77.7-64 119-3.3 8.7-5 14-5 16zM0 435v40h399900v-40z
m0-194v40h400000v-40zm0 0v40h400000v-40z`,righthook:`M399859 241c-764 0 0 0 0 0 40-3.3 68.7-15.7 86-37 10-12 15-25.3
 15-40 0-22.7-9.8-40.7-29.5-54-19.7-13.3-43.5-21-71.5-23-17.3-1.3-26-8-26-20 0
-13.3 8.7-20 26-20 38 0 71 11.2 99 33.5 0 0 7 5.6 21 16.7 14 11.2 21 33.5 21
 66.8s-14 61.2-42 83.5c-28 22.3-61 33.5-99 33.5L0 241z M0 281v-40h399859v40z`,rightlinesegment:ke("M399960 241 V94 h40 V428 h-40 V281 H0 v-40z"),rightbracketunder:ke("M399995 0 h-120 V290 H0 v120 H400000z"),rightbracketover:ke("M399995 440 h-120 V150 H0 v-120 H399995z"),rightToFrom:`M400000 167c-70.7-42-118-97.7-142-167h-23c-15.3 0-23 .3-23
 1 0 1.3 5.3 13.7 16 37 18 35.3 41.3 69 70 101l7 8H0v40h399905l-7 8c-28.7 32
-52 65.7-70 101-10.7 23.3-16 35.7-16 37 0 .7 7.7 1 23 1h23c24-69.3 71.3-125 142
-167z M100 147v40h399900v-40zM0 341v40h399900v-40z`,twoheadleftarrow:`M0 167c68 40
 115.7 95.7 143 167h22c15.3 0 23-.3 23-1 0-1.3-5.3-13.7-16-37-18-35.3-41.3-69
-70-101l-7-8h125l9 7c50.7 39.3 85 86 103 140h46c0-4.7-6.3-18.7-19-42-18-35.3
-40-67.3-66-96l-9-9h399716v-40H284l9-9c26-28.7 48-60.7 66-96 12.7-23.333 19
-37.333 19-42h-46c-18 54-52.3 100.7-103 140l-9 7H95l7-8c28.7-32 52-65.7 70-101
 10.7-23.333 16-35.7 16-37 0-.7-7.7-1-23-1h-22C115.7 71.3 68 127 0 167z`,twoheadrightarrow:`M400000 167
c-68-40-115.7-95.7-143-167h-22c-15.3 0-23 .3-23 1 0 1.3 5.3 13.7 16 37 18 35.3
 41.3 69 70 101l7 8h-125l-9-7c-50.7-39.3-85-86-103-140h-46c0 4.7 6.3 18.7 19 42
 18 35.3 40 67.3 66 96l9 9H0v40h399716l-9 9c-26 28.7-48 60.7-66 96-12.7 23.333
-19 37.333-19 42h46c18-54 52.3-100.7 103-140l9-7h125l-7 8c-28.7 32-52 65.7-70
 101-10.7 23.333-16 35.7-16 37 0 .7 7.7 1 23 1h22c27.3-71.3 75-127 143-167z`,tilde1:`M200 55.538c-77 0-168 73.953-177 73.953-3 0-7
-2.175-9-5.437L2 97c-1-2-2-4-2-6 0-4 2-7 5-9l20-12C116 12 171 0 207 0c86 0
 114 68 191 68 78 0 168-68 177-68 4 0 7 2 9 5l12 19c1 2.175 2 4.35 2 6.525 0
 4.35-2 7.613-5 9.788l-19 13.05c-92 63.077-116.937 75.308-183 76.128
-68.267.847-113-73.952-191-73.952z`,tilde2:`M344 55.266c-142 0-300.638 81.316-311.5 86.418
-8.01 3.762-22.5 10.91-23.5 5.562L1 120c-1-2-1-3-1-4 0-5 3-9 8-10l18.4-9C160.9
 31.9 283 0 358 0c148 0 188 122 331 122s314-97 326-97c4 0 8 2 10 7l7 21.114
c1 2.14 1 3.21 1 4.28 0 5.347-3 9.626-7 10.696l-22.3 12.622C852.6 158.372 751
 181.476 676 181.476c-149 0-189-126.21-332-126.21z`,tilde3:`M786 59C457 59 32 175.242 13 175.242c-6 0-10-3.457
-11-10.37L.15 138c-1-7 3-12 10-13l19.2-6.4C378.4 40.7 634.3 0 804.3 0c337 0
 411.8 157 746.8 157 328 0 754-112 773-112 5 0 10 3 11 9l1 14.075c1 8.066-.697
 16.595-6.697 17.492l-21.052 7.31c-367.9 98.146-609.15 122.696-778.15 122.696
 -338 0-409-156.573-744-156.573z`,tilde4:`M786 58C457 58 32 177.487 13 177.487c-6 0-10-3.345
-11-10.035L.15 143c-1-7 3-12 10-13l22-6.7C381.2 35 637.15 0 807.15 0c337 0 409
 177 744 177 328 0 754-127 773-127 5 0 10 3 11 9l1 14.794c1 7.805-3 13.38-9
 14.495l-20.7 5.574c-366.85 99.79-607.3 139.372-776.3 139.372-338 0-409
 -175.236-744-175.236z`,vec:`M377 20c0-5.333 1.833-10 5.5-14S391 0 397 0c4.667 0 8.667 1.667 12 5
3.333 2.667 6.667 9 10 19 6.667 24.667 20.333 43.667 41 57 7.333 4.667 11
10.667 11 18 0 6-1 10-3 12s-6.667 5-14 9c-28.667 14.667-53.667 35.667-75 63
-1.333 1.333-3.167 3.5-5.5 6.5s-4 4.833-5 5.5c-1 .667-2.5 1.333-4.5 2s-4.333 1
-7 1c-4.667 0-9.167-1.833-13.5-5.5S337 184 337 178c0-12.667 15.667-32.333 47-59
H213l-171-1c-8.667-6-13-12.333-13-19 0-4.667 4.333-11.333 13-20h359
c-16-25.333-24-45-24-59z`,widehat1:`M529 0h5l519 115c5 1 9 5 9 10 0 1-1 2-1 3l-4 22
c-1 5-5 9-11 9h-2L532 67 19 159h-2c-5 0-9-4-11-9l-5-22c-1-6 2-12 8-13z`,widehat2:`M1181 0h2l1171 176c6 0 10 5 10 11l-2 23c-1 6-5 10
-11 10h-1L1182 67 15 220h-1c-6 0-10-4-11-10l-2-23c-1-6 4-11 10-11z`,widehat3:`M1181 0h2l1171 236c6 0 10 5 10 11l-2 23c-1 6-5 10
-11 10h-1L1182 67 15 280h-1c-6 0-10-4-11-10l-2-23c-1-6 4-11 10-11z`,widehat4:`M1181 0h2l1171 296c6 0 10 5 10 11l-2 23c-1 6-5 10
-11 10h-1L1182 67 15 340h-1c-6 0-10-4-11-10l-2-23c-1-6 4-11 10-11z`,widecheck1:`M529,159h5l519,-115c5,-1,9,-5,9,-10c0,-1,-1,-2,-1,-3l-4,-22c-1,
-5,-5,-9,-11,-9h-2l-512,92l-513,-92h-2c-5,0,-9,4,-11,9l-5,22c-1,6,2,12,8,13z`,widecheck2:`M1181,220h2l1171,-176c6,0,10,-5,10,-11l-2,-23c-1,-6,-5,-10,
-11,-10h-1l-1168,153l-1167,-153h-1c-6,0,-10,4,-11,10l-2,23c-1,6,4,11,10,11z`,widecheck3:`M1181,280h2l1171,-236c6,0,10,-5,10,-11l-2,-23c-1,-6,-5,-10,
-11,-10h-1l-1168,213l-1167,-213h-1c-6,0,-10,4,-11,10l-2,23c-1,6,4,11,10,11z`,widecheck4:`M1181,340h2l1171,-296c6,0,10,-5,10,-11l-2,-23c-1,-6,-5,-10,
-11,-10h-1l-1168,273l-1167,-273h-1c-6,0,-10,4,-11,10l-2,23c-1,6,4,11,10,11z`,baraboveleftarrow:`M400000 620h-399890l3 -3c68.7 -52.7 113.7 -120 135 -202
c4 -14.7 6 -23 6 -25c0 -7.3 -7 -11 -21 -11c-8 0 -13.2 0.8 -15.5 2.5
c-2.3 1.7 -4.2 5.8 -5.5 12.5c-1.3 4.7 -2.7 10.3 -4 17c-12 48.7 -34.8 92 -68.5 130
s-74.2 66.3 -121.5 85c-10 4 -16 7.7 -18 11c0 8.7 6 14.3 18 17c47.3 18.7 87.8 47
121.5 85s56.5 81.3 68.5 130c0.7 2 1.3 5 2 9s1.2 6.7 1.5 8c0.3 1.3 1 3.3 2 6
s2.2 4.5 3.5 5.5c1.3 1 3.3 1.8 6 2.5s6 1 10 1c14 0 21 -3.7 21 -11
c0 -2 -2 -10.3 -6 -25c-20 -79.3 -65 -146.7 -135 -202l-3 -3h399890z
M100 620v40h399900v-40z M0 241v40h399900v-40zM0 241v40h399900v-40z`,rightarrowabovebar:`M0 241v40h399891c-47.3 35.3-84 78-110 128-16.7 32
-27.7 63.7-33 95 0 1.3-.2 2.7-.5 4-.3 1.3-.5 2.3-.5 3 0 7.3 6.7 11 20 11 8 0
13.2-.8 15.5-2.5 2.3-1.7 4.2-5.5 5.5-11.5 2-13.3 5.7-27 11-41 14.7-44.7 39
-84.5 73-119.5s73.7-60.2 119-75.5c6-2 9-5.7 9-11s-3-9-9-11c-45.3-15.3-85-40.5
-119-75.5s-58.3-74.8-73-119.5c-4.7-14-8.3-27.3-11-40-1.3-6.7-3.2-10.8-5.5
-12.5-2.3-1.7-7.5-2.5-15.5-2.5-14 0-21 3.7-21 11 0 2 2 10.3 6 25 20.7 83.3 67
151.7 139 205zm96 379h399894v40H0zm0 0h399904v40H0z`,baraboveshortleftharpoon:`M507,435c-4,4,-6.3,8.7,-7,14c0,5.3,0.7,9,2,11
c1.3,2,5.3,5.3,12,10c90.7,54,156,130,196,228c3.3,10.7,6.3,16.3,9,17
c2,0.7,5,1,9,1c0,0,5,0,5,0c10.7,0,16.7,-2,18,-6c2,-2.7,1,-9.7,-3,-21
c-32,-87.3,-82.7,-157.7,-152,-211c0,0,-3,-3,-3,-3l399351,0l0,-40
c-398570,0,-399437,0,-399437,0z M593 435 v40 H399500 v-40z
M0 281 v-40 H399908 v40z M0 281 v-40 H399908 v40z`,rightharpoonaboveshortbar:`M0,241 l0,40c399126,0,399993,0,399993,0
c4.7,-4.7,7,-9.3,7,-14c0,-9.3,-3.7,-15.3,-11,-18c-92.7,-56.7,-159,-133.7,-199,
-231c-3.3,-9.3,-6,-14.7,-8,-16c-2,-1.3,-7,-2,-15,-2c-10.7,0,-16.7,2,-18,6
c-2,2.7,-1,9.7,3,21c15.3,42,36.7,81.8,64,119.5c27.3,37.7,58,69.2,92,94.5z
M0 241 v40 H399908 v-40z M0 475 v-40 H399500 v40z M0 475 v-40 H399500 v40z`,shortbaraboveleftharpoon:`M7,435c-4,4,-6.3,8.7,-7,14c0,5.3,0.7,9,2,11
c1.3,2,5.3,5.3,12,10c90.7,54,156,130,196,228c3.3,10.7,6.3,16.3,9,17c2,0.7,5,1,9,
1c0,0,5,0,5,0c10.7,0,16.7,-2,18,-6c2,-2.7,1,-9.7,-3,-21c-32,-87.3,-82.7,-157.7,
-152,-211c0,0,-3,-3,-3,-3l399907,0l0,-40c-399126,0,-399993,0,-399993,0z
M93 435 v40 H400000 v-40z M500 241 v40 H400000 v-40z M500 241 v40 H400000 v-40z`,shortrightharpoonabovebar:`M53,241l0,40c398570,0,399437,0,399437,0
c4.7,-4.7,7,-9.3,7,-14c0,-9.3,-3.7,-15.3,-11,-18c-92.7,-56.7,-159,-133.7,-199,
-231c-3.3,-9.3,-6,-14.7,-8,-16c-2,-1.3,-7,-2,-15,-2c-10.7,0,-16.7,2,-18,6
c-2,2.7,-1,9.7,3,21c15.3,42,36.7,81.8,64,119.5c27.3,37.7,58,69.2,92,94.5z
M500 241 v40 H399408 v-40z M500 435 v40 H400000 v-40z`},Qo=function(e,t){switch(e){case"lbrack":return"M403 1759 V84 H666 V0 H319 V1759 v"+t+` v1759 v84 h347 v-84
H403z M403 1759 V0 H319 V1759 v`+t+" v1759 v84 h84z";case"rbrack":return"M347 1759 V0 H0 V84 H263 V1759 v"+t+` v1759 H0 v84 H347z
M347 1759 V0 H263 V1759 v`+t+" v1759 h84z";case"vert":return"M145 15 v585 v"+t+` v585 c2.667,10,9.667,15,21,15
c10,0,16.667,-5,20,-15 v-585 v`+-t+` v-585 c-2.667,-10,-9.667,-15,-21,-15
c-10,0,-16.667,5,-20,15z M188 15 H145 v585 v`+t+" v585 h43z";case"doublevert":return"M145 15 v585 v"+t+` v585 c2.667,10,9.667,15,21,15
c10,0,16.667,-5,20,-15 v-585 v`+-t+` v-585 c-2.667,-10,-9.667,-15,-21,-15
c-10,0,-16.667,5,-20,15z M188 15 H145 v585 v`+t+` v585 h43z
M367 15 v585 v`+t+` v585 c2.667,10,9.667,15,21,15
c10,0,16.667,-5,20,-15 v-585 v`+-t+` v-585 c-2.667,-10,-9.667,-15,-21,-15
c-10,0,-16.667,5,-20,15z M410 15 H367 v585 v`+t+" v585 h43z";case"lfloor":return"M319 602 V0 H403 V602 v"+t+` v1715 h263 v84 H319z
MM319 602 V0 H403 V602 v`+t+" v1715 H319z";case"rfloor":return"M319 602 V0 H403 V602 v"+t+` v1799 H0 v-84 H319z
MM319 602 V0 H403 V602 v`+t+" v1715 H319z";case"lceil":return"M403 1759 V84 H666 V0 H319 V1759 v"+t+` v602 h84z
M403 1759 V0 H319 V1759 v`+t+" v602 h84z";case"rceil":return"M347 1759 V0 H0 V84 H263 V1759 v"+t+` v602 h84z
M347 1759 V0 h-84 V1759 v`+t+" v602 h84z";case"lparen":return`M863,9c0,-2,-2,-5,-6,-9c0,0,-17,0,-17,0c-12.7,0,-19.3,0.3,-20,1
c-5.3,5.3,-10.3,11,-15,17c-242.7,294.7,-395.3,682,-458,1162c-21.3,163.3,-33.3,349,
-36,557 l0,`+(t+84)+`c0.2,6,0,26,0,60c2,159.3,10,310.7,24,454c53.3,528,210,
949.7,470,1265c4.7,6,9.7,11.7,15,17c0.7,0.7,7,1,19,1c0,0,18,0,18,0c4,-4,6,-7,6,-9
c0,-2.7,-3.3,-8.7,-10,-18c-135.3,-192.7,-235.5,-414.3,-300.5,-665c-65,-250.7,-102.5,
-544.7,-112.5,-882c-2,-104,-3,-167,-3,-189
l0,-`+(t+92)+`c0,-162.7,5.7,-314,17,-454c20.7,-272,63.7,-513,129,-723c65.3,
-210,155.3,-396.3,270,-559c6.7,-9.3,10,-15.3,10,-18z`;case"rparen":return`M76,0c-16.7,0,-25,3,-25,9c0,2,2,6.3,6,13c21.3,28.7,42.3,60.3,
63,95c96.7,156.7,172.8,332.5,228.5,527.5c55.7,195,92.8,416.5,111.5,664.5
c11.3,139.3,17,290.7,17,454c0,28,1.7,43,3.3,45l0,`+(t+9)+`
c-3,4,-3.3,16.7,-3.3,38c0,162,-5.7,313.7,-17,455c-18.7,248,-55.8,469.3,-111.5,664
c-55.7,194.7,-131.8,370.3,-228.5,527c-20.7,34.7,-41.7,66.3,-63,95c-2,3.3,-4,7,-6,11
c0,7.3,5.7,11,17,11c0,0,11,0,11,0c9.3,0,14.3,-0.3,15,-1c5.3,-5.3,10.3,-11,15,-17
c242.7,-294.7,395.3,-681.7,458,-1161c21.3,-164.7,33.3,-350.7,36,-558
l0,-`+(t+144)+`c-2,-159.3,-10,-310.7,-24,-454c-53.3,-528,-210,-949.7,
-470,-1265c-4.7,-6,-9.7,-11.7,-15,-17c-0.7,-0.7,-6.7,-1,-18,-1z`;default:throw new Error("Unknown stretchy delimiter.")}};function Jo(r){return"toText"in r}var q0=class{constructor(e){this.children=void 0,this.classes=void 0,this.height=void 0,this.depth=void 0,this.maxFontSize=void 0,this.style=void 0,this.children=e,this.classes=[],this.height=0,this.depth=0,this.maxFontSize=0,this.style={}}hasClass(e){return this.classes.includes(e)}toNode(){for(var e=document.createDocumentFragment(),t=0;t<this.children.length;t++)e.appendChild(this.children[t].toNode());return e}toMarkup(){for(var e="",t=0;t<this.children.length;t++)e+=this.children[t].toMarkup();return e}toText(){return this.children.map(e=>{if(Jo(e))return e.toText();throw new Error("Expected MathDomNode with toText, got "+e.constructor.name)}).join("")}},Ka={pt:1,mm:7227/2540,cm:7227/254,in:72.27,bp:803/800,pc:12,dd:1238/1157,cc:14856/1157,nd:685/642,nc:1370/107,sp:1/65536,px:803/800},eu={ex:!0,em:!0,mu:!0},Ms=function(e){return typeof e!="string"&&(e=e.unit),e in Ka||e in eu||e==="ex"},fe=function(e,t){var a;if(e.unit in Ka)a=Ka[e.unit]/t.fontMetrics().ptPerEm/t.sizeMultiplier;else if(e.unit==="mu")a=t.fontMetrics().cssEmPerMu;else{var n;if(t.style.isTight()?n=t.havingStyle(t.style.text()):n=t,e.unit==="ex")a=n.fontMetrics().xHeight;else if(e.unit==="em")a=n.fontMetrics().quad;else throw new C("Invalid unit: '"+e.unit+"'");n!==t&&(a*=n.sizeMultiplier/t.sizeMultiplier)}return Math.min(e.number*a,t.maxSize)},O=function(e){return+e.toFixed(4)+"em"},P0=function(e){return e.filter(t=>t).join(" ")},bn=function(e){var t="";for(var a of Object.keys(e)){var n=e[a];n!==void 0&&(t+=Eo(a)+":"+n+";")}return t},Es=function(e,t,a){if(this.classes=e||[],this.attributes={},this.height=0,this.depth=0,this.maxFontSize=0,this.style=a||{},t){t.style.isTight()&&this.classes.push("mtight");var n=t.getColor();n&&(this.style.color=n)}},Rs=function(e){var t=document.createElement(e);t.className=P0(this.classes),Object.assign(t.style,this.style);for(var a of Object.keys(this.attributes))t.setAttribute(a,this.attributes[a]);for(var n=0;n<this.children.length;n++)t.appendChild(this.children[n].toNode());return t},tu=/[\s"'>/=\x00-\x1f]/,Ds=function(e){var t="<"+e;this.classes.length&&(t+=' class="'+De(P0(this.classes))+'"');var a=bn(this.style);a&&(t+=' style="'+De(a)+'"');for(var n of Object.keys(this.attributes)){if(tu.test(n))throw new C("Invalid attribute name '"+n+"'");t+=" "+n+'="'+De(this.attributes[n])+'"'}t+=">";for(var i=0;i<this.children.length;i++)t+=this.children[i].toMarkup();return t+="</"+e+">",t},F0=class{constructor(e,t,a,n){this.children=void 0,this.attributes=void 0,this.classes=void 0,this.height=void 0,this.depth=void 0,this.width=void 0,this.maxFontSize=void 0,this.style=void 0,this.italic=void 0,Es.call(this,e,a,n),this.children=t||[]}setAttribute(e,t){this.attributes[e]=t}hasClass(e){return this.classes.includes(e)}toNode(){return Rs.call(this,"span")}toMarkup(){return Ds.call(this,"span")}},xt=class{constructor(e,t,a,n){this.children=void 0,this.attributes=void 0,this.classes=void 0,this.height=void 0,this.depth=void 0,this.maxFontSize=void 0,this.style=void 0,Es.call(this,t,n),this.children=a||[],this.setAttribute("href",e)}setAttribute(e,t){this.attributes[e]=t}hasClass(e){return this.classes.includes(e)}toNode(){return Rs.call(this,"a")}toMarkup(){return Ds.call(this,"a")}},Qa=class{constructor(e,t,a){this.src=void 0,this.alt=void 0,this.classes=void 0,this.height=void 0,this.depth=void 0,this.maxFontSize=void 0,this.style=void 0,this.alt=t,this.src=e,this.classes=["mord"],this.height=0,this.depth=0,this.maxFontSize=0,this.style=a}hasClass(e){return this.classes.includes(e)}toNode(){var e=document.createElement("img");return e.src=this.src,e.alt=this.alt,e.className="mord",Object.assign(e.style,this.style),e}toMarkup(){var e='<img src="'+De(this.src)+'"'+(' alt="'+De(this.alt)+'"'),t=bn(this.style);return t&&(e+=' style="'+De(t)+'"'),e+="'/>",e}},ru={\u00EE:"\u0131\u0302",\u00EF:"\u0131\u0308",\u00ED:"\u0131\u0301",\u00EC:"\u0131\u0300"},Ne=class{constructor(e,t,a,n,i,l,u,h){this.text=void 0,this.height=void 0,this.depth=void 0,this.italic=void 0,this.skew=void 0,this.width=void 0,this.maxFontSize=void 0,this.classes=void 0,this.style=void 0,this.text=e,this.height=t||0,this.depth=a||0,this.italic=n||0,this.skew=i||0,this.width=l||0,this.classes=u||[],this.style=h||{},this.maxFontSize=0;var d=$o(this.text.charCodeAt(0));d&&this.classes.push(d+"_fallback"),/[îïíì]/.test(this.text)&&(this.text=ru[this.text])}hasClass(e){return this.classes.includes(e)}toNode(){var e=document.createTextNode(this.text),t=null;return this.italic>0&&(t=document.createElement("span"),t.style.marginRight=O(this.italic)),this.classes.length>0&&(t=t||document.createElement("span"),t.className=P0(this.classes)),Object.keys(this.style).length>0&&(t=t||document.createElement("span"),Object.assign(t.style,this.style)),t?(t.appendChild(e),t):e}toMarkup(){var e=!1,t="<span";this.classes.length&&(e=!0,t+=' class="',t+=De(P0(this.classes)),t+='"');var a="";this.italic>0&&(a+="margin-right:"+O(this.italic)+";"),a+=bn(this.style),a&&(e=!0,t+=' style="'+De(a)+'"');var n=De(this.text);return e?(t+=">",t+=n,t+="</span>",t):n}},o0=class{constructor(e,t){this.children=void 0,this.attributes=void 0,this.children=e||[],this.attributes=t||{}}toNode(){var e="http://www.w3.org/2000/svg",t=document.createElementNS(e,"svg");for(var a of Object.keys(this.attributes))t.setAttribute(a,this.attributes[a]);for(var n=0;n<this.children.length;n++)t.appendChild(this.children[n].toNode());return t}toMarkup(){var e='<svg xmlns="http://www.w3.org/2000/svg"';for(var t of Object.keys(this.attributes))e+=" "+t+'="'+De(this.attributes[t])+'"';e+=">";for(var a=0;a<this.children.length;a++)e+=this.children[a].toMarkup();return e+="</svg>",e}},f0=class{constructor(e,t){this.pathName=void 0,this.alternate=void 0,this.pathName=e,this.alternate=t}toNode(){var e="http://www.w3.org/2000/svg",t=document.createElementNS(e,"path");return this.alternate?t.setAttribute("d",this.alternate):t.setAttribute("d",Ui[this.pathName]),t}toMarkup(){return this.alternate?'<path d="'+De(this.alternate)+'"/>':'<path d="'+De(Ui[this.pathName])+'"/>'}},Wt=class{constructor(e){this.attributes=void 0,this.attributes=e||{}}toNode(){var e="http://www.w3.org/2000/svg",t=document.createElementNS(e,"line");for(var a of Object.keys(this.attributes))t.setAttribute(a,this.attributes[a]);return t}toMarkup(){var e="<line";for(var t of Object.keys(this.attributes))e+=" "+t+'="'+De(this.attributes[t])+'"';return e+="/>",e}};function au(r){if(r instanceof Ne)return r;throw new Error("Expected symbolNode but got "+String(r)+".")}function nu(r){if(r instanceof F0)return r;throw new Error("Expected span<HtmlDomNode> but got "+String(r)+".")}var iu=r=>r instanceof F0||r instanceof xt||r instanceof q0,p0={"AMS-Regular":{32:[0,0,0,0,.25],65:[0,.68889,0,0,.72222],66:[0,.68889,0,0,.66667],67:[0,.68889,0,0,.72222],68:[0,.68889,0,0,.72222],69:[0,.68889,0,0,.66667],70:[0,.68889,0,0,.61111],71:[0,.68889,0,0,.77778],72:[0,.68889,0,0,.77778],73:[0,.68889,0,0,.38889],74:[.16667,.68889,0,0,.5],75:[0,.68889,0,0,.77778],76:[0,.68889,0,0,.66667],77:[0,.68889,0,0,.94445],78:[0,.68889,0,0,.72222],79:[.16667,.68889,0,0,.77778],80:[0,.68889,0,0,.61111],81:[.16667,.68889,0,0,.77778],82:[0,.68889,0,0,.72222],83:[0,.68889,0,0,.55556],84:[0,.68889,0,0,.66667],85:[0,.68889,0,0,.72222],86:[0,.68889,0,0,.72222],87:[0,.68889,0,0,1],88:[0,.68889,0,0,.72222],89:[0,.68889,0,0,.72222],90:[0,.68889,0,0,.66667],107:[0,.68889,0,0,.55556],160:[0,0,0,0,.25],165:[0,.675,.025,0,.75],174:[.15559,.69224,0,0,.94666],240:[0,.68889,0,0,.55556],295:[0,.68889,0,0,.54028],710:[0,.825,0,0,2.33334],732:[0,.9,0,0,2.33334],770:[0,.825,0,0,2.33334],771:[0,.9,0,0,2.33334],989:[.08167,.58167,0,0,.77778],1008:[0,.43056,.04028,0,.66667],8245:[0,.54986,0,0,.275],8463:[0,.68889,0,0,.54028],8487:[0,.68889,0,0,.72222],8498:[0,.68889,0,0,.55556],8502:[0,.68889,0,0,.66667],8503:[0,.68889,0,0,.44445],8504:[0,.68889,0,0,.66667],8513:[0,.68889,0,0,.63889],8592:[-.03598,.46402,0,0,.5],8594:[-.03598,.46402,0,0,.5],8602:[-.13313,.36687,0,0,1],8603:[-.13313,.36687,0,0,1],8606:[.01354,.52239,0,0,1],8608:[.01354,.52239,0,0,1],8610:[.01354,.52239,0,0,1.11111],8611:[.01354,.52239,0,0,1.11111],8619:[0,.54986,0,0,1],8620:[0,.54986,0,0,1],8621:[-.13313,.37788,0,0,1.38889],8622:[-.13313,.36687,0,0,1],8624:[0,.69224,0,0,.5],8625:[0,.69224,0,0,.5],8630:[0,.43056,0,0,1],8631:[0,.43056,0,0,1],8634:[.08198,.58198,0,0,.77778],8635:[.08198,.58198,0,0,.77778],8638:[.19444,.69224,0,0,.41667],8639:[.19444,.69224,0,0,.41667],8642:[.19444,.69224,0,0,.41667],8643:[.19444,.69224,0,0,.41667],8644:[.1808,.675,0,0,1],8646:[.1808,.675,0,0,1],8647:[.1808,.675,0,0,1],8648:[.19444,.69224,0,0,.83334],8649:[.1808,.675,0,0,1],8650:[.19444,.69224,0,0,.83334],8651:[.01354,.52239,0,0,1],8652:[.01354,.52239,0,0,1],8653:[-.13313,.36687,0,0,1],8654:[-.13313,.36687,0,0,1],8655:[-.13313,.36687,0,0,1],8666:[.13667,.63667,0,0,1],8667:[.13667,.63667,0,0,1],8669:[-.13313,.37788,0,0,1],8672:[-.064,.437,0,0,1.334],8674:[-.064,.437,0,0,1.334],8705:[0,.825,0,0,.5],8708:[0,.68889,0,0,.55556],8709:[.08167,.58167,0,0,.77778],8717:[0,.43056,0,0,.42917],8722:[-.03598,.46402,0,0,.5],8724:[.08198,.69224,0,0,.77778],8726:[.08167,.58167,0,0,.77778],8733:[0,.69224,0,0,.77778],8736:[0,.69224,0,0,.72222],8737:[0,.69224,0,0,.72222],8738:[.03517,.52239,0,0,.72222],8739:[.08167,.58167,0,0,.22222],8740:[.25142,.74111,0,0,.27778],8741:[.08167,.58167,0,0,.38889],8742:[.25142,.74111,0,0,.5],8756:[0,.69224,0,0,.66667],8757:[0,.69224,0,0,.66667],8764:[-.13313,.36687,0,0,.77778],8765:[-.13313,.37788,0,0,.77778],8769:[-.13313,.36687,0,0,.77778],8770:[-.03625,.46375,0,0,.77778],8774:[.30274,.79383,0,0,.77778],8776:[-.01688,.48312,0,0,.77778],8778:[.08167,.58167,0,0,.77778],8782:[.06062,.54986,0,0,.77778],8783:[.06062,.54986,0,0,.77778],8785:[.08198,.58198,0,0,.77778],8786:[.08198,.58198,0,0,.77778],8787:[.08198,.58198,0,0,.77778],8790:[0,.69224,0,0,.77778],8791:[.22958,.72958,0,0,.77778],8796:[.08198,.91667,0,0,.77778],8806:[.25583,.75583,0,0,.77778],8807:[.25583,.75583,0,0,.77778],8808:[.25142,.75726,0,0,.77778],8809:[.25142,.75726,0,0,.77778],8812:[.25583,.75583,0,0,.5],8814:[.20576,.70576,0,0,.77778],8815:[.20576,.70576,0,0,.77778],8816:[.30274,.79383,0,0,.77778],8817:[.30274,.79383,0,0,.77778],8818:[.22958,.72958,0,0,.77778],8819:[.22958,.72958,0,0,.77778],8822:[.1808,.675,0,0,.77778],8823:[.1808,.675,0,0,.77778],8828:[.13667,.63667,0,0,.77778],8829:[.13667,.63667,0,0,.77778],8830:[.22958,.72958,0,0,.77778],8831:[.22958,.72958,0,0,.77778],8832:[.20576,.70576,0,0,.77778],8833:[.20576,.70576,0,0,.77778],8840:[.30274,.79383,0,0,.77778],8841:[.30274,.79383,0,0,.77778],8842:[.13597,.63597,0,0,.77778],8843:[.13597,.63597,0,0,.77778],8847:[.03517,.54986,0,0,.77778],8848:[.03517,.54986,0,0,.77778],8858:[.08198,.58198,0,0,.77778],8859:[.08198,.58198,0,0,.77778],8861:[.08198,.58198,0,0,.77778],8862:[0,.675,0,0,.77778],8863:[0,.675,0,0,.77778],8864:[0,.675,0,0,.77778],8865:[0,.675,0,0,.77778],8872:[0,.69224,0,0,.61111],8873:[0,.69224,0,0,.72222],8874:[0,.69224,0,0,.88889],8876:[0,.68889,0,0,.61111],8877:[0,.68889,0,0,.61111],8878:[0,.68889,0,0,.72222],8879:[0,.68889,0,0,.72222],8882:[.03517,.54986,0,0,.77778],8883:[.03517,.54986,0,0,.77778],8884:[.13667,.63667,0,0,.77778],8885:[.13667,.63667,0,0,.77778],8888:[0,.54986,0,0,1.11111],8890:[.19444,.43056,0,0,.55556],8891:[.19444,.69224,0,0,.61111],8892:[.19444,.69224,0,0,.61111],8901:[0,.54986,0,0,.27778],8903:[.08167,.58167,0,0,.77778],8905:[.08167,.58167,0,0,.77778],8906:[.08167,.58167,0,0,.77778],8907:[0,.69224,0,0,.77778],8908:[0,.69224,0,0,.77778],8909:[-.03598,.46402,0,0,.77778],8910:[0,.54986,0,0,.76042],8911:[0,.54986,0,0,.76042],8912:[.03517,.54986,0,0,.77778],8913:[.03517,.54986,0,0,.77778],8914:[0,.54986,0,0,.66667],8915:[0,.54986,0,0,.66667],8916:[0,.69224,0,0,.66667],8918:[.0391,.5391,0,0,.77778],8919:[.0391,.5391,0,0,.77778],8920:[.03517,.54986,0,0,1.33334],8921:[.03517,.54986,0,0,1.33334],8922:[.38569,.88569,0,0,.77778],8923:[.38569,.88569,0,0,.77778],8926:[.13667,.63667,0,0,.77778],8927:[.13667,.63667,0,0,.77778],8928:[.30274,.79383,0,0,.77778],8929:[.30274,.79383,0,0,.77778],8934:[.23222,.74111,0,0,.77778],8935:[.23222,.74111,0,0,.77778],8936:[.23222,.74111,0,0,.77778],8937:[.23222,.74111,0,0,.77778],8938:[.20576,.70576,0,0,.77778],8939:[.20576,.70576,0,0,.77778],8940:[.30274,.79383,0,0,.77778],8941:[.30274,.79383,0,0,.77778],8994:[.19444,.69224,0,0,.77778],8995:[.19444,.69224,0,0,.77778],9416:[.15559,.69224,0,0,.90222],9484:[0,.69224,0,0,.5],9488:[0,.69224,0,0,.5],9492:[0,.37788,0,0,.5],9496:[0,.37788,0,0,.5],9585:[.19444,.68889,0,0,.88889],9586:[.19444,.74111,0,0,.88889],9632:[0,.675,0,0,.77778],9633:[0,.675,0,0,.77778],9650:[0,.54986,0,0,.72222],9651:[0,.54986,0,0,.72222],9654:[.03517,.54986,0,0,.77778],9660:[0,.54986,0,0,.72222],9661:[0,.54986,0,0,.72222],9664:[.03517,.54986,0,0,.77778],9674:[.11111,.69224,0,0,.66667],9733:[.19444,.69224,0,0,.94445],10003:[0,.69224,0,0,.83334],10016:[0,.69224,0,0,.83334],10731:[.11111,.69224,0,0,.66667],10846:[.19444,.75583,0,0,.61111],10877:[.13667,.63667,0,0,.77778],10878:[.13667,.63667,0,0,.77778],10885:[.25583,.75583,0,0,.77778],10886:[.25583,.75583,0,0,.77778],10887:[.13597,.63597,0,0,.77778],10888:[.13597,.63597,0,0,.77778],10889:[.26167,.75726,0,0,.77778],10890:[.26167,.75726,0,0,.77778],10891:[.48256,.98256,0,0,.77778],10892:[.48256,.98256,0,0,.77778],10901:[.13667,.63667,0,0,.77778],10902:[.13667,.63667,0,0,.77778],10933:[.25142,.75726,0,0,.77778],10934:[.25142,.75726,0,0,.77778],10935:[.26167,.75726,0,0,.77778],10936:[.26167,.75726,0,0,.77778],10937:[.26167,.75726,0,0,.77778],10938:[.26167,.75726,0,0,.77778],10949:[.25583,.75583,0,0,.77778],10950:[.25583,.75583,0,0,.77778],10955:[.28481,.79383,0,0,.77778],10956:[.28481,.79383,0,0,.77778],57350:[.08167,.58167,0,0,.22222],57351:[.08167,.58167,0,0,.38889],57352:[.08167,.58167,0,0,.77778],57353:[0,.43056,.04028,0,.66667],57356:[.25142,.75726,0,0,.77778],57357:[.25142,.75726,0,0,.77778],57358:[.41951,.91951,0,0,.77778],57359:[.30274,.79383,0,0,.77778],57360:[.30274,.79383,0,0,.77778],57361:[.41951,.91951,0,0,.77778],57366:[.25142,.75726,0,0,.77778],57367:[.25142,.75726,0,0,.77778],57368:[.25142,.75726,0,0,.77778],57369:[.25142,.75726,0,0,.77778],57370:[.13597,.63597,0,0,.77778],57371:[.13597,.63597,0,0,.77778]},"Caligraphic-Regular":{32:[0,0,0,0,.25],65:[0,.68333,0,.19445,.79847],66:[0,.68333,.03041,.13889,.65681],67:[0,.68333,.05834,.13889,.52653],68:[0,.68333,.02778,.08334,.77139],69:[0,.68333,.08944,.11111,.52778],70:[0,.68333,.09931,.11111,.71875],71:[.09722,.68333,.0593,.11111,.59487],72:[0,.68333,.00965,.11111,.84452],73:[0,.68333,.07382,0,.54452],74:[.09722,.68333,.18472,.16667,.67778],75:[0,.68333,.01445,.05556,.76195],76:[0,.68333,0,.13889,.68972],77:[0,.68333,0,.13889,1.2009],78:[0,.68333,.14736,.08334,.82049],79:[0,.68333,.02778,.11111,.79611],80:[0,.68333,.08222,.08334,.69556],81:[.09722,.68333,0,.11111,.81667],82:[0,.68333,0,.08334,.8475],83:[0,.68333,.075,.13889,.60556],84:[0,.68333,.25417,0,.54464],85:[0,.68333,.09931,.08334,.62583],86:[0,.68333,.08222,0,.61278],87:[0,.68333,.08222,.08334,.98778],88:[0,.68333,.14643,.13889,.7133],89:[.09722,.68333,.08222,.08334,.66834],90:[0,.68333,.07944,.13889,.72473],160:[0,0,0,0,.25]},"Fraktur-Regular":{32:[0,0,0,0,.25],33:[0,.69141,0,0,.29574],34:[0,.69141,0,0,.21471],38:[0,.69141,0,0,.73786],39:[0,.69141,0,0,.21201],40:[.24982,.74947,0,0,.38865],41:[.24982,.74947,0,0,.38865],42:[0,.62119,0,0,.27764],43:[.08319,.58283,0,0,.75623],44:[0,.10803,0,0,.27764],45:[.08319,.58283,0,0,.75623],46:[0,.10803,0,0,.27764],47:[.24982,.74947,0,0,.50181],48:[0,.47534,0,0,.50181],49:[0,.47534,0,0,.50181],50:[0,.47534,0,0,.50181],51:[.18906,.47534,0,0,.50181],52:[.18906,.47534,0,0,.50181],53:[.18906,.47534,0,0,.50181],54:[0,.69141,0,0,.50181],55:[.18906,.47534,0,0,.50181],56:[0,.69141,0,0,.50181],57:[.18906,.47534,0,0,.50181],58:[0,.47534,0,0,.21606],59:[.12604,.47534,0,0,.21606],61:[-.13099,.36866,0,0,.75623],63:[0,.69141,0,0,.36245],65:[0,.69141,0,0,.7176],66:[0,.69141,0,0,.88397],67:[0,.69141,0,0,.61254],68:[0,.69141,0,0,.83158],69:[0,.69141,0,0,.66278],70:[.12604,.69141,0,0,.61119],71:[0,.69141,0,0,.78539],72:[.06302,.69141,0,0,.7203],73:[0,.69141,0,0,.55448],74:[.12604,.69141,0,0,.55231],75:[0,.69141,0,0,.66845],76:[0,.69141,0,0,.66602],77:[0,.69141,0,0,1.04953],78:[0,.69141,0,0,.83212],79:[0,.69141,0,0,.82699],80:[.18906,.69141,0,0,.82753],81:[.03781,.69141,0,0,.82699],82:[0,.69141,0,0,.82807],83:[0,.69141,0,0,.82861],84:[0,.69141,0,0,.66899],85:[0,.69141,0,0,.64576],86:[0,.69141,0,0,.83131],87:[0,.69141,0,0,1.04602],88:[0,.69141,0,0,.71922],89:[.18906,.69141,0,0,.83293],90:[.12604,.69141,0,0,.60201],91:[.24982,.74947,0,0,.27764],93:[.24982,.74947,0,0,.27764],94:[0,.69141,0,0,.49965],97:[0,.47534,0,0,.50046],98:[0,.69141,0,0,.51315],99:[0,.47534,0,0,.38946],100:[0,.62119,0,0,.49857],101:[0,.47534,0,0,.40053],102:[.18906,.69141,0,0,.32626],103:[.18906,.47534,0,0,.5037],104:[.18906,.69141,0,0,.52126],105:[0,.69141,0,0,.27899],106:[0,.69141,0,0,.28088],107:[0,.69141,0,0,.38946],108:[0,.69141,0,0,.27953],109:[0,.47534,0,0,.76676],110:[0,.47534,0,0,.52666],111:[0,.47534,0,0,.48885],112:[.18906,.52396,0,0,.50046],113:[.18906,.47534,0,0,.48912],114:[0,.47534,0,0,.38919],115:[0,.47534,0,0,.44266],116:[0,.62119,0,0,.33301],117:[0,.47534,0,0,.5172],118:[0,.52396,0,0,.5118],119:[0,.52396,0,0,.77351],120:[.18906,.47534,0,0,.38865],121:[.18906,.47534,0,0,.49884],122:[.18906,.47534,0,0,.39054],160:[0,0,0,0,.25],8216:[0,.69141,0,0,.21471],8217:[0,.69141,0,0,.21471],58112:[0,.62119,0,0,.49749],58113:[0,.62119,0,0,.4983],58114:[.18906,.69141,0,0,.33328],58115:[.18906,.69141,0,0,.32923],58116:[.18906,.47534,0,0,.50343],58117:[0,.69141,0,0,.33301],58118:[0,.62119,0,0,.33409],58119:[0,.47534,0,0,.50073]},"Main-Bold":{32:[0,0,0,0,.25],33:[0,.69444,0,0,.35],34:[0,.69444,0,0,.60278],35:[.19444,.69444,0,0,.95833],36:[.05556,.75,0,0,.575],37:[.05556,.75,0,0,.95833],38:[0,.69444,0,0,.89444],39:[0,.69444,0,0,.31944],40:[.25,.75,0,0,.44722],41:[.25,.75,0,0,.44722],42:[0,.75,0,0,.575],43:[.13333,.63333,0,0,.89444],44:[.19444,.15556,0,0,.31944],45:[0,.44444,0,0,.38333],46:[0,.15556,0,0,.31944],47:[.25,.75,0,0,.575],48:[0,.64444,0,0,.575],49:[0,.64444,0,0,.575],50:[0,.64444,0,0,.575],51:[0,.64444,0,0,.575],52:[0,.64444,0,0,.575],53:[0,.64444,0,0,.575],54:[0,.64444,0,0,.575],55:[0,.64444,0,0,.575],56:[0,.64444,0,0,.575],57:[0,.64444,0,0,.575],58:[0,.44444,0,0,.31944],59:[.19444,.44444,0,0,.31944],60:[.08556,.58556,0,0,.89444],61:[-.10889,.39111,0,0,.89444],62:[.08556,.58556,0,0,.89444],63:[0,.69444,0,0,.54305],64:[0,.69444,0,0,.89444],65:[0,.68611,0,0,.86944],66:[0,.68611,0,0,.81805],67:[0,.68611,0,0,.83055],68:[0,.68611,0,0,.88194],69:[0,.68611,0,0,.75555],70:[0,.68611,0,0,.72361],71:[0,.68611,0,0,.90416],72:[0,.68611,0,0,.9],73:[0,.68611,0,0,.43611],74:[0,.68611,0,0,.59444],75:[0,.68611,0,0,.90138],76:[0,.68611,0,0,.69166],77:[0,.68611,0,0,1.09166],78:[0,.68611,0,0,.9],79:[0,.68611,0,0,.86388],80:[0,.68611,0,0,.78611],81:[.19444,.68611,0,0,.86388],82:[0,.68611,0,0,.8625],83:[0,.68611,0,0,.63889],84:[0,.68611,0,0,.8],85:[0,.68611,0,0,.88472],86:[0,.68611,.01597,0,.86944],87:[0,.68611,.01597,0,1.18888],88:[0,.68611,0,0,.86944],89:[0,.68611,.02875,0,.86944],90:[0,.68611,0,0,.70277],91:[.25,.75,0,0,.31944],92:[.25,.75,0,0,.575],93:[.25,.75,0,0,.31944],94:[0,.69444,0,0,.575],95:[.31,.13444,.03194,0,.575],97:[0,.44444,0,0,.55902],98:[0,.69444,0,0,.63889],99:[0,.44444,0,0,.51111],100:[0,.69444,0,0,.63889],101:[0,.44444,0,0,.52708],102:[0,.69444,.10903,0,.35139],103:[.19444,.44444,.01597,0,.575],104:[0,.69444,0,0,.63889],105:[0,.69444,0,0,.31944],106:[.19444,.69444,0,0,.35139],107:[0,.69444,0,0,.60694],108:[0,.69444,0,0,.31944],109:[0,.44444,0,0,.95833],110:[0,.44444,0,0,.63889],111:[0,.44444,0,0,.575],112:[.19444,.44444,0,0,.63889],113:[.19444,.44444,0,0,.60694],114:[0,.44444,0,0,.47361],115:[0,.44444,0,0,.45361],116:[0,.63492,0,0,.44722],117:[0,.44444,0,0,.63889],118:[0,.44444,.01597,0,.60694],119:[0,.44444,.01597,0,.83055],120:[0,.44444,0,0,.60694],121:[.19444,.44444,.01597,0,.60694],122:[0,.44444,0,0,.51111],123:[.25,.75,0,0,.575],124:[.25,.75,0,0,.31944],125:[.25,.75,0,0,.575],126:[.35,.34444,0,0,.575],160:[0,0,0,0,.25],163:[0,.69444,0,0,.86853],168:[0,.69444,0,0,.575],172:[0,.44444,0,0,.76666],176:[0,.69444,0,0,.86944],177:[.13333,.63333,0,0,.89444],184:[.17014,0,0,0,.51111],198:[0,.68611,0,0,1.04166],215:[.13333,.63333,0,0,.89444],216:[.04861,.73472,0,0,.89444],223:[0,.69444,0,0,.59722],230:[0,.44444,0,0,.83055],247:[.13333,.63333,0,0,.89444],248:[.09722,.54167,0,0,.575],305:[0,.44444,0,0,.31944],338:[0,.68611,0,0,1.16944],339:[0,.44444,0,0,.89444],567:[.19444,.44444,0,0,.35139],710:[0,.69444,0,0,.575],711:[0,.63194,0,0,.575],713:[0,.59611,0,0,.575],714:[0,.69444,0,0,.575],715:[0,.69444,0,0,.575],728:[0,.69444,0,0,.575],729:[0,.69444,0,0,.31944],730:[0,.69444,0,0,.86944],732:[0,.69444,0,0,.575],733:[0,.69444,0,0,.575],915:[0,.68611,0,0,.69166],916:[0,.68611,0,0,.95833],920:[0,.68611,0,0,.89444],923:[0,.68611,0,0,.80555],926:[0,.68611,0,0,.76666],928:[0,.68611,0,0,.9],931:[0,.68611,0,0,.83055],933:[0,.68611,0,0,.89444],934:[0,.68611,0,0,.83055],936:[0,.68611,0,0,.89444],937:[0,.68611,0,0,.83055],8211:[0,.44444,.03194,0,.575],8212:[0,.44444,.03194,0,1.14999],8216:[0,.69444,0,0,.31944],8217:[0,.69444,0,0,.31944],8220:[0,.69444,0,0,.60278],8221:[0,.69444,0,0,.60278],8224:[.19444,.69444,0,0,.51111],8225:[.19444,.69444,0,0,.51111],8242:[0,.55556,0,0,.34444],8407:[0,.72444,.15486,0,.575],8463:[0,.69444,0,0,.66759],8465:[0,.69444,0,0,.83055],8467:[0,.69444,0,0,.47361],8472:[.19444,.44444,0,0,.74027],8476:[0,.69444,0,0,.83055],8501:[0,.69444,0,0,.70277],8592:[-.10889,.39111,0,0,1.14999],8593:[.19444,.69444,0,0,.575],8594:[-.10889,.39111,0,0,1.14999],8595:[.19444,.69444,0,0,.575],8596:[-.10889,.39111,0,0,1.14999],8597:[.25,.75,0,0,.575],8598:[.19444,.69444,0,0,1.14999],8599:[.19444,.69444,0,0,1.14999],8600:[.19444,.69444,0,0,1.14999],8601:[.19444,.69444,0,0,1.14999],8636:[-.10889,.39111,0,0,1.14999],8637:[-.10889,.39111,0,0,1.14999],8640:[-.10889,.39111,0,0,1.14999],8641:[-.10889,.39111,0,0,1.14999],8656:[-.10889,.39111,0,0,1.14999],8657:[.19444,.69444,0,0,.70277],8658:[-.10889,.39111,0,0,1.14999],8659:[.19444,.69444,0,0,.70277],8660:[-.10889,.39111,0,0,1.14999],8661:[.25,.75,0,0,.70277],8704:[0,.69444,0,0,.63889],8706:[0,.69444,.06389,0,.62847],8707:[0,.69444,0,0,.63889],8709:[.05556,.75,0,0,.575],8711:[0,.68611,0,0,.95833],8712:[.08556,.58556,0,0,.76666],8715:[.08556,.58556,0,0,.76666],8722:[.13333,.63333,0,0,.89444],8723:[.13333,.63333,0,0,.89444],8725:[.25,.75,0,0,.575],8726:[.25,.75,0,0,.575],8727:[-.02778,.47222,0,0,.575],8728:[-.02639,.47361,0,0,.575],8729:[-.02639,.47361,0,0,.575],8730:[.18,.82,0,0,.95833],8733:[0,.44444,0,0,.89444],8734:[0,.44444,0,0,1.14999],8736:[0,.69224,0,0,.72222],8739:[.25,.75,0,0,.31944],8741:[.25,.75,0,0,.575],8743:[0,.55556,0,0,.76666],8744:[0,.55556,0,0,.76666],8745:[0,.55556,0,0,.76666],8746:[0,.55556,0,0,.76666],8747:[.19444,.69444,.12778,0,.56875],8764:[-.10889,.39111,0,0,.89444],8768:[.19444,.69444,0,0,.31944],8771:[.00222,.50222,0,0,.89444],8773:[.027,.638,0,0,.894],8776:[.02444,.52444,0,0,.89444],8781:[.00222,.50222,0,0,.89444],8801:[.00222,.50222,0,0,.89444],8804:[.19667,.69667,0,0,.89444],8805:[.19667,.69667,0,0,.89444],8810:[.08556,.58556,0,0,1.14999],8811:[.08556,.58556,0,0,1.14999],8826:[.08556,.58556,0,0,.89444],8827:[.08556,.58556,0,0,.89444],8834:[.08556,.58556,0,0,.89444],8835:[.08556,.58556,0,0,.89444],8838:[.19667,.69667,0,0,.89444],8839:[.19667,.69667,0,0,.89444],8846:[0,.55556,0,0,.76666],8849:[.19667,.69667,0,0,.89444],8850:[.19667,.69667,0,0,.89444],8851:[0,.55556,0,0,.76666],8852:[0,.55556,0,0,.76666],8853:[.13333,.63333,0,0,.89444],8854:[.13333,.63333,0,0,.89444],8855:[.13333,.63333,0,0,.89444],8856:[.13333,.63333,0,0,.89444],8857:[.13333,.63333,0,0,.89444],8866:[0,.69444,0,0,.70277],8867:[0,.69444,0,0,.70277],8868:[0,.69444,0,0,.89444],8869:[0,.69444,0,0,.89444],8900:[-.02639,.47361,0,0,.575],8901:[-.02639,.47361,0,0,.31944],8902:[-.02778,.47222,0,0,.575],8968:[.25,.75,0,0,.51111],8969:[.25,.75,0,0,.51111],8970:[.25,.75,0,0,.51111],8971:[.25,.75,0,0,.51111],8994:[-.13889,.36111,0,0,1.14999],8995:[-.13889,.36111,0,0,1.14999],9651:[.19444,.69444,0,0,1.02222],9657:[-.02778,.47222,0,0,.575],9661:[.19444,.69444,0,0,1.02222],9667:[-.02778,.47222,0,0,.575],9711:[.19444,.69444,0,0,1.14999],9824:[.12963,.69444,0,0,.89444],9825:[.12963,.69444,0,0,.89444],9826:[.12963,.69444,0,0,.89444],9827:[.12963,.69444,0,0,.89444],9837:[0,.75,0,0,.44722],9838:[.19444,.69444,0,0,.44722],9839:[.19444,.69444,0,0,.44722],10216:[.25,.75,0,0,.44722],10217:[.25,.75,0,0,.44722],10815:[0,.68611,0,0,.9],10927:[.19667,.69667,0,0,.89444],10928:[.19667,.69667,0,0,.89444],57376:[.19444,.69444,0,0,0]},"Main-BoldItalic":{32:[0,0,0,0,.25],33:[0,.69444,.11417,0,.38611],34:[0,.69444,.07939,0,.62055],35:[.19444,.69444,.06833,0,.94444],37:[.05556,.75,.12861,0,.94444],38:[0,.69444,.08528,0,.88555],39:[0,.69444,.12945,0,.35555],40:[.25,.75,.15806,0,.47333],41:[.25,.75,.03306,0,.47333],42:[0,.75,.14333,0,.59111],43:[.10333,.60333,.03306,0,.88555],44:[.19444,.14722,0,0,.35555],45:[0,.44444,.02611,0,.41444],46:[0,.14722,0,0,.35555],47:[.25,.75,.15806,0,.59111],48:[0,.64444,.13167,0,.59111],49:[0,.64444,.13167,0,.59111],50:[0,.64444,.13167,0,.59111],51:[0,.64444,.13167,0,.59111],52:[.19444,.64444,.13167,0,.59111],53:[0,.64444,.13167,0,.59111],54:[0,.64444,.13167,0,.59111],55:[.19444,.64444,.13167,0,.59111],56:[0,.64444,.13167,0,.59111],57:[0,.64444,.13167,0,.59111],58:[0,.44444,.06695,0,.35555],59:[.19444,.44444,.06695,0,.35555],61:[-.10889,.39111,.06833,0,.88555],63:[0,.69444,.11472,0,.59111],64:[0,.69444,.09208,0,.88555],65:[0,.68611,0,0,.86555],66:[0,.68611,.0992,0,.81666],67:[0,.68611,.14208,0,.82666],68:[0,.68611,.09062,0,.87555],69:[0,.68611,.11431,0,.75666],70:[0,.68611,.12903,0,.72722],71:[0,.68611,.07347,0,.89527],72:[0,.68611,.17208,0,.8961],73:[0,.68611,.15681,0,.47166],74:[0,.68611,.145,0,.61055],75:[0,.68611,.14208,0,.89499],76:[0,.68611,0,0,.69777],77:[0,.68611,.17208,0,1.07277],78:[0,.68611,.17208,0,.8961],79:[0,.68611,.09062,0,.85499],80:[0,.68611,.0992,0,.78721],81:[.19444,.68611,.09062,0,.85499],82:[0,.68611,.02559,0,.85944],83:[0,.68611,.11264,0,.64999],84:[0,.68611,.12903,0,.7961],85:[0,.68611,.17208,0,.88083],86:[0,.68611,.18625,0,.86555],87:[0,.68611,.18625,0,1.15999],88:[0,.68611,.15681,0,.86555],89:[0,.68611,.19803,0,.86555],90:[0,.68611,.14208,0,.70888],91:[.25,.75,.1875,0,.35611],93:[.25,.75,.09972,0,.35611],94:[0,.69444,.06709,0,.59111],95:[.31,.13444,.09811,0,.59111],97:[0,.44444,.09426,0,.59111],98:[0,.69444,.07861,0,.53222],99:[0,.44444,.05222,0,.53222],100:[0,.69444,.10861,0,.59111],101:[0,.44444,.085,0,.53222],102:[.19444,.69444,.21778,0,.4],103:[.19444,.44444,.105,0,.53222],104:[0,.69444,.09426,0,.59111],105:[0,.69326,.11387,0,.35555],106:[.19444,.69326,.1672,0,.35555],107:[0,.69444,.11111,0,.53222],108:[0,.69444,.10861,0,.29666],109:[0,.44444,.09426,0,.94444],110:[0,.44444,.09426,0,.64999],111:[0,.44444,.07861,0,.59111],112:[.19444,.44444,.07861,0,.59111],113:[.19444,.44444,.105,0,.53222],114:[0,.44444,.11111,0,.50167],115:[0,.44444,.08167,0,.48694],116:[0,.63492,.09639,0,.385],117:[0,.44444,.09426,0,.62055],118:[0,.44444,.11111,0,.53222],119:[0,.44444,.11111,0,.76777],120:[0,.44444,.12583,0,.56055],121:[.19444,.44444,.105,0,.56166],122:[0,.44444,.13889,0,.49055],126:[.35,.34444,.11472,0,.59111],160:[0,0,0,0,.25],168:[0,.69444,.11473,0,.59111],176:[0,.69444,0,0,.94888],184:[.17014,0,0,0,.53222],198:[0,.68611,.11431,0,1.02277],216:[.04861,.73472,.09062,0,.88555],223:[.19444,.69444,.09736,0,.665],230:[0,.44444,.085,0,.82666],248:[.09722,.54167,.09458,0,.59111],305:[0,.44444,.09426,0,.35555],338:[0,.68611,.11431,0,1.14054],339:[0,.44444,.085,0,.82666],567:[.19444,.44444,.04611,0,.385],710:[0,.69444,.06709,0,.59111],711:[0,.63194,.08271,0,.59111],713:[0,.59444,.10444,0,.59111],714:[0,.69444,.08528,0,.59111],715:[0,.69444,0,0,.59111],728:[0,.69444,.10333,0,.59111],729:[0,.69444,.12945,0,.35555],730:[0,.69444,0,0,.94888],732:[0,.69444,.11472,0,.59111],733:[0,.69444,.11472,0,.59111],915:[0,.68611,.12903,0,.69777],916:[0,.68611,0,0,.94444],920:[0,.68611,.09062,0,.88555],923:[0,.68611,0,0,.80666],926:[0,.68611,.15092,0,.76777],928:[0,.68611,.17208,0,.8961],931:[0,.68611,.11431,0,.82666],933:[0,.68611,.10778,0,.88555],934:[0,.68611,.05632,0,.82666],936:[0,.68611,.10778,0,.88555],937:[0,.68611,.0992,0,.82666],8211:[0,.44444,.09811,0,.59111],8212:[0,.44444,.09811,0,1.18221],8216:[0,.69444,.12945,0,.35555],8217:[0,.69444,.12945,0,.35555],8220:[0,.69444,.16772,0,.62055],8221:[0,.69444,.07939,0,.62055]},"Main-Italic":{32:[0,0,0,0,.25],33:[0,.69444,.12417,0,.30667],34:[0,.69444,.06961,0,.51444],35:[.19444,.69444,.06616,0,.81777],37:[.05556,.75,.13639,0,.81777],38:[0,.69444,.09694,0,.76666],39:[0,.69444,.12417,0,.30667],40:[.25,.75,.16194,0,.40889],41:[.25,.75,.03694,0,.40889],42:[0,.75,.14917,0,.51111],43:[.05667,.56167,.03694,0,.76666],44:[.19444,.10556,0,0,.30667],45:[0,.43056,.02826,0,.35778],46:[0,.10556,0,0,.30667],47:[.25,.75,.16194,0,.51111],48:[0,.64444,.13556,0,.51111],49:[0,.64444,.13556,0,.51111],50:[0,.64444,.13556,0,.51111],51:[0,.64444,.13556,0,.51111],52:[.19444,.64444,.13556,0,.51111],53:[0,.64444,.13556,0,.51111],54:[0,.64444,.13556,0,.51111],55:[.19444,.64444,.13556,0,.51111],56:[0,.64444,.13556,0,.51111],57:[0,.64444,.13556,0,.51111],58:[0,.43056,.0582,0,.30667],59:[.19444,.43056,.0582,0,.30667],61:[-.13313,.36687,.06616,0,.76666],63:[0,.69444,.1225,0,.51111],64:[0,.69444,.09597,0,.76666],65:[0,.68333,0,0,.74333],66:[0,.68333,.10257,0,.70389],67:[0,.68333,.14528,0,.71555],68:[0,.68333,.09403,0,.755],69:[0,.68333,.12028,0,.67833],70:[0,.68333,.13305,0,.65277],71:[0,.68333,.08722,0,.77361],72:[0,.68333,.16389,0,.74333],73:[0,.68333,.15806,0,.38555],74:[0,.68333,.14028,0,.525],75:[0,.68333,.14528,0,.76888],76:[0,.68333,0,0,.62722],77:[0,.68333,.16389,0,.89666],78:[0,.68333,.16389,0,.74333],79:[0,.68333,.09403,0,.76666],80:[0,.68333,.10257,0,.67833],81:[.19444,.68333,.09403,0,.76666],82:[0,.68333,.03868,0,.72944],83:[0,.68333,.11972,0,.56222],84:[0,.68333,.13305,0,.71555],85:[0,.68333,.16389,0,.74333],86:[0,.68333,.18361,0,.74333],87:[0,.68333,.18361,0,.99888],88:[0,.68333,.15806,0,.74333],89:[0,.68333,.19383,0,.74333],90:[0,.68333,.14528,0,.61333],91:[.25,.75,.1875,0,.30667],93:[.25,.75,.10528,0,.30667],94:[0,.69444,.06646,0,.51111],95:[.31,.12056,.09208,0,.51111],97:[0,.43056,.07671,0,.51111],98:[0,.69444,.06312,0,.46],99:[0,.43056,.05653,0,.46],100:[0,.69444,.10333,0,.51111],101:[0,.43056,.07514,0,.46],102:[.19444,.69444,.21194,0,.30667],103:[.19444,.43056,.08847,0,.46],104:[0,.69444,.07671,0,.51111],105:[0,.65536,.1019,0,.30667],106:[.19444,.65536,.14467,0,.30667],107:[0,.69444,.10764,0,.46],108:[0,.69444,.10333,0,.25555],109:[0,.43056,.07671,0,.81777],110:[0,.43056,.07671,0,.56222],111:[0,.43056,.06312,0,.51111],112:[.19444,.43056,.06312,0,.51111],113:[.19444,.43056,.08847,0,.46],114:[0,.43056,.10764,0,.42166],115:[0,.43056,.08208,0,.40889],116:[0,.61508,.09486,0,.33222],117:[0,.43056,.07671,0,.53666],118:[0,.43056,.10764,0,.46],119:[0,.43056,.10764,0,.66444],120:[0,.43056,.12042,0,.46389],121:[.19444,.43056,.08847,0,.48555],122:[0,.43056,.12292,0,.40889],126:[.35,.31786,.11585,0,.51111],160:[0,0,0,0,.25],168:[0,.66786,.10474,0,.51111],176:[0,.69444,0,0,.83129],184:[.17014,0,0,0,.46],198:[0,.68333,.12028,0,.88277],216:[.04861,.73194,.09403,0,.76666],223:[.19444,.69444,.10514,0,.53666],230:[0,.43056,.07514,0,.71555],248:[.09722,.52778,.09194,0,.51111],338:[0,.68333,.12028,0,.98499],339:[0,.43056,.07514,0,.71555],710:[0,.69444,.06646,0,.51111],711:[0,.62847,.08295,0,.51111],713:[0,.56167,.10333,0,.51111],714:[0,.69444,.09694,0,.51111],715:[0,.69444,0,0,.51111],728:[0,.69444,.10806,0,.51111],729:[0,.66786,.11752,0,.30667],730:[0,.69444,0,0,.83129],732:[0,.66786,.11585,0,.51111],733:[0,.69444,.1225,0,.51111],915:[0,.68333,.13305,0,.62722],916:[0,.68333,0,0,.81777],920:[0,.68333,.09403,0,.76666],923:[0,.68333,0,0,.69222],926:[0,.68333,.15294,0,.66444],928:[0,.68333,.16389,0,.74333],931:[0,.68333,.12028,0,.71555],933:[0,.68333,.11111,0,.76666],934:[0,.68333,.05986,0,.71555],936:[0,.68333,.11111,0,.76666],937:[0,.68333,.10257,0,.71555],8211:[0,.43056,.09208,0,.51111],8212:[0,.43056,.09208,0,1.02222],8216:[0,.69444,.12417,0,.30667],8217:[0,.69444,.12417,0,.30667],8220:[0,.69444,.1685,0,.51444],8221:[0,.69444,.06961,0,.51444],8463:[0,.68889,0,0,.54028]},"Main-Regular":{32:[0,0,0,0,.25],33:[0,.69444,0,0,.27778],34:[0,.69444,0,0,.5],35:[.19444,.69444,0,0,.83334],36:[.05556,.75,0,0,.5],37:[.05556,.75,0,0,.83334],38:[0,.69444,0,0,.77778],39:[0,.69444,0,0,.27778],40:[.25,.75,0,0,.38889],41:[.25,.75,0,0,.38889],42:[0,.75,0,0,.5],43:[.08333,.58333,0,0,.77778],44:[.19444,.10556,0,0,.27778],45:[0,.43056,0,0,.33333],46:[0,.10556,0,0,.27778],47:[.25,.75,0,0,.5],48:[0,.64444,0,0,.5],49:[0,.64444,0,0,.5],50:[0,.64444,0,0,.5],51:[0,.64444,0,0,.5],52:[0,.64444,0,0,.5],53:[0,.64444,0,0,.5],54:[0,.64444,0,0,.5],55:[0,.64444,0,0,.5],56:[0,.64444,0,0,.5],57:[0,.64444,0,0,.5],58:[0,.43056,0,0,.27778],59:[.19444,.43056,0,0,.27778],60:[.0391,.5391,0,0,.77778],61:[-.13313,.36687,0,0,.77778],62:[.0391,.5391,0,0,.77778],63:[0,.69444,0,0,.47222],64:[0,.69444,0,0,.77778],65:[0,.68333,0,0,.75],66:[0,.68333,0,0,.70834],67:[0,.68333,0,0,.72222],68:[0,.68333,0,0,.76389],69:[0,.68333,0,0,.68056],70:[0,.68333,0,0,.65278],71:[0,.68333,0,0,.78472],72:[0,.68333,0,0,.75],73:[0,.68333,0,0,.36111],74:[0,.68333,0,0,.51389],75:[0,.68333,0,0,.77778],76:[0,.68333,0,0,.625],77:[0,.68333,0,0,.91667],78:[0,.68333,0,0,.75],79:[0,.68333,0,0,.77778],80:[0,.68333,0,0,.68056],81:[.19444,.68333,0,0,.77778],82:[0,.68333,0,0,.73611],83:[0,.68333,0,0,.55556],84:[0,.68333,0,0,.72222],85:[0,.68333,0,0,.75],86:[0,.68333,.01389,0,.75],87:[0,.68333,.01389,0,1.02778],88:[0,.68333,0,0,.75],89:[0,.68333,.025,0,.75],90:[0,.68333,0,0,.61111],91:[.25,.75,0,0,.27778],92:[.25,.75,0,0,.5],93:[.25,.75,0,0,.27778],94:[0,.69444,0,0,.5],95:[.31,.12056,.02778,0,.5],97:[0,.43056,0,0,.5],98:[0,.69444,0,0,.55556],99:[0,.43056,0,0,.44445],100:[0,.69444,0,0,.55556],101:[0,.43056,0,0,.44445],102:[0,.69444,.07778,0,.30556],103:[.19444,.43056,.01389,0,.5],104:[0,.69444,0,0,.55556],105:[0,.66786,0,0,.27778],106:[.19444,.66786,0,0,.30556],107:[0,.69444,0,0,.52778],108:[0,.69444,0,0,.27778],109:[0,.43056,0,0,.83334],110:[0,.43056,0,0,.55556],111:[0,.43056,0,0,.5],112:[.19444,.43056,0,0,.55556],113:[.19444,.43056,0,0,.52778],114:[0,.43056,0,0,.39167],115:[0,.43056,0,0,.39445],116:[0,.61508,0,0,.38889],117:[0,.43056,0,0,.55556],118:[0,.43056,.01389,0,.52778],119:[0,.43056,.01389,0,.72222],120:[0,.43056,0,0,.52778],121:[.19444,.43056,.01389,0,.52778],122:[0,.43056,0,0,.44445],123:[.25,.75,0,0,.5],124:[.25,.75,0,0,.27778],125:[.25,.75,0,0,.5],126:[.35,.31786,0,0,.5],160:[0,0,0,0,.25],163:[0,.69444,0,0,.76909],167:[.19444,.69444,0,0,.44445],168:[0,.66786,0,0,.5],172:[0,.43056,0,0,.66667],176:[0,.69444,0,0,.75],177:[.08333,.58333,0,0,.77778],182:[.19444,.69444,0,0,.61111],184:[.17014,0,0,0,.44445],198:[0,.68333,0,0,.90278],215:[.08333,.58333,0,0,.77778],216:[.04861,.73194,0,0,.77778],223:[0,.69444,0,0,.5],230:[0,.43056,0,0,.72222],247:[.08333,.58333,0,0,.77778],248:[.09722,.52778,0,0,.5],305:[0,.43056,0,0,.27778],338:[0,.68333,0,0,1.01389],339:[0,.43056,0,0,.77778],567:[.19444,.43056,0,0,.30556],710:[0,.69444,0,0,.5],711:[0,.62847,0,0,.5],713:[0,.56778,0,0,.5],714:[0,.69444,0,0,.5],715:[0,.69444,0,0,.5],728:[0,.69444,0,0,.5],729:[0,.66786,0,0,.27778],730:[0,.69444,0,0,.75],732:[0,.66786,0,0,.5],733:[0,.69444,0,0,.5],915:[0,.68333,0,0,.625],916:[0,.68333,0,0,.83334],920:[0,.68333,0,0,.77778],923:[0,.68333,0,0,.69445],926:[0,.68333,0,0,.66667],928:[0,.68333,0,0,.75],931:[0,.68333,0,0,.72222],933:[0,.68333,0,0,.77778],934:[0,.68333,0,0,.72222],936:[0,.68333,0,0,.77778],937:[0,.68333,0,0,.72222],8211:[0,.43056,.02778,0,.5],8212:[0,.43056,.02778,0,1],8216:[0,.69444,0,0,.27778],8217:[0,.69444,0,0,.27778],8220:[0,.69444,0,0,.5],8221:[0,.69444,0,0,.5],8224:[.19444,.69444,0,0,.44445],8225:[.19444,.69444,0,0,.44445],8230:[0,.123,0,0,1.172],8242:[0,.55556,0,0,.275],8407:[0,.71444,.15382,0,.5],8463:[0,.68889,0,0,.54028],8465:[0,.69444,0,0,.72222],8467:[0,.69444,0,.11111,.41667],8472:[.19444,.43056,0,.11111,.63646],8476:[0,.69444,0,0,.72222],8501:[0,.69444,0,0,.61111],8592:[-.13313,.36687,0,0,1],8593:[.19444,.69444,0,0,.5],8594:[-.13313,.36687,0,0,1],8595:[.19444,.69444,0,0,.5],8596:[-.13313,.36687,0,0,1],8597:[.25,.75,0,0,.5],8598:[.19444,.69444,0,0,1],8599:[.19444,.69444,0,0,1],8600:[.19444,.69444,0,0,1],8601:[.19444,.69444,0,0,1],8614:[.011,.511,0,0,1],8617:[.011,.511,0,0,1.126],8618:[.011,.511,0,0,1.126],8636:[-.13313,.36687,0,0,1],8637:[-.13313,.36687,0,0,1],8640:[-.13313,.36687,0,0,1],8641:[-.13313,.36687,0,0,1],8652:[.011,.671,0,0,1],8656:[-.13313,.36687,0,0,1],8657:[.19444,.69444,0,0,.61111],8658:[-.13313,.36687,0,0,1],8659:[.19444,.69444,0,0,.61111],8660:[-.13313,.36687,0,0,1],8661:[.25,.75,0,0,.61111],8704:[0,.69444,0,0,.55556],8706:[0,.69444,.05556,.08334,.5309],8707:[0,.69444,0,0,.55556],8709:[.05556,.75,0,0,.5],8711:[0,.68333,0,0,.83334],8712:[.0391,.5391,0,0,.66667],8715:[.0391,.5391,0,0,.66667],8722:[.08333,.58333,0,0,.77778],8723:[.08333,.58333,0,0,.77778],8725:[.25,.75,0,0,.5],8726:[.25,.75,0,0,.5],8727:[-.03472,.46528,0,0,.5],8728:[-.05555,.44445,0,0,.5],8729:[-.05555,.44445,0,0,.5],8730:[.2,.8,0,0,.83334],8733:[0,.43056,0,0,.77778],8734:[0,.43056,0,0,1],8736:[0,.69224,0,0,.72222],8739:[.25,.75,0,0,.27778],8741:[.25,.75,0,0,.5],8743:[0,.55556,0,0,.66667],8744:[0,.55556,0,0,.66667],8745:[0,.55556,0,0,.66667],8746:[0,.55556,0,0,.66667],8747:[.19444,.69444,.11111,0,.41667],8764:[-.13313,.36687,0,0,.77778],8768:[.19444,.69444,0,0,.27778],8771:[-.03625,.46375,0,0,.77778],8773:[-.022,.589,0,0,.778],8776:[-.01688,.48312,0,0,.77778],8781:[-.03625,.46375,0,0,.77778],8784:[-.133,.673,0,0,.778],8801:[-.03625,.46375,0,0,.77778],8804:[.13597,.63597,0,0,.77778],8805:[.13597,.63597,0,0,.77778],8810:[.0391,.5391,0,0,1],8811:[.0391,.5391,0,0,1],8826:[.0391,.5391,0,0,.77778],8827:[.0391,.5391,0,0,.77778],8834:[.0391,.5391,0,0,.77778],8835:[.0391,.5391,0,0,.77778],8838:[.13597,.63597,0,0,.77778],8839:[.13597,.63597,0,0,.77778],8846:[0,.55556,0,0,.66667],8849:[.13597,.63597,0,0,.77778],8850:[.13597,.63597,0,0,.77778],8851:[0,.55556,0,0,.66667],8852:[0,.55556,0,0,.66667],8853:[.08333,.58333,0,0,.77778],8854:[.08333,.58333,0,0,.77778],8855:[.08333,.58333,0,0,.77778],8856:[.08333,.58333,0,0,.77778],8857:[.08333,.58333,0,0,.77778],8866:[0,.69444,0,0,.61111],8867:[0,.69444,0,0,.61111],8868:[0,.69444,0,0,.77778],8869:[0,.69444,0,0,.77778],8872:[.249,.75,0,0,.867],8900:[-.05555,.44445,0,0,.5],8901:[-.05555,.44445,0,0,.27778],8902:[-.03472,.46528,0,0,.5],8904:[.005,.505,0,0,.9],8942:[.03,.903,0,0,.278],8943:[-.19,.313,0,0,1.172],8945:[-.1,.823,0,0,1.282],8968:[.25,.75,0,0,.44445],8969:[.25,.75,0,0,.44445],8970:[.25,.75,0,0,.44445],8971:[.25,.75,0,0,.44445],8994:[-.14236,.35764,0,0,1],8995:[-.14236,.35764,0,0,1],9136:[.244,.744,0,0,.412],9137:[.244,.745,0,0,.412],9651:[.19444,.69444,0,0,.88889],9657:[-.03472,.46528,0,0,.5],9661:[.19444,.69444,0,0,.88889],9667:[-.03472,.46528,0,0,.5],9711:[.19444,.69444,0,0,1],9824:[.12963,.69444,0,0,.77778],9825:[.12963,.69444,0,0,.77778],9826:[.12963,.69444,0,0,.77778],9827:[.12963,.69444,0,0,.77778],9837:[0,.75,0,0,.38889],9838:[.19444,.69444,0,0,.38889],9839:[.19444,.69444,0,0,.38889],10216:[.25,.75,0,0,.38889],10217:[.25,.75,0,0,.38889],10222:[.244,.744,0,0,.412],10223:[.244,.745,0,0,.412],10229:[.011,.511,0,0,1.609],10230:[.011,.511,0,0,1.638],10231:[.011,.511,0,0,1.859],10232:[.024,.525,0,0,1.609],10233:[.024,.525,0,0,1.638],10234:[.024,.525,0,0,1.858],10236:[.011,.511,0,0,1.638],10815:[0,.68333,0,0,.75],10927:[.13597,.63597,0,0,.77778],10928:[.13597,.63597,0,0,.77778],57376:[.19444,.69444,0,0,0]},"Math-BoldItalic":{32:[0,0,0,0,.25],48:[0,.44444,0,0,.575],49:[0,.44444,0,0,.575],50:[0,.44444,0,0,.575],51:[.19444,.44444,0,0,.575],52:[.19444,.44444,0,0,.575],53:[.19444,.44444,0,0,.575],54:[0,.64444,0,0,.575],55:[.19444,.44444,0,0,.575],56:[0,.64444,0,0,.575],57:[.19444,.44444,0,0,.575],65:[0,.68611,0,0,.86944],66:[0,.68611,.04835,0,.8664],67:[0,.68611,.06979,0,.81694],68:[0,.68611,.03194,0,.93812],69:[0,.68611,.05451,0,.81007],70:[0,.68611,.15972,0,.68889],71:[0,.68611,0,0,.88673],72:[0,.68611,.08229,0,.98229],73:[0,.68611,.07778,0,.51111],74:[0,.68611,.10069,0,.63125],75:[0,.68611,.06979,0,.97118],76:[0,.68611,0,0,.75555],77:[0,.68611,.11424,0,1.14201],78:[0,.68611,.11424,0,.95034],79:[0,.68611,.03194,0,.83666],80:[0,.68611,.15972,0,.72309],81:[.19444,.68611,0,0,.86861],82:[0,.68611,.00421,0,.87235],83:[0,.68611,.05382,0,.69271],84:[0,.68611,.15972,0,.63663],85:[0,.68611,.11424,0,.80027],86:[0,.68611,.25555,0,.67778],87:[0,.68611,.15972,0,1.09305],88:[0,.68611,.07778,0,.94722],89:[0,.68611,.25555,0,.67458],90:[0,.68611,.06979,0,.77257],97:[0,.44444,0,0,.63287],98:[0,.69444,0,0,.52083],99:[0,.44444,0,0,.51342],100:[0,.69444,0,0,.60972],101:[0,.44444,0,0,.55361],102:[.19444,.69444,.11042,0,.56806],103:[.19444,.44444,.03704,0,.5449],104:[0,.69444,0,0,.66759],105:[0,.69326,0,0,.4048],106:[.19444,.69326,.0622,0,.47083],107:[0,.69444,.01852,0,.6037],108:[0,.69444,.0088,0,.34815],109:[0,.44444,0,0,1.0324],110:[0,.44444,0,0,.71296],111:[0,.44444,0,0,.58472],112:[.19444,.44444,0,0,.60092],113:[.19444,.44444,.03704,0,.54213],114:[0,.44444,.03194,0,.5287],115:[0,.44444,0,0,.53125],116:[0,.63492,0,0,.41528],117:[0,.44444,0,0,.68102],118:[0,.44444,.03704,0,.56666],119:[0,.44444,.02778,0,.83148],120:[0,.44444,0,0,.65903],121:[.19444,.44444,.03704,0,.59028],122:[0,.44444,.04213,0,.55509],160:[0,0,0,0,.25],915:[0,.68611,.15972,0,.65694],916:[0,.68611,0,0,.95833],920:[0,.68611,.03194,0,.86722],923:[0,.68611,0,0,.80555],926:[0,.68611,.07458,0,.84125],928:[0,.68611,.08229,0,.98229],931:[0,.68611,.05451,0,.88507],933:[0,.68611,.15972,0,.67083],934:[0,.68611,0,0,.76666],936:[0,.68611,.11653,0,.71402],937:[0,.68611,.04835,0,.8789],945:[0,.44444,0,0,.76064],946:[.19444,.69444,.03403,0,.65972],947:[.19444,.44444,.06389,0,.59003],948:[0,.69444,.03819,0,.52222],949:[0,.44444,0,0,.52882],950:[.19444,.69444,.06215,0,.50833],951:[.19444,.44444,.03704,0,.6],952:[0,.69444,.03194,0,.5618],953:[0,.44444,0,0,.41204],954:[0,.44444,0,0,.66759],955:[0,.69444,0,0,.67083],956:[.19444,.44444,0,0,.70787],957:[0,.44444,.06898,0,.57685],958:[.19444,.69444,.03021,0,.50833],959:[0,.44444,0,0,.58472],960:[0,.44444,.03704,0,.68241],961:[.19444,.44444,0,0,.6118],962:[.09722,.44444,.07917,0,.42361],963:[0,.44444,.03704,0,.68588],964:[0,.44444,.13472,0,.52083],965:[0,.44444,.03704,0,.63055],966:[.19444,.44444,0,0,.74722],967:[.19444,.44444,0,0,.71805],968:[.19444,.69444,.03704,0,.75833],969:[0,.44444,.03704,0,.71782],977:[0,.69444,0,0,.69155],981:[.19444,.69444,0,0,.7125],982:[0,.44444,.03194,0,.975],1009:[.19444,.44444,0,0,.6118],1013:[0,.44444,0,0,.48333],57649:[0,.44444,0,0,.39352],57911:[.19444,.44444,0,0,.43889]},"Math-Italic":{32:[0,0,0,0,.25],48:[0,.43056,0,0,.5],49:[0,.43056,0,0,.5],50:[0,.43056,0,0,.5],51:[.19444,.43056,0,0,.5],52:[.19444,.43056,0,0,.5],53:[.19444,.43056,0,0,.5],54:[0,.64444,0,0,.5],55:[.19444,.43056,0,0,.5],56:[0,.64444,0,0,.5],57:[.19444,.43056,0,0,.5],65:[0,.68333,0,.13889,.75],66:[0,.68333,.05017,.08334,.75851],67:[0,.68333,.07153,.08334,.71472],68:[0,.68333,.02778,.05556,.82792],69:[0,.68333,.05764,.08334,.7382],70:[0,.68333,.13889,.08334,.64306],71:[0,.68333,0,.08334,.78625],72:[0,.68333,.08125,.05556,.83125],73:[0,.68333,.07847,.11111,.43958],74:[0,.68333,.09618,.16667,.55451],75:[0,.68333,.07153,.05556,.84931],76:[0,.68333,0,.02778,.68056],77:[0,.68333,.10903,.08334,.97014],78:[0,.68333,.10903,.08334,.80347],79:[0,.68333,.02778,.08334,.76278],80:[0,.68333,.13889,.08334,.64201],81:[.19444,.68333,0,.08334,.79056],82:[0,.68333,.00773,.08334,.75929],83:[0,.68333,.05764,.08334,.6132],84:[0,.68333,.13889,.08334,.58438],85:[0,.68333,.10903,.02778,.68278],86:[0,.68333,.22222,0,.58333],87:[0,.68333,.13889,0,.94445],88:[0,.68333,.07847,.08334,.82847],89:[0,.68333,.22222,0,.58056],90:[0,.68333,.07153,.08334,.68264],97:[0,.43056,0,0,.52859],98:[0,.69444,0,0,.42917],99:[0,.43056,0,.05556,.43276],100:[0,.69444,0,.16667,.52049],101:[0,.43056,0,.05556,.46563],102:[.19444,.69444,.10764,.16667,.48959],103:[.19444,.43056,.03588,.02778,.47697],104:[0,.69444,0,0,.57616],105:[0,.65952,0,0,.34451],106:[.19444,.65952,.05724,0,.41181],107:[0,.69444,.03148,0,.5206],108:[0,.69444,.01968,.08334,.29838],109:[0,.43056,0,0,.87801],110:[0,.43056,0,0,.60023],111:[0,.43056,0,.05556,.48472],112:[.19444,.43056,0,.08334,.50313],113:[.19444,.43056,.03588,.08334,.44641],114:[0,.43056,.02778,.05556,.45116],115:[0,.43056,0,.05556,.46875],116:[0,.61508,0,.08334,.36111],117:[0,.43056,0,.02778,.57246],118:[0,.43056,.03588,.02778,.48472],119:[0,.43056,.02691,.08334,.71592],120:[0,.43056,0,.02778,.57153],121:[.19444,.43056,.03588,.05556,.49028],122:[0,.43056,.04398,.05556,.46505],160:[0,0,0,0,.25],915:[0,.68333,.13889,.08334,.61528],916:[0,.68333,0,.16667,.83334],920:[0,.68333,.02778,.08334,.76278],923:[0,.68333,0,.16667,.69445],926:[0,.68333,.07569,.08334,.74236],928:[0,.68333,.08125,.05556,.83125],931:[0,.68333,.05764,.08334,.77986],933:[0,.68333,.13889,.05556,.58333],934:[0,.68333,0,.08334,.66667],936:[0,.68333,.11,.05556,.61222],937:[0,.68333,.05017,.08334,.7724],945:[0,.43056,.0037,.02778,.6397],946:[.19444,.69444,.05278,.08334,.56563],947:[.19444,.43056,.05556,0,.51773],948:[0,.69444,.03785,.05556,.44444],949:[0,.43056,0,.08334,.46632],950:[.19444,.69444,.07378,.08334,.4375],951:[.19444,.43056,.03588,.05556,.49653],952:[0,.69444,.02778,.08334,.46944],953:[0,.43056,0,.05556,.35394],954:[0,.43056,0,0,.57616],955:[0,.69444,0,0,.58334],956:[.19444,.43056,0,.02778,.60255],957:[0,.43056,.06366,.02778,.49398],958:[.19444,.69444,.04601,.11111,.4375],959:[0,.43056,0,.05556,.48472],960:[0,.43056,.03588,0,.57003],961:[.19444,.43056,0,.08334,.51702],962:[.09722,.43056,.07986,.08334,.36285],963:[0,.43056,.03588,0,.57141],964:[0,.43056,.1132,.02778,.43715],965:[0,.43056,.03588,.02778,.54028],966:[.19444,.43056,0,.08334,.65417],967:[.19444,.43056,0,.05556,.62569],968:[.19444,.69444,.03588,.11111,.65139],969:[0,.43056,.03588,0,.62245],977:[0,.69444,0,.08334,.59144],981:[.19444,.69444,0,.08334,.59583],982:[0,.43056,.02778,0,.82813],1009:[.19444,.43056,0,.08334,.51702],1013:[0,.43056,0,.05556,.4059],57649:[0,.43056,0,.02778,.32246],57911:[.19444,.43056,0,.08334,.38403]},"SansSerif-Bold":{32:[0,0,0,0,.25],33:[0,.69444,0,0,.36667],34:[0,.69444,0,0,.55834],35:[.19444,.69444,0,0,.91667],36:[.05556,.75,0,0,.55],37:[.05556,.75,0,0,1.02912],38:[0,.69444,0,0,.83056],39:[0,.69444,0,0,.30556],40:[.25,.75,0,0,.42778],41:[.25,.75,0,0,.42778],42:[0,.75,0,0,.55],43:[.11667,.61667,0,0,.85556],44:[.10556,.13056,0,0,.30556],45:[0,.45833,0,0,.36667],46:[0,.13056,0,0,.30556],47:[.25,.75,0,0,.55],48:[0,.69444,0,0,.55],49:[0,.69444,0,0,.55],50:[0,.69444,0,0,.55],51:[0,.69444,0,0,.55],52:[0,.69444,0,0,.55],53:[0,.69444,0,0,.55],54:[0,.69444,0,0,.55],55:[0,.69444,0,0,.55],56:[0,.69444,0,0,.55],57:[0,.69444,0,0,.55],58:[0,.45833,0,0,.30556],59:[.10556,.45833,0,0,.30556],61:[-.09375,.40625,0,0,.85556],63:[0,.69444,0,0,.51945],64:[0,.69444,0,0,.73334],65:[0,.69444,0,0,.73334],66:[0,.69444,0,0,.73334],67:[0,.69444,0,0,.70278],68:[0,.69444,0,0,.79445],69:[0,.69444,0,0,.64167],70:[0,.69444,0,0,.61111],71:[0,.69444,0,0,.73334],72:[0,.69444,0,0,.79445],73:[0,.69444,0,0,.33056],74:[0,.69444,0,0,.51945],75:[0,.69444,0,0,.76389],76:[0,.69444,0,0,.58056],77:[0,.69444,0,0,.97778],78:[0,.69444,0,0,.79445],79:[0,.69444,0,0,.79445],80:[0,.69444,0,0,.70278],81:[.10556,.69444,0,0,.79445],82:[0,.69444,0,0,.70278],83:[0,.69444,0,0,.61111],84:[0,.69444,0,0,.73334],85:[0,.69444,0,0,.76389],86:[0,.69444,.01528,0,.73334],87:[0,.69444,.01528,0,1.03889],88:[0,.69444,0,0,.73334],89:[0,.69444,.0275,0,.73334],90:[0,.69444,0,0,.67223],91:[.25,.75,0,0,.34306],93:[.25,.75,0,0,.34306],94:[0,.69444,0,0,.55],95:[.35,.10833,.03056,0,.55],97:[0,.45833,0,0,.525],98:[0,.69444,0,0,.56111],99:[0,.45833,0,0,.48889],100:[0,.69444,0,0,.56111],101:[0,.45833,0,0,.51111],102:[0,.69444,.07639,0,.33611],103:[.19444,.45833,.01528,0,.55],104:[0,.69444,0,0,.56111],105:[0,.69444,0,0,.25556],106:[.19444,.69444,0,0,.28611],107:[0,.69444,0,0,.53056],108:[0,.69444,0,0,.25556],109:[0,.45833,0,0,.86667],110:[0,.45833,0,0,.56111],111:[0,.45833,0,0,.55],112:[.19444,.45833,0,0,.56111],113:[.19444,.45833,0,0,.56111],114:[0,.45833,.01528,0,.37222],115:[0,.45833,0,0,.42167],116:[0,.58929,0,0,.40417],117:[0,.45833,0,0,.56111],118:[0,.45833,.01528,0,.5],119:[0,.45833,.01528,0,.74445],120:[0,.45833,0,0,.5],121:[.19444,.45833,.01528,0,.5],122:[0,.45833,0,0,.47639],126:[.35,.34444,0,0,.55],160:[0,0,0,0,.25],168:[0,.69444,0,0,.55],176:[0,.69444,0,0,.73334],180:[0,.69444,0,0,.55],184:[.17014,0,0,0,.48889],305:[0,.45833,0,0,.25556],567:[.19444,.45833,0,0,.28611],710:[0,.69444,0,0,.55],711:[0,.63542,0,0,.55],713:[0,.63778,0,0,.55],728:[0,.69444,0,0,.55],729:[0,.69444,0,0,.30556],730:[0,.69444,0,0,.73334],732:[0,.69444,0,0,.55],733:[0,.69444,0,0,.55],915:[0,.69444,0,0,.58056],916:[0,.69444,0,0,.91667],920:[0,.69444,0,0,.85556],923:[0,.69444,0,0,.67223],926:[0,.69444,0,0,.73334],928:[0,.69444,0,0,.79445],931:[0,.69444,0,0,.79445],933:[0,.69444,0,0,.85556],934:[0,.69444,0,0,.79445],936:[0,.69444,0,0,.85556],937:[0,.69444,0,0,.79445],8211:[0,.45833,.03056,0,.55],8212:[0,.45833,.03056,0,1.10001],8216:[0,.69444,0,0,.30556],8217:[0,.69444,0,0,.30556],8220:[0,.69444,0,0,.55834],8221:[0,.69444,0,0,.55834]},"SansSerif-Italic":{32:[0,0,0,0,.25],33:[0,.69444,.05733,0,.31945],34:[0,.69444,.00316,0,.5],35:[.19444,.69444,.05087,0,.83334],36:[.05556,.75,.11156,0,.5],37:[.05556,.75,.03126,0,.83334],38:[0,.69444,.03058,0,.75834],39:[0,.69444,.07816,0,.27778],40:[.25,.75,.13164,0,.38889],41:[.25,.75,.02536,0,.38889],42:[0,.75,.11775,0,.5],43:[.08333,.58333,.02536,0,.77778],44:[.125,.08333,0,0,.27778],45:[0,.44444,.01946,0,.33333],46:[0,.08333,0,0,.27778],47:[.25,.75,.13164,0,.5],48:[0,.65556,.11156,0,.5],49:[0,.65556,.11156,0,.5],50:[0,.65556,.11156,0,.5],51:[0,.65556,.11156,0,.5],52:[0,.65556,.11156,0,.5],53:[0,.65556,.11156,0,.5],54:[0,.65556,.11156,0,.5],55:[0,.65556,.11156,0,.5],56:[0,.65556,.11156,0,.5],57:[0,.65556,.11156,0,.5],58:[0,.44444,.02502,0,.27778],59:[.125,.44444,.02502,0,.27778],61:[-.13,.37,.05087,0,.77778],63:[0,.69444,.11809,0,.47222],64:[0,.69444,.07555,0,.66667],65:[0,.69444,0,0,.66667],66:[0,.69444,.08293,0,.66667],67:[0,.69444,.11983,0,.63889],68:[0,.69444,.07555,0,.72223],69:[0,.69444,.11983,0,.59722],70:[0,.69444,.13372,0,.56945],71:[0,.69444,.11983,0,.66667],72:[0,.69444,.08094,0,.70834],73:[0,.69444,.13372,0,.27778],74:[0,.69444,.08094,0,.47222],75:[0,.69444,.11983,0,.69445],76:[0,.69444,0,0,.54167],77:[0,.69444,.08094,0,.875],78:[0,.69444,.08094,0,.70834],79:[0,.69444,.07555,0,.73611],80:[0,.69444,.08293,0,.63889],81:[.125,.69444,.07555,0,.73611],82:[0,.69444,.08293,0,.64584],83:[0,.69444,.09205,0,.55556],84:[0,.69444,.13372,0,.68056],85:[0,.69444,.08094,0,.6875],86:[0,.69444,.1615,0,.66667],87:[0,.69444,.1615,0,.94445],88:[0,.69444,.13372,0,.66667],89:[0,.69444,.17261,0,.66667],90:[0,.69444,.11983,0,.61111],91:[.25,.75,.15942,0,.28889],93:[.25,.75,.08719,0,.28889],94:[0,.69444,.0799,0,.5],95:[.35,.09444,.08616,0,.5],97:[0,.44444,.00981,0,.48056],98:[0,.69444,.03057,0,.51667],99:[0,.44444,.08336,0,.44445],100:[0,.69444,.09483,0,.51667],101:[0,.44444,.06778,0,.44445],102:[0,.69444,.21705,0,.30556],103:[.19444,.44444,.10836,0,.5],104:[0,.69444,.01778,0,.51667],105:[0,.67937,.09718,0,.23889],106:[.19444,.67937,.09162,0,.26667],107:[0,.69444,.08336,0,.48889],108:[0,.69444,.09483,0,.23889],109:[0,.44444,.01778,0,.79445],110:[0,.44444,.01778,0,.51667],111:[0,.44444,.06613,0,.5],112:[.19444,.44444,.0389,0,.51667],113:[.19444,.44444,.04169,0,.51667],114:[0,.44444,.10836,0,.34167],115:[0,.44444,.0778,0,.38333],116:[0,.57143,.07225,0,.36111],117:[0,.44444,.04169,0,.51667],118:[0,.44444,.10836,0,.46111],119:[0,.44444,.10836,0,.68334],120:[0,.44444,.09169,0,.46111],121:[.19444,.44444,.10836,0,.46111],122:[0,.44444,.08752,0,.43472],126:[.35,.32659,.08826,0,.5],160:[0,0,0,0,.25],168:[0,.67937,.06385,0,.5],176:[0,.69444,0,0,.73752],184:[.17014,0,0,0,.44445],305:[0,.44444,.04169,0,.23889],567:[.19444,.44444,.04169,0,.26667],710:[0,.69444,.0799,0,.5],711:[0,.63194,.08432,0,.5],713:[0,.60889,.08776,0,.5],714:[0,.69444,.09205,0,.5],715:[0,.69444,0,0,.5],728:[0,.69444,.09483,0,.5],729:[0,.67937,.07774,0,.27778],730:[0,.69444,0,0,.73752],732:[0,.67659,.08826,0,.5],733:[0,.69444,.09205,0,.5],915:[0,.69444,.13372,0,.54167],916:[0,.69444,0,0,.83334],920:[0,.69444,.07555,0,.77778],923:[0,.69444,0,0,.61111],926:[0,.69444,.12816,0,.66667],928:[0,.69444,.08094,0,.70834],931:[0,.69444,.11983,0,.72222],933:[0,.69444,.09031,0,.77778],934:[0,.69444,.04603,0,.72222],936:[0,.69444,.09031,0,.77778],937:[0,.69444,.08293,0,.72222],8211:[0,.44444,.08616,0,.5],8212:[0,.44444,.08616,0,1],8216:[0,.69444,.07816,0,.27778],8217:[0,.69444,.07816,0,.27778],8220:[0,.69444,.14205,0,.5],8221:[0,.69444,.00316,0,.5]},"SansSerif-Regular":{32:[0,0,0,0,.25],33:[0,.69444,0,0,.31945],34:[0,.69444,0,0,.5],35:[.19444,.69444,0,0,.83334],36:[.05556,.75,0,0,.5],37:[.05556,.75,0,0,.83334],38:[0,.69444,0,0,.75834],39:[0,.69444,0,0,.27778],40:[.25,.75,0,0,.38889],41:[.25,.75,0,0,.38889],42:[0,.75,0,0,.5],43:[.08333,.58333,0,0,.77778],44:[.125,.08333,0,0,.27778],45:[0,.44444,0,0,.33333],46:[0,.08333,0,0,.27778],47:[.25,.75,0,0,.5],48:[0,.65556,0,0,.5],49:[0,.65556,0,0,.5],50:[0,.65556,0,0,.5],51:[0,.65556,0,0,.5],52:[0,.65556,0,0,.5],53:[0,.65556,0,0,.5],54:[0,.65556,0,0,.5],55:[0,.65556,0,0,.5],56:[0,.65556,0,0,.5],57:[0,.65556,0,0,.5],58:[0,.44444,0,0,.27778],59:[.125,.44444,0,0,.27778],61:[-.13,.37,0,0,.77778],63:[0,.69444,0,0,.47222],64:[0,.69444,0,0,.66667],65:[0,.69444,0,0,.66667],66:[0,.69444,0,0,.66667],67:[0,.69444,0,0,.63889],68:[0,.69444,0,0,.72223],69:[0,.69444,0,0,.59722],70:[0,.69444,0,0,.56945],71:[0,.69444,0,0,.66667],72:[0,.69444,0,0,.70834],73:[0,.69444,0,0,.27778],74:[0,.69444,0,0,.47222],75:[0,.69444,0,0,.69445],76:[0,.69444,0,0,.54167],77:[0,.69444,0,0,.875],78:[0,.69444,0,0,.70834],79:[0,.69444,0,0,.73611],80:[0,.69444,0,0,.63889],81:[.125,.69444,0,0,.73611],82:[0,.69444,0,0,.64584],83:[0,.69444,0,0,.55556],84:[0,.69444,0,0,.68056],85:[0,.69444,0,0,.6875],86:[0,.69444,.01389,0,.66667],87:[0,.69444,.01389,0,.94445],88:[0,.69444,0,0,.66667],89:[0,.69444,.025,0,.66667],90:[0,.69444,0,0,.61111],91:[.25,.75,0,0,.28889],93:[.25,.75,0,0,.28889],94:[0,.69444,0,0,.5],95:[.35,.09444,.02778,0,.5],97:[0,.44444,0,0,.48056],98:[0,.69444,0,0,.51667],99:[0,.44444,0,0,.44445],100:[0,.69444,0,0,.51667],101:[0,.44444,0,0,.44445],102:[0,.69444,.06944,0,.30556],103:[.19444,.44444,.01389,0,.5],104:[0,.69444,0,0,.51667],105:[0,.67937,0,0,.23889],106:[.19444,.67937,0,0,.26667],107:[0,.69444,0,0,.48889],108:[0,.69444,0,0,.23889],109:[0,.44444,0,0,.79445],110:[0,.44444,0,0,.51667],111:[0,.44444,0,0,.5],112:[.19444,.44444,0,0,.51667],113:[.19444,.44444,0,0,.51667],114:[0,.44444,.01389,0,.34167],115:[0,.44444,0,0,.38333],116:[0,.57143,0,0,.36111],117:[0,.44444,0,0,.51667],118:[0,.44444,.01389,0,.46111],119:[0,.44444,.01389,0,.68334],120:[0,.44444,0,0,.46111],121:[.19444,.44444,.01389,0,.46111],122:[0,.44444,0,0,.43472],126:[.35,.32659,0,0,.5],160:[0,0,0,0,.25],168:[0,.67937,0,0,.5],176:[0,.69444,0,0,.66667],184:[.17014,0,0,0,.44445],305:[0,.44444,0,0,.23889],567:[.19444,.44444,0,0,.26667],710:[0,.69444,0,0,.5],711:[0,.63194,0,0,.5],713:[0,.60889,0,0,.5],714:[0,.69444,0,0,.5],715:[0,.69444,0,0,.5],728:[0,.69444,0,0,.5],729:[0,.67937,0,0,.27778],730:[0,.69444,0,0,.66667],732:[0,.67659,0,0,.5],733:[0,.69444,0,0,.5],915:[0,.69444,0,0,.54167],916:[0,.69444,0,0,.83334],920:[0,.69444,0,0,.77778],923:[0,.69444,0,0,.61111],926:[0,.69444,0,0,.66667],928:[0,.69444,0,0,.70834],931:[0,.69444,0,0,.72222],933:[0,.69444,0,0,.77778],934:[0,.69444,0,0,.72222],936:[0,.69444,0,0,.77778],937:[0,.69444,0,0,.72222],8211:[0,.44444,.02778,0,.5],8212:[0,.44444,.02778,0,1],8216:[0,.69444,0,0,.27778],8217:[0,.69444,0,0,.27778],8220:[0,.69444,0,0,.5],8221:[0,.69444,0,0,.5]},"Script-Regular":{32:[0,0,0,0,.25],65:[0,.7,.22925,0,.80253],66:[0,.7,.04087,0,.90757],67:[0,.7,.1689,0,.66619],68:[0,.7,.09371,0,.77443],69:[0,.7,.18583,0,.56162],70:[0,.7,.13634,0,.89544],71:[0,.7,.17322,0,.60961],72:[0,.7,.29694,0,.96919],73:[0,.7,.19189,0,.80907],74:[.27778,.7,.19189,0,1.05159],75:[0,.7,.31259,0,.91364],76:[0,.7,.19189,0,.87373],77:[0,.7,.15981,0,1.08031],78:[0,.7,.3525,0,.9015],79:[0,.7,.08078,0,.73787],80:[0,.7,.08078,0,1.01262],81:[0,.7,.03305,0,.88282],82:[0,.7,.06259,0,.85],83:[0,.7,.19189,0,.86767],84:[0,.7,.29087,0,.74697],85:[0,.7,.25815,0,.79996],86:[0,.7,.27523,0,.62204],87:[0,.7,.27523,0,.80532],88:[0,.7,.26006,0,.94445],89:[0,.7,.2939,0,.70961],90:[0,.7,.24037,0,.8212],160:[0,0,0,0,.25]},"Size1-Regular":{32:[0,0,0,0,.25],40:[.35001,.85,0,0,.45834],41:[.35001,.85,0,0,.45834],47:[.35001,.85,0,0,.57778],91:[.35001,.85,0,0,.41667],92:[.35001,.85,0,0,.57778],93:[.35001,.85,0,0,.41667],123:[.35001,.85,0,0,.58334],125:[.35001,.85,0,0,.58334],160:[0,0,0,0,.25],710:[0,.72222,0,0,.55556],732:[0,.72222,0,0,.55556],770:[0,.72222,0,0,.55556],771:[0,.72222,0,0,.55556],8214:[-99e-5,.601,0,0,.77778],8593:[1e-5,.6,0,0,.66667],8595:[1e-5,.6,0,0,.66667],8657:[1e-5,.6,0,0,.77778],8659:[1e-5,.6,0,0,.77778],8719:[.25001,.75,0,0,.94445],8720:[.25001,.75,0,0,.94445],8721:[.25001,.75,0,0,1.05556],8730:[.35001,.85,0,0,1],8739:[-.00599,.606,0,0,.33333],8741:[-.00599,.606,0,0,.55556],8747:[.30612,.805,.19445,0,.47222],8748:[.306,.805,.19445,0,.47222],8749:[.306,.805,.19445,0,.47222],8750:[.30612,.805,.19445,0,.47222],8896:[.25001,.75,0,0,.83334],8897:[.25001,.75,0,0,.83334],8898:[.25001,.75,0,0,.83334],8899:[.25001,.75,0,0,.83334],8968:[.35001,.85,0,0,.47222],8969:[.35001,.85,0,0,.47222],8970:[.35001,.85,0,0,.47222],8971:[.35001,.85,0,0,.47222],9168:[-99e-5,.601,0,0,.66667],10216:[.35001,.85,0,0,.47222],10217:[.35001,.85,0,0,.47222],10752:[.25001,.75,0,0,1.11111],10753:[.25001,.75,0,0,1.11111],10754:[.25001,.75,0,0,1.11111],10756:[.25001,.75,0,0,.83334],10758:[.25001,.75,0,0,.83334]},"Size2-Regular":{32:[0,0,0,0,.25],40:[.65002,1.15,0,0,.59722],41:[.65002,1.15,0,0,.59722],47:[.65002,1.15,0,0,.81111],91:[.65002,1.15,0,0,.47222],92:[.65002,1.15,0,0,.81111],93:[.65002,1.15,0,0,.47222],123:[.65002,1.15,0,0,.66667],125:[.65002,1.15,0,0,.66667],160:[0,0,0,0,.25],710:[0,.75,0,0,1],732:[0,.75,0,0,1],770:[0,.75,0,0,1],771:[0,.75,0,0,1],8719:[.55001,1.05,0,0,1.27778],8720:[.55001,1.05,0,0,1.27778],8721:[.55001,1.05,0,0,1.44445],8730:[.65002,1.15,0,0,1],8747:[.86225,1.36,.44445,0,.55556],8748:[.862,1.36,.44445,0,.55556],8749:[.862,1.36,.44445,0,.55556],8750:[.86225,1.36,.44445,0,.55556],8896:[.55001,1.05,0,0,1.11111],8897:[.55001,1.05,0,0,1.11111],8898:[.55001,1.05,0,0,1.11111],8899:[.55001,1.05,0,0,1.11111],8968:[.65002,1.15,0,0,.52778],8969:[.65002,1.15,0,0,.52778],8970:[.65002,1.15,0,0,.52778],8971:[.65002,1.15,0,0,.52778],10216:[.65002,1.15,0,0,.61111],10217:[.65002,1.15,0,0,.61111],10752:[.55001,1.05,0,0,1.51112],10753:[.55001,1.05,0,0,1.51112],10754:[.55001,1.05,0,0,1.51112],10756:[.55001,1.05,0,0,1.11111],10758:[.55001,1.05,0,0,1.11111]},"Size3-Regular":{32:[0,0,0,0,.25],40:[.95003,1.45,0,0,.73611],41:[.95003,1.45,0,0,.73611],47:[.95003,1.45,0,0,1.04445],91:[.95003,1.45,0,0,.52778],92:[.95003,1.45,0,0,1.04445],93:[.95003,1.45,0,0,.52778],123:[.95003,1.45,0,0,.75],125:[.95003,1.45,0,0,.75],160:[0,0,0,0,.25],710:[0,.75,0,0,1.44445],732:[0,.75,0,0,1.44445],770:[0,.75,0,0,1.44445],771:[0,.75,0,0,1.44445],8730:[.95003,1.45,0,0,1],8968:[.95003,1.45,0,0,.58334],8969:[.95003,1.45,0,0,.58334],8970:[.95003,1.45,0,0,.58334],8971:[.95003,1.45,0,0,.58334],10216:[.95003,1.45,0,0,.75],10217:[.95003,1.45,0,0,.75]},"Size4-Regular":{32:[0,0,0,0,.25],40:[1.25003,1.75,0,0,.79167],41:[1.25003,1.75,0,0,.79167],47:[1.25003,1.75,0,0,1.27778],91:[1.25003,1.75,0,0,.58334],92:[1.25003,1.75,0,0,1.27778],93:[1.25003,1.75,0,0,.58334],123:[1.25003,1.75,0,0,.80556],125:[1.25003,1.75,0,0,.80556],160:[0,0,0,0,.25],710:[0,.825,0,0,1.8889],732:[0,.825,0,0,1.8889],770:[0,.825,0,0,1.8889],771:[0,.825,0,0,1.8889],8730:[1.25003,1.75,0,0,1],8968:[1.25003,1.75,0,0,.63889],8969:[1.25003,1.75,0,0,.63889],8970:[1.25003,1.75,0,0,.63889],8971:[1.25003,1.75,0,0,.63889],9115:[.64502,1.155,0,0,.875],9116:[1e-5,.6,0,0,.875],9117:[.64502,1.155,0,0,.875],9118:[.64502,1.155,0,0,.875],9119:[1e-5,.6,0,0,.875],9120:[.64502,1.155,0,0,.875],9121:[.64502,1.155,0,0,.66667],9122:[-99e-5,.601,0,0,.66667],9123:[.64502,1.155,0,0,.66667],9124:[.64502,1.155,0,0,.66667],9125:[-99e-5,.601,0,0,.66667],9126:[.64502,1.155,0,0,.66667],9127:[1e-5,.9,0,0,.88889],9128:[.65002,1.15,0,0,.88889],9129:[.90001,0,0,0,.88889],9130:[0,.3,0,0,.88889],9131:[1e-5,.9,0,0,.88889],9132:[.65002,1.15,0,0,.88889],9133:[.90001,0,0,0,.88889],9143:[.88502,.915,0,0,1.05556],10216:[1.25003,1.75,0,0,.80556],10217:[1.25003,1.75,0,0,.80556],57344:[-.00499,.605,0,0,1.05556],57345:[-.00499,.605,0,0,1.05556],57680:[0,.12,0,0,.45],57681:[0,.12,0,0,.45],57682:[0,.12,0,0,.45],57683:[0,.12,0,0,.45]},"Typewriter-Regular":{32:[0,0,0,0,.525],33:[0,.61111,0,0,.525],34:[0,.61111,0,0,.525],35:[0,.61111,0,0,.525],36:[.08333,.69444,0,0,.525],37:[.08333,.69444,0,0,.525],38:[0,.61111,0,0,.525],39:[0,.61111,0,0,.525],40:[.08333,.69444,0,0,.525],41:[.08333,.69444,0,0,.525],42:[0,.52083,0,0,.525],43:[-.08056,.53055,0,0,.525],44:[.13889,.125,0,0,.525],45:[-.08056,.53055,0,0,.525],46:[0,.125,0,0,.525],47:[.08333,.69444,0,0,.525],48:[0,.61111,0,0,.525],49:[0,.61111,0,0,.525],50:[0,.61111,0,0,.525],51:[0,.61111,0,0,.525],52:[0,.61111,0,0,.525],53:[0,.61111,0,0,.525],54:[0,.61111,0,0,.525],55:[0,.61111,0,0,.525],56:[0,.61111,0,0,.525],57:[0,.61111,0,0,.525],58:[0,.43056,0,0,.525],59:[.13889,.43056,0,0,.525],60:[-.05556,.55556,0,0,.525],61:[-.19549,.41562,0,0,.525],62:[-.05556,.55556,0,0,.525],63:[0,.61111,0,0,.525],64:[0,.61111,0,0,.525],65:[0,.61111,0,0,.525],66:[0,.61111,0,0,.525],67:[0,.61111,0,0,.525],68:[0,.61111,0,0,.525],69:[0,.61111,0,0,.525],70:[0,.61111,0,0,.525],71:[0,.61111,0,0,.525],72:[0,.61111,0,0,.525],73:[0,.61111,0,0,.525],74:[0,.61111,0,0,.525],75:[0,.61111,0,0,.525],76:[0,.61111,0,0,.525],77:[0,.61111,0,0,.525],78:[0,.61111,0,0,.525],79:[0,.61111,0,0,.525],80:[0,.61111,0,0,.525],81:[.13889,.61111,0,0,.525],82:[0,.61111,0,0,.525],83:[0,.61111,0,0,.525],84:[0,.61111,0,0,.525],85:[0,.61111,0,0,.525],86:[0,.61111,0,0,.525],87:[0,.61111,0,0,.525],88:[0,.61111,0,0,.525],89:[0,.61111,0,0,.525],90:[0,.61111,0,0,.525],91:[.08333,.69444,0,0,.525],92:[.08333,.69444,0,0,.525],93:[.08333,.69444,0,0,.525],94:[0,.61111,0,0,.525],95:[.09514,0,0,0,.525],96:[0,.61111,0,0,.525],97:[0,.43056,0,0,.525],98:[0,.61111,0,0,.525],99:[0,.43056,0,0,.525],100:[0,.61111,0,0,.525],101:[0,.43056,0,0,.525],102:[0,.61111,0,0,.525],103:[.22222,.43056,0,0,.525],104:[0,.61111,0,0,.525],105:[0,.61111,0,0,.525],106:[.22222,.61111,0,0,.525],107:[0,.61111,0,0,.525],108:[0,.61111,0,0,.525],109:[0,.43056,0,0,.525],110:[0,.43056,0,0,.525],111:[0,.43056,0,0,.525],112:[.22222,.43056,0,0,.525],113:[.22222,.43056,0,0,.525],114:[0,.43056,0,0,.525],115:[0,.43056,0,0,.525],116:[0,.55358,0,0,.525],117:[0,.43056,0,0,.525],118:[0,.43056,0,0,.525],119:[0,.43056,0,0,.525],120:[0,.43056,0,0,.525],121:[.22222,.43056,0,0,.525],122:[0,.43056,0,0,.525],123:[.08333,.69444,0,0,.525],124:[.08333,.69444,0,0,.525],125:[.08333,.69444,0,0,.525],126:[0,.61111,0,0,.525],127:[0,.61111,0,0,.525],160:[0,0,0,0,.525],176:[0,.61111,0,0,.525],184:[.19445,0,0,0,.525],305:[0,.43056,0,0,.525],567:[.22222,.43056,0,0,.525],711:[0,.56597,0,0,.525],713:[0,.56555,0,0,.525],714:[0,.61111,0,0,.525],715:[0,.61111,0,0,.525],728:[0,.61111,0,0,.525],730:[0,.61111,0,0,.525],770:[0,.61111,0,0,.525],771:[0,.61111,0,0,.525],776:[0,.61111,0,0,.525],915:[0,.61111,0,0,.525],916:[0,.61111,0,0,.525],920:[0,.61111,0,0,.525],923:[0,.61111,0,0,.525],926:[0,.61111,0,0,.525],928:[0,.61111,0,0,.525],931:[0,.61111,0,0,.525],933:[0,.61111,0,0,.525],934:[0,.61111,0,0,.525],936:[0,.61111,0,0,.525],937:[0,.61111,0,0,.525],8216:[0,.61111,0,0,.525],8217:[0,.61111,0,0,.525],8242:[0,.61111,0,0,.525],9251:[.11111,.21944,0,0,.525]}},La={slant:[.25,.25,.25],space:[0,0,0],stretch:[0,0,0],shrink:[0,0,0],xHeight:[.431,.431,.431],quad:[1,1.171,1.472],extraSpace:[0,0,0],num1:[.677,.732,.925],num2:[.394,.384,.387],num3:[.444,.471,.504],denom1:[.686,.752,1.025],denom2:[.345,.344,.532],sup1:[.413,.503,.504],sup2:[.363,.431,.404],sup3:[.289,.286,.294],sub1:[.15,.143,.2],sub2:[.247,.286,.4],supDrop:[.386,.353,.494],subDrop:[.05,.071,.1],delim1:[2.39,1.7,1.98],delim2:[1.01,1.157,1.42],axisHeight:[.25,.25,.25],defaultRuleThickness:[.04,.049,.049],bigOpSpacing1:[.111,.111,.111],bigOpSpacing2:[.166,.166,.166],bigOpSpacing3:[.2,.2,.2],bigOpSpacing4:[.6,.611,.611],bigOpSpacing5:[.1,.143,.143],sqrtRuleThickness:[.04,.04,.04],ptPerEm:[10,10,10],doubleRuleSep:[.2,.2,.2],arrayRuleWidth:[.04,.04,.04],fboxsep:[.3,.3,.3],fboxrule:[.04,.04,.04]},Gi={\u00C5:"A",\u00D0:"D",\u00DE:"o",\u00E5:"a",\u00F0:"d",\u00FE:"o",\u0410:"A",\u0411:"B",\u0412:"B",\u0413:"F",\u0414:"A",\u0415:"E",\u0416:"K",\u0417:"3",\u0418:"N",\u0419:"N",\u041A:"K",\u041B:"N",\u041C:"M",\u041D:"H",\u041E:"O",\u041F:"N",\u0420:"P",\u0421:"C",\u0422:"T",\u0423:"y",\u0424:"O",\u0425:"X",\u0426:"U",\u0427:"h",\u0428:"W",\u0429:"W",\u042A:"B",\u042B:"X",\u042C:"B",\u042D:"3",\u042E:"X",\u042F:"R",\u0430:"a",\u0431:"b",\u0432:"a",\u0433:"r",\u0434:"y",\u0435:"e",\u0436:"m",\u0437:"e",\u0438:"n",\u0439:"n",\u043A:"n",\u043B:"n",\u043C:"m",\u043D:"n",\u043E:"o",\u043F:"n",\u0440:"p",\u0441:"c",\u0442:"o",\u0443:"y",\u0444:"b",\u0445:"x",\u0446:"n",\u0447:"n",\u0448:"w",\u0449:"w",\u044A:"a",\u044B:"m",\u044C:"a",\u044D:"e",\u044E:"m",\u044F:"r"};function su(r,e){p0[r]=e}function yn(r,e,t){if(!p0[e])throw new Error("Font metrics not found for font: "+e+".");var a=r.charCodeAt(0),n=p0[e][a];if(!n&&r[0]in Gi&&(a=Gi[r[0]].charCodeAt(0),n=p0[e][a]),!n&&t==="text"&&zs(a)&&(n=p0[e][77]),n)return{depth:n[0],height:n[1],italic:n[2],skew:n[3],width:n[4]}}var qa={};function lu(r){var e;if(r>=5?e=0:r>=3?e=1:e=2,!qa[e]){var t=qa[e]={cssEmPerMu:La.quad[e]/18};for(var a of Object.keys(La))t[a]=La[a][e]}return qa[e]}var he={math:{},text:{}};function s(r,e,t,a,n,i){he[r][n]={font:e,group:t,replace:a},i&&a&&(he[r][a]=he[r][n])}var o="math",z="text",c="main",v="ams",me="accent-token",q="bin",Le="close",St="inner",_="mathord",xe="op-token",Ze="open",Kt="punct",g="rel",A0="spacing",y="textord";s(o,c,g,"\u2261","\\equiv",!0);s(o,c,g,"\u227A","\\prec",!0);s(o,c,g,"\u227B","\\succ",!0);s(o,c,g,"\u223C","\\sim",!0);s(o,c,g,"\u22A5","\\perp");s(o,c,g,"\u2AAF","\\preceq",!0);s(o,c,g,"\u2AB0","\\succeq",!0);s(o,c,g,"\u2243","\\simeq",!0);s(o,c,g,"\u2223","\\mid",!0);s(o,c,g,"\u226A","\\ll",!0);s(o,c,g,"\u226B","\\gg",!0);s(o,c,g,"\u224D","\\asymp",!0);s(o,c,g,"\u2225","\\parallel");s(o,c,g,"\u22C8","\\bowtie",!0);s(o,c,g,"\u2323","\\smile",!0);s(o,c,g,"\u2291","\\sqsubseteq",!0);s(o,c,g,"\u2292","\\sqsupseteq",!0);s(o,c,g,"\u2250","\\doteq",!0);s(o,c,g,"\u2322","\\frown",!0);s(o,c,g,"\u220B","\\ni",!0);s(o,c,g,"\u221D","\\propto",!0);s(o,c,g,"\u22A2","\\vdash",!0);s(o,c,g,"\u22A3","\\dashv",!0);s(o,c,g,"\u220B","\\owns");s(o,c,Kt,".","\\ldotp");s(o,c,Kt,"\u22C5","\\cdotp");s(o,c,Kt,"\u22C5","\xB7");s(z,c,y,"\u22C5","\xB7");s(o,c,y,"#","\\#");s(z,c,y,"#","\\#");s(o,c,y,"&","\\&");s(z,c,y,"&","\\&");s(o,c,y,"\u2135","\\aleph",!0);s(o,c,y,"\u2200","\\forall",!0);s(o,c,y,"\u210F","\\hbar",!0);s(o,c,y,"\u2203","\\exists",!0);s(o,c,y,"\u2207","\\nabla",!0);s(o,c,y,"\u266D","\\flat",!0);s(o,c,y,"\u2113","\\ell",!0);s(o,c,y,"\u266E","\\natural",!0);s(o,c,y,"\u2663","\\clubsuit",!0);s(o,c,y,"\u2118","\\wp",!0);s(o,c,y,"\u266F","\\sharp",!0);s(o,c,y,"\u2662","\\diamondsuit",!0);s(o,c,y,"\u211C","\\Re",!0);s(o,c,y,"\u2661","\\heartsuit",!0);s(o,c,y,"\u2111","\\Im",!0);s(o,c,y,"\u2660","\\spadesuit",!0);s(o,c,y,"\xA7","\\S",!0);s(z,c,y,"\xA7","\\S");s(o,c,y,"\xB6","\\P",!0);s(z,c,y,"\xB6","\\P");s(o,c,y,"\u2020","\\dag");s(z,c,y,"\u2020","\\dag");s(z,c,y,"\u2020","\\textdagger");s(o,c,y,"\u2021","\\ddag");s(z,c,y,"\u2021","\\ddag");s(z,c,y,"\u2021","\\textdaggerdbl");s(o,c,Le,"\u23B1","\\rmoustache",!0);s(o,c,Ze,"\u23B0","\\lmoustache",!0);s(o,c,Le,"\u27EF","\\rgroup",!0);s(o,c,Ze,"\u27EE","\\lgroup",!0);s(o,c,q,"\u2213","\\mp",!0);s(o,c,q,"\u2296","\\ominus",!0);s(o,c,q,"\u228E","\\uplus",!0);s(o,c,q,"\u2293","\\sqcap",!0);s(o,c,q,"\u2217","\\ast");s(o,c,q,"\u2294","\\sqcup",!0);s(o,c,q,"\u25EF","\\bigcirc",!0);s(o,c,q,"\u2219","\\bullet",!0);s(o,c,q,"\u2021","\\ddagger");s(o,c,q,"\u2240","\\wr",!0);s(o,c,q,"\u2A3F","\\amalg");s(o,c,q,"&","\\And");s(o,c,g,"\u27F5","\\longleftarrow",!0);s(o,c,g,"\u21D0","\\Leftarrow",!0);s(o,c,g,"\u27F8","\\Longleftarrow",!0);s(o,c,g,"\u27F6","\\longrightarrow",!0);s(o,c,g,"\u21D2","\\Rightarrow",!0);s(o,c,g,"\u27F9","\\Longrightarrow",!0);s(o,c,g,"\u2194","\\leftrightarrow",!0);s(o,c,g,"\u27F7","\\longleftrightarrow",!0);s(o,c,g,"\u21D4","\\Leftrightarrow",!0);s(o,c,g,"\u27FA","\\Longleftrightarrow",!0);s(o,c,g,"\u21A6","\\mapsto",!0);s(o,c,g,"\u27FC","\\longmapsto",!0);s(o,c,g,"\u2197","\\nearrow",!0);s(o,c,g,"\u21A9","\\hookleftarrow",!0);s(o,c,g,"\u21AA","\\hookrightarrow",!0);s(o,c,g,"\u2198","\\searrow",!0);s(o,c,g,"\u21BC","\\leftharpoonup",!0);s(o,c,g,"\u21C0","\\rightharpoonup",!0);s(o,c,g,"\u2199","\\swarrow",!0);s(o,c,g,"\u21BD","\\leftharpoondown",!0);s(o,c,g,"\u21C1","\\rightharpoondown",!0);s(o,c,g,"\u2196","\\nwarrow",!0);s(o,c,g,"\u21CC","\\rightleftharpoons",!0);s(o,v,g,"\u226E","\\nless",!0);s(o,v,g,"\uE010","\\@nleqslant");s(o,v,g,"\uE011","\\@nleqq");s(o,v,g,"\u2A87","\\lneq",!0);s(o,v,g,"\u2268","\\lneqq",!0);s(o,v,g,"\uE00C","\\@lvertneqq");s(o,v,g,"\u22E6","\\lnsim",!0);s(o,v,g,"\u2A89","\\lnapprox",!0);s(o,v,g,"\u2280","\\nprec",!0);s(o,v,g,"\u22E0","\\npreceq",!0);s(o,v,g,"\u22E8","\\precnsim",!0);s(o,v,g,"\u2AB9","\\precnapprox",!0);s(o,v,g,"\u2241","\\nsim",!0);s(o,v,g,"\uE006","\\@nshortmid");s(o,v,g,"\u2224","\\nmid",!0);s(o,v,g,"\u22AC","\\nvdash",!0);s(o,v,g,"\u22AD","\\nvDash",!0);s(o,v,g,"\u22EA","\\ntriangleleft");s(o,v,g,"\u22EC","\\ntrianglelefteq",!0);s(o,v,g,"\u228A","\\subsetneq",!0);s(o,v,g,"\uE01A","\\@varsubsetneq");s(o,v,g,"\u2ACB","\\subsetneqq",!0);s(o,v,g,"\uE017","\\@varsubsetneqq");s(o,v,g,"\u226F","\\ngtr",!0);s(o,v,g,"\uE00F","\\@ngeqslant");s(o,v,g,"\uE00E","\\@ngeqq");s(o,v,g,"\u2A88","\\gneq",!0);s(o,v,g,"\u2269","\\gneqq",!0);s(o,v,g,"\uE00D","\\@gvertneqq");s(o,v,g,"\u22E7","\\gnsim",!0);s(o,v,g,"\u2A8A","\\gnapprox",!0);s(o,v,g,"\u2281","\\nsucc",!0);s(o,v,g,"\u22E1","\\nsucceq",!0);s(o,v,g,"\u22E9","\\succnsim",!0);s(o,v,g,"\u2ABA","\\succnapprox",!0);s(o,v,g,"\u2246","\\ncong",!0);s(o,v,g,"\uE007","\\@nshortparallel");s(o,v,g,"\u2226","\\nparallel",!0);s(o,v,g,"\u22AF","\\nVDash",!0);s(o,v,g,"\u22EB","\\ntriangleright");s(o,v,g,"\u22ED","\\ntrianglerighteq",!0);s(o,v,g,"\uE018","\\@nsupseteqq");s(o,v,g,"\u228B","\\supsetneq",!0);s(o,v,g,"\uE01B","\\@varsupsetneq");s(o,v,g,"\u2ACC","\\supsetneqq",!0);s(o,v,g,"\uE019","\\@varsupsetneqq");s(o,v,g,"\u22AE","\\nVdash",!0);s(o,v,g,"\u2AB5","\\precneqq",!0);s(o,v,g,"\u2AB6","\\succneqq",!0);s(o,v,g,"\uE016","\\@nsubseteqq");s(o,v,q,"\u22B4","\\unlhd");s(o,v,q,"\u22B5","\\unrhd");s(o,v,g,"\u219A","\\nleftarrow",!0);s(o,v,g,"\u219B","\\nrightarrow",!0);s(o,v,g,"\u21CD","\\nLeftarrow",!0);s(o,v,g,"\u21CF","\\nRightarrow",!0);s(o,v,g,"\u21AE","\\nleftrightarrow",!0);s(o,v,g,"\u21CE","\\nLeftrightarrow",!0);s(o,v,g,"\u25B3","\\vartriangle");s(o,v,y,"\u210F","\\hslash");s(o,v,y,"\u25BD","\\triangledown");s(o,v,y,"\u25CA","\\lozenge");s(o,v,y,"\u24C8","\\circledS");s(o,v,y,"\xAE","\\circledR");s(z,v,y,"\xAE","\\circledR");s(o,v,y,"\u2221","\\measuredangle",!0);s(o,v,y,"\u2204","\\nexists");s(o,v,y,"\u2127","\\mho");s(o,v,y,"\u2132","\\Finv",!0);s(o,v,y,"\u2141","\\Game",!0);s(o,v,y,"\u2035","\\backprime");s(o,v,y,"\u25B2","\\blacktriangle");s(o,v,y,"\u25BC","\\blacktriangledown");s(o,v,y,"\u25A0","\\blacksquare");s(o,v,y,"\u29EB","\\blacklozenge");s(o,v,y,"\u2605","\\bigstar");s(o,v,y,"\u2222","\\sphericalangle",!0);s(o,v,y,"\u2201","\\complement",!0);s(o,v,y,"\xF0","\\eth",!0);s(z,c,y,"\xF0","\xF0");s(o,v,y,"\u2571","\\diagup");s(o,v,y,"\u2572","\\diagdown");s(o,v,y,"\u25A1","\\square");s(o,v,y,"\u25A1","\\Box");s(o,v,y,"\u25CA","\\Diamond");s(o,v,y,"\xA5","\\yen",!0);s(z,v,y,"\xA5","\\yen",!0);s(o,v,y,"\u2713","\\checkmark",!0);s(z,v,y,"\u2713","\\checkmark");s(o,v,y,"\u2136","\\beth",!0);s(o,v,y,"\u2138","\\daleth",!0);s(o,v,y,"\u2137","\\gimel",!0);s(o,v,y,"\u03DD","\\digamma",!0);s(o,v,y,"\u03F0","\\varkappa");s(o,v,Ze,"\u250C","\\@ulcorner",!0);s(o,v,Le,"\u2510","\\@urcorner",!0);s(o,v,Ze,"\u2514","\\@llcorner",!0);s(o,v,Le,"\u2518","\\@lrcorner",!0);s(o,v,g,"\u2266","\\leqq",!0);s(o,v,g,"\u2A7D","\\leqslant",!0);s(o,v,g,"\u2A95","\\eqslantless",!0);s(o,v,g,"\u2272","\\lesssim",!0);s(o,v,g,"\u2A85","\\lessapprox",!0);s(o,v,g,"\u224A","\\approxeq",!0);s(o,v,q,"\u22D6","\\lessdot");s(o,v,g,"\u22D8","\\lll",!0);s(o,v,g,"\u2276","\\lessgtr",!0);s(o,v,g,"\u22DA","\\lesseqgtr",!0);s(o,v,g,"\u2A8B","\\lesseqqgtr",!0);s(o,v,g,"\u2251","\\doteqdot");s(o,v,g,"\u2253","\\risingdotseq",!0);s(o,v,g,"\u2252","\\fallingdotseq",!0);s(o,v,g,"\u223D","\\backsim",!0);s(o,v,g,"\u22CD","\\backsimeq",!0);s(o,v,g,"\u2AC5","\\subseteqq",!0);s(o,v,g,"\u22D0","\\Subset",!0);s(o,v,g,"\u228F","\\sqsubset",!0);s(o,v,g,"\u227C","\\preccurlyeq",!0);s(o,v,g,"\u22DE","\\curlyeqprec",!0);s(o,v,g,"\u227E","\\precsim",!0);s(o,v,g,"\u2AB7","\\precapprox",!0);s(o,v,g,"\u22B2","\\vartriangleleft");s(o,v,g,"\u22B4","\\trianglelefteq");s(o,v,g,"\u22A8","\\vDash",!0);s(o,v,g,"\u22AA","\\Vvdash",!0);s(o,v,g,"\u2323","\\smallsmile");s(o,v,g,"\u2322","\\smallfrown");s(o,v,g,"\u224F","\\bumpeq",!0);s(o,v,g,"\u224E","\\Bumpeq",!0);s(o,v,g,"\u2267","\\geqq",!0);s(o,v,g,"\u2A7E","\\geqslant",!0);s(o,v,g,"\u2A96","\\eqslantgtr",!0);s(o,v,g,"\u2273","\\gtrsim",!0);s(o,v,g,"\u2A86","\\gtrapprox",!0);s(o,v,q,"\u22D7","\\gtrdot");s(o,v,g,"\u22D9","\\ggg",!0);s(o,v,g,"\u2277","\\gtrless",!0);s(o,v,g,"\u22DB","\\gtreqless",!0);s(o,v,g,"\u2A8C","\\gtreqqless",!0);s(o,v,g,"\u2256","\\eqcirc",!0);s(o,v,g,"\u2257","\\circeq",!0);s(o,v,g,"\u225C","\\triangleq",!0);s(o,v,g,"\u223C","\\thicksim");s(o,v,g,"\u2248","\\thickapprox");s(o,v,g,"\u2AC6","\\supseteqq",!0);s(o,v,g,"\u22D1","\\Supset",!0);s(o,v,g,"\u2290","\\sqsupset",!0);s(o,v,g,"\u227D","\\succcurlyeq",!0);s(o,v,g,"\u22DF","\\curlyeqsucc",!0);s(o,v,g,"\u227F","\\succsim",!0);s(o,v,g,"\u2AB8","\\succapprox",!0);s(o,v,g,"\u22B3","\\vartriangleright");s(o,v,g,"\u22B5","\\trianglerighteq");s(o,v,g,"\u22A9","\\Vdash",!0);s(o,v,g,"\u2223","\\shortmid");s(o,v,g,"\u2225","\\shortparallel");s(o,v,g,"\u226C","\\between",!0);s(o,v,g,"\u22D4","\\pitchfork",!0);s(o,v,g,"\u221D","\\varpropto");s(o,v,g,"\u25C0","\\blacktriangleleft");s(o,v,g,"\u2234","\\therefore",!0);s(o,v,g,"\u220D","\\backepsilon");s(o,v,g,"\u25B6","\\blacktriangleright");s(o,v,g,"\u2235","\\because",!0);s(o,v,g,"\u22D8","\\llless");s(o,v,g,"\u22D9","\\gggtr");s(o,v,q,"\u22B2","\\lhd");s(o,v,q,"\u22B3","\\rhd");s(o,v,g,"\u2242","\\eqsim",!0);s(o,c,g,"\u22C8","\\Join");s(o,v,g,"\u2251","\\Doteq",!0);s(o,v,q,"\u2214","\\dotplus",!0);s(o,v,q,"\u2216","\\smallsetminus");s(o,v,q,"\u22D2","\\Cap",!0);s(o,v,q,"\u22D3","\\Cup",!0);s(o,v,q,"\u2A5E","\\doublebarwedge",!0);s(o,v,q,"\u229F","\\boxminus",!0);s(o,v,q,"\u229E","\\boxplus",!0);s(o,v,q,"\u22C7","\\divideontimes",!0);s(o,v,q,"\u22C9","\\ltimes",!0);s(o,v,q,"\u22CA","\\rtimes",!0);s(o,v,q,"\u22CB","\\leftthreetimes",!0);s(o,v,q,"\u22CC","\\rightthreetimes",!0);s(o,v,q,"\u22CF","\\curlywedge",!0);s(o,v,q,"\u22CE","\\curlyvee",!0);s(o,v,q,"\u229D","\\circleddash",!0);s(o,v,q,"\u229B","\\circledast",!0);s(o,v,q,"\u22C5","\\centerdot");s(o,v,q,"\u22BA","\\intercal",!0);s(o,v,q,"\u22D2","\\doublecap");s(o,v,q,"\u22D3","\\doublecup");s(o,v,q,"\u22A0","\\boxtimes",!0);s(o,v,g,"\u21E2","\\dashrightarrow",!0);s(o,v,g,"\u21E0","\\dashleftarrow",!0);s(o,v,g,"\u21C7","\\leftleftarrows",!0);s(o,v,g,"\u21C6","\\leftrightarrows",!0);s(o,v,g,"\u21DA","\\Lleftarrow",!0);s(o,v,g,"\u219E","\\twoheadleftarrow",!0);s(o,v,g,"\u21A2","\\leftarrowtail",!0);s(o,v,g,"\u21AB","\\looparrowleft",!0);s(o,v,g,"\u21CB","\\leftrightharpoons",!0);s(o,v,g,"\u21B6","\\curvearrowleft",!0);s(o,v,g,"\u21BA","\\circlearrowleft",!0);s(o,v,g,"\u21B0","\\Lsh",!0);s(o,v,g,"\u21C8","\\upuparrows",!0);s(o,v,g,"\u21BF","\\upharpoonleft",!0);s(o,v,g,"\u21C3","\\downharpoonleft",!0);s(o,c,g,"\u22B6","\\origof",!0);s(o,c,g,"\u22B7","\\imageof",!0);s(o,v,g,"\u22B8","\\multimap",!0);s(o,v,g,"\u21AD","\\leftrightsquigarrow",!0);s(o,v,g,"\u21C9","\\rightrightarrows",!0);s(o,v,g,"\u21C4","\\rightleftarrows",!0);s(o,v,g,"\u21A0","\\twoheadrightarrow",!0);s(o,v,g,"\u21A3","\\rightarrowtail",!0);s(o,v,g,"\u21AC","\\looparrowright",!0);s(o,v,g,"\u21B7","\\curvearrowright",!0);s(o,v,g,"\u21BB","\\circlearrowright",!0);s(o,v,g,"\u21B1","\\Rsh",!0);s(o,v,g,"\u21CA","\\downdownarrows",!0);s(o,v,g,"\u21BE","\\upharpoonright",!0);s(o,v,g,"\u21C2","\\downharpoonright",!0);s(o,v,g,"\u21DD","\\rightsquigarrow",!0);s(o,v,g,"\u21DD","\\leadsto");s(o,v,g,"\u21DB","\\Rrightarrow",!0);s(o,v,g,"\u21BE","\\restriction");s(o,c,y,"\u2018","`");s(o,c,y,"$","\\$");s(z,c,y,"$","\\$");s(z,c,y,"$","\\textdollar");s(o,c,y,"%","\\%");s(z,c,y,"%","\\%");s(o,c,y,"_","\\_");s(z,c,y,"_","\\_");s(z,c,y,"_","\\textunderscore");s(o,c,y,"\u2220","\\angle",!0);s(o,c,y,"\u221E","\\infty",!0);s(o,c,y,"\u2032","\\prime");s(o,c,y,"\u25B3","\\triangle");s(o,c,y,"\u0393","\\Gamma",!0);s(o,c,y,"\u0394","\\Delta",!0);s(o,c,y,"\u0398","\\Theta",!0);s(o,c,y,"\u039B","\\Lambda",!0);s(o,c,y,"\u039E","\\Xi",!0);s(o,c,y,"\u03A0","\\Pi",!0);s(o,c,y,"\u03A3","\\Sigma",!0);s(o,c,y,"\u03A5","\\Upsilon",!0);s(o,c,y,"\u03A6","\\Phi",!0);s(o,c,y,"\u03A8","\\Psi",!0);s(o,c,y,"\u03A9","\\Omega",!0);s(o,c,y,"A","\u0391");s(o,c,y,"B","\u0392");s(o,c,y,"E","\u0395");s(o,c,y,"Z","\u0396");s(o,c,y,"H","\u0397");s(o,c,y,"I","\u0399");s(o,c,y,"K","\u039A");s(o,c,y,"M","\u039C");s(o,c,y,"N","\u039D");s(o,c,y,"O","\u039F");s(o,c,y,"P","\u03A1");s(o,c,y,"T","\u03A4");s(o,c,y,"X","\u03A7");s(o,c,y,"\xAC","\\neg",!0);s(o,c,y,"\xAC","\\lnot");s(o,c,y,"\u22A4","\\top");s(o,c,y,"\u22A5","\\bot");s(o,c,y,"\u2205","\\emptyset");s(o,v,y,"\u2205","\\varnothing");s(o,c,_,"\u03B1","\\alpha",!0);s(o,c,_,"\u03B2","\\beta",!0);s(o,c,_,"\u03B3","\\gamma",!0);s(o,c,_,"\u03B4","\\delta",!0);s(o,c,_,"\u03F5","\\epsilon",!0);s(o,c,_,"\u03B6","\\zeta",!0);s(o,c,_,"\u03B7","\\eta",!0);s(o,c,_,"\u03B8","\\theta",!0);s(o,c,_,"\u03B9","\\iota",!0);s(o,c,_,"\u03BA","\\kappa",!0);s(o,c,_,"\u03BB","\\lambda",!0);s(o,c,_,"\u03BC","\\mu",!0);s(o,c,_,"\u03BD","\\nu",!0);s(o,c,_,"\u03BE","\\xi",!0);s(o,c,_,"\u03BF","\\omicron",!0);s(o,c,_,"\u03C0","\\pi",!0);s(o,c,_,"\u03C1","\\rho",!0);s(o,c,_,"\u03C3","\\sigma",!0);s(o,c,_,"\u03C4","\\tau",!0);s(o,c,_,"\u03C5","\\upsilon",!0);s(o,c,_,"\u03D5","\\phi",!0);s(o,c,_,"\u03C7","\\chi",!0);s(o,c,_,"\u03C8","\\psi",!0);s(o,c,_,"\u03C9","\\omega",!0);s(o,c,_,"\u03B5","\\varepsilon",!0);s(o,c,_,"\u03D1","\\vartheta",!0);s(o,c,_,"\u03D6","\\varpi",!0);s(o,c,_,"\u03F1","\\varrho",!0);s(o,c,_,"\u03C2","\\varsigma",!0);s(o,c,_,"\u03C6","\\varphi",!0);s(o,c,q,"\u2217","*",!0);s(o,c,q,"+","+");s(o,c,q,"\u2212","-",!0);s(o,c,q,"\u22C5","\\cdot",!0);s(o,c,q,"\u2218","\\circ",!0);s(o,c,q,"\xF7","\\div",!0);s(o,c,q,"\xB1","\\pm",!0);s(o,c,q,"\xD7","\\times",!0);s(o,c,q,"\u2229","\\cap",!0);s(o,c,q,"\u222A","\\cup",!0);s(o,c,q,"\u2216","\\setminus",!0);s(o,c,q,"\u2227","\\land");s(o,c,q,"\u2228","\\lor");s(o,c,q,"\u2227","\\wedge",!0);s(o,c,q,"\u2228","\\vee",!0);s(o,c,y,"\u221A","\\surd");s(o,c,Ze,"\u27E8","\\langle",!0);s(o,c,Ze,"\u2223","\\lvert");s(o,c,Ze,"\u2225","\\lVert");s(o,c,Le,"?","?");s(o,c,Le,"!","!");s(o,c,Le,"\u27E9","\\rangle",!0);s(o,c,Le,"\u2223","\\rvert");s(o,c,Le,"\u2225","\\rVert");s(o,c,g,"=","=");s(o,c,g,":",":");s(o,c,g,"\u2248","\\approx",!0);s(o,c,g,"\u2245","\\cong",!0);s(o,c,g,"\u2265","\\ge");s(o,c,g,"\u2265","\\geq",!0);s(o,c,g,"\u2190","\\gets");s(o,c,g,">","\\gt",!0);s(o,c,g,"\u2208","\\in",!0);s(o,c,g,"\uE020","\\@not");s(o,c,g,"\u2282","\\subset",!0);s(o,c,g,"\u2283","\\supset",!0);s(o,c,g,"\u2286","\\subseteq",!0);s(o,c,g,"\u2287","\\supseteq",!0);s(o,v,g,"\u2288","\\nsubseteq",!0);s(o,v,g,"\u2289","\\nsupseteq",!0);s(o,c,g,"\u22A8","\\models");s(o,c,g,"\u2190","\\leftarrow",!0);s(o,c,g,"\u2264","\\le");s(o,c,g,"\u2264","\\leq",!0);s(o,c,g,"<","\\lt",!0);s(o,c,g,"\u2192","\\rightarrow",!0);s(o,c,g,"\u2192","\\to");s(o,v,g,"\u2271","\\ngeq",!0);s(o,v,g,"\u2270","\\nleq",!0);s(o,c,A0,"\xA0","\\ ");s(o,c,A0,"\xA0","\\space");s(o,c,A0,"\xA0","\\nobreakspace");s(z,c,A0,"\xA0","\\ ");s(z,c,A0,"\xA0"," ");s(z,c,A0,"\xA0","\\space");s(z,c,A0,"\xA0","\\nobreakspace");s(o,c,A0,"","\\nobreak");s(o,c,A0,"","\\allowbreak");s(o,c,Kt,",",",");s(o,c,Kt,";",";");s(o,v,q,"\u22BC","\\barwedge",!0);s(o,v,q,"\u22BB","\\veebar",!0);s(o,c,q,"\u2299","\\odot",!0);s(o,c,q,"\u2295","\\oplus",!0);s(o,c,q,"\u2297","\\otimes",!0);s(o,c,y,"\u2202","\\partial",!0);s(o,c,q,"\u2298","\\oslash",!0);s(o,v,q,"\u229A","\\circledcirc",!0);s(o,v,q,"\u22A1","\\boxdot",!0);s(o,c,q,"\u25B3","\\bigtriangleup");s(o,c,q,"\u25BD","\\bigtriangledown");s(o,c,q,"\u2020","\\dagger");s(o,c,q,"\u22C4","\\diamond");s(o,c,q,"\u22C6","\\star");s(o,c,q,"\u25C3","\\triangleleft");s(o,c,q,"\u25B9","\\triangleright");s(o,c,Ze,"{","\\{");s(z,c,y,"{","\\{");s(z,c,y,"{","\\textbraceleft");s(o,c,Le,"}","\\}");s(z,c,y,"}","\\}");s(z,c,y,"}","\\textbraceright");s(o,c,Ze,"{","\\lbrace");s(o,c,Le,"}","\\rbrace");s(o,c,Ze,"[","\\lbrack",!0);s(z,c,y,"[","\\lbrack",!0);s(o,c,Le,"]","\\rbrack",!0);s(z,c,y,"]","\\rbrack",!0);s(o,c,Ze,"(","\\lparen",!0);s(o,c,Le,")","\\rparen",!0);s(z,c,y,"<","\\textless",!0);s(z,c,y,">","\\textgreater",!0);s(o,c,Ze,"\u230A","\\lfloor",!0);s(o,c,Le,"\u230B","\\rfloor",!0);s(o,c,Ze,"\u2308","\\lceil",!0);s(o,c,Le,"\u2309","\\rceil",!0);s(o,c,y,"\\","\\backslash");s(o,c,y,"\u2223","|");s(o,c,y,"\u2223","\\vert");s(z,c,y,"|","\\textbar",!0);s(o,c,y,"\u2225","\\|");s(o,c,y,"\u2225","\\Vert");s(z,c,y,"\u2225","\\textbardbl");s(z,c,y,"~","\\textasciitilde");s(z,c,y,"\\","\\textbackslash");s(z,c,y,"^","\\textasciicircum");s(o,c,g,"\u2191","\\uparrow",!0);s(o,c,g,"\u21D1","\\Uparrow",!0);s(o,c,g,"\u2193","\\downarrow",!0);s(o,c,g,"\u21D3","\\Downarrow",!0);s(o,c,g,"\u2195","\\updownarrow",!0);s(o,c,g,"\u21D5","\\Updownarrow",!0);s(o,c,xe,"\u2210","\\coprod");s(o,c,xe,"\u22C1","\\bigvee");s(o,c,xe,"\u22C0","\\bigwedge");s(o,c,xe,"\u2A04","\\biguplus");s(o,c,xe,"\u22C2","\\bigcap");s(o,c,xe,"\u22C3","\\bigcup");s(o,c,xe,"\u222B","\\int");s(o,c,xe,"\u222B","\\intop");s(o,c,xe,"\u222C","\\iint");s(o,c,xe,"\u222D","\\iiint");s(o,c,xe,"\u220F","\\prod");s(o,c,xe,"\u2211","\\sum");s(o,c,xe,"\u2A02","\\bigotimes");s(o,c,xe,"\u2A01","\\bigoplus");s(o,c,xe,"\u2A00","\\bigodot");s(o,c,xe,"\u222E","\\oint");s(o,c,xe,"\u222F","\\oiint");s(o,c,xe,"\u2230","\\oiiint");s(o,c,xe,"\u2A06","\\bigsqcup");s(o,c,xe,"\u222B","\\smallint");s(z,c,St,"\u2026","\\textellipsis");s(o,c,St,"\u2026","\\mathellipsis");s(z,c,St,"\u2026","\\ldots",!0);s(o,c,St,"\u2026","\\ldots",!0);s(o,c,St,"\u22EF","\\@cdots",!0);s(o,c,St,"\u22F1","\\ddots",!0);s(o,c,y,"\u22EE","\\varvdots");s(z,c,y,"\u22EE","\\varvdots");s(o,c,me,"\u02CA","\\acute");s(o,c,me,"\u02CB","\\grave");s(o,c,me,"\xA8","\\ddot");s(o,c,me,"~","\\tilde");s(o,c,me,"\u02C9","\\bar");s(o,c,me,"\u02D8","\\breve");s(o,c,me,"\u02C7","\\check");s(o,c,me,"^","\\hat");s(o,c,me,"\u20D7","\\vec");s(o,c,me,"\u02D9","\\dot");s(o,c,me,"\u02DA","\\mathring");s(o,c,_,"\uE131","\\@imath");s(o,c,_,"\uE237","\\@jmath");s(o,c,y,"\u0131","\u0131");s(o,c,y,"\u0237","\u0237");s(z,c,y,"\u0131","\\i",!0);s(z,c,y,"\u0237","\\j",!0);s(z,c,y,"\xDF","\\ss",!0);s(z,c,y,"\xE6","\\ae",!0);s(z,c,y,"\u0153","\\oe",!0);s(z,c,y,"\xF8","\\o",!0);s(z,c,y,"\xC6","\\AE",!0);s(z,c,y,"\u0152","\\OE",!0);s(z,c,y,"\xD8","\\O",!0);s(z,c,me,"\u02CA","\\'");s(z,c,me,"\u02CB","\\`");s(z,c,me,"\u02C6","\\^");s(z,c,me,"\u02DC","\\~");s(z,c,me,"\u02C9","\\=");s(z,c,me,"\u02D8","\\u");s(z,c,me,"\u02D9","\\.");s(z,c,me,"\xB8","\\c");s(z,c,me,"\u02DA","\\r");s(z,c,me,"\u02C7","\\v");s(z,c,me,"\xA8",'\\"');s(z,c,me,"\u02DD","\\H");s(z,c,me,"\u25EF","\\textcircled");var Cs={"--":!0,"---":!0,"``":!0,"''":!0};s(z,c,y,"\u2013","--",!0);s(z,c,y,"\u2013","\\textendash");s(z,c,y,"\u2014","---",!0);s(z,c,y,"\u2014","\\textemdash");s(z,c,y,"\u2018","`",!0);s(z,c,y,"\u2018","\\textquoteleft");s(z,c,y,"\u2019","'",!0);s(z,c,y,"\u2019","\\textquoteright");s(z,c,y,"\u201C","``",!0);s(z,c,y,"\u201C","\\textquotedblleft");s(z,c,y,"\u201D","''",!0);s(z,c,y,"\u201D","\\textquotedblright");s(o,c,y,"\xB0","\\degree",!0);s(z,c,y,"\xB0","\\degree");s(z,c,y,"\xB0","\\textdegree",!0);s(o,c,y,"\xA3","\\pounds");s(o,c,y,"\xA3","\\mathsterling",!0);s(z,c,y,"\xA3","\\pounds");s(z,c,y,"\xA3","\\textsterling",!0);s(o,v,y,"\u2720","\\maltese");s(z,v,y,"\u2720","\\maltese");var ji='0123456789/@."';for(kr=0;kr<ji.length;kr++)Pa=ji.charAt(kr),s(o,c,y,Pa,Pa);var Pa,kr,Wi='0123456789!@*()-=+";:?/.,';for(Sr=0;Sr<Wi.length;Sr++)Fa=Wi.charAt(Sr),s(z,c,y,Fa,Fa);var Fa,Sr,Br="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";for(Tr=0;Tr<Br.length;Tr++)_t=Br.charAt(Tr),s(o,c,_,_t,_t),s(z,c,y,_t,_t);var _t,Tr;s(o,v,y,"C","\u2102");s(z,v,y,"C","\u2102");s(o,v,y,"H","\u210D");s(z,v,y,"H","\u210D");s(o,v,y,"N","\u2115");s(z,v,y,"N","\u2115");s(o,v,y,"P","\u2119");s(z,v,y,"P","\u2119");s(o,v,y,"Q","\u211A");s(z,v,y,"Q","\u211A");s(o,v,y,"R","\u211D");s(z,v,y,"R","\u211D");s(o,v,y,"Z","\u2124");s(z,v,y,"Z","\u2124");s(o,c,_,"h","\u210E");s(z,c,_,"h","\u210E");var G;for(Re=0;Re<Br.length;Re++)de=Br.charAt(Re),G=String.fromCharCode(55349,56320+Re),s(o,c,_,de,G),s(z,c,y,de,G),G=String.fromCharCode(55349,56372+Re),s(o,c,_,de,G),s(z,c,y,de,G),G=String.fromCharCode(55349,56424+Re),s(o,c,_,de,G),s(z,c,y,de,G),G=String.fromCharCode(55349,56580+Re),s(o,c,_,de,G),s(z,c,y,de,G),G=String.fromCharCode(55349,56684+Re),s(o,c,_,de,G),s(z,c,y,de,G),G=String.fromCharCode(55349,56736+Re),s(o,c,_,de,G),s(z,c,y,de,G),G=String.fromCharCode(55349,56788+Re),s(o,c,_,de,G),s(z,c,y,de,G),G=String.fromCharCode(55349,56840+Re),s(o,c,_,de,G),s(z,c,y,de,G),G=String.fromCharCode(55349,56944+Re),s(o,c,_,de,G),s(z,c,y,de,G),Re<26&&(G=String.fromCharCode(55349,56632+Re),s(o,c,_,de,G),s(z,c,y,de,G),G=String.fromCharCode(55349,56476+Re),s(o,c,_,de,G),s(z,c,y,de,G));var de,Re;G="\u{1D55C}";s(o,c,_,"k",G);s(z,c,y,"k",G);for(N0=0;N0<10;N0++)w0=N0.toString(),G=String.fromCharCode(55349,57294+N0),s(o,c,_,w0,G),s(z,c,y,w0,G),G=String.fromCharCode(55349,57314+N0),s(o,c,_,w0,G),s(z,c,y,w0,G),G=String.fromCharCode(55349,57324+N0),s(o,c,_,w0,G),s(z,c,y,w0,G),G=String.fromCharCode(55349,57334+N0),s(o,c,_,w0,G),s(z,c,y,w0,G);var w0,N0,Ja="\xD0\xDE\xFE";for(Ar=0;Ar<Ja.length;Ar++)Ht=Ja.charAt(Ar),s(o,c,_,Ht,Ht),s(z,c,y,Ht,Ht);var Ht,Ar,en={mathClass:"mathbf",textClass:"textbf",font:"Main-Bold"},Vi={mathClass:"mathnormal",textClass:"textit",font:"Math-Italic"},Yi={mathClass:"boldsymbol",textClass:"boldsymbol",font:"Main-BoldItalic"},ou={mathClass:"mathscr",textClass:"textscr",font:"Script-Regular"},et={mathClass:"",textClass:"",font:""},Xi={mathClass:"mathfrak",textClass:"textfrak",font:"Fraktur-Regular"},Zi={mathClass:"mathbb",textClass:"textbb",font:"AMS-Regular"},Ki={mathClass:"mathboldfrak",textClass:"textboldfrak",font:"Fraktur-Regular"},tn={mathClass:"mathsf",textClass:"textsf",font:"SansSerif-Regular"},rn={mathClass:"mathboldsf",textClass:"textboldsf",font:"SansSerif-Bold"},Qi={mathClass:"mathitsf",textClass:"textitsf",font:"SansSerif-Italic"},an={mathClass:"mathtt",textClass:"texttt",font:"Typewriter-Regular"},Ji=[en,en,Vi,Vi,Yi,Yi,ou,et,et,et,Xi,Xi,Zi,Zi,Ki,Ki,tn,tn,rn,rn,Qi,Qi,et,et,an,an],uu=[en,et,tn,rn,an],cu=r=>{var e=r.charCodeAt(0),t=r.charCodeAt(1),a=(e-55296)*1024+(t-56320)+65536;if(119808<=a&&a<120484){var n=Math.floor((a-119808)/26);return Ji[n]}else if(120782<=a&&a<=120831){var i=Math.floor((a-120782)/10);return uu[i]}else{if(a===120485||a===120486)return Ji[0];if(120486<a&&a<120782)return et;throw new C("Unsupported character: "+r)}},Fr=function(e,t,a){if(he[a][e]){var n=he[a][e].replace;n&&(e=n)}return{value:e,metrics:yn(e,t,a)}},Oe=function(e,t,a,n,i){var l=Fr(e,t,a),u=l.metrics;e=l.value;var h;if(u){var d=u.italic;(a==="text"||n&&n.font==="mathit")&&(d=0),h=new Ne(e,u.height,u.depth,d,u.skew,u.width,i)}else typeof console<"u"&&console.warn("No character metrics "+("for '"+e+"' in style '"+t+"' and mode '"+a+"'")),h=new Ne(e,0,0,0,0,0,i);if(n){h.maxFontSize=n.sizeMultiplier,n.style.isTight()&&h.classes.push("mtight");var f=n.getColor();f&&(h.style.color=f)}return h},xn=function(e,t,a,n){return n===void 0&&(n=[]),a.font==="boldsymbol"&&Fr(e,"Main-Bold",t).metrics?Oe(e,"Main-Bold",t,a,n.concat(["mathbf"])):e==="\\"||he[t][e].font==="main"?Oe(e,"Main-Regular",t,a,n):Oe(e,"AMS-Regular",t,a,n.concat(["amsrm"]))},hu=function(e,t,a){return a!=="textord"&&Fr(e,"Math-BoldItalic",t).metrics?{fontName:"Math-BoldItalic",fontClass:"boldsymbol"}:{fontName:"Main-Bold",fontClass:"mathbf"}},_r=function(e,t){var a=e.type==="mathord"?"mathord":"textord",n=e.mode,i=e.text,l=["mord"],u=t.font,h=t.fontFamily,d=t.fontWeight,f=t.fontShape,b=n==="math"||n==="text"&&!!u,k=b?u:h,w="",M="";if(i.charCodeAt(0)===55349){var D=cu(i);w=D.font,M=D[n+"Class"]}if(w)return Oe(i,w,n,t,l.concat(M));if(k){var E,N;if(k==="boldsymbol"){var B=hu(i,n,a);E=B.fontName,N=[B.fontClass]}else b?(E=nn[u].fontName,N=[u]):(E=zr(h,d,f),N=[h,d,f]);if(Fr(i,E,n).metrics)return Oe(i,E,n,t,l.concat(N));if(Object.prototype.hasOwnProperty.call(Cs,i)&&E.slice(0,10)==="Typewriter"){for(var F=[],H=0;H<i.length;H++)F.push(Oe(i[H],E,n,t,l.concat(N)));return z0(F)}}if(a==="mathord")return Oe(i,"Math-Italic",n,t,l.concat(["mathnormal"]));if(a==="textord"){var V=he[n][i]&&he[n][i].font;if(V==="ams"){var j=zr("amsrm",d,f);return Oe(i,j,n,t,l.concat("amsrm",d,f))}else if(V==="main"||!V){var $=zr("textrm",d,f);return Oe(i,$,n,t,l.concat(d,f))}else{var X=zr(V,d,f);return Oe(i,X,n,t,l.concat(X,d,f))}}else throw new Error("unexpected type: "+a+" in makeOrd")},mu=(r,e)=>{if(P0(r.classes)!==P0(e.classes)||r.skew!==e.skew||r.maxFontSize!==e.maxFontSize||r.italic!==0&&r.hasClass("mathnormal"))return!1;if(r.classes.length===1){var t=r.classes[0];if(t==="mbin"||t==="mord")return!1}for(var a of Object.keys(r.style))if(r.style[a]!==e.style[a])return!1;for(var n of Object.keys(e.style))if(r.style[n]!==e.style[n])return!1;return!0},Is=r=>{for(var e=0;e<r.length-1;e++){var t=r[e],a=r[e+1];t instanceof Ne&&a instanceof Ne&&mu(t,a)&&(t.text+=a.text,t.height=Math.max(t.height,a.height),t.depth=Math.max(t.depth,a.depth),t.italic=a.italic,r.splice(e+1,1),e--)}return r},wn=function(e){for(var t=0,a=0,n=0,i=0;i<e.children.length;i++){var l=e.children[i];l.height>t&&(t=l.height),l.depth>a&&(a=l.depth),l.maxFontSize>n&&(n=l.maxFontSize)}e.height=t,e.depth=a,e.maxFontSize=n},R=function(e,t,a,n){var i=new F0(e,t,a,n);return wn(i),i},_0=(r,e,t,a)=>new F0(r,e,t,a),wt=function(e,t,a){var n=R([e],[],t);return n.height=Math.max(a||t.fontMetrics().defaultRuleThickness,t.minRuleThickness),n.style.borderBottomWidth=O(n.height),n.maxFontSize=1,n},du=function(e,t,a,n){var i=new xt(e,t,a,n);return wn(i),i},z0=function(e){var t=new q0(e);return wn(t),t},kt=function(e,t){return e instanceof q0?R([],[e],t):e},pu=function(e){if(e.positionType==="individualShift"){for(var t=e.children,a=[t[0]],n=-t[0].shift-t[0].elem.depth,i=n,l=1;l<t.length;l++){var u=-t[l].shift-i-t[l].elem.depth,h=u-(t[l-1].elem.height+t[l-1].elem.depth);i=i+u,a.push({type:"kern",size:h}),a.push(t[l])}return{children:a,depth:n}}var d;if(e.positionType==="top"){for(var f=e.positionData,b=0;b<e.children.length;b++){var k=e.children[b];f-=k.type==="kern"?k.size:k.elem.height+k.elem.depth}d=f}else if(e.positionType==="bottom")d=-e.positionData;else{var w=e.children[0];if(w.type!=="elem")throw new Error('First child must have type "elem".');if(e.positionType==="shift")d=-w.elem.depth-e.positionData;else if(e.positionType==="firstBaseline")d=-w.elem.depth;else throw new Error("Invalid positionType "+e.positionType+".")}return{children:e.children,depth:d}},re=function(e,t){for(var a=pu(e),n=a.children,i=a.depth,l=0,u=0;u<n.length;u++){var h=n[u];if(h.type==="elem"){var d=h.elem;l=Math.max(l,d.maxFontSize,d.height)}}l+=2;var f=R(["pstrut"],[]);f.style.height=O(l);for(var b=[],k=i,w=i,M=i,D=0;D<n.length;D++){var E=n[D];if(E.type==="kern")M+=E.size;else{var N=E.elem,B=E.wrapperClasses||[],F=E.wrapperStyle||{},H=R(B,[f,N],void 0,F);H.style.top=O(-l-M-N.depth),E.marginLeft&&(H.style.marginLeft=E.marginLeft),E.marginRight&&(H.style.marginRight=E.marginRight),b.push(H),M+=N.height+N.depth}k=Math.min(k,M),w=Math.max(w,M)}var V=R(["vlist"],b);V.style.height=O(w);var j;if(k<0){var $=R([],[]),X=R(["vlist"],[$]);X.style.height=O(-k);var ee=R(["vlist-s"],[new Ne("\u200B")]);j=[R(["vlist-r"],[V,ee]),R(["vlist-r"],[X])]}else j=[R(["vlist-r"],[V])];var ae=R(["vlist-t"],j);return j.length===2&&ae.classes.push("vlist-t2"),ae.height=w,ae.depth=-k,ae},Os=(r,e)=>{var t=R(["mspace"],[],e),a=fe(r,e);return t.style.marginRight=O(a),t},zr=(r,e,t)=>{var a,n;switch(r){case"amsrm":a="AMS";break;case"textrm":a="Main";break;case"textsf":a="SansSerif";break;case"texttt":a="Typewriter";break;default:a=r}return e==="textbf"&&t==="textit"?n="BoldItalic":e==="textbf"?n="Bold":t==="textit"?n="Italic":n="Regular",a+"-"+n},nn={mathbf:{variant:"bold",fontName:"Main-Bold"},mathrm:{variant:"normal",fontName:"Main-Regular"},textit:{variant:"italic",fontName:"Main-Italic"},mathit:{variant:"italic",fontName:"Main-Italic"},mathnormal:{variant:"italic",fontName:"Math-Italic"},mathsfit:{variant:"sans-serif-italic",fontName:"SansSerif-Italic"},mathbb:{variant:"double-struck",fontName:"AMS-Regular"},mathcal:{variant:"script",fontName:"Caligraphic-Regular"},mathfrak:{variant:"fraktur",fontName:"Fraktur-Regular"},mathscr:{variant:"script",fontName:"Script-Regular"},mathsf:{variant:"sans-serif",fontName:"SansSerif-Regular"},mathtt:{variant:"monospace",fontName:"Typewriter-Regular"}},Bs={vec:["vec",.471,.714],oiintSize1:["oiintSize1",.957,.499],oiintSize2:["oiintSize2",1.472,.659],oiiintSize1:["oiiintSize1",1.304,.499],oiiintSize2:["oiiintSize2",1.98,.659]},Ns=function(e,t){var a=Bs[e],n=a[0],i=a[1],l=a[2],u=new f0(n),h=new o0([u],{width:O(i),height:O(l),style:"width:"+O(i),viewBox:"0 0 "+1e3*i+" "+1e3*l,preserveAspectRatio:"xMinYMin"}),d=_0(["katex-overlay"],[h],t);return d.height=l,d.style.height=O(l),d.style.width=O(i),d},pe={number:3,unit:"mu"},J0={number:4,unit:"mu"},k0={number:5,unit:"mu"},fu={mord:{mop:pe,mbin:J0,mrel:k0,minner:pe},mop:{mord:pe,mop:pe,mrel:k0,minner:pe},mbin:{mord:J0,mop:J0,mopen:J0,minner:J0},mrel:{mord:k0,mop:k0,mopen:k0,minner:k0},mopen:{},mclose:{mop:pe,mbin:J0,mrel:k0,minner:pe},mpunct:{mord:pe,mop:pe,mrel:k0,mopen:pe,mclose:pe,mpunct:pe,minner:pe},minner:{mord:pe,mop:pe,mbin:J0,mrel:k0,mopen:pe,mpunct:pe,minner:pe}},vu={mord:{mop:pe},mop:{mord:pe,mop:pe},mbin:{},mrel:{},mopen:{},mclose:{mop:pe},mpunct:{},minner:{mop:pe}},Ls={},Vt={},Yt={};function L(r){for(var e=r.type,t=r.names,a=r.htmlBuilder,n=r.mathmlBuilder,i=0;i<t.length;++i)Ls[t[i]]=r;e&&(a&&(Vt[e]=a),n&&(Yt[e]=n))}function tt(r){var e=r.type,t=r.htmlBuilder,a=r.mathmlBuilder;t&&(Vt[e]=t),a&&(Yt[e]=a)}var Xt=function(e){return e.type==="ordgroup"&&e.body.length===1?e.body[0]:e},ye=function(e){return e.type==="ordgroup"?e.body:[e]},gu=new Set(["leftmost","mbin","mopen","mrel","mop","mpunct"]),bu=new Set(["rightmost","mrel","mclose","mpunct"]),yu={display:W.DISPLAY,text:W.TEXT,script:W.SCRIPT,scriptscript:W.SCRIPTSCRIPT},xu={mord:"mord",mop:"mop",mbin:"mbin",mrel:"mrel",mopen:"mopen",mclose:"mclose",mpunct:"mpunct",minner:"minner"},Se=function(e,t,a,n){n===void 0&&(n=[null,null]);for(var i=[],l=0;l<e.length;l++){var u=te(e[l],t);if(u instanceof q0){var h=u.children;i.push(...h)}else i.push(u)}if(Is(i),!a)return i;var d=t;if(e.length===1){var f=e[0];f.type==="sizing"?d=t.havingSize(f.size):f.type==="styling"&&(d=t.havingStyle(yu[f.style]))}var b=R([n[0]||"leftmost"],[],t),k=R([n[1]||"rightmost"],[],t),w=a==="root";return sn(i,(M,D)=>{var E=D.classes[0],N=M.classes[0];E==="mbin"&&bu.has(N)?D.classes[0]="mord":N==="mbin"&&gu.has(E)&&(M.classes[0]="mord")},{node:b},k,w),sn(i,(M,D)=>{var E,N,B=on(D),F=on(M),H=B&&F?M.hasClass("mtight")?(E=vu[B])==null?void 0:E[F]:(N=fu[B])==null?void 0:N[F]:null;if(H)return Os(H,d)},{node:b},k,w),i},sn=function(e,t,a,n,i){n&&e.push(n);for(var l=0;l<e.length;l++){var u=e[l],h=qs(u);if(h){sn(h.children,t,a,null,i);continue}var d=!u.hasClass("mspace");if(d){var f=t(u,a.node);f&&(a.insertAfter?a.insertAfter(f):(e.unshift(f),l++))}d?a.node=u:i&&u.hasClass("katex-newline")&&(a.node=R(["leftmost"])),a.insertAfter=(b=>k=>{e.splice(b+1,0,k),l++})(l)}n&&e.pop()},qs=function(e){return e instanceof q0||e instanceof xt||e instanceof F0&&e.hasClass("enclosing")?e:null},ln=function(e,t){var a=qs(e);if(a){var n=a.children;if(n.length){if(t==="right")return ln(n[n.length-1],"right");if(t==="left")return ln(n[0],"left")}}return e},on=function(e,t){if(!e)return null;t&&(e=ln(e,t));var a=e.classes[0];return xu[a]||null},Zt=function(e,t){var a=["nulldelimiter"].concat(e.baseSizingClasses());return R(t.concat(a))},te=function(e,t,a){if(!e)return R();if(Vt[e.type]){var n=Vt[e.type](e,t);if(a&&t.size!==a.size){n=R(t.sizingClasses(a),[n],t);var i=t.sizeMultiplier/a.sizeMultiplier;n.height*=i,n.depth*=i}return n}else throw new C("Got group of unknown type: '"+e.type+"'")};function Mr(r,e){var t=R(["katex-base"],r,e),a=R(["katex-strut"]);return a.style.height=O(t.height+t.depth),t.depth&&(a.style.verticalAlign=O(-t.depth)),t.children.unshift(a),t}function un(r,e){var t=null;r.length===1&&r[0].type==="tag"&&(t=r[0].tag,r=r[0].body);var a=Se(r,e,"root"),n;a.length===2&&a[1].hasClass("katex-tag")&&(n=a.pop());for(var i=[],l=[],u=0;u<a.length;u++)if(l.push(a[u]),a[u].hasClass("mbin")||a[u].hasClass("mrel")||a[u].hasClass("allowbreak")){for(var h=!1;u<a.length-1&&a[u+1].hasClass("mspace")&&!a[u+1].hasClass("katex-newline");)u++,l.push(a[u]),a[u].hasClass("nobreak")&&(h=!0);h||(i.push(Mr(l,e)),l=[])}else a[u].hasClass("katex-newline")&&(l.pop(),l.length>0&&(i.push(Mr(l,e)),l=[]),i.push(a[u]));l.length>0&&i.push(Mr(l,e));var d;t?(d=Mr(Se(t,e,!0),e),d.classes=["katex-tag"],i.push(d)):n&&i.push(n);var f=R(["katex-html"],i);if(f.setAttribute("aria-hidden","true"),d){var b=d.children[0];b.style.height=O(f.height+f.depth),f.depth&&(b.style.verticalAlign=O(-f.depth))}return f}function Ps(r){return new q0(r)}var I=class{constructor(e,t,a){this.type=void 0,this.attributes=void 0,this.children=void 0,this.classes=void 0,this.type=e,this.attributes={},this.children=t||[],this.classes=a||[]}setAttribute(e,t){this.attributes[e]=t}getAttribute(e){return this.attributes[e]}toNode(){var e=document.createElementNS("http://www.w3.org/1998/Math/MathML",this.type);for(var t of Object.entries(this.attributes)){var a=t[0],n=t[1];e.setAttribute(a,n)}this.classes.length>0&&(e.className=P0(this.classes));for(var i=0;i<this.children.length;i++)if(this.children[i]instanceof ve&&this.children[i+1]instanceof ve){for(var l=this.children[i].toText()+this.children[++i].toText();this.children[i+1]instanceof ve;)l+=this.children[++i].toText();e.appendChild(new ve(l).toNode())}else e.appendChild(this.children[i].toNode());return e}toMarkup(){var e="<"+this.type;for(var t of Object.entries(this.attributes)){var a=t[0],n=t[1];e+=" "+a+'="',e+=De(n),e+='"'}this.classes.length>0&&(e+=' class ="'+De(P0(this.classes))+'"'),e+=">";for(var i=0;i<this.children.length;i++)e+=this.children[i].toMarkup();return e+="</"+this.type+">",e}toText(){return this.children.map(e=>e.toText()).join("")}},ve=class{constructor(e){this.text=void 0,this.text=e}toNode(){return document.createTextNode(this.text)}toMarkup(){return De(this.toText())}toText(){return this.text}},Nr=class{constructor(e){this.width=void 0,this.character=void 0,this.width=e,e>=.05555&&e<=.05556?this.character="\u200A":e>=.1666&&e<=.1667?this.character="\u2009":e>=.2222&&e<=.2223?this.character="\u2005":e>=.2777&&e<=.2778?this.character="\u2005\u200A":e>=-.05556&&e<=-.05555?this.character="\u200A\u2063":e>=-.1667&&e<=-.1666?this.character="\u2009\u2063":e>=-.2223&&e<=-.2222?this.character="\u205F\u2063":e>=-.2778&&e<=-.2777?this.character="\u2005\u2063":this.character=null}toNode(){if(this.character)return document.createTextNode(this.character);var e=document.createElementNS("http://www.w3.org/1998/Math/MathML","mspace");return e.setAttribute("width",O(this.width)),e}toMarkup(){return this.character?"<mtext>"+this.character+"</mtext>":'<mspace width="'+O(this.width)+'"/>'}toText(){return this.character?this.character:" "}},wu=new Set(["\\imath","\\jmath"]),ku=new Set(["mrow","mtable"]),a0=function(e,t,a){var n,i;return he[t][e]&&he[t][e].replace&&e.charCodeAt(0)!==55349&&!(Object.prototype.hasOwnProperty.call(Cs,e)&&((a==null||(n=a.fontFamily)==null?void 0:n.slice(4,6))==="tt"||(a==null||(i=a.font)==null?void 0:i.slice(4,6))==="tt"))&&(e=he[t][e].replace),new ve(e)},kn=function(e){return e.length===1?e[0]:new I("mrow",e)},Su={mathit:"italic",boldsymbol:r=>r.type==="textord"?"bold":"bold-italic",mathbf:"bold",mathbb:"double-struck",mathsfit:"sans-serif-italic",mathfrak:"fraktur",mathscr:"script",mathcal:"script",mathsf:"sans-serif",mathtt:"monospace"},Sn=(r,e)=>{if(r.mode==="text"){if(e.fontFamily==="texttt")return"monospace";if(e.fontFamily==="textsf")return e.fontShape==="textit"&&e.fontWeight==="textbf"?"sans-serif-bold-italic":e.fontShape==="textit"?"sans-serif-italic":e.fontWeight==="textbf"?"bold-sans-serif":"sans-serif";if(e.fontShape==="textit"&&e.fontWeight==="textbf")return"bold-italic";if(e.fontShape==="textit")return"italic";if(e.fontWeight==="textbf")return"bold"}var t=e.font;if(!t||t==="mathnormal")return null;var a=r.mode,n=Su[t];if(n)return typeof n=="function"?n(r):n;var i=r.text;if(wu.has(i))return null;if(he[a][i]){var l=he[a][i].replace;l&&(i=l)}var u=nn[t].fontName;return yn(i,u,a)?nn[t].variant:null};function _a(r){if(!r)return!1;if(r.type==="mi"&&r.children.length===1){var e=r.children[0];return e instanceof ve&&e.text==="."}else if(r.type==="mo"&&r.children.length===1&&r.getAttribute("separator")==="true"&&r.getAttribute("lspace")==="0em"&&r.getAttribute("rspace")==="0em"){var t=r.children[0];return t instanceof ve&&t.text===","}else return!1}var Ke=function(e,t,a){if(e.length===1){var n=se(e[0],t);return a&&n instanceof I&&n.type==="mo"&&(n.setAttribute("lspace","0em"),n.setAttribute("rspace","0em")),[n]}for(var i=[],l,u=0;u<e.length;u++){var h=se(e[u],t);if(h instanceof I&&l instanceof I){if(h.type==="mtext"&&l.type==="mtext"&&h.getAttribute("mathvariant")===l.getAttribute("mathvariant")){l.children.push(...h.children);continue}else if(h.type==="mn"&&l.type==="mn"){l.children.push(...h.children);continue}else if(_a(h)&&l.type==="mn"){l.children.push(...h.children);continue}else if(h.type==="mn"&&_a(l))h.children=[...l.children,...h.children],i.pop();else if((h.type==="msup"||h.type==="msub")&&h.children.length>=1&&(l.type==="mn"||_a(l))){var d=h.children[0];d instanceof I&&d.type==="mn"&&(d.children=[...l.children,...d.children],i.pop())}else if(l.type==="mi"&&l.children.length===1){var f=l.children[0];if(f instanceof ve&&f.text==="\u0338"&&(h.type==="mo"||h.type==="mi"||h.type==="mn")){var b=h.children[0];b instanceof ve&&b.text.length>0&&(b.text=b.text.slice(0,1)+"\u0338"+b.text.slice(1),i.pop())}}}i.push(h),l=h}return i},H0=function(e,t,a){return kn(Ke(e,t,a))},se=function(e,t){if(!e)return new I("mrow");if(Yt[e.type])return Yt[e.type](e,t);throw new C("Got group of unknown type: '"+e.type+"'")};function es(r,e,t,a,n){var i=Ke(r,t),l;i.length===1&&i[0]instanceof I&&ku.has(i[0].type)?l=i[0]:l=new I("mrow",i);var u=new I("annotation",[new ve(e)]);u.setAttribute("encoding","application/x-tex");var h=new I("semantics",[l,u]),d=new I("math",[h]);d.setAttribute("xmlns","http://www.w3.org/1998/Math/MathML"),a&&d.setAttribute("display","block");var f=n?"katex":"katex-mathml";return R([f],[d])}var Tu=[[1,1,1],[2,1,1],[3,1,1],[4,2,1],[5,2,1],[6,3,1],[7,4,2],[8,6,3],[9,7,6],[10,8,7],[11,10,9]],ts=[.5,.6,.7,.8,.9,1,1.2,1.44,1.728,2.074,2.488],rs=function(e,t){return t.size<2?e:Tu[e-1][t.size-1]},Lr=class r{constructor(e){this.style=void 0,this.color=void 0,this.size=void 0,this.textSize=void 0,this.phantom=void 0,this.font=void 0,this.fontFamily=void 0,this.fontWeight=void 0,this.fontShape=void 0,this.sizeMultiplier=void 0,this.maxSize=void 0,this.minRuleThickness=void 0,this._fontMetrics=void 0,this.style=e.style,this.color=e.color,this.size=e.size||r.BASESIZE,this.textSize=e.textSize||this.size,this.phantom=!!e.phantom,this.font=e.font||"",this.fontFamily=e.fontFamily||"",this.fontWeight=e.fontWeight||"",this.fontShape=e.fontShape||"",this.sizeMultiplier=ts[this.size-1],this.maxSize=e.maxSize,this.minRuleThickness=e.minRuleThickness,this._fontMetrics=void 0}extend(e){var t={style:this.style,size:this.size,textSize:this.textSize,color:this.color,phantom:this.phantom,font:this.font,fontFamily:this.fontFamily,fontWeight:this.fontWeight,fontShape:this.fontShape,maxSize:this.maxSize,minRuleThickness:this.minRuleThickness};return Object.assign(t,e),new r(t)}havingStyle(e){return this.style===e?this:this.extend({style:e,size:rs(this.textSize,e)})}havingCrampedStyle(){return this.havingStyle(this.style.cramp())}havingSize(e){return this.size===e&&this.textSize===e?this:this.extend({style:this.style.text(),size:e,textSize:e,sizeMultiplier:ts[e-1]})}havingBaseStyle(e){e=e||this.style.text();var t=rs(r.BASESIZE,e);return this.size===t&&this.textSize===r.BASESIZE&&this.style===e?this:this.extend({style:e,size:t})}havingBaseSizing(){var e;switch(this.style.id){case 4:case 5:e=3;break;case 6:case 7:e=1;break;default:e=6}return this.extend({style:this.style.text(),size:e})}withColor(e){return this.extend({color:e})}withPhantom(){return this.extend({phantom:!0})}withFont(e){return this.extend({font:e})}withTextFontFamily(e){return this.extend({fontFamily:e,font:""})}withTextFontWeight(e){return this.extend({fontWeight:e,font:""})}withTextFontShape(e){return this.extend({fontShape:e,font:""})}sizingClasses(e){return e.size!==this.size?["katex-sizing","reset-size"+e.size,"size"+this.size]:[]}baseSizingClasses(){return this.size!==r.BASESIZE?["katex-sizing","reset-size"+this.size,"size"+r.BASESIZE]:[]}fontMetrics(){return this._fontMetrics||(this._fontMetrics=lu(this.size)),this._fontMetrics}getColor(){return this.phantom?"transparent":this.color}};Lr.BASESIZE=6;var Fs=function(e){return new Lr({style:e.displayMode?W.DISPLAY:W.TEXT,maxSize:e.maxSize,minRuleThickness:e.minRuleThickness})},_s=function(e,t){if(t.displayMode){var a=["katex-display"];t.leqno&&a.push("leqno"),t.fleqn&&a.push("fleqn"),e=R(a,[e])}return e},Au=function(e,t,a){var n=Fs(a),i;if(a.output==="mathml")return es(e,t,n,a.displayMode,!0);if(a.output==="html"){var l=un(e,n);i=R(["katex"],[l])}else{var u=es(e,t,n,a.displayMode,!1),h=un(e,n);i=R(["katex"],[u,h])}return _s(i,a)},zu=function(e,t,a){var n=Fs(a),i=un(e,n),l=R(["katex"],[i]);return _s(l,a)},Mu={widehat:"^",widecheck:"\u02C7",widetilde:"~",utilde:"~",overleftarrow:"\u2190",underleftarrow:"\u2190",xleftarrow:"\u2190",overrightarrow:"\u2192",underrightarrow:"\u2192",xrightarrow:"\u2192",underbrace:"\u23DF",overbrace:"\u23DE",underbracket:"\u23B5",overbracket:"\u23B4",overgroup:"\u23E0",undergroup:"\u23E1",overleftrightarrow:"\u2194",underleftrightarrow:"\u2194",xleftrightarrow:"\u2194",Overrightarrow:"\u21D2",xRightarrow:"\u21D2",overleftharpoon:"\u21BC",xleftharpoonup:"\u21BC",overrightharpoon:"\u21C0",xrightharpoonup:"\u21C0",xLeftarrow:"\u21D0",xLeftrightarrow:"\u21D4",xhookleftarrow:"\u21A9",xhookrightarrow:"\u21AA",xmapsto:"\u21A6",xrightharpoondown:"\u21C1",xleftharpoondown:"\u21BD",xrightleftharpoons:"\u21CC",xleftrightharpoons:"\u21CB",xtwoheadleftarrow:"\u219E",xtwoheadrightarrow:"\u21A0",xlongequal:"=",xtofrom:"\u21C4",xrightleftarrows:"\u21C4",xrightequilibrium:"\u21CC",xleftequilibrium:"\u21CB","\\cdrightarrow":"\u2192","\\cdleftarrow":"\u2190","\\cdlongequal":"="},Hr=function(e){var t=new I("mo",[new ve(Mu[e.replace(/^\\/,"")])]);return t.setAttribute("stretchy","true"),t},Eu={overrightarrow:[["rightarrow"],.888,522,"xMaxYMin"],overleftarrow:[["leftarrow"],.888,522,"xMinYMin"],underrightarrow:[["rightarrow"],.888,522,"xMaxYMin"],underleftarrow:[["leftarrow"],.888,522,"xMinYMin"],xrightarrow:[["rightarrow"],1.469,522,"xMaxYMin"],"\\cdrightarrow":[["rightarrow"],3,522,"xMaxYMin"],xleftarrow:[["leftarrow"],1.469,522,"xMinYMin"],"\\cdleftarrow":[["leftarrow"],3,522,"xMinYMin"],Overrightarrow:[["doublerightarrow"],.888,560,"xMaxYMin"],xRightarrow:[["doublerightarrow"],1.526,560,"xMaxYMin"],xLeftarrow:[["doubleleftarrow"],1.526,560,"xMinYMin"],overleftharpoon:[["leftharpoon"],.888,522,"xMinYMin"],xleftharpoonup:[["leftharpoon"],.888,522,"xMinYMin"],xleftharpoondown:[["leftharpoondown"],.888,522,"xMinYMin"],overrightharpoon:[["rightharpoon"],.888,522,"xMaxYMin"],xrightharpoonup:[["rightharpoon"],.888,522,"xMaxYMin"],xrightharpoondown:[["rightharpoondown"],.888,522,"xMaxYMin"],xlongequal:[["longequal"],.888,334,"xMinYMin"],"\\cdlongequal":[["longequal"],3,334,"xMinYMin"],xtwoheadleftarrow:[["twoheadleftarrow"],.888,334,"xMinYMin"],xtwoheadrightarrow:[["twoheadrightarrow"],.888,334,"xMaxYMin"],overleftrightarrow:[["leftarrow","rightarrow"],.888,522],overbrace:[["leftbrace","midbrace","rightbrace"],1.6,548],underbrace:[["leftbraceunder","midbraceunder","rightbraceunder"],1.6,548],underleftrightarrow:[["leftarrow","rightarrow"],.888,522],xleftrightarrow:[["leftarrow","rightarrow"],1.75,522],xLeftrightarrow:[["doubleleftarrow","doublerightarrow"],1.75,560],xrightleftharpoons:[["leftharpoondownplus","rightharpoonplus"],1.75,716],xleftrightharpoons:[["leftharpoonplus","rightharpoondownplus"],1.75,716],xhookleftarrow:[["leftarrow","righthook"],1.08,522],xhookrightarrow:[["lefthook","rightarrow"],1.08,522],overlinesegment:[["leftlinesegment","rightlinesegment"],.888,522],underlinesegment:[["leftlinesegment","rightlinesegment"],.888,522],overbracket:[["leftbracketover","rightbracketover"],1.6,440],underbracket:[["leftbracketunder","rightbracketunder"],1.6,410],overgroup:[["leftgroup","rightgroup"],.888,342],undergroup:[["leftgroupunder","rightgroupunder"],.888,342],xmapsto:[["leftmapsto","rightarrow"],1.5,522],xtofrom:[["leftToFrom","rightToFrom"],1.75,528],xrightleftarrows:[["baraboveleftarrow","rightarrowabovebar"],1.75,901],xrightequilibrium:[["baraboveshortleftharpoon","rightharpoonaboveshortbar"],1.75,716],xleftequilibrium:[["shortbaraboveleftharpoon","shortrightharpoonabovebar"],1.75,716]},Ru=new Set(["widehat","widecheck","widetilde","utilde"]),$r=function(e,t){function a(){var h=4e5,d=e.label.slice(1);if(Ru.has(d)&&"base"in e){var f=e.base.type==="ordgroup"?e.base.body.length:1,b,k,w;if(f>5)d==="widehat"||d==="widecheck"?(b=420,h=2364,w=.42,k=d+"4"):(b=312,h=2340,w=.34,k="tilde4");else{var M=[1,1,2,2,3,3][f];d==="widehat"||d==="widecheck"?(h=[0,1062,2364,2364,2364][M],b=[0,239,300,360,420][M],w=[0,.24,.3,.3,.36,.42][M],k=d+M):(h=[0,600,1033,2339,2340][M],b=[0,260,286,306,312][M],w=[0,.26,.286,.3,.306,.34][M],k="tilde"+M)}var D=new f0(k),E=new o0([D],{width:"100%",height:O(w),viewBox:"0 0 "+h+" "+b,preserveAspectRatio:"none"});return{span:_0([],[E],t),minWidth:0,height:w}}else{var N=[],B=Eu[d];if(!B)throw new Error('No SVG data for "'+d+'".');var F=B[0],H=B[1],V=B[2],j=V/1e3,$=F.length,X,ee;if($===1){if(B.length!==4)throw new Error('Expected 4-tuple for single-path SVG data "'+d+'".');X=["hide-tail"],ee=[B[3]]}else if($===2)X=["halfarrow-left","halfarrow-right"],ee=["xMinYMin","xMaxYMin"];else if($===3)X=["brace-left","brace-center","brace-right"],ee=["xMinYMin","xMidYMin","xMaxYMin"];else throw new Error(`Correct katexImagesData or update code here to support
                    `+$+" children.");for(var ae=0;ae<$;ae++){var Q=new f0(F[ae]),ie=new o0([Q],{width:"400em",height:O(j),viewBox:"0 0 "+h+" "+V,preserveAspectRatio:ee[ae]+" slice"}),$e=_0([X[ae]],[ie],t);if($===1)return{span:$e,minWidth:H,height:j};$e.style.height=O(j),N.push($e)}return{span:R(["katex-stretchy"],N,t),minWidth:H,height:j}}}var n=a(),i=n.span,l=n.minWidth,u=n.height;return i.height=u,i.style.height=O(u),l>0&&(i.style.minWidth=O(l)),i},Du=function(e,t,a,n,i){var l,u=e.height+e.depth+a+n;if(/fbox|color|angl/.test(t)){if(l=R(["katex-stretchy",t],[],i),t==="fbox"){var h=i.color&&i.getColor();h&&(l.style.borderColor=h)}}else{var d=[];/^[bx]cancel$/.test(t)&&d.push(new Wt({x1:"0",y1:"0",x2:"100%",y2:"100%","stroke-width":"0.046em"})),/^x?cancel$/.test(t)&&d.push(new Wt({x1:"0",y1:"100%",x2:"100%",y2:"0","stroke-width":"0.046em"}));var f=new o0(d,{width:"100%",height:O(u)});l=_0([],[f],i)}return l.height=u,l.style.height=O(u),l},Cu=["bin","close","inner","open","punct","rel"],Iu=["accent-token","mathord","op-token","spacing","textord"],Ou=new Set(Cu),Bu=new Set(Iu);function Nu(r){return Ou.has(r)}function K(r,e){if(!r||r.type!==e)throw new Error("Expected node of type "+e+", but got "+(r?"node of type "+r.type:String(r)));return r}function Ur(r){var e=Gr(r);if(!e)throw new Error("Expected node of symbol group type, but got "+(r?"node of type "+r.type:String(r)));return e}function Gr(r){return r.type==="atom"||Bu.has(r.type)?r:null}function Tn(r,e,t){var a="";for(var n of r.body)if(n.type==="textord")a+=n.text;else if(t&&n.type==="spacing"&&n.text===" ")a+=" ";else throw new C(e,r);return a}var Hs=r=>{if(r instanceof Ne)return r;if(iu(r)&&r.children.length===1)return Hs(r.children[0])},$s=(r,e)=>{var t,a,n;r&&r.type==="supsub"?(a=K(r.base,"accent"),t=a.base,r.base=t,n=nu(te(r,e)),r.base=a):(a=K(r,"accent"),t=a.base);var i=te(t,e.havingCrampedStyle()),l=a.isShifty&&T0(t),u=0;if(l){var h,d;u=(h=(d=Hs(i))==null?void 0:d.skew)!=null?h:0}var f=a.label==="\\c",b=f?i.height+i.depth:Math.min(i.height,e.fontMetrics().xHeight),k;if(a.isStretchy)k=$r(a,e),k=re({positionType:"firstBaseline",children:[{type:"elem",elem:i},{type:"elem",elem:k,wrapperClasses:["svg-align"],wrapperStyle:u>0?{width:"calc(100% - "+O(2*u)+")",marginLeft:O(2*u)}:void 0}]});else{var w,M;a.label==="\\vec"?(w=Ns("vec",e),M=Bs.vec[1]):(w=_r({type:"textord",mode:a.mode,text:a.label},e),w=au(w),w.italic=0,M=w.width,f&&(b+=w.depth)),k=R(["accent-body"],[w]);var D=a.label==="\\textcircled";D&&(k.classes.push("accent-full"),b=i.height);var E=u;D||(E-=M/2),k.style.left=O(E),a.label==="\\textcircled"&&(k.style.top=".2em"),k=re({positionType:"firstBaseline",children:[{type:"elem",elem:i},{type:"kern",size:-b},{type:"elem",elem:k}]})}var N=R(["mord","katex-accent"],[k],e);return n?(n.children[0]=N,n.height=Math.max(N.height,n.height),n.classes[0]="mord",n):N},Lu=(r,e)=>{var t=r.isStretchy?Hr(r.label):new I("mo",[a0(r.label,r.mode)]),a=new I("mover",[se(r.base,e),t]);return a.setAttribute("accent","true"),a},qu=new RegExp(["\\acute","\\grave","\\ddot","\\tilde","\\bar","\\breve","\\check","\\hat","\\vec","\\dot","\\mathring"].map(r=>"\\"+r).join("|"));L({type:"accent",names:["\\acute","\\grave","\\ddot","\\tilde","\\bar","\\breve","\\check","\\hat","\\vec","\\dot","\\mathring","\\widecheck","\\widehat","\\widetilde","\\overrightarrow","\\overleftarrow","\\Overrightarrow","\\overleftrightarrow","\\overgroup","\\overlinesegment","\\overleftharpoon","\\overrightharpoon"],numArgs:1,handler:(r,e)=>{var t=Xt(e[0]),a=!qu.test(r.funcName),n=!a||r.funcName==="\\widehat"||r.funcName==="\\widetilde"||r.funcName==="\\widecheck";return{type:"accent",mode:r.parser.mode,label:r.funcName,isStretchy:a,isShifty:n,base:t}},htmlBuilder:$s,mathmlBuilder:Lu});L({type:"accent",names:["\\'","\\`","\\^","\\~","\\=","\\u","\\.",'\\"',"\\c","\\r","\\H","\\v","\\textcircled"],numArgs:1,allowedInText:!0,allowedInMath:!0,argTypes:["primitive"],handler:(r,e)=>{var t=e[0],a=r.parser.mode;return a==="math"&&(r.parser.settings.reportNonstrict("mathVsTextAccents","LaTeX's accent "+r.funcName+" works only in text mode"),a="text"),{type:"accent",mode:a,label:r.funcName,isStretchy:!1,isShifty:!0,base:t}}});L({type:"accentUnder",names:["\\underleftarrow","\\underrightarrow","\\underleftrightarrow","\\undergroup","\\underlinesegment","\\utilde"],numArgs:1,handler:(r,e)=>{var t=r.parser,a=r.funcName,n=e[0];return{type:"accentUnder",mode:t.mode,label:a,base:n}},htmlBuilder:(r,e)=>{var t=te(r.base,e),a=$r(r,e),n=r.label==="\\utilde"?.12:0,i=re({positionType:"top",positionData:t.height,children:[{type:"elem",elem:a,wrapperClasses:["svg-align"]},{type:"kern",size:n},{type:"elem",elem:t}]});return R(["mord","accentunder"],[i],e)},mathmlBuilder:(r,e)=>{var t=Hr(r.label),a=new I("munder",[se(r.base,e),t]);return a.setAttribute("accentunder","true"),a}});var Er=r=>{var e=new I("mpadded",r?[r]:[]);return e.setAttribute("width","+0.6em"),e.setAttribute("lspace","0.3em"),e};L({type:"xArrow",names:["\\xleftarrow","\\xrightarrow","\\xLeftarrow","\\xRightarrow","\\xleftrightarrow","\\xLeftrightarrow","\\xhookleftarrow","\\xhookrightarrow","\\xmapsto","\\xrightharpoondown","\\xrightharpoonup","\\xleftharpoondown","\\xleftharpoonup","\\xrightleftharpoons","\\xleftrightharpoons","\\xlongequal","\\xtwoheadrightarrow","\\xtwoheadleftarrow","\\xtofrom","\\xrightleftarrows","\\xrightequilibrium","\\xleftequilibrium","\\\\cdrightarrow","\\\\cdleftarrow","\\\\cdlongequal"],numArgs:1,numOptionalArgs:1,handler(r,e,t){var a=r.parser,n=r.funcName;return{type:"xArrow",mode:a.mode,label:n,body:e[0],below:t[0]}},htmlBuilder(r,e){var t=e.style,a=e.havingStyle(t.sup()),n=kt(te(r.body,a,e),e),i=r.label.slice(0,2)==="\\x"?"x":"cd";n.classes.push(i+"-arrow-pad");var l;r.below&&(a=e.havingStyle(t.sub()),l=kt(te(r.below,a,e),e),l.classes.push(i+"-arrow-pad"));var u=$r(r,e),h=-e.fontMetrics().axisHeight+.5*u.height,d=-e.fontMetrics().axisHeight-.5*u.height-.111;(n.depth>.25||r.label==="\\xleftequilibrium")&&(d-=n.depth);var f;if(l){var b=-e.fontMetrics().axisHeight+l.height+.5*u.height+.111;f=re({positionType:"individualShift",children:[{type:"elem",elem:n,shift:d},{type:"elem",elem:u,shift:h,wrapperClasses:["svg-align"]},{type:"elem",elem:l,shift:b}]})}else f=re({positionType:"individualShift",children:[{type:"elem",elem:n,shift:d},{type:"elem",elem:u,shift:h,wrapperClasses:["svg-align"]}]});return R(["mrel","x-arrow"],[f],e)},mathmlBuilder(r,e){var t=Hr(r.label);t.setAttribute("minsize",r.label.charAt(0)==="x"?"1.75em":"3.0em");var a;if(r.body){var n=Er(se(r.body,e));if(r.below){var i=Er(se(r.below,e));a=new I("munderover",[t,i,n])}else a=new I("mover",[t,n])}else if(r.below){var l=Er(se(r.below,e));a=new I("munder",[t,l])}else a=Er(),a=new I("mover",[t,a]);return a}});function Pu(r,e){var t=Se(r.body,e,!0);return R([r.mclass],t,e)}function Fu(r,e){var t,a=Ke(r.body,e);return r.mclass==="minner"?t=new I("mpadded",a):r.mclass==="mord"?r.isCharacterBox?(t=a[0],t.type="mi"):t=new I("mi",a):(r.isCharacterBox?(t=a[0],t.type="mo"):t=new I("mo",a),r.mclass==="mbin"?(t.attributes.lspace="0.22em",t.attributes.rspace="0.22em"):r.mclass==="mpunct"?(t.attributes.lspace="0em",t.attributes.rspace="0.17em"):(r.mclass==="mopen"||r.mclass==="mclose")&&(t.attributes.lspace="0em",t.attributes.rspace="0em")),t}L({type:"mclass",names:["\\mathord","\\mathbin","\\mathrel","\\mathopen","\\mathclose","\\mathpunct","\\mathinner"],numArgs:1,primitive:!0,handler(r,e){var t=r.parser,a=r.funcName,n=e[0];return{type:"mclass",mode:t.mode,mclass:"m"+a.slice(5),body:ye(n),isCharacterBox:T0(n)}},htmlBuilder:Pu,mathmlBuilder:Fu});var jr=r=>{var e=r.type==="ordgroup"&&r.body.length?r.body[0]:r;return e.type==="atom"&&(e.family==="bin"||e.family==="rel")?"m"+e.family:"mord"};L({type:"mclass",names:["\\@binrel"],numArgs:2,handler(r,e){var t=r.parser;return{type:"mclass",mode:t.mode,mclass:jr(e[0]),body:ye(e[1]),isCharacterBox:T0(e[1])}}});L({type:"mclass",names:["\\stackrel","\\overset","\\underset"],numArgs:2,handler(r,e){var t=r.parser,a=r.funcName,n=e[1],i=e[0],l;a!=="\\stackrel"?l=jr(n):l="mrel";var u={type:"op",mode:n.mode,limits:!0,alwaysHandleSupSub:!0,parentIsSupSub:!1,symbol:!1,suppressBaseShift:a!=="\\stackrel",body:ye(n)},h=a==="\\underset"?{type:"supsub",mode:i.mode,base:u,sub:i}:{type:"supsub",mode:i.mode,base:u,sup:i};return{type:"mclass",mode:t.mode,mclass:l,body:[h],isCharacterBox:T0(h)}}});L({type:"pmb",names:["\\pmb"],numArgs:1,allowedInText:!0,handler(r,e){var t=r.parser;return{type:"pmb",mode:t.mode,mclass:jr(e[0]),body:ye(e[0])}},htmlBuilder(r,e){var t=Se(r.body,e,!0),a=R([r.mclass],t,e);return a.style.textShadow="0.02em 0.01em 0.04px",a},mathmlBuilder(r,e){var t=Ke(r.body,e),a=new I("mstyle",t);return a.setAttribute("style","text-shadow: 0.02em 0.01em 0.04px"),a}});var _u={">":"\\\\cdrightarrow","<":"\\\\cdleftarrow","=":"\\\\cdlongequal",A:"\\uparrow",V:"\\downarrow","|":"\\Vert",".":"no arrow"},as=()=>({type:"styling",body:[],mode:"math",style:"display",resetFont:!0}),ns=r=>r.type==="textord"&&r.text==="@",Hu=(r,e)=>(r.type==="mathord"||r.type==="atom")&&r.text===e;function $u(r,e,t){var a=_u[r];switch(a){case"\\\\cdrightarrow":case"\\\\cdleftarrow":return t.callFunction(a,[e[0]],[e[1]]);case"\\uparrow":case"\\downarrow":{var n=t.callFunction("\\\\cdleft",[e[0]],[]),i={type:"atom",text:a,mode:"math",family:"rel"},l=t.callFunction("\\Big",[i],[]),u=t.callFunction("\\\\cdright",[e[1]],[]),h={type:"ordgroup",mode:"math",body:[n,l,u]};return t.callFunction("\\\\cdparent",[h],[])}case"\\\\cdlongequal":return t.callFunction("\\\\cdlongequal",[],[]);case"\\Vert":{var d={type:"textord",text:"\\Vert",mode:"math"};return t.callFunction("\\Big",[d],[])}default:return{type:"textord",text:" ",mode:"math"}}}function Uu(r){var e=[];for(r.gullet.beginGroup(),r.gullet.macros.set("\\cr","\\\\\\relax"),r.gullet.beginGroup();;){e.push(r.parseExpression(!1,"\\\\")),r.gullet.endGroup(),r.gullet.beginGroup();var t=r.fetch().text;if(t==="&"||t==="\\\\")r.consume();else if(t==="\\end"){e[e.length-1].length===0&&e.pop();break}else throw new C("Expected \\\\ or \\cr or \\end",r.nextToken)}for(var a=[],n=[a],i=0;i<e.length;i++){for(var l=e[i],u=as(),h=0;h<l.length;h++)if(!ns(l[h]))u.body.push(l[h]);else{a.push(u),h+=1;var d=Ur(l[h]).text,f=new Array(2);if(f[0]={type:"ordgroup",mode:"math",body:[]},f[1]={type:"ordgroup",mode:"math",body:[]},!"=|.".includes(d))if("<>AV".includes(d))for(var b=0;b<2;b++){for(var k=!0,w=h+1;w<l.length;w++){if(Hu(l[w],d)){k=!1,h=w;break}if(ns(l[w]))throw new C("Missing a "+d+" character to complete a CD arrow.",l[w]);f[b].body.push(l[w])}if(k)throw new C("Missing a "+d+" character to complete a CD arrow.",l[h])}else throw new C('Expected one of "<>AV=|." after @',l[h]);var M=$u(d,f,r),D={type:"styling",body:[M],mode:"math",style:"display",resetFont:!0};a.push(D),u=as()}i%2===0?a.push(u):a.shift(),a=[],n.push(a)}r.gullet.endGroup(),r.gullet.endGroup();var E=new Array(n[0].length).fill({type:"align",align:"c",pregap:.25,postgap:.25});return{type:"array",mode:"math",body:n,arraystretch:1,addJot:!0,rowGaps:[null],cols:E,colSeparationType:"CD",hLinesBeforeRow:new Array(n.length+1).fill([])}}L({type:"cdlabel",names:["\\\\cdleft","\\\\cdright"],numArgs:1,handler(r,e){var t=r.parser,a=r.funcName;return{type:"cdlabel",mode:t.mode,side:a.slice(4),label:e[0]}},htmlBuilder(r,e){var t=e.havingStyle(e.style.sup()),a=kt(te(r.label,t,e),e);return a.classes.push("cd-label-"+r.side),a.style.bottom=O(.8-a.depth),a.height=0,a.depth=0,a},mathmlBuilder(r,e){var t=new I("mrow",[se(r.label,e)]);return t=new I("mpadded",[t]),t.setAttribute("width","0"),r.side==="left"&&t.setAttribute("lspace","-1width"),t.setAttribute("voffset","0.7em"),t=new I("mstyle",[t]),t.setAttribute("displaystyle","false"),t.setAttribute("scriptlevel","1"),t}});L({type:"cdlabelparent",names:["\\\\cdparent"],numArgs:1,handler(r,e){var t=r.parser;return{type:"cdlabelparent",mode:t.mode,fragment:e[0]}},htmlBuilder(r,e){var t=kt(te(r.fragment,e),e);return t.classes.push("cd-vert-arrow"),t},mathmlBuilder(r,e){return new I("mrow",[se(r.fragment,e)])}});L({type:"textord",names:["\\@char"],numArgs:1,allowedInText:!0,handler(r,e){var t=r.parser,a=K(e[0],"ordgroup"),n=Tn(a,"\\@char has non-numeric argument"),i=parseInt(n),l;if(isNaN(i))throw new C("\\@char has non-numeric argument "+n);if(i<0||i>1114111)throw new C("\\@char with invalid code point "+n);return i<=65535?l=String.fromCharCode(i):(i-=65536,l=String.fromCharCode((i>>10)+55296,(i&1023)+56320)),{type:"textord",mode:t.mode,text:l}}});var Gu=(r,e)=>{var t=Se(r.body,e.withColor(r.color),!1);return z0(t)},ju=(r,e)=>{var t=Ke(r.body,e.withColor(r.color)),a=new I("mstyle",t);return a.setAttribute("mathcolor",r.color),a};L({type:"color",names:["\\textcolor"],numArgs:2,allowedInText:!0,argTypes:["color","original"],handler(r,e){var t=r.parser,a=K(e[0],"color-token").color,n=e[1];return{type:"color",mode:t.mode,color:a,body:ye(n)}},htmlBuilder:Gu,mathmlBuilder:ju});L({type:"color",names:["\\color"],numArgs:1,allowedInText:!0,argTypes:["color"],handler(r,e){var t=r.parser,a=r.breakOnTokenText,n=K(e[0],"color-token").color;t.gullet.macros.set("\\current@color",n);var i=t.parseExpression(!0,a);return{type:"color",mode:t.mode,color:n,body:i}}});L({type:"cr",names:["\\\\"],numArgs:0,numOptionalArgs:0,allowedInText:!0,handler(r,e,t){var a=r.parser,n=a.gullet.future().text==="["?a.parseSizeGroup(!0):null,i=!a.settings.displayMode||!a.settings.useStrictBehavior("newLineInDisplayMode","In LaTeX, \\\\ or \\newline does nothing in display mode");return{type:"cr",mode:a.mode,newLine:i,size:n&&K(n,"size").value}},htmlBuilder(r,e){var t=R(["mspace"],[],e);return r.newLine&&(t.classes.push("katex-newline"),r.size&&(t.style.marginTop=O(fe(r.size,e)))),t},mathmlBuilder(r,e){var t=new I("mspace");return r.newLine&&(t.setAttribute("linebreak","newline"),r.size&&t.setAttribute("height",O(fe(r.size,e)))),t}});var cn={"\\global":"\\global","\\long":"\\\\globallong","\\\\globallong":"\\\\globallong","\\def":"\\gdef","\\gdef":"\\gdef","\\edef":"\\xdef","\\xdef":"\\xdef","\\let":"\\\\globallet","\\futurelet":"\\\\globalfuture"},Us=r=>{var e=r.text;if(/^(?:[\\{}$&#^_]|EOF)$/.test(e))throw new C("Expected a control sequence",r);return e},Wu=r=>{var e=r.gullet.popToken();return e.text==="="&&(e=r.gullet.popToken(),e.text===" "&&(e=r.gullet.popToken())),e},Gs=(r,e,t,a)=>{var n=r.gullet.macros.get(t.text);n==null&&(t.noexpand=!0,n={tokens:[t],numArgs:0,unexpandable:!r.gullet.isExpandable(t.text)}),r.gullet.macros.set(e,n,a)};L({type:"internal",names:["\\global","\\long","\\\\globallong"],numArgs:0,allowedInText:!0,handler(r){var e=r.parser,t=r.funcName;e.consumeSpaces();var a=e.fetch();if(cn[a.text])return(t==="\\global"||t==="\\\\globallong")&&(a.text=cn[a.text]),K(e.parseFunction(),"internal");throw new C("Invalid token after macro prefix",a)}});L({type:"internal",names:["\\def","\\gdef","\\edef","\\xdef"],numArgs:0,allowedInText:!0,primitive:!0,handler(r){var e=r.parser,t=r.funcName,a=e.gullet.popToken(),n=a.text;if(/^(?:[\\{}$&#^_]|EOF)$/.test(n))throw new C("Expected a control sequence",a);for(var i=0,l,u=[[]];e.gullet.future().text!=="{";)if(a=e.gullet.popToken(),a.text==="#"){if(e.gullet.future().text==="{"){l=e.gullet.future(),u[i].push("{");break}if(a=e.gullet.popToken(),!/^[1-9]$/.test(a.text))throw new C('Invalid argument number "'+a.text+'"');if(parseInt(a.text)!==i+1)throw new C('Argument number "'+a.text+'" out of order');i++,u.push([])}else{if(a.text==="EOF")throw new C("Expected a macro definition");u[i].push(a.text)}var h=e.gullet.consumeArg(),d=h.tokens;return l&&d.unshift(l),(t==="\\edef"||t==="\\xdef")&&(d=e.gullet.expandTokens(d),d.reverse()),e.gullet.macros.set(n,{tokens:d,numArgs:i,delimiters:u},t===cn[t]),{type:"internal",mode:e.mode}}});L({type:"internal",names:["\\let","\\\\globallet"],numArgs:0,allowedInText:!0,primitive:!0,handler(r){var e=r.parser,t=r.funcName,a=Us(e.gullet.popToken());e.gullet.consumeSpaces();var n=Wu(e);return Gs(e,a,n,t==="\\\\globallet"),{type:"internal",mode:e.mode}}});L({type:"internal",names:["\\futurelet","\\\\globalfuture"],numArgs:0,allowedInText:!0,primitive:!0,handler(r){var e=r.parser,t=r.funcName,a=Us(e.gullet.popToken()),n=e.gullet.popToken(),i=e.gullet.popToken();return Gs(e,a,i,t==="\\\\globalfuture"),e.gullet.pushToken(i),e.gullet.pushToken(n),{type:"internal",mode:e.mode}}});var $t=function(e,t,a){var n=he.math[e]&&he.math[e].replace,i=yn(n||e,t,a);if(!i)throw new Error("Unsupported symbol "+e+" and font size "+t+".");return i},An=function(e,t,a,n){var i=a.havingBaseStyle(t),l=R(n.concat(i.sizingClasses(a)),[e],a),u=i.sizeMultiplier/a.sizeMultiplier;return l.height*=u,l.depth*=u,l.maxFontSize=i.sizeMultiplier,l},js=function(e,t,a){var n=t.havingBaseStyle(a),i=(1-t.sizeMultiplier/n.sizeMultiplier)*t.fontMetrics().axisHeight;e.classes.push("delimcenter"),e.style.top=O(i),e.height-=i,e.depth+=i},Vu=function(e,t,a,n,i,l){var u=Oe(e,"Main-Regular",i,n),h=An(u,t,n,l);return a&&js(h,n,t),h},Yu=function(e,t,a,n){return Oe(e,"Size"+t+"-Regular",a,n)},Ws=function(e,t,a,n,i,l){var u=Yu(e,t,i,n),h=An(R(["delimsizing","size"+t],[u],n),W.TEXT,n,l);return a&&js(h,n,W.TEXT),h},Ha=function(e,t,a){var n;t==="Size1-Regular"?n="delim-size1":n="delim-size4";var i=R(["delimsizinginner",n],[R([],[Oe(e,t,a)])]);return{type:"elem",elem:i}},$a=function(e,t,a){var n=p0["Size4-Regular"][e.charCodeAt(0)]?p0["Size4-Regular"][e.charCodeAt(0)][4]:p0["Size1-Regular"][e.charCodeAt(0)][4],i=new f0("inner",Ko(e,Math.round(1e3*t))),l=new o0([i],{width:O(n),height:O(t),style:"width:"+O(n),viewBox:"0 0 "+1e3*n+" "+Math.round(1e3*t),preserveAspectRatio:"xMinYMin"}),u=_0([],[l],a);return u.height=t,u.style.height=O(t),u.style.width=O(n),{type:"elem",elem:u}},hn=.008,Rr={type:"kern",size:-1*hn},Xu=new Set(["|","\\lvert","\\rvert","\\vert"]),Zu=new Set(["\\|","\\lVert","\\rVert","\\Vert"]),Vs=function(e,t,a,n,i,l){var u,h,d,f,b="",k=0;u=d=f=e,h=null;var w="Size1-Regular";e==="\\uparrow"?d=f="\u23D0":e==="\\Uparrow"?d=f="\u2016":e==="\\downarrow"?u=d="\u23D0":e==="\\Downarrow"?u=d="\u2016":e==="\\updownarrow"?(u="\\uparrow",d="\u23D0",f="\\downarrow"):e==="\\Updownarrow"?(u="\\Uparrow",d="\u2016",f="\\Downarrow"):Xu.has(e)?(d="\u2223",b="vert",k=333):Zu.has(e)?(d="\u2225",b="doublevert",k=556):e==="["||e==="\\lbrack"?(u="\u23A1",d="\u23A2",f="\u23A3",w="Size4-Regular",b="lbrack",k=667):e==="]"||e==="\\rbrack"?(u="\u23A4",d="\u23A5",f="\u23A6",w="Size4-Regular",b="rbrack",k=667):e==="\\lfloor"||e==="\u230A"?(d=u="\u23A2",f="\u23A3",w="Size4-Regular",b="lfloor",k=667):e==="\\lceil"||e==="\u2308"?(u="\u23A1",d=f="\u23A2",w="Size4-Regular",b="lceil",k=667):e==="\\rfloor"||e==="\u230B"?(d=u="\u23A5",f="\u23A6",w="Size4-Regular",b="rfloor",k=667):e==="\\rceil"||e==="\u2309"?(u="\u23A4",d=f="\u23A5",w="Size4-Regular",b="rceil",k=667):e==="("||e==="\\lparen"?(u="\u239B",d="\u239C",f="\u239D",w="Size4-Regular",b="lparen",k=875):e===")"||e==="\\rparen"?(u="\u239E",d="\u239F",f="\u23A0",w="Size4-Regular",b="rparen",k=875):e==="\\{"||e==="\\lbrace"?(u="\u23A7",h="\u23A8",f="\u23A9",d="\u23AA",w="Size4-Regular"):e==="\\}"||e==="\\rbrace"?(u="\u23AB",h="\u23AC",f="\u23AD",d="\u23AA",w="Size4-Regular"):e==="\\lgroup"||e==="\u27EE"?(u="\u23A7",f="\u23A9",d="\u23AA",w="Size4-Regular"):e==="\\rgroup"||e==="\u27EF"?(u="\u23AB",f="\u23AD",d="\u23AA",w="Size4-Regular"):e==="\\lmoustache"||e==="\u23B0"?(u="\u23A7",f="\u23AD",d="\u23AA",w="Size4-Regular"):(e==="\\rmoustache"||e==="\u23B1")&&(u="\u23AB",f="\u23A9",d="\u23AA",w="Size4-Regular");var M=$t(u,w,i),D=M.height+M.depth,E=$t(d,w,i),N=E.height+E.depth,B=$t(f,w,i),F=B.height+B.depth,H=0,V=1;if(h!==null){var j=$t(h,w,i);H=j.height+j.depth,V=2}var $=D+F+H,X=Math.max(0,Math.ceil((t-$)/(V*N))),ee=$+X*V*N,ae=n.fontMetrics().axisHeight;a&&(ae*=n.sizeMultiplier);var Q=ee/2-ae,ie=[];if(b.length>0){var $e=ee-D-F,Ue=Math.round(ee*1e3),ze=Qo(b,Math.round($e*1e3)),n0=new f0(b,ze),Ge=O(k/1e3),M0=O(Ue/1e3),Tt=new o0([n0],{width:Ge,height:M0,viewBox:"0 0 "+k+" "+Ue}),je=_0([],[Tt],n);je.height=Ue/1e3,je.style.width=Ge,je.style.height=M0,ie.push({type:"elem",elem:je})}else{if(ie.push(Ha(f,w,i)),ie.push(Rr),h===null){var Qe=ee-D-F+2*hn;ie.push($a(d,Qe,n))}else{var E0=(ee-D-F-H)/2+2*hn;ie.push($a(d,E0,n)),ie.push(Rr),ie.push(Ha(h,w,i)),ie.push(Rr),ie.push($a(d,E0,n))}ie.push(Rr),ie.push(Ha(u,w,i))}var We=n.havingBaseStyle(W.TEXT),rt=re({positionType:"bottom",positionData:Q,children:ie});return An(R(["delimsizing","mult"],[rt],We),W.TEXT,n,l)},Ua=80,Ga=.08,ja=function(e,t,a,n,i){var l=Zo(e,n,a),u=new f0(e,l),h=new o0([u],{width:"400em",height:O(t),viewBox:"0 0 400000 "+a,preserveAspectRatio:"xMinYMin slice"});return _0(["hide-tail"],[h],i)},Ku=function(e,t){var a=t.havingBaseSizing(),n=Qs("\\surd",e*a.sizeMultiplier,Ks,a),i=a.sizeMultiplier,l=Math.max(0,t.minRuleThickness-t.fontMetrics().sqrtRuleThickness),u,h,d,f,b;return n.type==="small"?(f=1e3+1e3*l+Ua,e<1?i=1:e<1.4&&(i=.7),h=(1+l+Ga)/i,d=(1+l)/i,u=ja("sqrtMain",h,f,l,t),u.style.minWidth="0.853em",b=.833/i):n.type==="large"?(f=(1e3+Ua)*Ut[n.size],d=(Ut[n.size]+l)/i,h=(Ut[n.size]+l+Ga)/i,u=ja("sqrtSize"+n.size,h,f,l,t),u.style.minWidth="1.02em",b=1/i):(h=e+l+Ga,d=e+l,f=Math.floor(1e3*e+l)+Ua,u=ja("sqrtTall",h,f,l,t),u.style.minWidth="0.742em",b=1.056),u.height=d,u.style.height=O(h),{span:u,advanceWidth:b,ruleWidth:(t.fontMetrics().sqrtRuleThickness+l)*i}},Ys=new Set(["(","\\lparen",")","\\rparen","[","\\lbrack","]","\\rbrack","\\{","\\lbrace","\\}","\\rbrace","\\lfloor","\\rfloor","\u230A","\u230B","\\lceil","\\rceil","\u2308","\u2309","\\surd"]),Qu=new Set(["\\uparrow","\\downarrow","\\updownarrow","\\Uparrow","\\Downarrow","\\Updownarrow","|","\\|","\\vert","\\Vert","\\lvert","\\rvert","\\lVert","\\rVert","\\lgroup","\\rgroup","\u27EE","\u27EF","\\lmoustache","\\rmoustache","\u23B0","\u23B1"]),Xs=new Set(["<",">","\\langle","\\rangle","/","\\backslash","\\lt","\\gt"]),Ut=[0,1.2,1.8,2.4,3],Zs=function(e,t,a,n,i){if(e==="<"||e==="\\lt"||e==="\u27E8"?e="\\langle":(e===">"||e==="\\gt"||e==="\u27E9")&&(e="\\rangle"),Ys.has(e)||Xs.has(e))return Ws(e,t,!1,a,n,i);if(Qu.has(e))return Vs(e,Ut[t],!1,a,n,i);throw new C("Illegal delimiter: '"+e+"'")},Ju=[{type:"small",style:W.SCRIPTSCRIPT},{type:"small",style:W.SCRIPT},{type:"small",style:W.TEXT},{type:"large",size:1},{type:"large",size:2},{type:"large",size:3},{type:"large",size:4}],e4=[{type:"small",style:W.SCRIPTSCRIPT},{type:"small",style:W.SCRIPT},{type:"small",style:W.TEXT},{type:"stack"}],Ks=[{type:"small",style:W.SCRIPTSCRIPT},{type:"small",style:W.SCRIPT},{type:"small",style:W.TEXT},{type:"large",size:1},{type:"large",size:2},{type:"large",size:3},{type:"large",size:4},{type:"stack"}],t4=function(e){if(e.type==="small")return"Main-Regular";if(e.type==="large")return"Size"+e.size+"-Regular";if(e.type==="stack")return"Size4-Regular";var t=e.type;throw new Error("Add support for delim type '"+t+"' here.")},Qs=function(e,t,a,n){for(var i=Math.min(2,3-n.style.size),l=i;l<a.length;l++){var u=a[l];if(u.type==="stack")break;var h=$t(e,t4(u),"math"),d=h.height+h.depth;if(u.type==="small"){var f=n.havingBaseStyle(u.style);d*=f.sizeMultiplier}if(d>t)return u}return a[a.length-1]},mn=function(e,t,a,n,i,l){e==="<"||e==="\\lt"||e==="\u27E8"?e="\\langle":(e===">"||e==="\\gt"||e==="\u27E9")&&(e="\\rangle");var u;Xs.has(e)?u=Ju:Ys.has(e)?u=Ks:u=e4;var h=Qs(e,t,u,n);return h.type==="small"?Vu(e,h.style,a,n,i,l):h.type==="large"?Ws(e,h.size,a,n,i,l):Vs(e,t,a,n,i,l)},Wa=function(e,t,a,n,i,l){var u=n.fontMetrics().axisHeight*n.sizeMultiplier,h=901,d=5/n.fontMetrics().ptPerEm,f=Math.max(t-u,a+u),b=Math.max(f/500*h,2*f-d);return mn(e,b,!0,n,i,l)},is={"\\bigl":{mclass:"mopen",size:1},"\\Bigl":{mclass:"mopen",size:2},"\\biggl":{mclass:"mopen",size:3},"\\Biggl":{mclass:"mopen",size:4},"\\bigr":{mclass:"mclose",size:1},"\\Bigr":{mclass:"mclose",size:2},"\\biggr":{mclass:"mclose",size:3},"\\Biggr":{mclass:"mclose",size:4},"\\bigm":{mclass:"mrel",size:1},"\\Bigm":{mclass:"mrel",size:2},"\\biggm":{mclass:"mrel",size:3},"\\Biggm":{mclass:"mrel",size:4},"\\big":{mclass:"mord",size:1},"\\Big":{mclass:"mord",size:2},"\\bigg":{mclass:"mord",size:3},"\\Bigg":{mclass:"mord",size:4}},r4=new Set(["(","\\lparen",")","\\rparen","[","\\lbrack","]","\\rbrack","\\{","\\lbrace","\\}","\\rbrace","\\lfloor","\\rfloor","\u230A","\u230B","\\lceil","\\rceil","\u2308","\u2309","<",">","\\langle","\u27E8","\\rangle","\u27E9","\\lt","\\gt","\\lvert","\\rvert","\\lVert","\\rVert","\\lgroup","\\rgroup","\u27EE","\u27EF","\\lmoustache","\\rmoustache","\u23B0","\u23B1","/","\\backslash","|","\\vert","\\|","\\Vert","\\uparrow","\\Uparrow","\\downarrow","\\Downarrow","\\updownarrow","\\Updownarrow","."]);function ss(r){return"isMiddle"in r}function Wr(r,e){var t=Gr(r);if(t&&r4.has(t.text))return t;throw t?new C("Invalid delimiter '"+t.text+"' after '"+e.funcName+"'",r):new C("Invalid delimiter type '"+r.type+"'",r)}L({type:"delimsizing",names:["\\bigl","\\Bigl","\\biggl","\\Biggl","\\bigr","\\Bigr","\\biggr","\\Biggr","\\bigm","\\Bigm","\\biggm","\\Biggm","\\big","\\Big","\\bigg","\\Bigg"],numArgs:1,argTypes:["primitive"],handler:(r,e)=>{var t=Wr(Xt(e[0]),r);return{type:"delimsizing",mode:r.parser.mode,size:is[r.funcName].size,mclass:is[r.funcName].mclass,delim:t.text}},htmlBuilder:(r,e)=>r.delim==="."?R([r.mclass]):Zs(r.delim,r.size,e,r.mode,[r.mclass]),mathmlBuilder:r=>{var e=[];r.delim!=="."&&e.push(a0(r.delim,r.mode));var t=new I("mo",e);r.mclass==="mopen"||r.mclass==="mclose"?t.setAttribute("fence","true"):t.setAttribute("fence","false"),t.setAttribute("stretchy","true");var a=O(Ut[r.size]);return t.setAttribute("minsize",a),t.setAttribute("maxsize",a),t}});function ls(r){if(!r.body)throw new Error("Bug: The leftright ParseNode wasn't fully parsed.")}L({type:"leftright-right",names:["\\right"],numArgs:1,primitive:!0,handler:(r,e)=>{var t=r.parser.gullet.macros.get("\\current@color");if(t&&typeof t!="string")throw new C("\\current@color set to non-string in \\right");return{type:"leftright-right",mode:r.parser.mode,delim:Wr(e[0],r).text,color:t}}});L({type:"leftright",names:["\\left"],numArgs:1,primitive:!0,handler:(r,e)=>{var t=Wr(e[0],r),a=r.parser;++a.leftrightDepth;var n=a.parseExpression(!1);--a.leftrightDepth,a.expect("\\right",!1);var i=K(a.parseFunction(),"leftright-right");return{type:"leftright",mode:a.mode,body:n,left:t.text,right:i.delim,rightColor:i.color}},htmlBuilder:(r,e)=>{ls(r);for(var t=Se(r.body,e,!0,["mopen","mclose"]),a=0,n=0,i=!1,l=0;l<t.length;l++){var u=t[l];ss(u)?i=!0:(a=Math.max(t[l].height,a),n=Math.max(t[l].depth,n))}a*=e.sizeMultiplier,n*=e.sizeMultiplier;var h;if(r.left==="."?h=Zt(e,["mopen"]):h=Wa(r.left,a,n,e,r.mode,["mopen"]),t.unshift(h),i)for(var d=1;d<t.length;d++){var f=t[d];if(ss(f)){var b=f.isMiddle;t[d]=Wa(b.delim,a,n,b.options,r.mode,[])}}var k;if(r.right===".")k=Zt(e,["mclose"]);else{var w=r.rightColor?e.withColor(r.rightColor):e;k=Wa(r.right,a,n,w,r.mode,["mclose"])}return t.push(k),R(["minner"],t,e)},mathmlBuilder:(r,e)=>{ls(r);var t=Ke(r.body,e);if(r.left!=="."){var a=new I("mo",[a0(r.left,r.mode)]);a.setAttribute("fence","true"),t.unshift(a)}if(r.right!=="."){var n=new I("mo",[a0(r.right,r.mode)]);n.setAttribute("fence","true"),r.rightColor&&n.setAttribute("mathcolor",r.rightColor),t.push(n)}return kn(t)}});L({type:"middle",names:["\\middle"],numArgs:1,primitive:!0,handler:(r,e)=>{var t=Wr(e[0],r);if(!r.parser.leftrightDepth)throw new C("\\middle without preceding \\left",t);return{type:"middle",mode:r.parser.mode,delim:t.text}},htmlBuilder:(r,e)=>{var t;return r.delim==="."?t=Zt(e,[]):(t=Zs(r.delim,1,e,r.mode,[]),t.isMiddle={delim:r.delim,options:e}),t},mathmlBuilder:(r,e)=>{var t=r.delim==="\\vert"||r.delim==="|"?a0("|","text"):a0(r.delim,r.mode),a=new I("mo",[t]);return a.setAttribute("fence","true"),a.setAttribute("lspace","0.05em"),a.setAttribute("rspace","0.05em"),a}});var a4=(r,e)=>{var t=kt(te(r.body,e),e),a=r.label.slice(1),n=e.sizeMultiplier,i,l,u=T0(r.body);if(a==="sout")i=R(["katex-stretchy","katex-sout"]),i.height=e.fontMetrics().defaultRuleThickness/n,l=-.5*e.fontMetrics().xHeight;else if(a==="phase"){var h=fe({number:.6,unit:"pt"},e),d=fe({number:.35,unit:"ex"},e),f=e.havingBaseSizing();n=n/f.sizeMultiplier;var b=t.height+t.depth+h+d;t.style.paddingLeft=O(b/2+h);var k=Math.floor(1e3*b*n),w=Yo(k),M=new o0([new f0("phase",w)],{width:"400em",height:O(k/1e3),viewBox:"0 0 400000 "+k,preserveAspectRatio:"xMinYMin slice"});i=_0(["hide-tail"],[M],e),i.style.height=O(b),l=t.depth+h+d}else{/cancel/.test(a)?u||t.classes.push("cancel-pad"):a==="angl"?t.classes.push("anglpad"):t.classes.push("boxpad");var D,E,N=0;/box/.test(a)?(N=Math.max(e.fontMetrics().fboxrule,e.minRuleThickness),D=e.fontMetrics().fboxsep+(a==="colorbox"?0:N),E=D):a==="angl"?(N=Math.max(e.fontMetrics().defaultRuleThickness,e.minRuleThickness),D=4*N,E=Math.max(0,.25-t.depth)):(D=u?.2:0,E=D),i=Du(t,a,D,E,e),/fbox|boxed|fcolorbox/.test(a)?(i.style.borderStyle="solid",i.style.borderWidth=O(N)):a==="angl"&&N!==.049&&(i.style.borderTopWidth=O(N),i.style.borderRightWidth=O(N)),l=t.depth+E,r.backgroundColor&&(i.style.backgroundColor=r.backgroundColor,r.borderColor&&(i.style.borderColor=r.borderColor))}var B;if(r.backgroundColor)B=re({positionType:"individualShift",children:[{type:"elem",elem:i,shift:l},{type:"elem",elem:t,shift:0}]});else{var F=/cancel|phase/.test(a)?["svg-align"]:[];B=re({positionType:"individualShift",children:[{type:"elem",elem:t,shift:0},{type:"elem",elem:i,shift:l,wrapperClasses:F}]})}return/cancel/.test(a)&&(B.height=t.height,B.depth=t.depth),/cancel/.test(a)&&!u?R(["mord","cancel-lap"],[B],e):R(["mord"],[B],e)},n4=(r,e)=>{var t,a=new I(r.label.includes("colorbox")?"mpadded":"menclose",[se(r.body,e)]);switch(r.label){case"\\cancel":a.setAttribute("notation","updiagonalstrike");break;case"\\bcancel":a.setAttribute("notation","downdiagonalstrike");break;case"\\phase":a.setAttribute("notation","phasorangle");break;case"\\sout":a.setAttribute("notation","horizontalstrike");break;case"\\fbox":a.setAttribute("notation","box");break;case"\\angl":a.setAttribute("notation","actuarial");break;case"\\fcolorbox":case"\\colorbox":if(t=e.fontMetrics().fboxsep*e.fontMetrics().ptPerEm,a.setAttribute("width","+"+2*t+"pt"),a.setAttribute("height","+"+2*t+"pt"),a.setAttribute("lspace",t+"pt"),a.setAttribute("voffset",t+"pt"),r.label==="\\fcolorbox"){var n=Math.max(e.fontMetrics().fboxrule,e.minRuleThickness);a.setAttribute("style","border: "+O(n)+" solid "+r.borderColor)}break;case"\\xcancel":a.setAttribute("notation","updiagonalstrike downdiagonalstrike");break}return r.backgroundColor&&a.setAttribute("mathbackground",r.backgroundColor),a};L({type:"enclose",names:["\\colorbox"],numArgs:2,allowedInText:!0,argTypes:["color","hbox"],handler(r,e,t){var a=r.parser,n=r.funcName,i=K(e[0],"color-token").color,l=e[1];return{type:"enclose",mode:a.mode,label:n,backgroundColor:i,body:l}},htmlBuilder:a4,mathmlBuilder:n4});L({type:"enclose",names:["\\fcolorbox"],numArgs:3,allowedInText:!0,argTypes:["color","color","hbox"],handler(r,e,t){var a=r.parser,n=r.funcName,i=K(e[0],"color-token").color,l=K(e[1],"color-token").color,u=e[2];return{type:"enclose",mode:a.mode,label:n,backgroundColor:l,borderColor:i,body:u}}});L({type:"enclose",names:["\\fbox"],numArgs:1,argTypes:["hbox"],allowedInText:!0,handler(r,e){var t=r.parser;return{type:"enclose",mode:t.mode,label:"\\fbox",body:e[0]}}});L({type:"enclose",names:["\\cancel","\\bcancel","\\xcancel","\\phase"],numArgs:1,handler(r,e){var t=r.parser,a=r.funcName,n=e[0];return{type:"enclose",mode:t.mode,label:a,body:n}}});L({type:"enclose",names:["\\sout"],numArgs:1,allowedInText:!0,handler(r,e){var t=r.parser,a=r.funcName;t.mode==="math"&&t.settings.reportNonstrict("mathVsSout","LaTeX's \\sout works only in text mode");var n=e[0];return{type:"enclose",mode:t.mode,label:a,body:n}}});L({type:"enclose",names:["\\angl"],numArgs:1,argTypes:["hbox"],allowedInText:!1,handler(r,e){var t=r.parser;return{type:"enclose",mode:t.mode,label:"\\angl",body:e[0]}}});var Js={};function v0(r){for(var e=r.type,t=r.names,a=r.props,n=r.handler,i=r.htmlBuilder,l=r.mathmlBuilder,u={type:e,numArgs:a.numArgs||0,allowedInText:!1,numOptionalArgs:0,handler:n},h=0;h<t.length;++h)Js[t[h]]=u;i&&(Vt[e]=i),l&&(Yt[e]=l)}var el={};function m(r,e){el[r]=e}var He=class r{constructor(e,t,a){this.lexer=void 0,this.start=void 0,this.end=void 0,this.lexer=e,this.start=t,this.end=a}static range(e,t){return t?!e||!e.loc||!t.loc||e.loc.lexer!==t.loc.lexer?null:new r(e.loc.lexer,e.loc.start,t.loc.end):e&&e.loc}},Xe=class r{constructor(e,t){this.text=void 0,this.loc=void 0,this.noexpand=void 0,this.treatAsRelax=void 0,this.text=e,this.loc=t}range(e,t){return new r(t,He.range(this,e))}};function os(r){var e=[];r.consumeSpaces();var t=r.fetch().text;for(t==="\\relax"&&(r.consume(),r.consumeSpaces(),t=r.fetch().text);t==="\\hline"||t==="\\hdashline";)r.consume(),e.push(t==="\\hdashline"),r.consumeSpaces(),t=r.fetch().text;return e}var Vr=r=>{var e=r.parser.settings;if(!e.displayMode)throw new C("{"+r.envName+"} can be used only in display mode.")},i4=new Set(["gather","gather*"]);function zn(r){if(!r.includes("ed"))return!r.includes("*")}function $0(r,e,t){var a=e.hskipBeforeAndAfter,n=e.addJot,i=e.cols,l=e.arraystretch,u=e.colSeparationType,h=e.autoTag,d=e.singleRow,f=e.emptySingleRow,b=e.maxNumCols,k=e.leqno;if(r.gullet.beginGroup(),d||r.gullet.macros.set("\\cr","\\\\\\relax"),!l){var w=r.gullet.expandMacroAsText("\\arraystretch");if(w==null)l=1;else if(l=parseFloat(w),!l||l<0)throw new C("Invalid \\arraystretch: "+w)}r.gullet.beginGroup();var M=[],D=[M],E=[],N=[],B=h!=null?[]:void 0;function F(){h&&r.gullet.macros.set("\\@eqnsw","1",!0)}function H(){B&&(r.gullet.macros.get("\\df@tag")?(B.push(r.subparse([new Xe("\\df@tag")])),r.gullet.macros.set("\\df@tag",void 0,!0)):B.push(!!h&&r.gullet.macros.get("\\@eqnsw")==="1"))}for(F(),N.push(os(r));;){var V=r.parseExpression(!1,d?"\\end":"\\\\");r.gullet.endGroup(),r.gullet.beginGroup();var j={type:"ordgroup",mode:r.mode,body:V};t&&(j={type:"styling",mode:r.mode,style:t,resetFont:!0,body:[j]}),M.push(j);var $=r.fetch().text;if($==="&"){if(b&&M.length===b){if(d||u)throw new C("Too many tab characters: &",r.nextToken);r.settings.reportNonstrict("textEnv","Too few columns specified in the {array} column argument.")}r.consume()}else if($==="\\end"){H(),M.length===1&&j.type==="styling"&&j.body.length===1&&j.body[0].type==="ordgroup"&&j.body[0].body.length===0&&(D.length>1||!f)&&!Array.isArray(B?.[B.length-1])&&!(h&&B?.[B.length-1]===!0)&&D.pop(),N.length<D.length+1&&N.push([]);break}else if($==="\\\\"){r.consume();var X=void 0;r.gullet.future().text!==" "&&(X=r.parseSizeGroup(!0)),E.push(X?X.value:null),H(),N.push(os(r)),M=[],D.push(M),F()}else throw new C("Expected & or \\\\ or \\cr or \\end",r.nextToken)}return r.gullet.endGroup(),r.gullet.endGroup(),{type:"array",mode:r.mode,addJot:n,arraystretch:l,body:D,cols:i,rowGaps:E,hskipBeforeAndAfter:a,hLinesBeforeRow:N,colSeparationType:u,tags:B,leqno:k}}function Mn(r){return r.slice(0,1)==="d"?"display":"text"}var g0=function(e,t){var a,n,i=e.body.length,l=e.hLinesBeforeRow,u=0,h=new Array(i),d=[],f=Math.max(t.fontMetrics().arrayRuleWidth,t.minRuleThickness),b=1/t.fontMetrics().ptPerEm,k=5*b;if(e.colSeparationType&&e.colSeparationType==="small"){var w=t.havingStyle(W.SCRIPT).sizeMultiplier;k=.2778*(w/t.sizeMultiplier)}var M=e.colSeparationType==="CD"?fe({number:3,unit:"ex"},t):12*b,D=3*b,E=e.arraystretch*M,N=.7*E,B=.3*E,F=0;function H(qe){for(var e0=0;e0<qe.length;++e0)e0>0&&(F+=.25),d.push({pos:F,isDashed:qe[e0]})}for(H(l[0]),a=0;a<e.body.length;++a){var V=e.body[a],j=N,$=B;u<V.length&&(u=V.length);var X={cells:new Array(V.length),height:0,depth:0,pos:0};for(n=0;n<V.length;++n){var ee=te(V[n],t);$<ee.depth&&($=ee.depth),j<ee.height&&(j=ee.height),X.cells[n]=ee}var ae=e.rowGaps[a],Q=0;ae&&(Q=fe(ae,t),Q>0&&(Q+=B,$<Q&&($=Q),Q=0)),e.addJot&&a<e.body.length-1&&($+=D),X.height=j,X.depth=$,F+=j,X.pos=F,F+=$+Q,h[a]=X,H(l[a+1])}var ie=F/2+t.fontMetrics().axisHeight,$e=e.cols||[],Ue=[],ze,n0,Ge=[];if(e.tags&&e.tags.some(qe=>qe))for(a=0;a<i;++a){var M0=h[a],Tt=M0.pos-ie,je=e.tags[a],Qe=void 0;je===!0?Qe=R(["eqn-num"],[],t):je===!1?Qe=R([],[],t):Qe=R([],Se(je,t,!0),t),Qe.depth=M0.depth,Qe.height=M0.height,Ge.push({type:"elem",elem:Qe,shift:Tt})}for(n=0,n0=0;n<u||n0<$e.length;++n,++n0){for(var E0,We=$e[n0],rt=!0;((Qt=We)==null?void 0:Qt.type)==="separator";){var Qt;if(rt||(ze=R(["arraycolsep"],[]),ze.style.width=O(t.fontMetrics().doubleRuleSep),Ue.push(ze)),We.separator==="|"||We.separator===":"){var le=We.separator==="|"?"solid":"dashed",R0=R(["vertical-separator"],[],t);R0.style.height=O(F),R0.style.borderRightWidth=O(f),R0.style.borderRightStyle=le,R0.style.margin="0 "+O(-f/2);var Jt=F-ie;Jt&&(R0.style.verticalAlign=O(-Jt)),Ue.push(R0)}else throw new C("Invalid separator type: "+We.separator);n0++,We=$e[n0],rt=!1}if(!(n>=u)){var D0=void 0;if(n>0||e.hskipBeforeAndAfter){var er,tr;D0=(er=(tr=We)==null?void 0:tr.pregap)!=null?er:k,D0!==0&&(ze=R(["arraycolsep"],[]),ze.style.width=O(D0),Ue.push(ze))}var rr=[];for(a=0;a<i;++a){var U0=h[a],at=U0.cells[n];if(at){var ar=U0.pos-ie;at.depth=U0.depth,at.height=U0.height,rr.push({type:"elem",elem:at,shift:ar})}}var ue=re({positionType:"individualShift",children:rr}),At=R(["col-align-"+(((E0=We)==null?void 0:E0.align)||"c")],[ue]);if(Ue.push(At),n<u-1||e.hskipBeforeAndAfter){var oe,nt;D0=(oe=(nt=We)==null?void 0:nt.postgap)!=null?oe:k,D0!==0&&(ze=R(["arraycolsep"],[]),ze.style.width=O(D0),Ue.push(ze))}}}var Ce=R(["mtable"],Ue);if(d.length>0){for(var G0=wt("katex-hline",t,f),nr=wt("katex-hdashline",t,f),Je=[{type:"elem",elem:Ce,shift:0}];d.length>0;){var zt=d.pop(),it=zt.pos-ie;zt.isDashed?Je.push({type:"elem",elem:nr,shift:it}):Je.push({type:"elem",elem:G0,shift:it})}Ce=re({positionType:"individualShift",children:Je})}if(Ge.length===0)return R(["mord"],[Ce],t);var ir=re({positionType:"individualShift",children:Ge}),Mt=R(["katex-tag"],[ir],t);return z0([Ce,Mt])},s4={c:"center ",l:"left ",r:"right "},b0=function(e,t){for(var a=[],n=new I("mtd",[],["mtr-glue"]),i=new I("mtd",[],["mml-eqn-num"]),l=0;l<e.body.length;l++){for(var u=e.body[l],h=[],d=0;d<u.length;d++)h.push(new I("mtd",[se(u[d],t)]));e.tags&&e.tags[l]&&(h.unshift(n),h.push(n),e.leqno?h.unshift(i):h.push(i)),a.push(new I("mtr",h))}var f=new I("mtable",a),b=e.arraystretch===.5?.1:.16+e.arraystretch-1+(e.addJot?.09:0);f.setAttribute("rowspacing",O(b));var k="",w="";if(e.cols&&e.cols.length>0){var M=e.cols,D="",E=!1,N=0,B=M.length;M[0].type==="separator"&&(k+="top ",N=1),M[M.length-1].type==="separator"&&(k+="bottom ",B-=1);for(var F=N;F<B;F++){var H=M[F];H.type==="align"?(w+=s4[H.align],E&&(D+="none "),E=!0):H.type==="separator"&&E&&(D+=H.separator==="|"?"solid ":"dashed ",E=!1)}f.setAttribute("columnalign",w.trim()),/[sd]/.test(D)&&f.setAttribute("columnlines",D.trim())}if(e.colSeparationType==="align"){for(var V=e.cols||[],j="",$=1;$<V.length;$++)j+=$%2?"0em ":"1em ";f.setAttribute("columnspacing",j.trim())}else e.colSeparationType==="alignat"||e.colSeparationType==="gather"?f.setAttribute("columnspacing","0em"):e.colSeparationType==="small"?f.setAttribute("columnspacing","0.2778em"):e.colSeparationType==="CD"?f.setAttribute("columnspacing","0.5em"):f.setAttribute("columnspacing","1em");var X="",ee=e.hLinesBeforeRow;k+=ee[0].length>0?"left ":"",k+=ee[ee.length-1].length>0?"right ":"";for(var ae=1;ae<ee.length-1;ae++)X+=ee[ae].length===0?"none ":ee[ae][0]?"dashed ":"solid ";return/[sd]/.test(X)&&f.setAttribute("rowlines",X.trim()),k!==""&&(f=new I("menclose",[f]),f.setAttribute("notation",k.trim())),e.arraystretch&&e.arraystretch<1&&(f=new I("mstyle",[f]),f.setAttribute("scriptlevel","1")),f},tl=function(e,t){e.envName.includes("ed")||Vr(e);var a=[],n=e.envName==="split",i=$0(e.parser,{cols:a,addJot:!0,autoTag:n?void 0:zn(e.envName),emptySingleRow:!0,colSeparationType:e.envName.includes("at")?"alignat":"align",maxNumCols:n?2:void 0,leqno:e.parser.settings.leqno},"display"),l=0,u=0,h={type:"ordgroup",mode:e.mode,body:[]};if(t[0]&&t[0].type==="ordgroup"){var d="Number of columns should be a positive integer",f=Tn(t[0],d);if(!/^[0-9]+$/.test(f)||Number(f)<1)throw new C(d,t[0]);l=Number(f),u=l*2}var b=!u;i.body.forEach(function(D){for(var E=1;E<D.length;E+=2){var N=K(D[E],"styling"),B=K(N.body[0],"ordgroup");B.body.unshift(h)}if(b)u<D.length&&(u=D.length);else{var F=D.length/2;if(l<F)throw new C("Too many math in a row: "+("expected "+l+", but got "+F),D[0])}});for(var k=0;k<u;++k){var w="r",M=0;k%2===1?w="l":k>0&&b&&(M=1),a[k]={type:"align",align:w,pregap:M,postgap:0}}return i.colSeparationType=b?"align":"alignat",i};v0({type:"array",names:["array","darray"],props:{numArgs:1},handler(r,e){var t=Gr(e[0]),a=t?[e[0]]:K(e[0],"ordgroup").body,n=a.map(function(l){var u=Ur(l),h=u.text;if("lcr".includes(h))return{type:"align",align:h};if(h==="|")return{type:"separator",separator:"|"};if(h===":")return{type:"separator",separator:":"};throw new C("Unknown column alignment: "+h,l)}),i={cols:n,hskipBeforeAndAfter:!0,maxNumCols:n.length};return $0(r.parser,i,Mn(r.envName))},htmlBuilder:g0,mathmlBuilder:b0});v0({type:"array",names:["matrix","pmatrix","bmatrix","Bmatrix","vmatrix","Vmatrix","matrix*","pmatrix*","bmatrix*","Bmatrix*","vmatrix*","Vmatrix*"],props:{numArgs:0},handler(r){var e={matrix:null,pmatrix:["(",")"],bmatrix:["[","]"],Bmatrix:["\\{","\\}"],vmatrix:["|","|"],Vmatrix:["\\Vert","\\Vert"]}[r.envName.replace("*","")],t="c",a={hskipBeforeAndAfter:!1,cols:[{type:"align",align:t}]};if(r.envName.charAt(r.envName.length-1)==="*"){var n=r.parser;if(n.consumeSpaces(),n.fetch().text==="["){if(n.consume(),n.consumeSpaces(),t=n.fetch().text,!"lcr".includes(t))throw new C("Expected l or c or r",n.nextToken);n.consume(),n.consumeSpaces(),n.expect("]"),n.consume(),a.cols=[{type:"align",align:t}]}}var i=$0(r.parser,a,Mn(r.envName)),l=Math.max(0,...i.body.map(u=>u.length));return i.cols=new Array(l).fill({type:"align",align:t}),e?{type:"leftright",mode:r.mode,body:[i],left:e[0],right:e[1],rightColor:void 0}:i},htmlBuilder:g0,mathmlBuilder:b0});v0({type:"array",names:["smallmatrix"],props:{numArgs:0},handler(r){var e={arraystretch:.5},t=$0(r.parser,e,"script");return t.colSeparationType="small",t},htmlBuilder:g0,mathmlBuilder:b0});v0({type:"array",names:["subarray"],props:{numArgs:1},handler(r,e){var t=Gr(e[0]),a=t?[e[0]]:K(e[0],"ordgroup").body,n=a.map(function(u){var h=Ur(u),d=h.text;if("lc".includes(d))return{type:"align",align:d};throw new C("Unknown column alignment: "+d,u)});if(n.length>1)throw new C("{subarray} can contain only one column");var i={cols:n,hskipBeforeAndAfter:!1,arraystretch:.5},l=$0(r.parser,i,"script");if(l.body.length>0&&l.body[0].length>1)throw new C("{subarray} can contain only one column");return l},htmlBuilder:g0,mathmlBuilder:b0});v0({type:"array",names:["cases","dcases","rcases","drcases"],props:{numArgs:0},handler(r){var e={arraystretch:1.2,cols:[{type:"align",align:"l",pregap:0,postgap:1},{type:"align",align:"l",pregap:0,postgap:0}]},t=$0(r.parser,e,Mn(r.envName));return{type:"leftright",mode:r.mode,body:[t],left:r.envName.includes("r")?".":"\\{",right:r.envName.includes("r")?"\\}":".",rightColor:void 0}},htmlBuilder:g0,mathmlBuilder:b0});v0({type:"array",names:["align","align*","aligned","split"],props:{numArgs:0},handler:tl,htmlBuilder:g0,mathmlBuilder:b0});v0({type:"array",names:["gathered","gather","gather*"],props:{numArgs:0},handler(r){i4.has(r.envName)&&Vr(r);var e={cols:[{type:"align",align:"c"}],addJot:!0,colSeparationType:"gather",autoTag:zn(r.envName),emptySingleRow:!0,leqno:r.parser.settings.leqno};return $0(r.parser,e,"display")},htmlBuilder:g0,mathmlBuilder:b0});v0({type:"array",names:["alignat","alignat*","alignedat"],props:{numArgs:1},handler:tl,htmlBuilder:g0,mathmlBuilder:b0});v0({type:"array",names:["equation","equation*"],props:{numArgs:0},handler(r){Vr(r);var e={autoTag:zn(r.envName),emptySingleRow:!0,singleRow:!0,maxNumCols:1,leqno:r.parser.settings.leqno};return $0(r.parser,e,"display")},htmlBuilder:g0,mathmlBuilder:b0});v0({type:"array",names:["CD"],props:{numArgs:0},handler(r){return Vr(r),Uu(r.parser)},htmlBuilder:g0,mathmlBuilder:b0});m("\\nonumber","\\gdef\\@eqnsw{0}");m("\\notag","\\nonumber");L({type:"text",names:["\\hline","\\hdashline"],numArgs:0,allowedInText:!0,allowedInMath:!0,handler(r,e){throw new C(r.funcName+" valid only within array environment")}});var us=Js;L({type:"environment",names:["\\begin","\\end"],numArgs:1,argTypes:["text"],handler(r,e){var t=r.parser,a=r.funcName,n=e[0];if(n.type!=="ordgroup")throw new C("Invalid environment name",n);var i=Tn(n,"Environment name should contain only text characters and spaces",!0);if(a==="\\begin"){if(!Object.prototype.hasOwnProperty.call(us,i))throw new C("No such environment: "+i,n);var l=us[i],u=t.parseArguments("\\begin{"+i+"}",l),h=u.args,d=u.optArgs,f={mode:t.mode,envName:i,parser:t},b=l.handler(f,h,d);t.expect("\\end",!1);var k=t.nextToken,w=K(t.parseFunction(),"environment");if(w.name!==i)throw new C("Mismatch: \\begin{"+i+"} matched by \\end{"+w.name+"}",k);return b}return{type:"environment",mode:t.mode,name:i,nameGroup:n}}});var l4=(r,e)=>{var t=r.font,a=e.withFont(t);return te(r.body,a)},o4=(r,e)=>{var t=r.font,a=e.withFont(t);return se(r.body,a)},cs={"\\Bbb":"\\mathbb","\\bold":"\\mathbf","\\frak":"\\mathfrak"};L({type:"font",names:["\\mathrm","\\mathit","\\mathbf","\\mathnormal","\\mathsfit","\\mathbb","\\mathcal","\\mathfrak","\\mathscr","\\mathsf","\\mathtt","\\Bbb","\\bold","\\frak"],numArgs:1,allowedInArgument:!0,handler:(r,e)=>{var t=r.parser,a=r.funcName,n=Xt(e[0]),i=a in cs?cs[a]:a;return{type:"font",mode:t.mode,font:i.slice(1),body:n}},htmlBuilder:l4,mathmlBuilder:o4});L({type:"mclass",names:["\\boldsymbol","\\bm"],numArgs:1,handler:(r,e)=>{var t=r.parser,a=e[0];return{type:"mclass",mode:t.mode,mclass:jr(a),body:[{type:"font",mode:t.mode,font:"boldsymbol",body:a}],isCharacterBox:T0(a)}}});L({type:"font",names:["\\rm","\\sf","\\tt","\\bf","\\it","\\cal"],numArgs:0,allowedInText:!0,handler:(r,e)=>{var t=r.parser,a=r.funcName,n=r.breakOnTokenText,i=t.mode,l=t.parseExpression(!0,n);return{type:"font",mode:i,font:"math"+a.slice(1),body:{type:"ordgroup",mode:t.mode,body:l}}}});var u4=(r,e)=>{var t=e.style,a=t.fracNum(),n=t.fracDen(),i;i=e.havingStyle(a);var l=te(r.numer,i,e);if(r.continued){var u=8.5/e.fontMetrics().ptPerEm,h=3.5/e.fontMetrics().ptPerEm;l.height=l.height<u?u:l.height,l.depth=l.depth<h?h:l.depth}i=e.havingStyle(n);var d=te(r.denom,i,e),f,b,k;r.hasBarLine?(r.barSize?(b=fe(r.barSize,e),f=wt("frac-line",e,b)):f=wt("frac-line",e),b=f.height,k=f.height):(f=null,b=0,k=e.fontMetrics().defaultRuleThickness);var w,M,D;t.size===W.DISPLAY.size?(w=e.fontMetrics().num1,b>0?M=3*k:M=7*k,D=e.fontMetrics().denom1):(b>0?(w=e.fontMetrics().num2,M=k):(w=e.fontMetrics().num3,M=3*k),D=e.fontMetrics().denom2);var E;if(f){var B=e.fontMetrics().axisHeight;w-l.depth-(B+.5*b)<M&&(w+=M-(w-l.depth-(B+.5*b))),B-.5*b-(d.height-D)<M&&(D+=M-(B-.5*b-(d.height-D)));var F=-(B-.5*b);E=re({positionType:"individualShift",children:[{type:"elem",elem:d,shift:D},{type:"elem",elem:f,shift:F},{type:"elem",elem:l,shift:-w}]})}else{var N=w-l.depth-(d.height-D);N<M&&(w+=.5*(M-N),D+=.5*(M-N)),E=re({positionType:"individualShift",children:[{type:"elem",elem:d,shift:D},{type:"elem",elem:l,shift:-w}]})}i=e.havingStyle(t),E.height*=i.sizeMultiplier/e.sizeMultiplier,E.depth*=i.sizeMultiplier/e.sizeMultiplier;var H;t.size===W.DISPLAY.size?H=e.fontMetrics().delim1:t.size===W.SCRIPTSCRIPT.size?H=e.havingStyle(W.SCRIPT).fontMetrics().delim2:H=e.fontMetrics().delim2;var V,j;return r.leftDelim==null?V=Zt(e,["mopen"]):V=mn(r.leftDelim,H,!0,e.havingStyle(t),r.mode,["mopen"]),r.continued?j=R([]):r.rightDelim==null?j=Zt(e,["mclose"]):j=mn(r.rightDelim,H,!0,e.havingStyle(t),r.mode,["mclose"]),R(["mord"].concat(i.sizingClasses(e)),[V,R(["mfrac"],[E]),j],e)},c4=(r,e)=>{var t=new I("mfrac",[se(r.numer,e),se(r.denom,e)]);if(!r.hasBarLine)t.setAttribute("linethickness","0px");else if(r.barSize){var a=fe(r.barSize,e);t.setAttribute("linethickness",O(a))}if(r.leftDelim!=null||r.rightDelim!=null){var n=[];if(r.leftDelim!=null){var i=new I("mo",[new ve(r.leftDelim.replace("\\",""))]);i.setAttribute("fence","true"),n.push(i)}if(n.push(t),r.rightDelim!=null){var l=new I("mo",[new ve(r.rightDelim.replace("\\",""))]);l.setAttribute("fence","true"),n.push(l)}return kn(n)}return t},rl=(r,e)=>{if(!e)return r;var t={type:"styling",mode:r.mode,style:e,body:[r]};return t};L({type:"genfrac",names:["\\cfrac","\\dfrac","\\frac","\\tfrac","\\dbinom","\\binom","\\tbinom","\\\\atopfrac","\\\\bracefrac","\\\\brackfrac"],numArgs:2,allowedInArgument:!0,handler:(r,e)=>{var t=r.parser,a=r.funcName,n=e[0],i=e[1],l,u=null,h=null;switch(a){case"\\cfrac":case"\\dfrac":case"\\frac":case"\\tfrac":l=!0;break;case"\\\\atopfrac":l=!1;break;case"\\dbinom":case"\\binom":case"\\tbinom":l=!1,u="(",h=")";break;case"\\\\bracefrac":l=!1,u="\\{",h="\\}";break;case"\\\\brackfrac":l=!1,u="[",h="]";break;default:throw new Error("Unrecognized genfrac command")}var d=a==="\\cfrac",f=null;return d||a.startsWith("\\d")?f="display":a.startsWith("\\t")&&(f="text"),rl({type:"genfrac",mode:t.mode,numer:n,denom:i,continued:d,hasBarLine:l,leftDelim:u,rightDelim:h,barSize:null},f)},htmlBuilder:u4,mathmlBuilder:c4});L({type:"infix",names:["\\over","\\choose","\\atop","\\brace","\\brack"],numArgs:0,infix:!0,handler(r){var e=r.parser,t=r.funcName,a=r.token,n;switch(t){case"\\over":n="\\frac";break;case"\\choose":n="\\binom";break;case"\\atop":n="\\\\atopfrac";break;case"\\brace":n="\\\\bracefrac";break;case"\\brack":n="\\\\brackfrac";break;default:throw new Error("Unrecognized infix genfrac command")}return{type:"infix",mode:e.mode,replaceWith:n,token:a}}});var hs=["display","text","script","scriptscript"],ms=function(e){var t=null;return e.length>0&&(t=e,t=t==="."?null:t),t};L({type:"genfrac",names:["\\genfrac"],numArgs:6,allowedInArgument:!0,argTypes:["math","math","size","text","math","math"],handler(r,e){var t=r.parser,a=e[4],n=e[5],i=Xt(e[0]),l=i.type==="atom"&&i.family==="open"?ms(i.text):null,u=Xt(e[1]),h=u.type==="atom"&&u.family==="close"?ms(u.text):null,d=K(e[2],"size"),f,b=null;d.isBlank?f=!0:(b=d.value,f=b.number>0);var k=null,w=e[3];if(w.type==="ordgroup"){if(w.body.length>0){var M=K(w.body[0],"textord");k=hs[Number(M.text)]}}else w=K(w,"textord"),k=hs[Number(w.text)];return rl({type:"genfrac",mode:t.mode,numer:a,denom:n,continued:!1,hasBarLine:f,barSize:b,leftDelim:l,rightDelim:h},k)}});L({type:"infix",names:["\\above"],numArgs:1,argTypes:["size"],infix:!0,handler(r,e){var t=r.parser;r.funcName;var a=r.token;return{type:"infix",mode:t.mode,replaceWith:"\\\\abovefrac",size:K(e[0],"size").value,token:a}}});L({type:"genfrac",names:["\\\\abovefrac"],numArgs:3,argTypes:["math","size","math"],handler:(r,e)=>{var t=r.parser;r.funcName;var a=e[0],n=K(e[1],"infix").size;if(!n)throw new Error("\\\\abovefrac expected size, but got "+String(n));var i=e[2],l=n.number>0;return{type:"genfrac",mode:t.mode,numer:a,denom:i,continued:!1,hasBarLine:l,barSize:n,leftDelim:null,rightDelim:null}}});var al=(r,e)=>{var t=e.style,a,n;r.type==="supsub"?(a=r.sup?te(r.sup,e.havingStyle(t.sup()),e):te(r.sub,e.havingStyle(t.sub()),e),n=K(r.base,"horizBrace")):n=K(r,"horizBrace");var i=te(n.base,e.havingBaseStyle(W.DISPLAY)),l=$r(n,e),u;if(n.isOver?u=re({positionType:"firstBaseline",children:[{type:"elem",elem:i},{type:"kern",size:.1},{type:"elem",elem:l,wrapperClasses:["svg-align"]}]}):u=re({positionType:"bottom",positionData:i.depth+.1+l.height,children:[{type:"elem",elem:l,wrapperClasses:["svg-align"]},{type:"kern",size:.1},{type:"elem",elem:i}]}),a){var h=R(["minner",n.isOver?"mover":"munder"],[u],e);n.isOver?u=re({positionType:"firstBaseline",children:[{type:"elem",elem:h},{type:"kern",size:.2},{type:"elem",elem:a}]}):u=re({positionType:"bottom",positionData:h.depth+.2+a.height+a.depth,children:[{type:"elem",elem:a},{type:"kern",size:.2},{type:"elem",elem:h}]})}return R(["minner",n.isOver?"mover":"munder"],[u],e)},h4=(r,e)=>{var t=Hr(r.label);return new I(r.isOver?"mover":"munder",[se(r.base,e),t])};L({type:"horizBrace",names:["\\overbrace","\\underbrace","\\overbracket","\\underbracket"],numArgs:1,handler(r,e){var t=r.parser,a=r.funcName;return{type:"horizBrace",mode:t.mode,label:a,isOver:a.includes("\\over"),base:e[0]}},htmlBuilder:al,mathmlBuilder:h4});L({type:"href",names:["\\href"],numArgs:2,argTypes:["url","original"],allowedInText:!0,handler:(r,e)=>{var t=r.parser,a=e[1],n=K(e[0],"url").url;return t.settings.isTrusted({command:"\\href",url:n})?{type:"href",mode:t.mode,href:n,body:ye(a)}:t.formatUnsupportedCmd("\\href")},htmlBuilder:(r,e)=>{var t=Se(r.body,e,!1);return du(r.href,[],t,e)},mathmlBuilder:(r,e)=>{var t=H0(r.body,e);return t instanceof I||(t=new I("mrow",[t])),t.setAttribute("href",r.href),t}});L({type:"href",names:["\\url"],numArgs:1,argTypes:["url"],allowedInText:!0,handler:(r,e)=>{var t=r.parser,a=K(e[0],"url").url;if(!t.settings.isTrusted({command:"\\url",url:a}))return t.formatUnsupportedCmd("\\url");for(var n=[],i=0;i<a.length;i++){var l=a[i];l==="~"&&(l="\\textasciitilde"),n.push({type:"textord",mode:"text",text:l})}var u={type:"text",mode:t.mode,font:"\\texttt",body:n};return{type:"href",mode:t.mode,href:a,body:ye(u)}}});L({type:"hbox",names:["\\hbox"],numArgs:1,argTypes:["text"],allowedInText:!0,primitive:!0,handler(r,e){var t=r.parser;return{type:"hbox",mode:t.mode,body:ye(e[0])}},htmlBuilder(r,e){var t=Se(r.body,e.withFont(""),!1);return z0(t)},mathmlBuilder(r,e){return new I("mrow",Ke(r.body,e.withFont("")))}});L({type:"html",names:["\\htmlClass","\\htmlId","\\htmlStyle","\\htmlData"],numArgs:2,argTypes:["raw","original"],allowedInText:!0,handler:(r,e)=>{var t=r.parser,a=r.funcName;r.token;var n=K(e[0],"raw").string,i=e[1];t.settings.strict&&t.settings.reportNonstrict("htmlExtension","HTML extension is disabled on strict mode");var l,u={};switch(a){case"\\htmlClass":u.class=n,l={command:"\\htmlClass",class:n};break;case"\\htmlId":u.id=n,l={command:"\\htmlId",id:n};break;case"\\htmlStyle":u.style=n,l={command:"\\htmlStyle",style:n};break;case"\\htmlData":{for(var h="{,}",d=[],f="",b=0;b<n.length;b++)n.startsWith(h,b)?(f+=",",b+=h.length-1):n[b]===","?(d.push(f),f=""):f+=n[b];d.push(f);for(var k=0;k<d.length;k++){var w=d[k],M=w.indexOf("=");if(M<0)throw new C("\\htmlData key/value '"+w+"' missing equals sign");var D=w.slice(0,M),E=w.slice(M+1);u["data-"+D.trim()]=E}l={command:"\\htmlData",attributes:u};break}default:throw new Error("Unrecognized html command")}return t.settings.isTrusted(l)?{type:"html",mode:t.mode,attributes:u,body:ye(i)}:t.formatUnsupportedCmd(a)},htmlBuilder:(r,e)=>{var t=Se(r.body,e,!1),a=["enclosing"];r.attributes.class&&a.push(...r.attributes.class.trim().split(/\s+/));var n=R(a,t,e);for(var i of Object.entries(r.attributes)){var l=i[0],u=i[1];l!=="class"&&n.setAttribute(l,u)}return n},mathmlBuilder:(r,e)=>H0(r.body,e)});L({type:"htmlmathml",names:["\\html@mathml"],numArgs:2,allowedInArgument:!0,allowedInText:!0,handler:(r,e)=>{var t=r.parser;return{type:"htmlmathml",mode:t.mode,html:ye(e[0]),mathml:ye(e[1])}},htmlBuilder:(r,e)=>{var t=Se(r.html,e,!1);return z0(t)},mathmlBuilder:(r,e)=>H0(r.mathml,e)});var Va=function(e){if(/^[-+]? *(\d+(\.\d*)?|\.\d+)$/.test(e))return{number:+e,unit:"bp"};var t=/([-+]?) *(\d+(?:\.\d*)?|\.\d+) *([a-z]{2})/.exec(e);if(!t)throw new C("Invalid size: '"+e+"' in \\includegraphics");var a={number:+(t[1]+t[2]),unit:t[3]};if(!Ms(a))throw new C("Invalid unit: '"+a.unit+"' in \\includegraphics.");return a};L({type:"includegraphics",names:["\\includegraphics"],numArgs:1,numOptionalArgs:1,argTypes:["raw","url"],allowedInText:!1,handler:(r,e,t)=>{var a=r.parser,n={number:0,unit:"em"},i={number:.9,unit:"em"},l={number:0,unit:"em"},u="";if(t[0])for(var h=K(t[0],"raw").string,d=h.split(","),f=0;f<d.length;f++){var b=d[f].split("=");if(b.length===2){var k=b[1].trim();switch(b[0].trim()){case"alt":u=k;break;case"width":n=Va(k);break;case"height":i=Va(k);break;case"totalheight":l=Va(k);break;default:throw new C("Invalid key: '"+b[0]+"' in \\includegraphics.")}}}var w=K(e[0],"url").url;return u===""&&(u=w,u=u.replace(/^.*[\\/]/,""),u=u.substring(0,u.lastIndexOf("."))),a.settings.isTrusted({command:"\\includegraphics",url:w})?{type:"includegraphics",mode:a.mode,alt:u,width:n,height:i,totalheight:l,src:w}:a.formatUnsupportedCmd("\\includegraphics")},htmlBuilder:(r,e)=>{var t=fe(r.height,e),a=0;r.totalheight.number>0&&(a=fe(r.totalheight,e)-t);var n=0;r.width.number>0&&(n=fe(r.width,e));var i={height:O(t+a)};n>0&&(i.width=O(n)),a>0&&(i.verticalAlign=O(-a));var l=new Qa(r.src,r.alt,i);return l.height=t,l.depth=a,l},mathmlBuilder:(r,e)=>{var t=new I("mglyph",[]);t.setAttribute("alt",r.alt);var a=fe(r.height,e),n=0;if(r.totalheight.number>0&&(n=fe(r.totalheight,e)-a,t.setAttribute("valign",O(-n))),t.setAttribute("height",O(a+n)),r.width.number>0){var i=fe(r.width,e);t.setAttribute("width",O(i))}return t.setAttribute("src",r.src),t}});L({type:"kern",names:["\\kern","\\mkern","\\hskip","\\mskip"],numArgs:1,argTypes:["size"],primitive:!0,allowedInText:!0,handler(r,e){var t=r.parser,a=r.funcName,n=K(e[0],"size");if(t.settings.strict){var i=a[1]==="m",l=n.value.unit==="mu";i?(l||t.settings.reportNonstrict("mathVsTextUnits","LaTeX's "+a+" supports only mu units, "+("not "+n.value.unit+" units")),t.mode!=="math"&&t.settings.reportNonstrict("mathVsTextUnits","LaTeX's "+a+" works only in math mode")):l&&t.settings.reportNonstrict("mathVsTextUnits","LaTeX's "+a+" doesn't support mu units")}return{type:"kern",mode:t.mode,dimension:n.value}},htmlBuilder(r,e){return Os(r.dimension,e)},mathmlBuilder(r,e){var t=fe(r.dimension,e);return new Nr(t)}});L({type:"lap",names:["\\mathllap","\\mathrlap","\\mathclap"],numArgs:1,allowedInText:!0,handler:(r,e)=>{var t=r.parser,a=r.funcName,n=e[0];return{type:"lap",mode:t.mode,alignment:a.slice(5),body:n}},htmlBuilder:(r,e)=>{var t;r.alignment==="clap"?(t=R([],[te(r.body,e)]),t=R(["katex-inner"],[t],e)):t=R(["katex-inner"],[te(r.body,e)]);var a=R(["katex-fix"],[]),n=R([r.alignment],[t,a],e),i=R(["katex-strut"]);return i.style.height=O(n.height+n.depth),n.depth&&(i.style.verticalAlign=O(-n.depth)),n.children.unshift(i),n=R(["katex-thinbox"],[n],e),R(["mord","katex-vbox"],[n],e)},mathmlBuilder:(r,e)=>{var t=new I("mpadded",[se(r.body,e)]);if(r.alignment!=="rlap"){var a=r.alignment==="llap"?"-1":"-0.5";t.setAttribute("lspace",a+"width")}return t.setAttribute("width","0px"),t}});L({type:"styling",names:["\\(","$"],numArgs:0,allowedInText:!0,allowedInMath:!1,handler(r,e){var t=r.funcName,a=r.parser,n=a.mode;a.switchMode("math");var i=t==="\\("?"\\)":"$",l=a.parseExpression(!1,i);return a.expect(i),a.switchMode(n),{type:"styling",mode:a.mode,style:"text",resetFont:!0,body:l}}});L({type:"text",names:["\\)","\\]"],numArgs:0,allowedInText:!0,allowedInMath:!1,handler(r,e){throw new C("Mismatched "+r.funcName)}});var ds=(r,e)=>{switch(e.style.size){case W.DISPLAY.size:return r.display;case W.TEXT.size:return r.text;case W.SCRIPT.size:return r.script;case W.SCRIPTSCRIPT.size:return r.scriptscript;default:return r.text}};L({type:"mathchoice",names:["\\mathchoice"],numArgs:4,primitive:!0,handler:(r,e)=>{var t=r.parser;return{type:"mathchoice",mode:t.mode,display:ye(e[0]),text:ye(e[1]),script:ye(e[2]),scriptscript:ye(e[3])}},htmlBuilder:(r,e)=>{var t=ds(r,e),a=Se(t,e,!1);return z0(a)},mathmlBuilder:(r,e)=>{var t=ds(r,e);return H0(t,e)}});var nl=(r,e,t,a,n,i,l)=>{r=R([],[r]);var u=t&&T0(t),h,d;if(e){var f=te(e,a.havingStyle(n.sup()),a);d={elem:f,kern:Math.max(a.fontMetrics().bigOpSpacing1,a.fontMetrics().bigOpSpacing3-f.depth)}}if(t){var b=te(t,a.havingStyle(n.sub()),a);h={elem:b,kern:Math.max(a.fontMetrics().bigOpSpacing2,a.fontMetrics().bigOpSpacing4-b.height)}}var k;if(d&&h){var w=a.fontMetrics().bigOpSpacing5+h.elem.height+h.elem.depth+h.kern+r.depth+l;k=re({positionType:"bottom",positionData:w,children:[{type:"kern",size:a.fontMetrics().bigOpSpacing5},{type:"elem",elem:h.elem,marginLeft:O(-i)},{type:"kern",size:h.kern},{type:"elem",elem:r},{type:"kern",size:d.kern},{type:"elem",elem:d.elem,marginLeft:O(i)},{type:"kern",size:a.fontMetrics().bigOpSpacing5}]})}else if(h){var M=r.height-l;k=re({positionType:"top",positionData:M,children:[{type:"kern",size:a.fontMetrics().bigOpSpacing5},{type:"elem",elem:h.elem,marginLeft:O(-i)},{type:"kern",size:h.kern},{type:"elem",elem:r}]})}else if(d){var D=r.depth+l;k=re({positionType:"bottom",positionData:D,children:[{type:"elem",elem:r},{type:"kern",size:d.kern},{type:"elem",elem:d.elem,marginLeft:O(i)},{type:"kern",size:a.fontMetrics().bigOpSpacing5}]})}else return r;var E=[k];if(h&&i!==0&&!u){var N=R(["mspace"],[],a);N.style.marginRight=O(i),E.unshift(N)}return R(["mop","op-limits"],E,a)},il=new Set(["\\smallint"]),sl=(r,e)=>{var t,a,n=!1,i;r.type==="supsub"?(t=r.sup,a=r.sub,i=K(r.base,"op"),n=!0):i=K(r,"op");var l=e.style,u=!1;l.size===W.DISPLAY.size&&i.symbol&&!il.has(i.name)&&(u=!0);var h,d;if(i.symbol){var f=u?"Size2-Regular":"Size1-Regular",b="";if((i.name==="\\oiint"||i.name==="\\oiiint")&&(b=i.name.slice(1),i.name=b==="oiint"?"\\iint":"\\iiint"),h=Oe(i.name,f,"math",e,["mop","op-symbol",u?"large-op":"small-op"]),d=h.italic,b.length>0){var k=Ns(b+"Size"+(u?"2":"1"),e);h=re({positionType:"individualShift",children:[{type:"elem",elem:h,shift:0},{type:"elem",elem:k,shift:u?.08:0}]}),i.name="\\"+b,h.classes.unshift("mop"),h.italic=d}}else if(i.body){var w=Se(i.body,e,!0);w.length===1&&w[0]instanceof Ne?(h=w[0],h.classes[0]="mop"):h=R(["mop"],w,e)}else{for(var M=[],D=1;D<i.name.length;D++)M.push(xn(i.name[D],i.mode,e));h=R(["mop"],M,e)}var E=0,N=0;if((h instanceof Ne||i.name==="\\oiint"||i.name==="\\oiiint")&&!i.suppressBaseShift){var B;E=(h.height-h.depth)/2-e.fontMetrics().axisHeight,N=(B=h.italic)!=null?B:0}return n?nl(h,t,a,e,l,N,E):(E&&(h.style.position="relative",h.style.top=O(E)),h)},m4=(r,e)=>{var t;if(r.symbol)t=new I("mo",[a0(r.name,r.mode)]),il.has(r.name)&&t.setAttribute("largeop","false");else if(r.body)t=new I("mo",Ke(r.body,e));else{t=new I("mi",[new ve(r.name.slice(1))]);var a=new I("mo",[a0("\u2061","text")]);r.parentIsSupSub?t=new I("mrow",[t,a]):t=Ps([t,a])}return t},d4={"\u220F":"\\prod","\u2210":"\\coprod","\u2211":"\\sum","\u22C0":"\\bigwedge","\u22C1":"\\bigvee","\u22C2":"\\bigcap","\u22C3":"\\bigcup","\u2A00":"\\bigodot","\u2A01":"\\bigoplus","\u2A02":"\\bigotimes","\u2A04":"\\biguplus","\u2A06":"\\bigsqcup"};L({type:"op",names:["\\coprod","\\bigvee","\\bigwedge","\\biguplus","\\bigcap","\\bigcup","\\intop","\\prod","\\sum","\\bigotimes","\\bigoplus","\\bigodot","\\bigsqcup","\\smallint","\u220F","\u2210","\u2211","\u22C0","\u22C1","\u22C2","\u22C3","\u2A00","\u2A01","\u2A02","\u2A04","\u2A06"],numArgs:0,handler:(r,e)=>{var t=r.parser,a=r.funcName,n=a;return n.length===1&&(n=d4[n]),{type:"op",mode:t.mode,limits:!0,parentIsSupSub:!1,symbol:!0,name:n}},htmlBuilder:sl,mathmlBuilder:m4});L({type:"op",names:["\\mathop"],numArgs:1,primitive:!0,handler:(r,e)=>{var t=r.parser,a=e[0];return{type:"op",mode:t.mode,limits:!1,parentIsSupSub:!1,symbol:!1,body:ye(a)}}});var p4={"\u222B":"\\int","\u222C":"\\iint","\u222D":"\\iiint","\u222E":"\\oint","\u222F":"\\oiint","\u2230":"\\oiiint"};L({type:"op",names:["\\arcsin","\\arccos","\\arctan","\\arctg","\\arcctg","\\arg","\\ch","\\cos","\\cosec","\\cosh","\\cot","\\cotg","\\coth","\\csc","\\ctg","\\cth","\\deg","\\dim","\\exp","\\hom","\\ker","\\lg","\\ln","\\log","\\sec","\\sin","\\sinh","\\sh","\\tan","\\tanh","\\tg","\\th"],numArgs:0,handler(r){var e=r.parser,t=r.funcName;return{type:"op",mode:e.mode,limits:!1,parentIsSupSub:!1,symbol:!1,name:t}}});L({type:"op",names:["\\det","\\gcd","\\inf","\\lim","\\max","\\min","\\Pr","\\sup"],numArgs:0,handler(r){var e=r.parser,t=r.funcName;return{type:"op",mode:e.mode,limits:!0,parentIsSupSub:!1,symbol:!1,name:t}}});L({type:"op",names:["\\int","\\iint","\\iiint","\\oint","\\oiint","\\oiiint","\u222B","\u222C","\u222D","\u222E","\u222F","\u2230"],numArgs:0,allowedInArgument:!0,handler(r){var e=r.parser,t=r.funcName,a=t;return a.length===1&&(a=p4[a]),{type:"op",mode:e.mode,limits:!1,parentIsSupSub:!1,symbol:!0,name:a}}});var ll=(r,e)=>{var t,a,n=!1,i;r.type==="supsub"?(t=r.sup,a=r.sub,i=K(r.base,"operatorname"),n=!0):i=K(r,"operatorname");var l;if(i.body.length>0){for(var u=i.body.map(b=>{var k="text"in b?b.text:void 0;return typeof k=="string"?{type:"textord",mode:b.mode,text:k}:b}),h=Se(u,e.withFont("mathrm"),!0),d=0;d<h.length;d++){var f=h[d];f instanceof Ne&&(f.text=f.text.replace(/\u2212/,"-").replace(/\u2217/,"*"))}l=R(["mop"],h,e)}else l=R(["mop"],[],e);return n?nl(l,t,a,e,e.style,0,0):l},f4=(r,e)=>{for(var t=Ke(r.body,e.withFont("mathrm")),a=!0,n=0;n<t.length;n++){var i=t[n];if(!(i instanceof Nr))if(i instanceof I)switch(i.type){case"mi":case"mn":case"mspace":case"mtext":break;case"mo":{var l=i.children[0];i.children.length===1&&l instanceof ve?l.text=l.text.replace(/\u2212/,"-").replace(/\u2217/,"*"):a=!1;break}default:a=!1}else a=!1}if(a){var u=t.map(f=>f.toText()).join("");t=[new ve(u)]}var h=new I("mi",t);h.setAttribute("mathvariant","normal");var d=new I("mo",[a0("\u2061","text")]);return r.parentIsSupSub?new I("mrow",[h,d]):Ps([h,d])};L({type:"operatorname",names:["\\operatorname@","\\operatornamewithlimits"],numArgs:1,handler:(r,e)=>{var t=r.parser,a=r.funcName,n=e[0];return{type:"operatorname",mode:t.mode,body:ye(n),alwaysHandleSupSub:a==="\\operatornamewithlimits",limits:!1,parentIsSupSub:!1}},htmlBuilder:ll,mathmlBuilder:f4});m("\\operatorname","\\@ifstar\\operatornamewithlimits\\operatorname@");tt({type:"ordgroup",htmlBuilder(r,e){return r.semisimple?z0(Se(r.body,e,!1)):R(["mord"],Se(r.body,e,!0),e)},mathmlBuilder(r,e){return H0(r.body,e,!0)}});L({type:"overline",names:["\\overline"],numArgs:1,handler(r,e){var t=r.parser,a=e[0];return{type:"overline",mode:t.mode,body:a}},htmlBuilder(r,e){var t=te(r.body,e.havingCrampedStyle()),a=wt("overline-line",e),n=e.fontMetrics().defaultRuleThickness,i=re({positionType:"firstBaseline",children:[{type:"elem",elem:t},{type:"kern",size:3*n},{type:"elem",elem:a},{type:"kern",size:n}]});return R(["mord","katex-overline"],[i],e)},mathmlBuilder(r,e){var t=new I("mo",[new ve("\u203E")]);t.setAttribute("stretchy","true");var a=new I("mover",[se(r.body,e),t]);return a.setAttribute("accent","true"),a}});L({type:"phantom",names:["\\phantom"],numArgs:1,allowedInText:!0,handler:(r,e)=>{var t=r.parser,a=e[0];return{type:"phantom",mode:t.mode,body:ye(a)}},htmlBuilder:(r,e)=>{var t=Se(r.body,e.withPhantom(),!1);return z0(t)},mathmlBuilder:(r,e)=>{var t=Ke(r.body,e);return new I("mphantom",t)}});m("\\hphantom","\\smash{\\phantom{#1}}");L({type:"vphantom",names:["\\vphantom"],numArgs:1,allowedInText:!0,handler:(r,e)=>{var t=r.parser,a=e[0];return{type:"vphantom",mode:t.mode,body:a}},htmlBuilder:(r,e)=>{var t=R(["katex-inner"],[te(r.body,e.withPhantom())]),a=R(["katex-fix"],[]);return R(["mord","rlap"],[t,a],e)},mathmlBuilder:(r,e)=>{var t=Ke(ye(r.body),e),a=new I("mphantom",t),n=new I("mpadded",[a]);return n.setAttribute("width","0px"),n}});L({type:"raisebox",names:["\\raisebox"],numArgs:2,argTypes:["size","hbox"],allowedInText:!0,handler(r,e){var t=r.parser,a=K(e[0],"size").value,n=e[1];return{type:"raisebox",mode:t.mode,dy:a,body:n}},htmlBuilder(r,e){var t=te(r.body,e),a=fe(r.dy,e);return re({positionType:"shift",positionData:-a,children:[{type:"elem",elem:t}]})},mathmlBuilder(r,e){var t=new I("mpadded",[se(r.body,e)]),a=r.dy.number+r.dy.unit;return t.setAttribute("voffset",a),t}});var ol=(r,e)=>{var t=r.parser;return{type:"reflectbox",mode:t.mode,body:e[0]}};L({type:"reflectbox",names:["\\reflectbox"],numArgs:1,argTypes:["hbox"],allowedInText:!0,handler:ol,htmlBuilder(r,e){return R(["mord","reflectbox"],[te(r.body,e)],e)},mathmlBuilder(r,e){return se(r.body,e)}});L({type:"reflectbox",names:["\\mathreflectbox"],numArgs:1,argTypes:["math"],handler:ol});L({type:"internal",names:["\\relax"],numArgs:0,allowedInText:!0,allowedInArgument:!0,handler(r){var e=r.parser;return{type:"internal",mode:e.mode}}});L({type:"rule",names:["\\rule"],numArgs:2,numOptionalArgs:1,allowedInText:!0,allowedInMath:!0,argTypes:["size","size","size"],handler(r,e,t){var a=r.parser,n=t[0],i=K(e[0],"size"),l=K(e[1],"size");return{type:"rule",mode:a.mode,shift:n&&K(n,"size").value,width:i.value,height:l.value}},htmlBuilder(r,e){var t=R(["mord","katex-rule"],[],e),a=fe(r.width,e),n=fe(r.height,e),i=r.shift?fe(r.shift,e):0;return t.style.borderRightWidth=O(a),t.style.borderTopWidth=O(n),t.style.bottom=O(i),t.width=a,t.height=n+i,t.depth=-i,t.maxFontSize=n*1.125*e.sizeMultiplier,t},mathmlBuilder(r,e){var t=fe(r.width,e),a=fe(r.height,e),n=r.shift?fe(r.shift,e):0,i=e.color&&e.getColor()||"black",l=new I("mspace");l.setAttribute("mathbackground",i),l.setAttribute("width",O(t)),l.setAttribute("height",O(a));var u=new I("mpadded",[l]);return n>=0?u.setAttribute("height",O(n)):(u.setAttribute("height",O(n)),u.setAttribute("depth",O(-n))),u.setAttribute("voffset",O(n)),u}});function ul(r,e,t){for(var a=Se(r,e,!1),n=e.sizeMultiplier/t.sizeMultiplier,i=0;i<a.length;i++){var l=a[i].classes.indexOf("katex-sizing");l<0?Array.prototype.push.apply(a[i].classes,e.sizingClasses(t)):a[i].classes[l+1]==="reset-size"+e.size&&(a[i].classes[l+1]="reset-size"+t.size),a[i].height*=n,a[i].depth*=n}return z0(a)}var ps=["\\tiny","\\sixptsize","\\scriptsize","\\footnotesize","\\small","\\normalsize","\\large","\\Large","\\LARGE","\\huge","\\Huge"],v4=(r,e)=>{var t=e.havingSize(r.size);return ul(r.body,t,e)};L({type:"sizing",names:ps,numArgs:0,allowedInText:!0,handler:(r,e)=>{var t=r.breakOnTokenText,a=r.funcName,n=r.parser,i=n.parseExpression(!1,t);return{type:"sizing",mode:n.mode,size:ps.indexOf(a)+1,body:i}},htmlBuilder:v4,mathmlBuilder:(r,e)=>{var t=e.havingSize(r.size),a=Ke(r.body,t),n=new I("mstyle",a);return n.setAttribute("mathsize",O(t.sizeMultiplier)),n}});L({type:"smash",names:["\\smash"],numArgs:1,numOptionalArgs:1,allowedInText:!0,handler:(r,e,t)=>{var a=r.parser,n=!1,i=!1,l=t[0]&&K(t[0],"ordgroup");if(l)for(var u,h=0;h<l.body.length;++h){var d=l.body[h];if(u=Ur(d).text,u==="t")n=!0;else if(u==="b")i=!0;else{n=!1,i=!1;break}}else n=!0,i=!0;var f=e[0];return{type:"smash",mode:a.mode,body:f,smashHeight:n,smashDepth:i}},htmlBuilder:(r,e)=>{var t=R([],[te(r.body,e)]);if(!r.smashHeight&&!r.smashDepth)return t;if(r.smashHeight&&(t.height=0),r.smashDepth&&(t.depth=0),r.smashHeight&&r.smashDepth)return R(["mord","katex-smash"],[t],e);if(t.children)for(var a=0;a<t.children.length;a++)r.smashHeight&&(t.children[a].height=0),r.smashDepth&&(t.children[a].depth=0);var n=re({positionType:"firstBaseline",children:[{type:"elem",elem:t}]});return R(["mord"],[n],e)},mathmlBuilder:(r,e)=>{var t=new I("mpadded",[se(r.body,e)]);return r.smashHeight&&t.setAttribute("height","0px"),r.smashDepth&&t.setAttribute("depth","0px"),t}});L({type:"sqrt",names:["\\sqrt"],numArgs:1,numOptionalArgs:1,handler(r,e,t){var a=r.parser,n=t[0],i=e[0];return{type:"sqrt",mode:a.mode,body:i,index:n}},htmlBuilder(r,e){var t=te(r.body,e.havingCrampedStyle());t.height===0&&(t.height=e.fontMetrics().xHeight),t=kt(t,e);var a=e.fontMetrics(),n=a.defaultRuleThickness,i=n;e.style.id<W.TEXT.id&&(i=e.fontMetrics().xHeight);var l=n+i/4,u=t.height+t.depth+l+n,h=Ku(u,e),d=h.span,f=h.ruleWidth,b=h.advanceWidth,k=d.height-f;k>t.height+t.depth+l&&(l=(l+k-t.height-t.depth)/2);var w=d.height-t.height-l-f;t.style.paddingLeft=O(b);var M=re({positionType:"firstBaseline",children:[{type:"elem",elem:t,wrapperClasses:["svg-align"]},{type:"kern",size:-(t.height+w)},{type:"elem",elem:d},{type:"kern",size:f}]});if(r.index){var D=e.havingStyle(W.SCRIPTSCRIPT),E=te(r.index,D,e),N=.6*(M.height-M.depth),B=re({positionType:"shift",positionData:-N,children:[{type:"elem",elem:E}]}),F=R(["katex-root"],[B]);return R(["mord","sqrt"],[F,M],e)}else return R(["mord","sqrt"],[M],e)},mathmlBuilder(r,e){var t=r.body,a=r.index;return a?new I("mroot",[se(t,e),se(a,e)]):new I("msqrt",[se(t,e)])}});var dn={display:W.DISPLAY,text:W.TEXT,script:W.SCRIPT,scriptscript:W.SCRIPTSCRIPT};function g4(r){return r in dn}L({type:"styling",names:["\\displaystyle","\\textstyle","\\scriptstyle","\\scriptscriptstyle"],numArgs:0,allowedInText:!0,primitive:!0,handler(r,e){var t=r.breakOnTokenText,a=r.funcName,n=r.parser,i=n.parseExpression(!0,t),l=a.slice(1,a.length-5);if(!g4(l))throw new Error("Unknown style: "+l);return{type:"styling",mode:n.mode,style:l,body:i}},htmlBuilder(r,e){var t=dn[r.style],a=e.havingStyle(t);return r.resetFont&&(a=a.withFont("")),ul(r.body,a,e)},mathmlBuilder(r,e){var t=dn[r.style],a=e.havingStyle(t);r.resetFont&&(a=a.withFont(""));var n=Ke(r.body,a),i=new I("mstyle",n),l={display:["0","true"],text:["0","false"],script:["1","false"],scriptscript:["2","false"]},u=l[r.style];return i.setAttribute("scriptlevel",u[0]),i.setAttribute("displaystyle",u[1]),i}});var b4=function(e,t){var a=e.base;if(a)if(a.type==="op"){var n=a.limits&&(t.style.size===W.DISPLAY.size||a.alwaysHandleSupSub);return n?sl:null}else if(a.type==="operatorname"){var i=a.alwaysHandleSupSub&&(t.style.size===W.DISPLAY.size||a.limits);return i?ll:null}else{if(a.type==="accent")return T0(a.base)?$s:null;if(a.type==="horizBrace"){var l=!e.sub;return l===a.isOver?al:null}else return null}else return null};tt({type:"supsub",htmlBuilder(r,e){var t=b4(r,e);if(t)return t(r,e);var a=r.base,n=r.sup,i=r.sub,l=te(a,e),u,h,d=e.fontMetrics(),f=0,b=0,k=a&&T0(a);if(n){var w=e.havingStyle(e.style.sup());u=te(n,w,e),k||(f=l.height-w.fontMetrics().supDrop*w.sizeMultiplier/e.sizeMultiplier)}if(i){var M=e.havingStyle(e.style.sub());h=te(i,M,e),k||(b=l.depth+M.fontMetrics().subDrop*M.sizeMultiplier/e.sizeMultiplier)}var D;e.style===W.DISPLAY?D=d.sup1:e.style.cramped?D=d.sup3:D=d.sup2;var E=e.sizeMultiplier,N=O(.5/d.ptPerEm/E),B=null;if(h){var F=r.base&&r.base.type==="op"&&r.base.name&&(r.base.name==="\\oiint"||r.base.name==="\\oiiint");if(l instanceof Ne||F){var H;B=O(-((H=l.italic)!=null?H:0))}}var V;if(u&&h){f=Math.max(f,D,u.depth+.25*d.xHeight),b=Math.max(b,d.sub2);var j=d.defaultRuleThickness,$=4*j;if(f-u.depth-(h.height-b)<$){b=$-(f-u.depth)+h.height;var X=.8*d.xHeight-(f-u.depth);X>0&&(f+=X,b-=X)}var ee=[{type:"elem",elem:h,shift:b,marginRight:N,marginLeft:B},{type:"elem",elem:u,shift:-f,marginRight:N}];V=re({positionType:"individualShift",children:ee})}else if(h){b=Math.max(b,d.sub1,h.height-.8*d.xHeight);var ae=[{type:"elem",elem:h,marginLeft:B,marginRight:N}];V=re({positionType:"shift",positionData:b,children:ae})}else if(u)f=Math.max(f,D,u.depth+.25*d.xHeight),V=re({positionType:"shift",positionData:-f,children:[{type:"elem",elem:u,marginRight:N}]});else throw new Error("supsub must have either sup or sub.");var Q=on(l,"right")||"mord";return R([Q],[l,R(["msupsub"],[V])],e)},mathmlBuilder(r,e){var t=!1,a,n;r.base&&r.base.type==="horizBrace"&&(n=!!r.sup,n===r.base.isOver&&(t=!0,a=r.base.isOver)),r.base&&(r.base.type==="op"||r.base.type==="operatorname")&&(r.base.parentIsSupSub=!0);var i=[se(r.base,e)];r.sub&&i.push(se(r.sub,e)),r.sup&&i.push(se(r.sup,e));var l;if(t)l=a?"mover":"munder";else if(r.sub)if(r.sup){var d=r.base;d&&d.type==="op"&&d.limits&&e.style===W.DISPLAY||d&&d.type==="operatorname"&&d.alwaysHandleSupSub&&(e.style===W.DISPLAY||d.limits)?l="munderover":l="msubsup"}else{var h=r.base;h&&h.type==="op"&&h.limits&&(e.style===W.DISPLAY||h.alwaysHandleSupSub)||h&&h.type==="operatorname"&&h.alwaysHandleSupSub&&(h.limits||e.style===W.DISPLAY)?l="munder":l="msub"}else{var u=r.base;u&&u.type==="op"&&u.limits&&(e.style===W.DISPLAY||u.alwaysHandleSupSub)||u&&u.type==="operatorname"&&u.alwaysHandleSupSub&&(u.limits||e.style===W.DISPLAY)?l="mover":l="msup"}return new I(l,i)}});tt({type:"atom",htmlBuilder(r,e){return xn(r.text,r.mode,e,["m"+r.family])},mathmlBuilder(r,e){var t=new I("mo",[a0(r.text,r.mode)]);if(r.family==="bin"){var a=Sn(r,e);a==="bold-italic"&&t.setAttribute("mathvariant",a)}else r.family==="punct"?t.setAttribute("separator","true"):(r.family==="open"||r.family==="close")&&t.setAttribute("stretchy","false");return t}});var cl={mi:"italic",mn:"normal",mtext:"normal"};tt({type:"mathord",htmlBuilder(r,e){return _r(r,e)},mathmlBuilder(r,e){var t=new I("mi",[a0(r.text,r.mode,e)]),a=Sn(r,e)||"italic";return a!==cl[t.type]&&t.setAttribute("mathvariant",a),t}});tt({type:"textord",htmlBuilder(r,e){return _r(r,e)},mathmlBuilder(r,e){var t=a0(r.text,r.mode,e),a=Sn(r,e)||"normal",n;return r.mode==="text"?n=new I("mtext",[t]):/[0-9]/.test(r.text)?n=new I("mn",[t]):r.text==="\\prime"?n=new I("mo",[t]):n=new I("mi",[t]),a!==cl[n.type]&&n.setAttribute("mathvariant",a),n}});var fs=new Map([["\\nobreak","nobreak"],["\\allowbreak","allowbreak"]]),vs=new Map([[" ",{}],["\\ ",{}],["~",{className:"nobreak"}],["\\space",{}],["\\nobreakspace",{className:"nobreak"}]]);tt({type:"spacing",htmlBuilder(r,e){var t=vs.get(r.text),a=fs.get(r.text);if(t){var n=t.className||"";if(r.mode==="text"){var i=_r(r,e);return i.classes.push(n),i}else return R(["mspace",n],[xn(r.text,r.mode,e)],e)}else{if(a)return R(["mspace",a],[],e);throw new C('Unknown type of space "'+r.text+'"')}},mathmlBuilder(r,e){var t;if(vs.has(r.text))t=new I("mtext",[new ve("\xA0")]);else{if(fs.has(r.text))return new I("mspace");throw new C('Unknown type of space "'+r.text+'"')}return t}});var gs=()=>{var r=new I("mtd",[]);return r.setAttribute("width","50%"),r};tt({type:"tag",mathmlBuilder(r,e){var t=new I("mtable",[new I("mtr",[gs(),new I("mtd",[H0(r.body,e)]),gs(),new I("mtd",[H0(r.tag,e)])])]);return t.setAttribute("width","100%"),t}});var bs={"\\text":void 0,"\\textrm":"textrm","\\textsf":"textsf","\\texttt":"texttt","\\textnormal":"textrm"},ys={"\\textbf":"textbf","\\textmd":"textmd"},y4={"\\textit":"textit","\\textup":"textup"},xs=(r,e)=>{var t=r.font;if(t){if(bs[t])return e.withTextFontFamily(bs[t]);if(ys[t])return e.withTextFontWeight(ys[t]);if(t==="\\emph")return e.fontShape==="textit"?e.withTextFontShape("textup"):e.withTextFontShape("textit")}else return e;return e.withTextFontShape(y4[t])};L({type:"text",names:["\\text","\\textrm","\\textsf","\\texttt","\\textnormal","\\textbf","\\textmd","\\textit","\\textup","\\emph"],numArgs:1,argTypes:["text"],allowedInArgument:!0,allowedInText:!0,handler(r,e){var t=r.parser,a=r.funcName,n=e[0];return{type:"text",mode:t.mode,body:ye(n),font:a}},htmlBuilder(r,e){var t=xs(r,e),a=Se(r.body,t,!0);return R(["mord","text"],a,t)},mathmlBuilder(r,e){var t=xs(r,e);return H0(r.body,t)}});L({type:"underline",names:["\\underline"],numArgs:1,allowedInText:!0,handler(r,e){var t=r.parser;return{type:"underline",mode:t.mode,body:e[0]}},htmlBuilder(r,e){var t=te(r.body,e),a=wt("underline-line",e),n=e.fontMetrics().defaultRuleThickness,i=re({positionType:"top",positionData:t.height,children:[{type:"kern",size:n},{type:"elem",elem:a},{type:"kern",size:3*n},{type:"elem",elem:t}]});return R(["mord","katex-underline"],[i],e)},mathmlBuilder(r,e){var t=new I("mo",[new ve("\u203E")]);t.setAttribute("stretchy","true");var a=new I("munder",[se(r.body,e),t]);return a.setAttribute("accentunder","true"),a}});L({type:"vcenter",names:["\\vcenter"],numArgs:1,argTypes:["original"],allowedInText:!1,handler(r,e){var t=r.parser;return{type:"vcenter",mode:t.mode,body:e[0]}},htmlBuilder(r,e){var t=te(r.body,e),a=e.fontMetrics().axisHeight,n=.5*(t.height-a-(t.depth+a));return re({positionType:"shift",positionData:n,children:[{type:"elem",elem:t}]})},mathmlBuilder(r,e){var t=new I("mpadded",[se(r.body,e)],["vcenter"]);return new I("mrow",[t])}});L({type:"verb",names:["\\verb"],numArgs:0,allowedInText:!0,handler(r,e,t){throw new C("\\verb ended by end of line instead of matching delimiter")},htmlBuilder(r,e){for(var t=ws(r),a=[],n=e.havingStyle(e.style.text()),i=0;i<t.length;i++){var l=t[i];l==="~"&&(l="\\textasciitilde"),a.push(Oe(l,"Typewriter-Regular",r.mode,n,["mord","texttt"]))}return R(["mord","text"].concat(n.sizingClasses(e)),Is(a),n)},mathmlBuilder(r,e){var t=new ve(ws(r)),a=new I("mtext",[t]);return a.setAttribute("mathvariant","monospace"),a}});var ws=r=>r.body.replace(/ /g,r.star?"\u2423":"\xA0"),L0=Ls,hl=`[ \r
	]`,x4="\\\\[a-zA-Z@]+",w4="\\\\[^\uD800-\uDFFF]",k4="("+x4+")"+hl+"*",S4=`\\\\(
|[ \r	]+
?)[ \r	]*`,pn="[\u0300-\u036F]",T4=new RegExp(pn+"+$"),A4="("+hl+"+)|"+(S4+"|")+"([!-\\[\\]-\u2027\u202A-\uD7FF\uF900-\uFFFF]"+(pn+"*")+"|[\uD800-\uDBFF][\uDC00-\uDFFF]"+(pn+"*")+"|\\\\verb\\*([^]).*?\\4|\\\\verb([^*a-zA-Z]).*?\\5"+("|"+k4)+("|"+w4+")"),qr=class{constructor(e,t){this.input=void 0,this.settings=void 0,this.tokenRegex=void 0,this.catcodes=void 0,this.input=e,this.settings=t,this.tokenRegex=new RegExp(A4,"g"),this.catcodes={"%":14,"~":13}}setCatcode(e,t){this.catcodes[e]=t}lex(){var e=this.input,t=this.tokenRegex.lastIndex;if(t===e.length)return new Xe("EOF",new He(this,t,t));var a=this.tokenRegex.exec(e);if(a===null||a.index!==t)throw new C("Unexpected character: '"+e[t]+"'",new Xe(e[t],new He(this,t,t+1)));var n=a[6]||a[3]||(a[2]?"\\ ":" ");if(this.catcodes[n]===14){var i=e.indexOf(`
`,this.tokenRegex.lastIndex);return i===-1?(this.tokenRegex.lastIndex=e.length,this.settings.reportNonstrict("commentAtEnd","% comment has no terminating newline; LaTeX would fail because of commenting the end of math mode (e.g. $)")):this.tokenRegex.lastIndex=i+1,this.lex()}return new Xe(n,new He(this,t,this.tokenRegex.lastIndex))}},fn=class{constructor(e,t){e===void 0&&(e={}),t===void 0&&(t={}),this.current=void 0,this.builtins=void 0,this.undefStack=void 0,this.current=t,this.builtins=e,this.undefStack=[]}beginGroup(){this.undefStack.push({})}endGroup(){if(this.undefStack.length===0)throw new C("Unbalanced namespace destruction: attempt to pop global namespace; please report this as a bug");var e=this.undefStack.pop();for(var t of Object.keys(e))e[t]===void 0?delete this.current[t]:this.current[t]=e[t]}endGroups(){for(;this.undefStack.length>0;)this.endGroup()}has(e){return Object.prototype.hasOwnProperty.call(this.current,e)||Object.prototype.hasOwnProperty.call(this.builtins,e)}get(e){return Object.prototype.hasOwnProperty.call(this.current,e)?this.current[e]:Object.prototype.hasOwnProperty.call(this.builtins,e)?this.builtins[e]:void 0}set(e,t,a){if(a===void 0&&(a=!1),a){for(var n=0;n<this.undefStack.length;n++)delete this.undefStack[n][e];this.undefStack.length>0&&(this.undefStack[this.undefStack.length-1][e]=t)}else{var i=this.undefStack[this.undefStack.length-1];i&&!Object.prototype.hasOwnProperty.call(i,e)&&(i[e]=Object.prototype.hasOwnProperty.call(this.current,e)?this.current[e]:void 0)}t==null?delete this.current[e]:this.current[e]=t}},z4=el;m("\\noexpand",function(r){var e=r.popToken();return r.isExpandable(e.text)&&(e.noexpand=!0,e.treatAsRelax=!0),{tokens:[e],numArgs:0}});m("\\expandafter",function(r){var e=r.popToken();return r.expandOnce(!0),{tokens:[e],numArgs:0}});m("\\@firstoftwo",function(r){var e=r.consumeArgs(2);return{tokens:e[0],numArgs:0}});m("\\@secondoftwo",function(r){var e=r.consumeArgs(2);return{tokens:e[1],numArgs:0}});m("\\@ifnextchar",function(r){var e=r.consumeArgs(3);r.consumeSpaces();var t=r.future();return e[0].length===1&&e[0][0].text===t.text?{tokens:e[1],numArgs:0}:{tokens:e[2],numArgs:0}});m("\\@ifstar","\\@ifnextchar *{\\@firstoftwo{#1}}");m("\\TextOrMath",function(r){var e=r.consumeArgs(2);return r.mode==="text"?{tokens:e[0],numArgs:0}:{tokens:e[1],numArgs:0}});var ks={0:0,1:1,2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,a:10,A:10,b:11,B:11,c:12,C:12,d:13,D:13,e:14,E:14,f:15,F:15};m("\\char",function(r){var e=r.popToken(),t,a=0;if(e.text==="'")t=8,e=r.popToken();else if(e.text==='"')t=16,e=r.popToken();else if(e.text==="`")if(e=r.popToken(),e.text[0]==="\\")a=e.text.charCodeAt(1);else{if(e.text==="EOF")throw new C("\\char` missing argument");a=e.text.charCodeAt(0)}else t=10;if(t){if(a=ks[e.text],a==null||a>=t)throw new C("Invalid base-"+t+" digit "+e.text);for(var n;(n=ks[r.future().text])!=null&&n<t;)a*=t,a+=n,r.popToken()}return"\\@char{"+a+"}"});var En=(r,e,t,a)=>{var n=r.consumeArg().tokens;if(n.length!==1)throw new C("\\newcommand's first argument must be a macro name");var i=n[0].text,l=r.isDefined(i);if(l&&!e)throw new C("\\newcommand{"+i+"} attempting to redefine "+(i+"; use \\renewcommand"));if(!l&&!t)throw new C("\\renewcommand{"+i+"} when command "+i+" does not yet exist; use \\newcommand");var u=0;if(n=r.consumeArg().tokens,n.length===1&&n[0].text==="["){for(var h="",d=r.expandNextToken();d.text!=="]"&&d.text!=="EOF";)h+=d.text,d=r.expandNextToken();if(!h.match(/^\s*[0-9]+\s*$/))throw new C("Invalid number of arguments: "+h);u=parseInt(h),n=r.consumeArg().tokens}return l&&a||r.macros.set(i,{tokens:n,numArgs:u}),""};m("\\newcommand",r=>En(r,!1,!0,!1));m("\\renewcommand",r=>En(r,!0,!1,!1));m("\\providecommand",r=>En(r,!0,!0,!0));m("\\message",r=>{var e=r.consumeArgs(1)[0];return console.log(e.reverse().map(t=>t.text).join("")),""});m("\\errmessage",r=>{var e=r.consumeArgs(1)[0];return console.error(e.reverse().map(t=>t.text).join("")),""});m("\\show",r=>{var e=r.popToken(),t=e.text;return console.log(e,r.macros.get(t),L0[t],he.math[t],he.text[t]),""});m("\\bgroup","{");m("\\egroup","}");m("~","\\nobreakspace");m("\\lq","`");m("\\rq","'");m("\\aa","\\r a");m("\\AA","\\r A");m("\\textcopyright","\\html@mathml{\\textcircled{c}}{\\char`\xA9}");m("\\copyright","\\TextOrMath{\\textcopyright}{\\text{\\textcopyright}}");m("\\textregistered","\\html@mathml{\\textcircled{\\scriptsize R}}{\\char`\xAE}");m("\u212C","\\mathscr{B}");m("\u2130","\\mathscr{E}");m("\u2131","\\mathscr{F}");m("\u210B","\\mathscr{H}");m("\u2110","\\mathscr{I}");m("\u2112","\\mathscr{L}");m("\u2133","\\mathscr{M}");m("\u211B","\\mathscr{R}");m("\u212D","\\mathfrak{C}");m("\u210C","\\mathfrak{H}");m("\u2128","\\mathfrak{Z}");m("\\Bbbk","\\Bbb{k}");m("\\llap","\\mathllap{\\textrm{#1}}");m("\\rlap","\\mathrlap{\\textrm{#1}}");m("\\clap","\\mathclap{\\textrm{#1}}");m("\\mathstrut","\\vphantom{(}");m("\\underbar","\\underline{\\text{#1}}");m("\\not",'\\html@mathml{\\mathrel{\\mathrlap\\@not}\\nobreak}{\\char"338}');m("\\neq","\\html@mathml{\\mathrel{\\not=}}{\\mathrel{\\char`\u2260}}");m("\\ne","\\neq");m("\u2260","\\neq");m("\\notin","\\html@mathml{\\mathrel{{\\in}\\mathllap{/\\mskip1mu}}}{\\mathrel{\\char`\u2209}}");m("\u2209","\\notin");m("\u2258","\\html@mathml{\\mathrel{=\\kern{-1em}\\raisebox{0.4em}{$\\scriptsize\\frown$}}}{\\mathrel{\\char`\u2258}}");m("\u2259","\\html@mathml{\\stackrel{\\tiny\\wedge}{=}}{\\mathrel{\\char`\u2258}}");m("\u225A","\\html@mathml{\\stackrel{\\tiny\\vee}{=}}{\\mathrel{\\char`\u225A}}");m("\u225B","\\html@mathml{\\stackrel{\\scriptsize\\star}{=}}{\\mathrel{\\char`\u225B}}");m("\u225D","\\html@mathml{\\stackrel{\\tiny\\mathrm{def}}{=}}{\\mathrel{\\char`\u225D}}");m("\u225E","\\html@mathml{\\stackrel{\\tiny\\mathrm{m}}{=}}{\\mathrel{\\char`\u225E}}");m("\u225F","\\html@mathml{\\stackrel{\\tiny?}{=}}{\\mathrel{\\char`\u225F}}");m("\u27C2","\\perp");m("\u203C","\\mathclose{!\\mkern-0.8mu!}");m("\u220C","\\notni");m("\u231C","\\ulcorner");m("\u231D","\\urcorner");m("\u231E","\\llcorner");m("\u231F","\\lrcorner");m("\xA9","\\copyright");m("\xAE","\\textregistered");m("\\ulcorner",'\\html@mathml{\\@ulcorner}{\\mathop{\\char"231c}}');m("\\urcorner",'\\html@mathml{\\@urcorner}{\\mathop{\\char"231d}}');m("\\llcorner",'\\html@mathml{\\@llcorner}{\\mathop{\\char"231e}}');m("\\lrcorner",'\\html@mathml{\\@lrcorner}{\\mathop{\\char"231f}}');m("\\vdots","{\\varvdots\\rule{0pt}{15pt}}");m("\u22EE","\\vdots");m("\\varGamma","\\mathit{\\Gamma}");m("\\varDelta","\\mathit{\\Delta}");m("\\varTheta","\\mathit{\\Theta}");m("\\varLambda","\\mathit{\\Lambda}");m("\\varXi","\\mathit{\\Xi}");m("\\varPi","\\mathit{\\Pi}");m("\\varSigma","\\mathit{\\Sigma}");m("\\varUpsilon","\\mathit{\\Upsilon}");m("\\varPhi","\\mathit{\\Phi}");m("\\varPsi","\\mathit{\\Psi}");m("\\varOmega","\\mathit{\\Omega}");m("\\substack","\\begin{subarray}{c}#1\\end{subarray}");m("\\colon","\\nobreak\\mskip2mu\\mathpunct{}\\mathchoice{\\mkern-3mu}{\\mkern-3mu}{}{}{:}\\mskip6mu\\relax");m("\\boxed","\\fbox{$\\displaystyle{#1}$}");m("\\iff","\\DOTSB\\;\\Longleftrightarrow\\;");m("\\implies","\\DOTSB\\;\\Longrightarrow\\;");m("\\impliedby","\\DOTSB\\;\\Longleftarrow\\;");m("\\dddot","{\\overset{\\raisebox{-0.1ex}{\\normalsize ...}}{#1}}");m("\\ddddot","{\\overset{\\raisebox{-0.1ex}{\\normalsize ....}}{#1}}");var Ss={",":"\\dotsc","\\not":"\\dotsb","+":"\\dotsb","=":"\\dotsb","<":"\\dotsb",">":"\\dotsb","-":"\\dotsb","*":"\\dotsb",":":"\\dotsb","\\DOTSB":"\\dotsb","\\coprod":"\\dotsb","\\bigvee":"\\dotsb","\\bigwedge":"\\dotsb","\\biguplus":"\\dotsb","\\bigcap":"\\dotsb","\\bigcup":"\\dotsb","\\prod":"\\dotsb","\\sum":"\\dotsb","\\bigotimes":"\\dotsb","\\bigoplus":"\\dotsb","\\bigodot":"\\dotsb","\\bigsqcup":"\\dotsb","\\And":"\\dotsb","\\longrightarrow":"\\dotsb","\\Longrightarrow":"\\dotsb","\\longleftarrow":"\\dotsb","\\Longleftarrow":"\\dotsb","\\longleftrightarrow":"\\dotsb","\\Longleftrightarrow":"\\dotsb","\\mapsto":"\\dotsb","\\longmapsto":"\\dotsb","\\hookrightarrow":"\\dotsb","\\doteq":"\\dotsb","\\mathbin":"\\dotsb","\\mathrel":"\\dotsb","\\relbar":"\\dotsb","\\Relbar":"\\dotsb","\\xrightarrow":"\\dotsb","\\xleftarrow":"\\dotsb","\\DOTSI":"\\dotsi","\\int":"\\dotsi","\\oint":"\\dotsi","\\iint":"\\dotsi","\\iiint":"\\dotsi","\\iiiint":"\\dotsi","\\idotsint":"\\dotsi","\\DOTSX":"\\dotsx"},M4=new Set(["bin","rel"]);m("\\dots",function(r){var e="\\dotso",t=r.expandAfterFuture().text;return t in Ss?e=Ss[t]:(t.slice(0,4)==="\\not"||t in he.math&&M4.has(he.math[t].group))&&(e="\\dotsb"),e});var Rn={")":!0,"]":!0,"\\rbrack":!0,"\\}":!0,"\\rbrace":!0,"\\rangle":!0,"\\rceil":!0,"\\rfloor":!0,"\\rgroup":!0,"\\rmoustache":!0,"\\right":!0,"\\bigr":!0,"\\biggr":!0,"\\Bigr":!0,"\\Biggr":!0,$:!0,";":!0,".":!0,",":!0};m("\\dotso",function(r){var e=r.future().text;return e in Rn?"\\ldots\\,":"\\ldots"});m("\\dotsc",function(r){var e=r.future().text;return e in Rn&&e!==","?"\\ldots\\,":"\\ldots"});m("\\cdots",function(r){var e=r.future().text;return e in Rn?"\\@cdots\\,":"\\@cdots"});m("\\dotsb","\\cdots");m("\\dotsm","\\cdots");m("\\dotsi","\\!\\cdots");m("\\dotsx","\\ldots\\,");m("\\DOTSI","\\relax");m("\\DOTSB","\\relax");m("\\DOTSX","\\relax");m("\\tmspace","\\TextOrMath{\\kern#1#3}{\\mskip#1#2}\\relax");m("\\,","\\tmspace+{3mu}{.1667em}");m("\\thinspace","\\,");m("\\>","\\mskip{4mu}");m("\\:","\\tmspace+{4mu}{.2222em}");m("\\medspace","\\:");m("\\;","\\tmspace+{5mu}{.2777em}");m("\\thickspace","\\;");m("\\!","\\tmspace-{3mu}{.1667em}");m("\\negthinspace","\\!");m("\\negmedspace","\\tmspace-{4mu}{.2222em}");m("\\negthickspace","\\tmspace-{5mu}{.277em}");m("\\enspace","\\kern.5em ");m("\\enskip","\\hskip.5em\\relax");m("\\quad","\\hskip1em\\relax");m("\\qquad","\\hskip2em\\relax");m("\\tag","\\@ifstar\\tag@literal\\tag@paren");m("\\tag@paren","\\tag@literal{({#1})}");m("\\tag@literal",r=>{if(r.macros.get("\\df@tag"))throw new C("Multiple \\tag");return"\\gdef\\df@tag{\\text{#1}}"});m("\\bmod","\\mathchoice{\\mskip1mu}{\\mskip1mu}{\\mskip5mu}{\\mskip5mu}\\mathbin{\\rm mod}\\mathchoice{\\mskip1mu}{\\mskip1mu}{\\mskip5mu}{\\mskip5mu}");m("\\pod","\\allowbreak\\mathchoice{\\mkern18mu}{\\mkern8mu}{\\mkern8mu}{\\mkern8mu}(#1)");m("\\pmod","\\pod{{\\rm mod}\\mkern6mu#1}");m("\\mod","\\allowbreak\\mathchoice{\\mkern18mu}{\\mkern12mu}{\\mkern12mu}{\\mkern12mu}{\\rm mod}\\,\\,#1");m("\\newline","\\\\\\relax");m("\\TeX","\\textrm{\\html@mathml{T\\kern-.1667em\\raisebox{-.5ex}{E}\\kern-.125emX}{TeX}}");var ml=O(p0["Main-Regular"][84][1]-.7*p0["Main-Regular"][65][1]);m("\\LaTeX","\\textrm{\\html@mathml{"+("L\\kern-.36em\\raisebox{"+ml+"}{\\scriptstyle A}")+"\\kern-.15em\\TeX}{LaTeX}}");m("\\KaTeX","\\textrm{\\html@mathml{"+("K\\kern-.17em\\raisebox{"+ml+"}{\\scriptstyle A}")+"\\kern-.15em\\TeX}{KaTeX}}");m("\\hspace","\\@ifstar\\@hspacer\\@hspace");m("\\@hspace","\\hskip #1\\relax");m("\\@hspacer","\\rule{0pt}{0pt}\\hskip #1\\relax");m("\\ordinarycolon",":");m("\\vcentcolon","\\mathrel{\\mathop\\ordinarycolon}");m("\\dblcolon",'\\html@mathml{\\mathrel{\\vcentcolon\\mathrel{\\mkern-.9mu}\\vcentcolon}}{\\mathop{\\char"2237}}');m("\\coloneqq",'\\html@mathml{\\mathrel{\\vcentcolon\\mathrel{\\mkern-1.2mu}=}}{\\mathop{\\char"2254}}');m("\\Coloneqq",'\\html@mathml{\\mathrel{\\dblcolon\\mathrel{\\mkern-1.2mu}=}}{\\mathop{\\char"2237\\char"3d}}');m("\\coloneq",'\\html@mathml{\\mathrel{\\vcentcolon\\mathrel{\\mkern-1.2mu}\\mathrel{-}}}{\\mathop{\\char"3a\\char"2212}}');m("\\Coloneq",'\\html@mathml{\\mathrel{\\dblcolon\\mathrel{\\mkern-1.2mu}\\mathrel{-}}}{\\mathop{\\char"2237\\char"2212}}');m("\\eqqcolon",'\\html@mathml{\\mathrel{=\\mathrel{\\mkern-1.2mu}\\vcentcolon}}{\\mathop{\\char"2255}}');m("\\Eqqcolon",'\\html@mathml{\\mathrel{=\\mathrel{\\mkern-1.2mu}\\dblcolon}}{\\mathop{\\char"3d\\char"2237}}');m("\\eqcolon",'\\html@mathml{\\mathrel{\\mathrel{-}\\mathrel{\\mkern-1.2mu}\\vcentcolon}}{\\mathop{\\char"2239}}');m("\\Eqcolon",'\\html@mathml{\\mathrel{\\mathrel{-}\\mathrel{\\mkern-1.2mu}\\dblcolon}}{\\mathop{\\char"2212\\char"2237}}');m("\\colonapprox",'\\html@mathml{\\mathrel{\\vcentcolon\\mathrel{\\mkern-1.2mu}\\approx}}{\\mathop{\\char"3a\\char"2248}}');m("\\Colonapprox",'\\html@mathml{\\mathrel{\\dblcolon\\mathrel{\\mkern-1.2mu}\\approx}}{\\mathop{\\char"2237\\char"2248}}');m("\\colonsim",'\\html@mathml{\\mathrel{\\vcentcolon\\mathrel{\\mkern-1.2mu}\\sim}}{\\mathop{\\char"3a\\char"223c}}');m("\\Colonsim",'\\html@mathml{\\mathrel{\\dblcolon\\mathrel{\\mkern-1.2mu}\\sim}}{\\mathop{\\char"2237\\char"223c}}');m("\u2237","\\dblcolon");m("\u2239","\\eqcolon");m("\u2254","\\coloneqq");m("\u2255","\\eqqcolon");m("\u2A74","\\Coloneqq");m("\\ratio","\\vcentcolon");m("\\coloncolon","\\dblcolon");m("\\colonequals","\\coloneqq");m("\\coloncolonequals","\\Coloneqq");m("\\equalscolon","\\eqqcolon");m("\\equalscoloncolon","\\Eqqcolon");m("\\colonminus","\\coloneq");m("\\coloncolonminus","\\Coloneq");m("\\minuscolon","\\eqcolon");m("\\minuscoloncolon","\\Eqcolon");m("\\coloncolonapprox","\\Colonapprox");m("\\coloncolonsim","\\Colonsim");m("\\simcolon","\\mathrel{\\sim\\mathrel{\\mkern-1.2mu}\\vcentcolon}");m("\\simcoloncolon","\\mathrel{\\sim\\mathrel{\\mkern-1.2mu}\\dblcolon}");m("\\approxcolon","\\mathrel{\\approx\\mathrel{\\mkern-1.2mu}\\vcentcolon}");m("\\approxcoloncolon","\\mathrel{\\approx\\mathrel{\\mkern-1.2mu}\\dblcolon}");m("\\notni","\\html@mathml{\\not\\ni}{\\mathrel{\\char`\u220C}}");m("\\limsup","\\DOTSB\\operatorname*{lim\\,sup}");m("\\liminf","\\DOTSB\\operatorname*{lim\\,inf}");m("\\injlim","\\DOTSB\\operatorname*{inj\\,lim}");m("\\projlim","\\DOTSB\\operatorname*{proj\\,lim}");m("\\varlimsup","\\DOTSB\\operatorname*{\\overline{lim}}");m("\\varliminf","\\DOTSB\\operatorname*{\\underline{lim}}");m("\\varinjlim","\\DOTSB\\operatorname*{\\underrightarrow{lim}}");m("\\varprojlim","\\DOTSB\\operatorname*{\\underleftarrow{lim}}");m("\\gvertneqq","\\html@mathml{\\@gvertneqq}{\u2269}");m("\\lvertneqq","\\html@mathml{\\@lvertneqq}{\u2268}");m("\\ngeqq","\\html@mathml{\\@ngeqq}{\u2271}");m("\\ngeqslant","\\html@mathml{\\@ngeqslant}{\u2271}");m("\\nleqq","\\html@mathml{\\@nleqq}{\u2270}");m("\\nleqslant","\\html@mathml{\\@nleqslant}{\u2270}");m("\\nshortmid","\\html@mathml{\\@nshortmid}{\u2224}");m("\\nshortparallel","\\html@mathml{\\@nshortparallel}{\u2226}");m("\\nsubseteqq","\\html@mathml{\\@nsubseteqq}{\u2288}");m("\\nsupseteqq","\\html@mathml{\\@nsupseteqq}{\u2289}");m("\\varsubsetneq","\\html@mathml{\\@varsubsetneq}{\u228A}");m("\\varsubsetneqq","\\html@mathml{\\@varsubsetneqq}{\u2ACB}");m("\\varsupsetneq","\\html@mathml{\\@varsupsetneq}{\u228B}");m("\\varsupsetneqq","\\html@mathml{\\@varsupsetneqq}{\u2ACC}");m("\\imath","\\html@mathml{\\@imath}{\u0131}");m("\\jmath","\\html@mathml{\\@jmath}{\u0237}");m("\\llbracket","\\html@mathml{\\mathopen{[\\mkern-3.2mu[}}{\\mathopen{\\char`\u27E6}}");m("\\rrbracket","\\html@mathml{\\mathclose{]\\mkern-3.2mu]}}{\\mathclose{\\char`\u27E7}}");m("\u27E6","\\llbracket");m("\u27E7","\\rrbracket");m("\\lBrace","\\html@mathml{\\mathopen{\\{\\mkern-3.2mu[}}{\\mathopen{\\char`\u2983}}");m("\\rBrace","\\html@mathml{\\mathclose{]\\mkern-3.2mu\\}}}{\\mathclose{\\char`\u2984}}");m("\u21A4","\\mapsfrom");m("\\mapsfrom","\\html@mathml{\\mathrel{\\mathreflectbox{\\mapsto}}}{\\mathrel{\\char`\u21A4}}");m("\u2983","\\lBrace");m("\u2984","\\rBrace");m("\\minuso","\\mathbin{\\html@mathml{{\\mathrlap{\\mathchoice{\\kern{0.145em}}{\\kern{0.145em}}{\\kern{0.1015em}}{\\kern{0.0725em}}\\circ}{-}}}{\\char`\u29B5}}");m("\u29B5","\\minuso");m("\\darr","\\downarrow");m("\\dArr","\\Downarrow");m("\\Darr","\\Downarrow");m("\\lang","\\langle");m("\\rang","\\rangle");m("\\uarr","\\uparrow");m("\\uArr","\\Uparrow");m("\\Uarr","\\Uparrow");m("\\N","\\mathbb{N}");m("\\R","\\mathbb{R}");m("\\Z","\\mathbb{Z}");m("\\alef","\\aleph");m("\\alefsym","\\aleph");m("\\Alpha","\\mathrm{A}");m("\\Beta","\\mathrm{B}");m("\\bull","\\bullet");m("\\Chi","\\mathrm{X}");m("\\clubs","\\clubsuit");m("\\cnums","\\mathbb{C}");m("\\Complex","\\mathbb{C}");m("\\Dagger","\\ddagger");m("\\diamonds","\\diamondsuit");m("\\empty","\\emptyset");m("\\Epsilon","\\mathrm{E}");m("\\Eta","\\mathrm{H}");m("\\exist","\\exists");m("\\harr","\\leftrightarrow");m("\\hArr","\\Leftrightarrow");m("\\Harr","\\Leftrightarrow");m("\\hearts","\\heartsuit");m("\\image","\\Im");m("\\infin","\\infty");m("\\Iota","\\mathrm{I}");m("\\isin","\\in");m("\\Kappa","\\mathrm{K}");m("\\larr","\\leftarrow");m("\\lArr","\\Leftarrow");m("\\Larr","\\Leftarrow");m("\\lrarr","\\leftrightarrow");m("\\lrArr","\\Leftrightarrow");m("\\Lrarr","\\Leftrightarrow");m("\\Mu","\\mathrm{M}");m("\\natnums","\\mathbb{N}");m("\\Nu","\\mathrm{N}");m("\\Omicron","\\mathrm{O}");m("\\plusmn","\\pm");m("\\rarr","\\rightarrow");m("\\rArr","\\Rightarrow");m("\\Rarr","\\Rightarrow");m("\\real","\\Re");m("\\reals","\\mathbb{R}");m("\\Reals","\\mathbb{R}");m("\\Rho","\\mathrm{P}");m("\\sdot","\\cdot");m("\\sect","\\S");m("\\spades","\\spadesuit");m("\\sub","\\subset");m("\\sube","\\subseteq");m("\\supe","\\supseteq");m("\\Tau","\\mathrm{T}");m("\\thetasym","\\vartheta");m("\\weierp","\\wp");m("\\Zeta","\\mathrm{Z}");m("\\argmin","\\DOTSB\\operatorname*{arg\\,min}");m("\\argmax","\\DOTSB\\operatorname*{arg\\,max}");m("\\plim","\\DOTSB\\mathop{\\operatorname{plim}}\\limits");m("\\bra","\\mathinner{\\langle{#1}|}");m("\\ket","\\mathinner{|{#1}\\rangle}");m("\\braket","\\mathinner{\\langle{#1}\\rangle}");m("\\Bra","\\left\\langle#1\\right|");m("\\Ket","\\left|#1\\right\\rangle");var dl=r=>e=>{var t=e.consumeArg().tokens,a=e.consumeArg().tokens,n=e.consumeArg().tokens,i=e.consumeArg().tokens,l=e.macros.get("|"),u=e.macros.get("\\|");e.macros.beginGroup();var h=b=>k=>{r&&(k.macros.set("|",l),n.length&&k.macros.set("\\|",u));var w=b;if(!b&&n.length){var M=k.future();M.text==="|"&&(k.popToken(),w=!0)}return{tokens:w?n:a,numArgs:0}};e.macros.set("|",h(!1)),n.length&&e.macros.set("\\|",h(!0));var d=e.consumeArg().tokens,f=e.expandTokens([...i,...d,...t]);return e.macros.endGroup(),{tokens:f.reverse(),numArgs:0}};m("\\bra@ket",dl(!1));m("\\bra@set",dl(!0));m("\\Braket","\\bra@ket{\\left\\langle}{\\,\\middle\\vert\\,}{\\,\\middle\\vert\\,}{\\right\\rangle}");m("\\Set","\\bra@set{\\left\\{\\:}{\\;\\middle\\vert\\;}{\\;\\middle\\Vert\\;}{\\:\\right\\}}");m("\\set","\\bra@set{\\{\\,}{\\mid}{}{\\,\\}}");m("\\angln","{\\angl n}");m("\\blue","\\textcolor{##6495ed}{#1}");m("\\orange","\\textcolor{##ffa500}{#1}");m("\\pink","\\textcolor{##ff00af}{#1}");m("\\red","\\textcolor{##df0030}{#1}");m("\\green","\\textcolor{##28ae7b}{#1}");m("\\gray","\\textcolor{gray}{#1}");m("\\purple","\\textcolor{##9d38bd}{#1}");m("\\blueA","\\textcolor{##ccfaff}{#1}");m("\\blueB","\\textcolor{##80f6ff}{#1}");m("\\blueC","\\textcolor{##63d9ea}{#1}");m("\\blueD","\\textcolor{##11accd}{#1}");m("\\blueE","\\textcolor{##0c7f99}{#1}");m("\\tealA","\\textcolor{##94fff5}{#1}");m("\\tealB","\\textcolor{##26edd5}{#1}");m("\\tealC","\\textcolor{##01d1c1}{#1}");m("\\tealD","\\textcolor{##01a995}{#1}");m("\\tealE","\\textcolor{##208170}{#1}");m("\\greenA","\\textcolor{##b6ffb0}{#1}");m("\\greenB","\\textcolor{##8af281}{#1}");m("\\greenC","\\textcolor{##74cf70}{#1}");m("\\greenD","\\textcolor{##1fab54}{#1}");m("\\greenE","\\textcolor{##0d923f}{#1}");m("\\goldA","\\textcolor{##ffd0a9}{#1}");m("\\goldB","\\textcolor{##ffbb71}{#1}");m("\\goldC","\\textcolor{##ff9c39}{#1}");m("\\goldD","\\textcolor{##e07d10}{#1}");m("\\goldE","\\textcolor{##a75a05}{#1}");m("\\redA","\\textcolor{##fca9a9}{#1}");m("\\redB","\\textcolor{##ff8482}{#1}");m("\\redC","\\textcolor{##f9685d}{#1}");m("\\redD","\\textcolor{##e84d39}{#1}");m("\\redE","\\textcolor{##bc2612}{#1}");m("\\maroonA","\\textcolor{##ffbde0}{#1}");m("\\maroonB","\\textcolor{##ff92c6}{#1}");m("\\maroonC","\\textcolor{##ed5fa6}{#1}");m("\\maroonD","\\textcolor{##ca337c}{#1}");m("\\maroonE","\\textcolor{##9e034e}{#1}");m("\\purpleA","\\textcolor{##ddd7ff}{#1}");m("\\purpleB","\\textcolor{##c6b9fc}{#1}");m("\\purpleC","\\textcolor{##aa87ff}{#1}");m("\\purpleD","\\textcolor{##7854ab}{#1}");m("\\purpleE","\\textcolor{##543b78}{#1}");m("\\mintA","\\textcolor{##f5f9e8}{#1}");m("\\mintB","\\textcolor{##edf2df}{#1}");m("\\mintC","\\textcolor{##e0e5cc}{#1}");m("\\grayA","\\textcolor{##f6f7f7}{#1}");m("\\grayB","\\textcolor{##f0f1f2}{#1}");m("\\grayC","\\textcolor{##e3e5e6}{#1}");m("\\grayD","\\textcolor{##d6d8da}{#1}");m("\\grayE","\\textcolor{##babec2}{#1}");m("\\grayF","\\textcolor{##888d93}{#1}");m("\\grayG","\\textcolor{##626569}{#1}");m("\\grayH","\\textcolor{##3b3e40}{#1}");m("\\grayI","\\textcolor{##21242c}{#1}");m("\\kaBlue","\\textcolor{##314453}{#1}");m("\\kaGreen","\\textcolor{##71B307}{#1}");var pl={"^":!0,_:!0,"\\limits":!0,"\\nolimits":!0},vn=class{constructor(e,t,a){this.settings=void 0,this.expansionCount=void 0,this.lexer=void 0,this.macros=void 0,this.stack=void 0,this.mode=void 0,this.settings=t,this.expansionCount=0,this.feed(e),this.macros=new fn(z4,t.macros),this.mode=a,this.stack=[]}feed(e){this.lexer=new qr(e,this.settings)}switchMode(e){this.mode=e}beginGroup(){this.macros.beginGroup()}endGroup(){this.macros.endGroup()}endGroups(){this.macros.endGroups()}future(){return this.stack.length===0&&this.pushToken(this.lexer.lex()),this.stack[this.stack.length-1]}popToken(){return this.future(),this.stack.pop()}pushToken(e){this.stack.push(e)}pushTokens(e){this.stack.push(...e)}scanArgument(e){var t,a,n;if(e){if(this.consumeSpaces(),this.future().text!=="[")return null;t=this.popToken();var i=this.consumeArg(["]"]);n=i.tokens,a=i.end}else{var l=this.consumeArg();n=l.tokens,t=l.start,a=l.end}return this.pushToken(new Xe("EOF",a.loc)),this.pushTokens(n),new Xe("",He.range(t,a))}consumeSpaces(){for(;;){var e=this.future();if(e.text===" ")this.stack.pop();else break}}consumeArg(e){var t=[],a=e&&e.length>0;a||this.consumeSpaces();var n=this.future(),i,l=0,u=0;do{if(i=this.popToken(),t.push(i),i.text==="{")++l;else if(i.text==="}"){if(--l,l===-1)throw new C("Extra }",i)}else if(i.text==="EOF")throw new C("Unexpected end of input in a macro argument, expected '"+(e&&a?e[u]:"}")+"'",i);if(e&&a)if((l===0||l===1&&e[u]==="{")&&i.text===e[u]){if(++u,u===e.length){t.splice(-u,u);break}}else u=0}while(l!==0||a);return n.text==="{"&&t[t.length-1].text==="}"&&(t.pop(),t.shift()),t.reverse(),{tokens:t,start:n,end:i}}consumeArgs(e,t){if(t){if(t.length!==e+1)throw new C("The length of delimiters doesn't match the number of args!");for(var a=t[0],n=0;n<a.length;n++){var i=this.popToken();if(a[n]!==i.text)throw new C("Use of the macro doesn't match its definition",i)}}for(var l=[],u=0;u<e;u++)l.push(this.consumeArg(t&&t[u+1]).tokens);return l}countExpansion(e){if(this.expansionCount+=e,this.expansionCount>this.settings.maxExpand)throw new C("Too many expansions: infinite loop or need to increase maxExpand setting")}expandOnce(e){var t=this.popToken(),a=t.text,n=t.noexpand?null:this._getExpansion(a);if(n==null||e&&n.unexpandable){if(e&&n==null&&a[0]==="\\"&&!this.isDefined(a))throw new C("Undefined control sequence: "+a);return this.pushToken(t),!1}this.countExpansion(1);var i=n.tokens,l=this.consumeArgs(n.numArgs,n.delimiters);if(n.numArgs){i=i.slice();for(var u=i.length-1;u>=0;--u){var h=i[u];if(h.text==="#"){if(u===0)throw new C("Incomplete placeholder at end of macro body",h);if(h=i[--u],h.text==="#")i.splice(u+1,1);else if(/^[1-9]$/.test(h.text))i.splice(u,2,...l[+h.text-1]);else throw new C("Not a valid argument number",h)}}}return this.pushTokens(i),i.length}expandAfterFuture(){return this.expandOnce(),this.future()}expandNextToken(){for(;;)if(this.expandOnce()===!1){var e=this.stack.pop();return e.treatAsRelax&&(e.text="\\relax"),e}}expandMacro(e){return this.macros.has(e)?this.expandTokens([new Xe(e)]):void 0}expandTokens(e){var t=[],a=this.stack.length;for(this.pushTokens(e);this.stack.length>a;)if(this.expandOnce(!0)===!1){var n=this.stack.pop();n.treatAsRelax&&(n.noexpand=!1,n.treatAsRelax=!1),t.push(n)}return this.countExpansion(t.length),t}expandMacroAsText(e){var t=this.expandMacro(e);return t&&t.map(a=>a.text).join("")}_getExpansion(e){var t=this.macros.get(e);if(t==null)return t;if(e.length===1){var a=this.lexer.catcodes[e];if(a!=null&&a!==13)return}var n=typeof t=="function"?t(this):t;if(typeof n=="string"){var i=0;if(n.includes("#"))for(var l=n.replace(/##/g,"");l.includes("#"+(i+1));)++i;for(var u=new qr(n,this.settings),h=[],d=u.lex();d.text!=="EOF";)h.push(d),d=u.lex();h.reverse();var f={tokens:h,numArgs:i};return f}return n}isDefined(e){return this.macros.has(e)||Object.prototype.hasOwnProperty.call(L0,e)||Object.prototype.hasOwnProperty.call(he.math,e)||Object.prototype.hasOwnProperty.call(he.text,e)||Object.prototype.hasOwnProperty.call(pl,e)}isExpandable(e){var t=this.macros.get(e);return t!=null?typeof t=="string"||typeof t=="function"||!t.unexpandable:Object.prototype.hasOwnProperty.call(L0,e)&&!L0[e].primitive}},Ts=/^[₊₋₌₍₎₀₁₂₃₄₅₆₇₈₉ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓᵦᵧᵨᵩᵪ]/,Dr=Object.freeze({"\u208A":"+","\u208B":"-","\u208C":"=","\u208D":"(","\u208E":")","\u2080":"0","\u2081":"1","\u2082":"2","\u2083":"3","\u2084":"4","\u2085":"5","\u2086":"6","\u2087":"7","\u2088":"8","\u2089":"9","\u2090":"a","\u2091":"e","\u2095":"h","\u1D62":"i","\u2C7C":"j","\u2096":"k","\u2097":"l","\u2098":"m","\u2099":"n","\u2092":"o","\u209A":"p","\u1D63":"r","\u209B":"s","\u209C":"t","\u1D64":"u","\u1D65":"v","\u2093":"x","\u1D66":"\u03B2","\u1D67":"\u03B3","\u1D68":"\u03C1","\u1D69":"\u03D5","\u1D6A":"\u03C7","\u207A":"+","\u207B":"-","\u207C":"=","\u207D":"(","\u207E":")","\u2070":"0","\xB9":"1","\xB2":"2","\xB3":"3","\u2074":"4","\u2075":"5","\u2076":"6","\u2077":"7","\u2078":"8","\u2079":"9","\u1D2C":"A","\u1D2E":"B","\u1D30":"D","\u1D31":"E","\u1D33":"G","\u1D34":"H","\u1D35":"I","\u1D36":"J","\u1D37":"K","\u1D38":"L","\u1D39":"M","\u1D3A":"N","\u1D3C":"O","\u1D3E":"P","\u1D3F":"R","\u1D40":"T","\u1D41":"U","\u2C7D":"V","\u1D42":"W","\u1D43":"a","\u1D47":"b","\u1D9C":"c","\u1D48":"d","\u1D49":"e","\u1DA0":"f","\u1D4D":"g",\u02B0:"h","\u2071":"i",\u02B2:"j","\u1D4F":"k",\u02E1:"l","\u1D50":"m",\u207F:"n","\u1D52":"o","\u1D56":"p",\u02B3:"r",\u02E2:"s","\u1D57":"t","\u1D58":"u","\u1D5B":"v",\u02B7:"w",\u02E3:"x",\u02B8:"y","\u1DBB":"z","\u1D5D":"\u03B2","\u1D5E":"\u03B3","\u1D5F":"\u03B4","\u1D60":"\u03D5","\u1D61":"\u03C7","\u1DBF":"\u03B8"}),Ya={"\u0301":{text:"\\'",math:"\\acute"},"\u0300":{text:"\\`",math:"\\grave"},"\u0308":{text:'\\"',math:"\\ddot"},"\u0303":{text:"\\~",math:"\\tilde"},"\u0304":{text:"\\=",math:"\\bar"},"\u0306":{text:"\\u",math:"\\breve"},"\u030C":{text:"\\v",math:"\\check"},"\u0302":{text:"\\^",math:"\\hat"},"\u0307":{text:"\\.",math:"\\dot"},"\u030A":{text:"\\r",math:"\\mathring"},"\u030B":{text:"\\H"},"\u0327":{text:"\\c"}},As={\u00E1:"a\u0301",\u00E0:"a\u0300",\u00E4:"a\u0308",\u01DF:"a\u0308\u0304",\u00E3:"a\u0303",\u0101:"a\u0304",\u0103:"a\u0306",\u1EAF:"a\u0306\u0301",\u1EB1:"a\u0306\u0300",\u1EB5:"a\u0306\u0303",\u01CE:"a\u030C",\u00E2:"a\u0302",\u1EA5:"a\u0302\u0301",\u1EA7:"a\u0302\u0300",\u1EAB:"a\u0302\u0303",\u0227:"a\u0307",\u01E1:"a\u0307\u0304",\u00E5:"a\u030A",\u01FB:"a\u030A\u0301",\u1E03:"b\u0307",\u0107:"c\u0301",\u1E09:"c\u0327\u0301",\u010D:"c\u030C",\u0109:"c\u0302",\u010B:"c\u0307",\u00E7:"c\u0327",\u010F:"d\u030C",\u1E0B:"d\u0307",\u1E11:"d\u0327",\u00E9:"e\u0301",\u00E8:"e\u0300",\u00EB:"e\u0308",\u1EBD:"e\u0303",\u0113:"e\u0304",\u1E17:"e\u0304\u0301",\u1E15:"e\u0304\u0300",\u0115:"e\u0306",\u1E1D:"e\u0327\u0306",\u011B:"e\u030C",\u00EA:"e\u0302",\u1EBF:"e\u0302\u0301",\u1EC1:"e\u0302\u0300",\u1EC5:"e\u0302\u0303",\u0117:"e\u0307",\u0229:"e\u0327",\u1E1F:"f\u0307",\u01F5:"g\u0301",\u1E21:"g\u0304",\u011F:"g\u0306",\u01E7:"g\u030C",\u011D:"g\u0302",\u0121:"g\u0307",\u0123:"g\u0327",\u1E27:"h\u0308",\u021F:"h\u030C",\u0125:"h\u0302",\u1E23:"h\u0307",\u1E29:"h\u0327",\u00ED:"i\u0301",\u00EC:"i\u0300",\u00EF:"i\u0308",\u1E2F:"i\u0308\u0301",\u0129:"i\u0303",\u012B:"i\u0304",\u012D:"i\u0306",\u01D0:"i\u030C",\u00EE:"i\u0302",\u01F0:"j\u030C",\u0135:"j\u0302",\u1E31:"k\u0301",\u01E9:"k\u030C",\u0137:"k\u0327",\u013A:"l\u0301",\u013E:"l\u030C",\u013C:"l\u0327",\u1E3F:"m\u0301",\u1E41:"m\u0307",\u0144:"n\u0301",\u01F9:"n\u0300",\u00F1:"n\u0303",\u0148:"n\u030C",\u1E45:"n\u0307",\u0146:"n\u0327",\u00F3:"o\u0301",\u00F2:"o\u0300",\u00F6:"o\u0308",\u022B:"o\u0308\u0304",\u00F5:"o\u0303",\u1E4D:"o\u0303\u0301",\u1E4F:"o\u0303\u0308",\u022D:"o\u0303\u0304",\u014D:"o\u0304",\u1E53:"o\u0304\u0301",\u1E51:"o\u0304\u0300",\u014F:"o\u0306",\u01D2:"o\u030C",\u00F4:"o\u0302",\u1ED1:"o\u0302\u0301",\u1ED3:"o\u0302\u0300",\u1ED7:"o\u0302\u0303",\u022F:"o\u0307",\u0231:"o\u0307\u0304",\u0151:"o\u030B",\u1E55:"p\u0301",\u1E57:"p\u0307",\u0155:"r\u0301",\u0159:"r\u030C",\u1E59:"r\u0307",\u0157:"r\u0327",\u015B:"s\u0301",\u1E65:"s\u0301\u0307",\u0161:"s\u030C",\u1E67:"s\u030C\u0307",\u015D:"s\u0302",\u1E61:"s\u0307",\u015F:"s\u0327",\u1E97:"t\u0308",\u0165:"t\u030C",\u1E6B:"t\u0307",\u0163:"t\u0327",\u00FA:"u\u0301",\u00F9:"u\u0300",\u00FC:"u\u0308",\u01D8:"u\u0308\u0301",\u01DC:"u\u0308\u0300",\u01D6:"u\u0308\u0304",\u01DA:"u\u0308\u030C",\u0169:"u\u0303",\u1E79:"u\u0303\u0301",\u016B:"u\u0304",\u1E7B:"u\u0304\u0308",\u016D:"u\u0306",\u01D4:"u\u030C",\u00FB:"u\u0302",\u016F:"u\u030A",\u0171:"u\u030B",\u1E7D:"v\u0303",\u1E83:"w\u0301",\u1E81:"w\u0300",\u1E85:"w\u0308",\u0175:"w\u0302",\u1E87:"w\u0307",\u1E98:"w\u030A",\u1E8D:"x\u0308",\u1E8B:"x\u0307",\u00FD:"y\u0301",\u1EF3:"y\u0300",\u00FF:"y\u0308",\u1EF9:"y\u0303",\u0233:"y\u0304",\u0177:"y\u0302",\u1E8F:"y\u0307",\u1E99:"y\u030A",\u017A:"z\u0301",\u017E:"z\u030C",\u1E91:"z\u0302",\u017C:"z\u0307",\u00C1:"A\u0301",\u00C0:"A\u0300",\u00C4:"A\u0308",\u01DE:"A\u0308\u0304",\u00C3:"A\u0303",\u0100:"A\u0304",\u0102:"A\u0306",\u1EAE:"A\u0306\u0301",\u1EB0:"A\u0306\u0300",\u1EB4:"A\u0306\u0303",\u01CD:"A\u030C",\u00C2:"A\u0302",\u1EA4:"A\u0302\u0301",\u1EA6:"A\u0302\u0300",\u1EAA:"A\u0302\u0303",\u0226:"A\u0307",\u01E0:"A\u0307\u0304",\u00C5:"A\u030A",\u01FA:"A\u030A\u0301",\u1E02:"B\u0307",\u0106:"C\u0301",\u1E08:"C\u0327\u0301",\u010C:"C\u030C",\u0108:"C\u0302",\u010A:"C\u0307",\u00C7:"C\u0327",\u010E:"D\u030C",\u1E0A:"D\u0307",\u1E10:"D\u0327",\u00C9:"E\u0301",\u00C8:"E\u0300",\u00CB:"E\u0308",\u1EBC:"E\u0303",\u0112:"E\u0304",\u1E16:"E\u0304\u0301",\u1E14:"E\u0304\u0300",\u0114:"E\u0306",\u1E1C:"E\u0327\u0306",\u011A:"E\u030C",\u00CA:"E\u0302",\u1EBE:"E\u0302\u0301",\u1EC0:"E\u0302\u0300",\u1EC4:"E\u0302\u0303",\u0116:"E\u0307",\u0228:"E\u0327",\u1E1E:"F\u0307",\u01F4:"G\u0301",\u1E20:"G\u0304",\u011E:"G\u0306",\u01E6:"G\u030C",\u011C:"G\u0302",\u0120:"G\u0307",\u0122:"G\u0327",\u1E26:"H\u0308",\u021E:"H\u030C",\u0124:"H\u0302",\u1E22:"H\u0307",\u1E28:"H\u0327",\u00CD:"I\u0301",\u00CC:"I\u0300",\u00CF:"I\u0308",\u1E2E:"I\u0308\u0301",\u0128:"I\u0303",\u012A:"I\u0304",\u012C:"I\u0306",\u01CF:"I\u030C",\u00CE:"I\u0302",\u0130:"I\u0307",\u0134:"J\u0302",\u1E30:"K\u0301",\u01E8:"K\u030C",\u0136:"K\u0327",\u0139:"L\u0301",\u013D:"L\u030C",\u013B:"L\u0327",\u1E3E:"M\u0301",\u1E40:"M\u0307",\u0143:"N\u0301",\u01F8:"N\u0300",\u00D1:"N\u0303",\u0147:"N\u030C",\u1E44:"N\u0307",\u0145:"N\u0327",\u00D3:"O\u0301",\u00D2:"O\u0300",\u00D6:"O\u0308",\u022A:"O\u0308\u0304",\u00D5:"O\u0303",\u1E4C:"O\u0303\u0301",\u1E4E:"O\u0303\u0308",\u022C:"O\u0303\u0304",\u014C:"O\u0304",\u1E52:"O\u0304\u0301",\u1E50:"O\u0304\u0300",\u014E:"O\u0306",\u01D1:"O\u030C",\u00D4:"O\u0302",\u1ED0:"O\u0302\u0301",\u1ED2:"O\u0302\u0300",\u1ED6:"O\u0302\u0303",\u022E:"O\u0307",\u0230:"O\u0307\u0304",\u0150:"O\u030B",\u1E54:"P\u0301",\u1E56:"P\u0307",\u0154:"R\u0301",\u0158:"R\u030C",\u1E58:"R\u0307",\u0156:"R\u0327",\u015A:"S\u0301",\u1E64:"S\u0301\u0307",\u0160:"S\u030C",\u1E66:"S\u030C\u0307",\u015C:"S\u0302",\u1E60:"S\u0307",\u015E:"S\u0327",\u0164:"T\u030C",\u1E6A:"T\u0307",\u0162:"T\u0327",\u00DA:"U\u0301",\u00D9:"U\u0300",\u00DC:"U\u0308",\u01D7:"U\u0308\u0301",\u01DB:"U\u0308\u0300",\u01D5:"U\u0308\u0304",\u01D9:"U\u0308\u030C",\u0168:"U\u0303",\u1E78:"U\u0303\u0301",\u016A:"U\u0304",\u1E7A:"U\u0304\u0308",\u016C:"U\u0306",\u01D3:"U\u030C",\u00DB:"U\u0302",\u016E:"U\u030A",\u0170:"U\u030B",\u1E7C:"V\u0303",\u1E82:"W\u0301",\u1E80:"W\u0300",\u1E84:"W\u0308",\u0174:"W\u0302",\u1E86:"W\u0307",\u1E8C:"X\u0308",\u1E8A:"X\u0307",\u00DD:"Y\u0301",\u1EF2:"Y\u0300",\u0178:"Y\u0308",\u1EF8:"Y\u0303",\u0232:"Y\u0304",\u0176:"Y\u0302",\u1E8E:"Y\u0307",\u0179:"Z\u0301",\u017D:"Z\u030C",\u1E90:"Z\u0302",\u017B:"Z\u0307",\u03AC:"\u03B1\u0301",\u1F70:"\u03B1\u0300",\u1FB1:"\u03B1\u0304",\u1FB0:"\u03B1\u0306",\u03AD:"\u03B5\u0301",\u1F72:"\u03B5\u0300",\u03AE:"\u03B7\u0301",\u1F74:"\u03B7\u0300",\u03AF:"\u03B9\u0301",\u1F76:"\u03B9\u0300",\u03CA:"\u03B9\u0308",\u0390:"\u03B9\u0308\u0301",\u1FD2:"\u03B9\u0308\u0300",\u1FD1:"\u03B9\u0304",\u1FD0:"\u03B9\u0306",\u03CC:"\u03BF\u0301",\u1F78:"\u03BF\u0300",\u03CD:"\u03C5\u0301",\u1F7A:"\u03C5\u0300",\u03CB:"\u03C5\u0308",\u03B0:"\u03C5\u0308\u0301",\u1FE2:"\u03C5\u0308\u0300",\u1FE1:"\u03C5\u0304",\u1FE0:"\u03C5\u0306",\u03CE:"\u03C9\u0301",\u1F7C:"\u03C9\u0300",\u038E:"\u03A5\u0301",\u1FEA:"\u03A5\u0300",\u03AB:"\u03A5\u0308",\u1FE9:"\u03A5\u0304",\u1FE8:"\u03A5\u0306",\u038F:"\u03A9\u0301",\u1FFA:"\u03A9\u0300"},Pr=class r{constructor(e,t){this.mode=void 0,this.gullet=void 0,this.settings=void 0,this.leftrightDepth=void 0,this.nextToken=void 0,this.mode="math",this.gullet=new vn(e,t,this.mode),this.settings=t,this.leftrightDepth=0,this.nextToken=null}expect(e,t){if(t===void 0&&(t=!0),this.fetch().text!==e)throw new C("Expected '"+e+"', got '"+this.fetch().text+"'",this.fetch());t&&this.consume()}consume(){this.nextToken=null}fetch(){return this.nextToken==null&&(this.nextToken=this.gullet.expandNextToken()),this.nextToken}switchMode(e){this.mode=e,this.gullet.switchMode(e)}parse(){this.settings.globalGroup||this.gullet.beginGroup(),this.settings.colorIsTextColor&&this.gullet.macros.set("\\color","\\textcolor");try{var e=this.parseExpression(!1);return this.expect("EOF"),this.settings.globalGroup||this.gullet.endGroup(),e}finally{this.gullet.endGroups()}}subparse(e){var t=this.nextToken;this.consume(),this.gullet.pushToken(new Xe("}")),this.gullet.pushTokens(e);var a=this.parseExpression(!1);return this.expect("}"),this.nextToken=t,a}parseExpression(e,t){for(var a=[];;){this.mode==="math"&&this.consumeSpaces();var n=this.fetch();if(r.endOfExpression.has(n.text)||t&&n.text===t||e&&L0[n.text]&&L0[n.text].infix)break;var i=this.parseAtom(t);if(i){if(i.type==="internal")continue}else break;a.push(i)}return this.mode==="text"&&this.formLigatures(a),this.handleInfixNodes(a)}handleInfixNodes(e){for(var t=-1,a,n=0;n<e.length;n++){var i=e[n];if(i.type==="infix"){if(t!==-1)throw new C("only one infix operator per group",i.token);t=n,a=i.replaceWith}}if(t!==-1&&a){var l,u,h=e.slice(0,t),d=e.slice(t+1);h.length===1&&h[0].type==="ordgroup"?l=h[0]:l={type:"ordgroup",mode:this.mode,body:h},d.length===1&&d[0].type==="ordgroup"?u=d[0]:u={type:"ordgroup",mode:this.mode,body:d};var f;return a==="\\\\abovefrac"?f=this.callFunction(a,[l,e[t],u],[]):f=this.callFunction(a,[l,u],[]),[f]}else return e}handleSupSubscript(e){var t=this.fetch(),a=t.text;this.consume(),this.consumeSpaces();var n;do{var i;n=this.parseGroup(e)}while(((i=n)==null?void 0:i.type)==="internal");if(!n)throw new C("Expected group after '"+a+"'",t);return n}formatUnsupportedCmd(e){for(var t=[],a=0;a<e.length;a++)t.push({type:"textord",mode:"text",text:e[a]});var n={type:"text",mode:this.mode,body:t},i={type:"color",mode:this.mode,color:this.settings.errorColor,body:[n]};return i}parseAtom(e){var t=this.parseGroup("atom",e);if(t?.type==="internal"||this.mode==="text")return t;for(var a,n;;){this.consumeSpaces();var i=this.fetch();if(i.text==="\\limits"||i.text==="\\nolimits"){if(t&&t.type==="op")t.limits=i.text==="\\limits",t.alwaysHandleSupSub=!0;else if(t&&t.type==="operatorname")t.alwaysHandleSupSub&&(t.limits=i.text==="\\limits");else throw new C("Limit controls must follow a math operator",i);this.consume()}else if(i.text==="^"){if(a)throw new C("Double superscript",i);a=this.handleSupSubscript("superscript")}else if(i.text==="_"){if(n)throw new C("Double subscript",i);n=this.handleSupSubscript("subscript")}else if(i.text==="'"){if(a)throw new C("Double superscript",i);var l={type:"textord",mode:this.mode,text:"\\prime"},u=[l];for(this.consume();this.fetch().text==="'";)u.push(l),this.consume();this.fetch().text==="^"&&u.push(this.handleSupSubscript("superscript")),a={type:"ordgroup",mode:this.mode,body:u}}else if(Dr[i.text]){var h=Ts.test(i.text),d=[];for(d.push(new Xe(Dr[i.text])),this.consume();;){var f=this.fetch().text;if(!Dr[f]||Ts.test(f)!==h)break;d.unshift(new Xe(Dr[f])),this.consume()}var b=this.subparse(d);h?n={type:"ordgroup",mode:"math",body:b}:a={type:"ordgroup",mode:"math",body:b}}else break}return a&&n?{type:"supsub",mode:this.mode,base:t,sup:a,sub:n}:a?{type:"supsub",mode:this.mode,base:t,sup:a}:n?{type:"supsub",mode:this.mode,base:t,sub:n}:t}parseFunction(e,t){var a=this.fetch(),n=a.text,i=L0[n];if(!i)return null;if(this.consume(),t&&t!=="atom"&&!i.allowedInArgument)throw new C("Got function '"+n+"' with no arguments"+(t?" as "+t:""),a);if(this.mode==="text"&&!i.allowedInText)throw new C("Can't use function '"+n+"' in text mode",a);if(this.mode==="math"&&i.allowedInMath===!1)throw new C("Can't use function '"+n+"' in math mode",a);var l=this.parseArguments(n,i),u=l.args,h=l.optArgs;return this.callFunction(n,u,h,a,e)}callFunction(e,t,a,n,i){var l={funcName:e,parser:this,token:n,breakOnTokenText:i},u=L0[e];if(u&&u.handler)return u.handler(l,t,a);throw new C("No function handler for "+e)}parseArguments(e,t){var a,n=(a=t.numOptionalArgs)!=null?a:0,i=t.numArgs+n;if(i===0)return{args:[],optArgs:[]};for(var l=[],u=[],h=0;h<i;h++){var d,f=(d=t.argTypes)==null?void 0:d[h],b=h<n;("primitive"in t&&t.primitive&&f==null||t.type==="sqrt"&&h===1&&u[0]==null)&&(f="primitive");var k=this.parseGroupOfType("argument to '"+e+"'",f,b);if(b)u.push(k);else if(k!=null)l.push(k);else throw new C("Null argument, please report this as a bug")}return{args:l,optArgs:u}}parseGroupOfType(e,t,a){switch(t){case"color":return this.parseColorGroup(a);case"size":return this.parseSizeGroup(a);case"url":return this.parseUrlGroup(a);case"math":case"text":return this.parseArgumentGroup(a,t);case"hbox":{var n=this.parseArgumentGroup(a,"text");return n!=null?{type:"styling",mode:n.mode,body:[n],style:"text",resetFont:!0}:null}case"raw":{var i=this.parseStringGroup(a);return i!=null?{type:"raw",mode:"text",string:i.text}:null}case"primitive":{if(a)throw new C("A primitive argument cannot be optional");var l=this.parseGroup(e);if(l==null)throw new C("Expected group as "+e,this.fetch());return l}case"original":case void 0:return this.parseArgumentGroup(a);default:throw new C("Unknown group type as "+e,this.fetch())}}consumeSpaces(){for(;this.fetch().text===" ";)this.consume()}parseStringGroup(e){var t=this.gullet.scanArgument(e);if(t==null)return null;for(var a="",n;(n=this.fetch()).text!=="EOF";)a+=n.text,this.consume();return this.consume(),t.text=a,t}parseRegexGroup(e,t){for(var a=this.fetch(),n=a,i="",l;(l=this.fetch()).text!=="EOF"&&e.test(i+l.text);)n=l,i+=n.text,this.consume();if(i==="")throw new C("Invalid "+t+": '"+a.text+"'",a);return a.range(n,i)}parseColorGroup(e){var t=this.parseStringGroup(e);if(t==null)return null;var a=/^(#[a-f0-9]{3,4}|#[a-f0-9]{6}|#[a-f0-9]{8}|[a-f0-9]{6}|[a-z]+)$/i.exec(t.text);if(!a)throw new C("Invalid color: '"+t.text+"'",t);var n=a[0];return/^[0-9a-f]{6}$/i.test(n)&&(n="#"+n),{type:"color-token",mode:this.mode,color:n}}parseSizeGroup(e){var t,a=!1;if(this.gullet.consumeSpaces(),!e&&this.gullet.future().text!=="{"?t=this.parseRegexGroup(/^[-+]? *(?:$|\d+|\d+\.\d*|\.\d*) *[a-z]{0,2} *$/,"size"):t=this.parseStringGroup(e),!t)return null;!e&&t.text.length===0&&(t.text="0pt",a=!0);var n=/([-+]?) *(\d+(?:\.\d*)?|\.\d+) *([a-z]{2})/.exec(t.text);if(!n)throw new C("Invalid size: '"+t.text+"'",t);var i={number:+(n[1]+n[2]),unit:n[3]};if(!Ms(i))throw new C("Invalid unit: '"+i.unit+"'",t);return{type:"size",mode:this.mode,value:i,isBlank:a}}parseUrlGroup(e){this.gullet.lexer.setCatcode("%",13),this.gullet.lexer.setCatcode("~",12);var t=this.parseStringGroup(e);if(this.gullet.lexer.setCatcode("%",14),this.gullet.lexer.setCatcode("~",13),t==null)return null;var a=t.text.replace(/\\([#$%&~_^{}])/g,"$1");return{type:"url",mode:this.mode,url:a}}parseArgumentGroup(e,t){var a=this.gullet.scanArgument(e);if(a==null)return null;var n=this.mode;t&&this.switchMode(t),this.gullet.beginGroup();var i=this.parseExpression(!1,"EOF");this.expect("EOF"),this.gullet.endGroup();var l={type:"ordgroup",mode:this.mode,loc:a.loc,body:i};return t&&this.switchMode(n),l}parseGroup(e,t){var a=this.fetch(),n=a.text,i;if(n==="{"||n==="\\begingroup"){this.consume();var l=n==="{"?"}":"\\endgroup";this.gullet.beginGroup();var u=this.parseExpression(!1,l),h=this.fetch();this.expect(l),this.gullet.endGroup(),i={type:"ordgroup",mode:this.mode,loc:He.range(a,h),body:u,semisimple:n==="\\begingroup"||void 0}}else if(i=this.parseFunction(t,e)||this.parseSymbol(),i==null&&n[0]==="\\"&&!Object.prototype.hasOwnProperty.call(pl,n)){if(this.settings.throwOnError)throw new C("Undefined control sequence: "+n,a);i=this.formatUnsupportedCmd(n),this.consume()}return i}formLigatures(e){for(var t=e.length-1,a=0;a<t;++a){var n=e[a];if(n.type==="textord"){var i=n.text,l=e[a+1];if(!(!l||l.type!=="textord")){if(i==="-"&&l.text==="-"){var u=e[a+2];a+1<t&&u&&u.type==="textord"&&u.text==="-"?(e.splice(a,3,{type:"textord",mode:"text",loc:He.range(n,u),text:"---"}),t-=2):(e.splice(a,2,{type:"textord",mode:"text",loc:He.range(n,l),text:"--"}),t-=1)}(i==="'"||i==="`")&&l.text===i&&(e.splice(a,2,{type:"textord",mode:"text",loc:He.range(n,l),text:i+i}),t-=1)}}}}parseSymbol(){var e=this.fetch(),t=e.text;if(/^\\verb[^a-zA-Z]/.test(t)){this.consume();var a=t.slice(5),n=a.charAt(0)==="*";if(n&&(a=a.slice(1)),a.length<2||a.charAt(0)!==a.slice(-1))throw new C(`\\verb assertion failed --
                    please report what input caused this bug`);return a=a.slice(1,-1),{type:"verb",mode:"text",body:a,star:n}}Object.prototype.hasOwnProperty.call(As,t[0])&&!he[this.mode][t[0]]&&(this.settings.strict&&this.mode==="math"&&this.settings.reportNonstrict("unicodeTextInMathMode",'Accented Unicode text character "'+t[0]+'" used in math mode',e),t=As[t[0]]+t.slice(1));var i=T4.exec(t);i&&(t=t.substring(0,i.index),t==="i"?t="\u0131":t==="j"&&(t="\u0237"));var l;if(he[this.mode][t]){this.settings.strict&&this.mode==="math"&&Ja.includes(t)&&this.settings.reportNonstrict("unicodeTextInMathMode",'Latin-1/Unicode text character "'+t[0]+'" used in math mode',e);var u=he[this.mode][t].group,h=He.range(e),d;Nu(u)?d={type:"atom",mode:this.mode,family:u,loc:h,text:t}:d={type:u,mode:this.mode,loc:h,text:t},l=d}else if(t.charCodeAt(0)>=128)this.settings.strict&&(zs(t.charCodeAt(0))?this.mode==="math"&&this.settings.reportNonstrict("unicodeTextInMathMode",'Unicode text character "'+t[0]+'" used in math mode',e):this.settings.reportNonstrict("unknownSymbol",'Unrecognized Unicode character "'+t[0]+'"'+(" ("+t.charCodeAt(0)+")"),e)),l={type:"textord",mode:"text",loc:He.range(e),text:t};else return null;if(this.consume(),i)for(var f=0;f<i[0].length;f++){var b=i[0][f];if(!Ya[b])throw new C("Unknown accent ' "+b+"'",e);var k=Ya[b][this.mode]||Ya[b].text;if(!k)throw new C("Accent "+b+" unsupported in "+this.mode+" mode",e);l={type:"accent",mode:this.mode,loc:He.range(e),label:k,isStretchy:!1,isShifty:!0,base:l}}return l}};Pr.endOfExpression=new Set(["}","\\endgroup","\\end","\\right","&"]);var Dn=function(e,t){if(!(typeof e=="string"||e instanceof String))throw new TypeError("KaTeX can only parse string typed expression");var a=new Pr(e,t);delete a.gullet.macros.current["\\df@tag"];var n=a.parse();if(delete a.gullet.macros.current["\\current@color"],delete a.gullet.macros.current["\\color"],a.gullet.macros.get("\\df@tag")){if(!t.displayMode)throw new C("\\tag works only in display equations");n=[{type:"tag",mode:"text",body:n,tag:a.subparse([new Xe("\\df@tag")])}]}return n},fl=function(e,t,a){t.textContent="";var n=Cn(e,a).toNode();t.appendChild(n)};typeof document<"u"&&document.compatMode!=="CSS1Compat"&&(typeof console<"u"&&console.warn("Warning: KaTeX doesn't work in quirks mode. Make sure your website has a suitable doctype."),fl=function(){throw new C("KaTeX doesn't work in quirks mode.")});var E4=function(e,t){var a=Cn(e,t).toMarkup();return a},R4=function(e,t){var a=new Gt(t);return Dn(e,a)},vl=function(e,t,a){if(a.throwOnError||!(e instanceof C))throw e;var n=R(["katex-error"],[new Ne(t)]);return n.setAttribute("title",e.toString()),n.setAttribute("style","color:"+a.errorColor),n},Cn=function(e,t){var a=new Gt(t);try{var n=Dn(e,a);return Au(n,e,a)}catch(i){return vl(i,e,a)}},D4=function(e,t){var a=new Gt(t);try{var n=Dn(e,a);return zu(n,e,a)}catch(i){return vl(i,e,a)}},C4="0.18.10",I4={Span:F0,Anchor:xt,SymbolNode:Ne,SvgNode:o0,PathNode:f0,LineNode:Wt},gl={version:C4,render:fl,renderToString:E4,ParseError:C,SETTINGS_SCHEMA:Xa,__parse:R4,__renderToDomTree:Cn,__renderToHTMLTree:D4,__setFontMetrics:su,__defineSymbol:s,__defineFunction:L,__defineMacro:m,__domTree:I4};var O4=/^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n\$]))\1(?=[\s?!\.,:？！。，：]|$)/,B4=/^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n\$]))\1/,N4=/^(\${1,2})\n((?:\\[^]|[^\\])+?)\n\1(?:\n|$)/;function yl(r={}){return{extensions:[L4(r,bl(r,!1)),q4(r,bl(r,!0))]}}function bl(r,e){return t=>gl.renderToString(t.text,{...r,displayMode:t.displayMode})+(e?`
`:"")}function L4(r,e){let t=r&&r.nonStandard,a=t?B4:O4;return{name:"inlineKatex",level:"inline",start(n){let i,l=n;for(;l;){if(i=l.indexOf("$"),i===-1)return;if((t?i>-1:i===0||l.charAt(i-1)===" ")&&l.substring(i).match(a))return i;l=l.substring(i+1).replace(/^\$+/,"")}},tokenizer(n,i){let l=n.match(a);if(l)return{type:"inlineKatex",raw:l[0],text:l[2].trim(),displayMode:l[1].length===2}},renderer:e}}function q4(r,e){return{name:"blockKatex",level:"block",tokenizer(t,a){let n=t.match(N4);if(n)return{type:"blockKatex",raw:n[0],text:n[2].trim(),displayMode:n[1].length===2}},renderer:e}}var P4=$i(window);ne.use(yl({output:"mathml",throwOnError:!1,trust:!1,strict:"ignore",nonStandard:!0}));function F4(r){return P4.sanitize(ne.parse(String(r),{async:!1,gfm:!0}),{FORBID_TAGS:["style","script","iframe","form","input","button","textarea","select","object","embed","link","meta"],FORBID_ATTR:["style","srcdoc","id","name"],SANITIZE_NAMED_PROPS:!0})}return jl(_4);})();

  const REMOTE_KEY = 'exhloj.local.remote.cache';
  const CF_KEY = 'exhloj.local.cf.ratings';
  const DIFFICULTY = ['暂无评定', '入门', '普及−', '普及/提高−', '普及+/提高', '提高+/省选−', '省选/NOI−', 'NOI/NOI+/CTSC'];
  const DIFFICULTY_COLORS = ['#777', '#fe4c61', '#d47f00', '#987400', '#299522', '#2385c8', '#9d3dcf', '#0e1d69'];
  function cacheObject() { try { return validateCache(stored(CACHE_KEY, {})); } catch { return {}; } }
  function safeLink(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; }
    catch { return ''; }
  }
  function luoguId(value) {
    const text = String(value || '').trim().replace(/^https:\/\/(?:www\.)?luogu\.com\.cn\/problem\//i, '').split(/[?#]/)[0].replace(/\/$/, '');
    if (/^AT_[\w]+$/i.test(text)) return 'AT_' + text.slice(3).toLowerCase();
    return /^(?:P|B|U|T|CF|SP|UVA)\d+[A-Z]?\d?$/i.test(text) ? text.toUpperCase() : '';
  }
  function cfId(value) {
    let text = String(value || '').trim();
    const url = text.match(/^https:\/\/codeforces\.com\/(?:problemset\/problem\/(\d+)\/([A-Z]\d?)|(?:contest|gym)\/(\d+)\/problem\/([A-Z]\d?))/i);
    if (url) text = (url[1] || url[3]) + (url[2] || url[4]);
    const match = text.match(/^(?:CF|P)?(\d+)\/?([A-Z]\d?)$/i);
    return match ? `CF${match[1]}${match[2].toUpperCase()}` : '';
  }
  function atcoderId(value) {
    let text = String(value || '').trim().replace(/^AT_/i, '').replace(/^atcoder\//i, '');
    const url = text.match(/^https:\/\/atcoder\.jp\/contests\/[\w-]+\/tasks\/([\w-]+)/i);
    if (url) text = url[1];
    if (/^[a-z]+\d+[a-z]\d?$/i.test(text)) text = text.replace(/^([a-z]+\d+)([a-z]\d?)$/i, '$1_$2');
    return /^[a-z][\w-]*_[a-z\d]+$/i.test(text) ? text.toLowerCase() : '';
  }
  function normalizeOrigin(value) {
    if (typeof value === 'string') { try { value = value.trim().startsWith('{') ? JSON.parse(value) : { type: 'luogu', luoguId: value }; } catch { return null; } }
    if (!isObject(value)) return null;
    const type = String(value.type || 'luogu').toLowerCase();
    if (type === 'none') return { type: 'none', target: '', extra_links: [] };
    let target = String(value.target || value.luoguId || '').trim(), lid = luoguId(value.luoguId || '');
    if (type === 'luogu') { target = luoguId(target); lid = target; }
    else if (type === 'codeforces') { target = cfId(target); lid ||= target; }
    else if (type === 'atcoder') { target = atcoderId(target); lid ||= target ? `AT_${target}` : ''; }
    else if (type === 'qoj') { target = target.replace(/^https:\/\/qoj\.ac\/problem\//i, '').replace(/^[PQ]/i, '').replace(/\/$/, ''); if (!/^\d+$/.test(target)) target = ''; }
    else if (type !== 'other') return null;
    if (!target && type !== 'other') return null;
    const extra_links = (Array.isArray(value.extra_links) ? value.extra_links : []).slice(0, 20).filter(x => x && safeLink(x.link)).map(x => ({ name: String(x.name || x.link).slice(0, 150), link: safeLink(x.link) }));
    const result = { type, target, luoguId: lid, extra_links };
    if (Number.isInteger(+value.difficulty) && +value.difficulty >= 0 && +value.difficulty <= 7) result.difficulty = +value.difficulty;
    return result;
  }
  function problemKey() { const pdoc = current('pdoc'); return `${pdoc?.domainId || domainId()}/${pdoc?.docId ?? pdoc?._id ?? location.pathname}`; }
  function inferOrigin() {
    const cache = cacheObject(), key = problemKey();
    const local = cache['exhloj.remoteOrigins'];
    if (isObject(local) && Object.hasOwn(local, key)) return normalizeOrigin(local[key]);
    const old = cache['exhloj.problemOriginCache'];
    if (isObject(old) && Object.hasOwn(old, key)) { const result = normalizeOrigin(old[key]); if (result) return result; }
    const pdoc = current('pdoc') || {}, config = pdoc.config || {};
    const subtype = String(config.subType || '').toLowerCase();
    if (['luogu', 'codeforces', 'qoj', 'atcoder'].includes(subtype) && config.target) return normalizeOrigin({ type: subtype, target: config.target });
    if (/^CF\d+[A-Z]\d?$/i.test(pdoc.pid || '')) return normalizeOrigin({ type: 'codeforces', target: pdoc.pid });
    if ((pdoc.domainId || domainId()) === 'luogu' && luoguId(pdoc.pid)) return normalizeOrigin({ type: 'luogu', target: pdoc.pid });
    for (const link of $$('.remote__tags a[href]')) {
      const href = link.href;
      if (/^https:\/\/(?:www\.)?luogu\.com\.cn\/problem\//i.test(href)) return normalizeOrigin({ type: 'luogu', target: href });
      if (cfId(href)) return normalizeOrigin({ type: 'codeforces', target: href });
      if (/^https:\/\/qoj\.ac\/problem\/\d+/i.test(href)) return normalizeOrigin({ type: 'qoj', target: href });
      if (/^https:\/\/atcoder\.jp\/contests\//i.test(href)) return normalizeOrigin({ type: 'atcoder', target: href });
    }
    return null;
  }
  function originLinks(origin) {
    if (!origin || origin.type === 'none') return [];
    const links = [], cf = cfId(origin.luoguId) || (origin.type === 'codeforces' ? origin.target : '');
    if (cf) { const [, contest, index] = cf.match(/^CF(\d+)(.+)$/); links.push({ name: `Codeforces ${contest}${index}`, link: `https://codeforces.com/${+contest >= 100000 ? 'gym' : 'contest'}/${contest}/problem/${index}` }); }
    if (origin.type === 'qoj') links.push({ name: `QOJ ${origin.target}`, link: `https://qoj.ac/problem/${origin.target}` });
    if (origin.type === 'atcoder') { const contest = origin.target.split('_').slice(0, -1).join('_'); links.push({ name: `AtCoder ${origin.target}`, link: `https://atcoder.jp/contests/${contest}/tasks/${origin.target}` }); }
    if (origin.luoguId) links.push({ name: `洛谷 ${origin.luoguId}`, link: `https://www.luogu.com.cn/problem/${origin.luoguId}` });
    for (const link of origin.extra_links || []) if (!links.some(x => x.link === link.link)) links.push(link);
    return links;
  }
  const externalRequests = new Map();
  function externalText(address) {
    const url = new URL(address);
    if (url.protocol !== 'https:' || !['www.luogu.com.cn', 'codeforces.com', 'qoj.ac'].includes(url.hostname) || url.username || url.password) return Promise.reject(new Error('不允许读取此站点'));
    if (externalRequests.has(url.href)) return externalRequests.get(url.href);
    const promise = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
      const timer = setTimeout(() => finish(reject, new Error('原站请求超时')), 15000);
      try {
        GM_xmlhttpRequest({ method: 'GET', url: url.href, timeout: 14000,
          anonymous: url.hostname !== 'www.luogu.com.cn', headers: { Accept: 'text/html,application/json' },
          onload(response) {
            if (response.finalUrl) {
              try { if (new URL(response.finalUrl).origin !== url.origin) return finish(reject, new Error('原站跳转到了其他站点，请直接打开原链接查看')); } catch { return finish(reject, new Error('原站跳转地址无效')); }
            }
            if ([401, 403].includes(response.status)) return finish(reject, new Error('原站拒绝读取，请在原站登录并确认访问权限'));
            if (response.status < 200 || response.status >= 300) return finish(reject, new Error(`原站返回 HTTP ${response.status}`));
            const text = response.responseText ?? response.response;
            if (typeof text !== 'string' || text.length > 12 * 1024 * 1024) return finish(reject, new Error('原站返回的数据过大或无效'));
            finish(resolve, text);
          }, onerror: () => finish(reject, new Error('无法连接原站，请检查网络与油猴的跨站权限')),
          ontimeout: () => finish(reject, new Error('原站请求超时')), onabort: () => finish(reject, new Error('原站请求被取消')) });
      } catch (error) { finish(reject, error); }
    });
    externalRequests.set(url.href, promise);
    promise.finally(() => externalRequests.delete(url.href)).catch(() => {});
    return promise;
  }
  function parseLuogu(text) {
    try { const data = JSON.parse(text); if (isObject(data)) return data; } catch {}
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const json = doc.querySelector('script#lentille-context, script#__NEXT_DATA__')?.textContent;
    if (json) { try { return JSON.parse(json); } catch {} }
    const old = text.match(/JSON\.parse\(decodeURIComponent\(("(?:[^"\\]|\\.)*")\)\)/);
    if (old) { try { return JSON.parse(decodeURIComponent(JSON.parse(old[1]))); } catch {} }
    throw new Error('洛谷页面结构变化或需要验证，请直接打开原站');
  }
  function statementMarkdown(problem, content, id) {
    content = isObject(content) ? content : problem;
    let text = `# ${id} ${content.name || problem.title || problem.name || ''}\n\n`;
    for (const [title, keys] of [['题目背景', ['background']], ['题目描述', ['description']], ['输入格式', ['formatI', 'inputFormat']], ['输出格式', ['formatO', 'outputFormat']]]) {
      const value = keys.map(key => content[key]).find(x => typeof x === 'string' && x.trim());
      if (value) text += `## ${title}\n\n${value.trim()}\n\n`;
    }
    for (const [i, sample] of (Array.isArray(problem.samples) ? problem.samples : []).entries()) {
      if (Array.isArray(sample)) text += `## 样例 ${i + 1}\n\n\`\`\`input\n${sample[0]}\n\`\`\`\n\n\`\`\`output\n${sample[1]}\n\`\`\`\n\n`;
    }
    if (typeof content.hint === 'string' && content.hint.trim()) text += `## 说明/提示\n\n${content.hint.trim()}\n`;
    if (typeof problem.translation === 'string' && problem.translation.trim()) text += `\n## 题目翻译\n\n${problem.translation.trim()}\n`;
    return text;
  }
  async function luoguProblem(id, force = false) {
    const cache = stored(REMOTE_KEY, {}), cached = isObject(cache) ? cache[id] : null;
    if (!force && cached?.time > Date.now() - 86400000 && isObject(cached.value)) return cached.value;
    const payload = parseLuogu(await externalText(`https://www.luogu.com.cn/problem/${encodeURIComponent(id)}`));
    const data = payload.data || payload.currentData || payload, problem = data.problem;
    if (!isObject(problem)) throw new Error('洛谷未返回题目资料，题号或访问权限可能不正确');
    const content = data.translations?.['zh-CN'] || data.translations?.zh || problem.content || problem.contenu || problem;
    const value = { id, title: problem.title || problem.name || content.name || id,
      difficulty: Number.isInteger(+problem.difficulty) && +problem.difficulty <= 7 && +problem.difficulty >= 0 ? +problem.difficulty : undefined,
      statement: statementMarkdown(problem, content, id) };
    const next = Object.entries(isObject(cache) ? cache : {}).filter(([key, item]) => key !== id && item?.time > Date.now() - 86400000).sort((a, b) => a[1].time - b[1].time).slice(-14);
    save(REMOTE_KEY, { ...Object.fromEntries(next), [id]: { time: Date.now(), value } });
    return value;
  }
  let cfPromise;
  async function cfRating(id, force = false) {
    let cache = stored(CF_KEY, {});
    if (force || !isObject(cache.ratings) || cache.time < Date.now() - 3 * 86400000) {
      if (!cfPromise) {
        cfPromise = externalText('https://codeforces.com/api/problemset.problems').then(text => {
          const data = JSON.parse(text);
          if (data.status !== 'OK' || !Array.isArray(data.result?.problems)) throw new Error('Codeforces API 未返回题目列表');
          const ratings = {};
          for (const p of data.result.problems) if (Number.isInteger(p.contestId) && /^[A-Z]\d?$/.test(p.index) && Number.isFinite(p.rating)) ratings[`CF${p.contestId}${p.index}`] = p.rating;
          const value = { time: Date.now(), ratings }; save(CF_KEY, value); return value;
        }).finally(() => { cfPromise = undefined; });
      }
      cache = await cfPromise;
    }
    return cache.ratings[id];
  }
  const remoteViews = new Map();
  let remoteState, remoteCounter = 0, remotePending = false, contestRevealed = false;
  function makeRemoteState(origin, local = false) {
    const state = { id: String(++remoteCounter), origin, local, solutions: [], solutionPage: 0, total: 0, exhausted: false, messages: [] };
    remoteViews.set(state.id, state);
    if (remoteViews.size > 12) remoteViews.delete(remoteViews.keys().next().value);
    return state;
  }
  function stateFor(control) {
    const id = control.closest('[data-remote-view]')?.dataset.remoteView;
    const state = remoteViews.get(id);
    if (!state) throw new Error('工具面板已过期，请重新打开');
    return state;
  }
  function renderedMarkdown(text) {
    const node = el('div', { class: 'typo richmedia' }); node.innerHTML = ExhlojMarkdown.render(text);
    for (const a of $$('a[href]', node)) {
      const href = a.getAttribute('href');
      if (href && !href.startsWith('#')) { try { a.href = new URL(href, 'https://www.luogu.com.cn/').href; } catch { a.removeAttribute('href'); } }
      a.target = '_blank'; a.rel = 'noopener noreferrer';
    }
    for (const img of $$('img', node)) {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('data:')) { try { img.src = new URL(src, 'https://www.luogu.com.cn/').href; } catch { img.removeAttribute('src'); } }
      img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    }
    return node;
  }
  function renderRemote(state) {
    const root = state.root;
    if (!root?.isConnected) return;
    root.dataset.remoteView = state.id;
    const tools = el('div', { class: 'exhloj-remote-tools' });
    for (const link of originLinks(state.origin)) tools.append(el('a', { href: link.link, target: '_blank', rel: 'noopener noreferrer' }, link.name));
    const difficulty = state.origin?.difficulty ?? state.problem?.difficulty;
    if (difficulty !== undefined) {
      const chip = el('span', { class: 'exhloj-remote-chip', 'data-exh-difficulty': difficulty }, DIFFICULTY[difficulty] || '暂无评定');
      if (settings.remoteColor === 'text') chip.style.color = DIFFICULTY_COLORS[difficulty];
      if (settings.remoteColor === 'background') { chip.style.backgroundColor = DIFFICULTY_COLORS[difficulty]; chip.style.color = '#fff'; }
      tools.append(chip);
    }
    if (state.rating !== undefined) tools.append(el('span', { class: 'exhloj-remote-chip', 'data-exh-cf-rating': '' }, `CF *${state.rating}`));
    if (state.origin?.luoguId || cfId(state.origin?.target)) tools.append(button('读取 / 刷新难度', 'remote-meta'));
    if (state.origin?.luoguId) tools.append(button('题面 / 翻译', 'remote-statement'), button('查看洛谷题解', 'remote-solutions'), button('导出已加载内容', 'remote-export'));
    if (state.local) tools.append(button('配置题源', 'remote-config'));
    if (!state.origin || state.origin.type === 'none') tools.append(el('span', {}, state.origin?.type === 'none' ? '已停用此题的自动题源识别' : '未识别题源；可在本机配置'));
    if (state.messages.length) tools.append(el('div', { class: 'exhloj-remote-status', role: 'status' }, state.messages.join('；')));
    root.replaceChildren(tools);
    if (state.showStatement && state.problem) {
      const article = el('section', { class: 'exhloj-remote-article' });
      article.append(button('复制题面 Markdown', 'remote-copy-statement'), renderedMarkdown(state.problem.statement)); root.append(article);
    }
    if (state.showSolutions) {
      const content = el('div', { class: 'exhloj-remote-solutions' });
      content.append(el('p', {}, `已加载 ${state.solutions.length} 篇题解${state.total ? ` / 原站共 ${state.total} 篇` : ''}；仅导出已加载内容。`));
      state.solutions.forEach((solution, index) => {
        const article = el('section', { class: 'exhloj-remote-article' });
        const header = el('p', {}, `作者：${solution.author} `);
        if (/^[\w-]+$/.test(solution.id)) header.append(el('a', { href: `https://www.luogu.com.cn/article/${solution.id}`, target: '_blank', rel: 'noopener noreferrer' }, '原文'));
        header.append(button('复制 Markdown', 'remote-copy-solution', { 'data-index': index }));
        article.append(header, renderedMarkdown(solution.content)); content.append(article);
      });
      if (!state.exhausted) content.append(button('加载下一页题解', 'remote-more'));
      root.append(content);
    }
    try { (page.jQuery || page.$)?.(root).trigger('vjContentNew'); } catch {}
  }
  async function loadRemoteMeta(state, force = false) {
    if (state.metaPromise) return state.metaPromise;
    state.messages = ['正在读取原站资料…']; renderRemote(state);
    state.metaPromise = (async () => {
      const jobs = [], names = [];
      if (state.origin?.luoguId) { jobs.push(luoguProblem(state.origin.luoguId, force).then(p => { state.problem = p; })); names.push('洛谷'); }
      const cf = cfId(state.origin?.luoguId) || (state.origin?.type === 'codeforces' ? state.origin.target : '');
      if (cf) { jobs.push(cfRating(cf, force).then(rating => { state.rating = rating; })); names.push('Codeforces'); }
      const results = await Promise.allSettled(jobs);
      state.messages = results.flatMap((result, i) => result.status === 'rejected' ? [`${names[i]}：${result.reason.message}`] : []);
      if (!state.messages.length) state.messages = ['原站资料已读取；未评级的题目不显示 rating'];
      renderRemote(state);
    })().finally(() => { state.metaPromise = undefined; });
    return state.metaPromise;
  }
  async function loadRemoteSolutions(state) {
    if (!state.origin?.luoguId) throw new Error('请先配置洛谷题号');
    const number = state.solutionPage + 1;
    const payload = parseLuogu(await externalText(`https://www.luogu.com.cn/problem/solution/${encodeURIComponent(state.origin.luoguId)}?page=${number}`));
    const data = payload.data || payload.currentData || payload, list = data.solutions;
    const rows = Array.isArray(list) ? list : list?.result || list?.list;
    if (!Array.isArray(rows)) throw new Error('未获得题解列表；请在洛谷登录并确认有查看权限');
    const known = new Set(state.solutions.map(x => x.id));
    let added = 0;
    for (const row of rows) {
      if (typeof row.content !== 'string') continue;
      const id = String(row.lid || row.id || row._id || `page${number}-${added}`);
      if (known.has(id)) continue;
      known.add(id); state.solutions.push({ id, author: String(row.author?.name || row.author?.uname || '未知'), content: row.content }); added++;
    }
    state.solutionPage = number; state.total = Number(list?.count ?? list?.total ?? state.total) || 0;
    state.showSolutions = true;
    state.exhausted = rows.length === 0 || added === 0 || (state.total > 0 && state.solutions.length >= state.total) || state.solutions.length >= 500;
    state.messages = rows.length ? [] : ['原站没有更多题解']; renderRemote(state);
  }
  function remoteProblem() {
    if (!settings.remote || !mainColumn()) return;
    if (!current('pdoc')) {
      if (!remotePending) { remotePending = true; const epoch = routeEpoch; loadPage().then(() => { if (epoch === routeEpoch) schedule(); }).catch(() => {}); }
      return;
    }
    const hidden = pageName() === 'contest_detail_problem' && settings.remoteContest !== 'show' && !contestRevealed;
    let root = $('#exhloj-local-remote');
    if (hidden) {
      if (!root) { root = el('div', { id: 'exhloj-local-remote' }, settings.remoteContest === 'shortcut' ? '比赛页题源已隐藏，按 Ctrl+Q 显示' : '比赛页默认隐藏题源'); mainColumn().prepend(root); }
      return;
    }
    const origin = inferOrigin(), signature = problemKey() + JSON.stringify(origin);
    if (remoteState?.signature === signature && root?.dataset.remoteView === remoteState.id) return;
    if (!root) {
      root = el('div', { id: 'exhloj-local-remote' });
      const tags = $('#exhloj-local-problem-tools') || $('.problem__tags');
      if (tags) tags.after(root); else mainColumn().prepend(root);
    }
    const state = makeRemoteState(origin, true); state.signature = signature; state.root = root; remoteState = state; renderRemote(state);
    if (settings.remoteAuto && origin?.type !== 'none' && (origin?.luoguId || origin?.type === 'codeforces')) loadRemoteMeta(state);
  }
  function configureOrigin() {
    const origin = remoteState?.origin || { type: 'luogu', target: '', extra_links: [] };
    const body = modal('本地题源配置');
    body.append(el('p', {}, `只保存到本机。题目键：${problemKey()}。普通本地 P 题号不会被自动当成洛谷题号。`));
    const type = el('select', { id: 'exhloj-origin-type' });
    for (const [id, label] of [['luogu', '洛谷'], ['codeforces', 'Codeforces'], ['qoj', 'QOJ'], ['atcoder', 'AtCoder'], ['other', '其他链接'], ['none', '停用此题识别']]) type.append(el('option', { value: id }, label));
    type.value = origin.type; body.append(type);
    for (const [key, title, value] of [['target', '原站编号或原题链接', origin.target], ['luoguId', '对应洛谷题号（可留空）', origin.luoguId]]) {
      const label = el('label', {}, title); label.append(el('input', { id: `exhloj-origin-${key}`, type: 'text', class: 'exhloj-source-input', value: value || '' })); body.append(label);
    }
    const label = el('label', {}, '手动难度（留空使用原站）'); label.append(el('input', { id: 'exhloj-origin-difficulty', type: 'number', min: 0, max: 7, value: origin.difficulty ?? '' })); body.append(label);
    body.append(el('p', {}, '附加链接：每行“显示名,https://...”'));
    const extra = el('textarea', { id: 'exhloj-origin-extra' }); extra.value = (origin.extra_links || []).map(x => `${x.name},${x.link}`).join('\n'); body.append(extra);
    body.append(button('保存本地题源', 'remote-save-origin'), button('清除手动配置', 'remote-reset-origin'));
  }
  function saveOrigin(reset = false) {
    const cache = cacheObject(), map = isObject(cache['exhloj.remoteOrigins']) ? { ...cache['exhloj.remoteOrigins'] } : {};
    if (reset) delete map[problemKey()];
    else {
      const value = { type: $('#exhloj-origin-type').value, target: $('#exhloj-origin-target').value,
        luoguId: $('#exhloj-origin-luoguId').value, extra_links: [] };
      if (value.luoguId && !luoguId(value.luoguId)) throw new Error('对应洛谷题号的格式不正确');
      const diff = $('#exhloj-origin-difficulty').value;
      if (diff !== '') { const n = +diff; if (!Number.isInteger(n) || n < 0 || n > 7) throw new Error('难度必须为 0–7 的整数'); value.difficulty = n; }
      for (const line of $('#exhloj-origin-extra').value.split('\n').filter(x => x.trim())) {
        const split = line.indexOf(',');
        if (split < 0 || !safeLink(line.slice(split + 1).trim())) throw new Error('附加链接格式错误');
        value.extra_links.push({ name: line.slice(0, split).trim(), link: line.slice(split + 1).trim() });
      }
      const origin = normalizeOrigin(value); if (!origin) throw new Error('原站编号格式不正确'); map[problemKey()] = origin;
    }
    cache['exhloj.remoteOrigins'] = map; save(CACHE_KEY, cache); remoteState = undefined;
    $('#exhloj-local-dialog')?.close(); remoteProblem(); notify(reset ? '已清除手动配置' : '本地题源已保存');
  }
  function openLuoguTool(value) {
    const id = luoguId(value); if (!id) throw new Error('请输入正确的洛谷题号，例如 P1001 或 CF1234A');
    const body = modal(`洛谷工具 · ${id}`), root = el('div'); body.append(root);
    const state = makeRemoteState(normalizeOrigin({ type: 'luogu', target: id })); state.root = root; renderRemote(state);
    loadRemoteMeta(state);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  function zipContent(files) {
    const encoder = new TextEncoder(), chunks = [], central = []; let offset = 0, directorySize = 0;
    for (const file of files) {
      const name = encoder.encode(file.name), data = file.bytes instanceof Uint8Array ? file.bytes :
        file.bytes instanceof ArrayBuffer ? new Uint8Array(file.bytes) : encoder.encode(file.content); let crc = 0xffffffff;
      for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); crc = (crc ^ 0xffffffff) >>> 0;
      const header = new Uint8Array(30 + name.length), view = new DataView(header.buffer);
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
      view.setUint16(12, 33, true); // DOS date: 1980-01-01
      view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true); header.set(name, 30);
      const record = new Uint8Array(46 + name.length), r = new DataView(record.buffer);
      r.setUint32(0, 0x02014b50, true); r.setUint16(4, 20, true); r.setUint16(6, 20, true); r.setUint16(8, 0x800, true);
      r.setUint16(14, 33, true);
      r.setUint32(16, crc, true); r.setUint32(20, data.length, true); r.setUint32(24, data.length, true); r.setUint16(28, name.length, true); r.setUint32(42, offset, true); record.set(name, 46);
      chunks.push(header, data); central.push(record); offset += header.length + data.length; directorySize += record.length;
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, end], { type: 'application/zip' });
  }
  async function exportRemote(state) {
    if (!state.problem) { state.problem = await luoguProblem(state.origin.luoguId); renderRemote(state); }
    const files = [{ name: 'statement.md', content: state.problem.statement }, { name: 'source.json', content: JSON.stringify({ source: state.origin, solutionsLoaded: state.solutions.length, pagesLoaded: state.solutionPage, exportedAt: new Date().toISOString() }, null, 2) }];
    state.solutions.forEach((solution, i) => files.push({ name: `solutions/${String(i + 1).padStart(3, '0')}-${solution.id.replace(/[^\w-]/g, '_').slice(0, 80)}.md`, content: `Author: ${solution.author}\n\n${solution.content}` }));
    download(`Luogu_${state.origin.luoguId}.zip`, zipContent(files), 'application/zip');
  }
  function remoteSubmissionTools() {
    if ($('#exhloj-local-origin-code')) return;
    const record = current('rdoc'); if (!record || record.code?.trim()) return;
    const id = (Array.isArray(record.judgeTexts) ? record.judgeTexts.join(' ') : '').match(/^ID\s*=\s*(\d+)/)?.[1];
    const platform = String(record.lang || '').split('.')[0]; if (!id || !['qoj', 'codeforces'].includes(platform)) return;
    let link = `https://qoj.ac/submission/${id}`;
    if (platform === 'codeforces') {
      const origin = inferOrigin(), cf = cfId(origin?.luoguId) || cfId(origin?.target);
      if (!cf) return;
      const contest = cf.match(/^CF(\d+)/)[1]; link = `https://codeforces.com/${+contest >= 100000 ? 'gym' : 'contest'}/${contest}/submission/${id}`;
    }
    const root = el('div', { class: 'section__body', id: 'exhloj-local-origin-code' });
    root.append(el('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, '原站提交'), button('读取原站公开代码', 'remote-code', { 'data-url': link }));
    (mainColumn() || document.body).append(root);
  }
  async function loadSubmissionCode(control) {
    const root = $('#exhloj-local-origin-code'), html = await externalText(control.dataset.url);
    if (!root?.isConnected) return;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const source = doc.querySelector('#program-source, #submission-source-code, .submission-source-code, .card-body pre > code');
    if (!source || !source.textContent.trim()) throw new Error('原站没有公开可读取的代码；请打开原站提交查看');
    $('pre', root)?.remove(); const pre = el('pre'), code = el('code', { class: 'language-cpp' }, source.textContent); pre.append(code); root.append(pre);
  }


  // contest-helper / juan-monitor 共用串行请求、进度与取消控制。
  const workStates = { contest: {}, juan: {}, auto: {}, user: {} }, workJobs = new Map();
  const SNAPSHOT_KEY = 'exhloj.local.juan.snapshots.v1', ATTEND_KEY = 'exhloj.local.attended.v1';
  const VERDICTS = { 0: 'Waiting', 1: 'Accepted', 2: 'Wrong Answer', 3: 'Time Limit Exceeded', 4: 'Memory Limit Exceeded',
    5: 'Output Limit Exceeded', 6: 'Runtime Error', 7: 'Compile Error', 8: 'System Error', 9: 'Cancelled', 20: 'Running', 21: 'Compiling', 30: 'Ignored' };
  let netQueue = Promise.resolve(), lastWorkRequest = 0;
  function workError(message, budget = false) { const error = new Error(message); error.budget = budget; return error; }
  function checkJob(job, requesting = false) {
    if (job.controller.signal.aborted) throw workError('任务已取消');
    if (job.owner !== +user()._id) throw workError('登录账号已变化，任务停止');
    if (requesting && job.count >= job.limit) throw workError(`达到 ${job.limit} 次请求上限；本次结果不完整`, true);
  }
  function pauseWork(ms, signal) {
    if (signal.aborted) return Promise.reject(workError('任务已取消'));
    return new Promise((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(workError('任务已取消')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
  function updateWorkProgress(kind) {
    const state = workStates[kind], root = state.root;
    if (!root?.isConnected) return;
    const progress = $(`[data-work-progress="${kind}"]`, root);
    if (progress) progress.textContent = `${state.running ? '运行中' : state.status || '就绪'} · ${state.job?.count || 0} 次请求\n${state.message || ''}`;
  }
  async function workRequest(job, label, fn) {
    const operation = netQueue.then(async () => {
      checkJob(job, true);
      await pauseWork(Math.max(0, job.delay - (Date.now() - lastWorkRequest)), job.controller.signal);
      checkJob(job, true); job.count++; lastWorkRequest = Date.now();
      workStates[job.kind].message = label; updateWorkProgress(job.kind);
      return fn(job.controller.signal);
    });
    netQueue = operation.catch(() => {}); return operation;
  }
  function jobJSON(job, path, options = {}) {
    const url = new URL(path, location.origin);
    return workRequest(job, url.pathname + url.search, signal => requestJSON(url.href, { ...options, signal }));
  }
  function postOptions(data) {
    const body = { ...data }, csrf = $('input[name="_csrf"]')?.value || $('meta[name="csrf-token"]')?.content;
    if (csrf) body._csrf = csrf;
    return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  }
  async function jobBytes(job, address, label) {
    const url = new URL(address, location.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw workError('附件链接无效');
    return workRequest(job, `下载附件：${label}`, async signal => {
      const abort = new AbortController(), cancel = () => abort.abort(), timer = setTimeout(cancel, 30000);
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const response = await fetch(url.href, { credentials: url.origin === location.origin ? 'same-origin' : 'omit', signal: abort.signal });
        if (!response.ok) throw workError(`附件返回 HTTP ${response.status}`);
        if (+response.headers.get('content-length') > 64 * 1024 * 1024) throw workError('附件超过 64 MiB，请在原站单独下载');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 64 * 1024 * 1024) throw workError('附件超过 64 MiB，请在原站单独下载');
        return bytes;
      } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
    });
  }
  async function runWork(kind, fn, local = false) {
    if (workJobs.has(kind)) throw workError('此模块已有任务运行，请等待或取消');
    if (!local && !(+user()._id > 0)) throw workError('请先登录 OJ');
    const state = workStates[kind], job = { kind, count: 0, limit: settings.helperRequestLimit,
      delay: settings.helperDelay, owner: +user()._id, controller: new AbortController() };
    workJobs.set(kind, job); Object.assign(state, { kind, job, running: true, status: '', message: '', errors: [] }); updateWorkProgress(kind);
    try { return await fn(job, state); }
    catch (error) {
      state.status = job.controller.signal.aborted ? '已取消' : '未完成'; state.errors.push(error.message);
      if (!job.controller.signal.aborted) notify(error.message, true);
    } finally {
      state.running = false; state.status ||= state.errors.length ? '完成，存在缺失' : '已完成'; workJobs.delete(kind);
      updateWorkProgress(kind); showWorkErrors(state);
    }
  }
  function showWorkErrors(state) {
    const root = state.root; if (!root?.isConnected) return;
    let area = $(`[data-work-errors="${state.kind}"]`, root);
    if (!area) { area = el('div', { class: 'exhloj-work-errors', role: 'status', 'data-work-errors': state.kind }); root.append(area); }
    area.textContent = (state.errors || []).join('\n');
  }
  function workProgress(root, kind) {
    const row = el('div'); row.append(el('pre', { class: 'exhloj-work-progress', 'data-work-progress': kind, 'aria-live': 'polite' }), button('取消任务', 'work-cancel', { 'data-kind': kind })); root.append(row);
    workStates[kind].root = root; workStates[kind].kind = kind; updateWorkProgress(kind);
  }
  async function listPages(job, path, key, onPage = () => {}) {
    const result = [], signatures = new Set();
    try { for (let number = 1; number <= settings.helperPageLimit; number++) {
      const url = new URL(path, location.origin); url.searchParams.set('page', number);
      const body = await jobJSON(job, url.href), rows = body[key] ?? body.data?.[key];
      if (!Array.isArray(rows)) throw workError(`接口未返回 ${key} 列表`);
      onPage(body);
      if (!rows.length) return result;
      const signature = JSON.stringify(rows.map(row => String(row._id ?? row.docId ?? `${row.uid}/${row.pid}`)));
      if (signatures.has(signature)) throw workError('分页重复，已停止扫描；结果不完整');
      signatures.add(signature); result.push(...rows);
      const pages = Number(body.pageCount ?? body.totalPages ?? body.rpages ?? body.tpages);
      if (pages > 0 && number >= pages) return result;
      if (number === settings.helperPageLimit) throw Object.assign(workError(`达到 ${number} 页上限；结果不完整`), { rows: result });
    } } catch (error) { error.rows ||= result; throw error; }
    return result;
  }
  function domainList(value) {
    const ids = [...new Set(String(value).split(/[\s,]+/).filter(Boolean))];
    if (!ids.length || ids.some(id => !/^[\p{L}\p{N}_-]{1,80}$/u.test(id))) throw workError('域 ID 格式不正确');
    return ids;
  }
  const seg = value => encodeURIComponent(String(value));
  function contestURL(domain, kind, id, suffix = '') { return `/d/${seg(domain)}/${kind}/${seg(id)}${suffix}`; }
  function alphabet(index) { let text = ''; do { text = String.fromCharCode(65 + index % 26) + text; index = Math.floor(index / 26) - 1; } while (index >= 0); return text; }
  function objectId(value) {
    if (typeof value === 'string') { const id = value.replace(/^ObjectId::/, ''); return /^[\da-f]{24}$/i.test(id) ? id : ''; }
    if (isObject(value)) return objectId(value.$oid || value.rid || value._id || value.raw || '');
    return '';
  }
  function recordTime(record) {
    for (const value of [record.submitAt, record.createdAt, record.timeAt]) {
      if (!value) continue;
      const time = typeof value === 'number' ? (value < 1e11 ? value * 1000 : value) : new Date(value).getTime();
      if (Number.isFinite(time)) return time;
    }
    return core.getTimeByObjectId(objectId(record._id || record.rid))?.getTime() || 0;
  }
  function textOnly(value) { return new DOMParser().parseFromString(String(value ?? ''), 'text/html').body.textContent || ''; }
  function csvField(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    let text = String(value ?? ''); if (/^[=+@\t\r]|^-\D/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function csvContent(headers, rows) { return '\ufeff' + [headers, ...rows].map(row => row.map(csvField).join(',')).join('\r\n'); }
  function safeArchivePath(value) {
    const path = String(value).replace(/\\/g, '/'), parts = path.split('/');
    if (!path || path.startsWith('/') || parts.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f:*?"<>|]/.test(part))) throw workError('附件文件名不合法');
    return path;
  }
  function fileReferences(markdown, pdoc) {
    const names = new Set();
    for (const match of markdown.matchAll(/file:\/\/([^\s)<>"']+)/g)) { try { names.add(decodeURIComponent(match[1])); } catch { names.add(match[1]); } }
    for (const file of Array.isArray(pdoc.additional_file) ? pdoc.additional_file : []) if (typeof file.name === 'string') names.add(file.name);
    return [...names];
  }
  function contestContext() {
    const match = location.pathname.match(/\/((?:contest|homework))\/([^/]+)/), tdoc = current('tdoc');
    return { domain: domainId(), kind: match?.[1] || (pageName().startsWith('homework') ? 'homework' : 'contest'), id: String(match?.[2] || tdoc?.docId || tdoc?._id || '') };
  }
  function contestInput() {
    const form = $('#exhloj-contest-form');
    const domain = domainList(form.elements.domain.value)[0], kind = form.elements.kind.value, id = form.elements.tid.value.trim();
    if (!['contest', 'homework'].includes(kind) || !/^(?:[\da-f]{24}|\d+)$/i.test(id)) throw workError('请输入正确的比赛 / 作业 ID');
    return { domain, kind, id, files: form.elements.files.checked, details: form.elements.details.checked };
  }
  function openContestHelper() {
    if (!settings.contestHelper) throw workError('请先启用 contest-helper');
    const body = modal('比赛助手'), context = contestContext(), form = el('form', { id: 'exhloj-contest-form' });
    for (const [name, title, value] of [['domain', '域 ID', context.domain], ['tid', '比赛 / 作业 ID', context.id]]) {
      const label = el('label', {}, title + ' '); label.append(el('input', { type: 'text', name, value, required: true })); form.append(label);
    }
    const kind = el('select', { name: 'kind' }); kind.append(el('option', { value: 'contest' }, '比赛'), el('option', { value: 'homework' }, '作业')); kind.value = context.kind; form.append(kind);
    for (const [name, title, checked] of [['files', '打包题面引用的附件及公开比赛附件', settings.contestFiles], ['details', '提交导出包含时间 / 内存详情（逐条读取）', settings.contestDetails]]) {
      const label = el('label'), input = el('input', { type: 'checkbox', name }); input.checked = checked; label.append(input, title); form.append(label);
    }
    form.append(button('导出题面 ZIP', 'contest-statements'), button('导出提交 CSV', 'contest-records-csv'), button('导出提交 JSON', 'contest-records-json'), button('导出 Ghost', 'contest-ghost'));
    body.append(form); workProgress(body, 'contest');
    body.append(el('h3', {}, '报名工具'), el('p', {}, '检查设置中配置的目标、标题和赛制；仅列出尚未结束且未报名的比赛 / 作业。自动报名默认关闭。'));
    body.append(button('检查待报名', 'attend-preview'), el('div', { id: 'exhloj-attend-results' }));
    workProgress(body, 'auto'); showWorkErrors(workStates.contest); showWorkErrors(workStates.auto);
  }
  async function contestDocument(job, target) {
    const context = contestContext();
    let body = context.domain === target.domain && context.kind === target.kind && context.id === target.id && current('tdoc') ?
      { tdoc: current('tdoc'), pdict: current('pdict') || {}, tsdoc: current('tsdoc') } : await jobJSON(job, contestURL(target.domain, target.kind, target.id));
    if (!body.tdoc || !Array.isArray(body.tdoc.pids)) throw workError('未读取到比赛题目列表，请检查权限');
    return body;
  }
  async function exportContestStatements(target) {
    return runWork('contest', async (job, state) => {
      const body = await contestDocument(job, target), tdoc = body.tdoc;
      if (tdoc.duration && !body.tsdoc?.startAt && +tdoc.owner !== +user()._id) throw workError('请先在原站开始灵活计时比赛，再导出题面');
      const files = [], report = { version: VERSION, title: tdoc.title, target, problems: [], errors: [] };
      for (const [index, pid] of tdoc.pids.entries()) {
        const letter = alphabet(index), record = { id: letter, pid, attachments: [] }; report.problems.push(record);
        try {
          const url = `/d/${seg(target.domain)}/p/${seg(pid)}?tid=${seg(target.id)}`;
          const data = await jobJSON(job, url), pdoc = data.pdoc;
          if (!pdoc || typeof pdoc.content !== 'string' && !isObject(pdoc.content)) throw workError('题面未开放或接口没有返回正文');
          let markdown = markdownContent(pdoc.content);
          if (target.files) {
            const names = fileReferences(markdown, pdoc), safe = [];
            for (const name of names) { try { safe.push({ name, path: safeArchivePath(name) }); } catch (error) { report.errors.push(`${letter}/${name}: ${error.message}`); } }
            if (safe.length) {
              let links = {};
              try {
                const response = await jobJSON(job, `/d/${seg(target.domain)}/p/${seg(pid)}/files?tid=${seg(target.id)}`, postOptions({ operation: 'get_links', type: 'additional_file', files: safe.map(x => x.name) }));
                links = response.links || {};
              } catch (error) { if (job.controller.signal.aborted || error.budget) throw error; report.errors.push(`${letter} 附件链接: ${error.message}`); }
              for (const file of safe) {
                try {
                  const link = links[file.name]; if (!link) throw workError('未返回附件链接');
                  files.push({ name: `${letter}/files/${file.path}`, bytes: await jobBytes(job, link, file.name) }); record.attachments.push(file.name);
                  for (const token of [file.name, encodeURI(file.name), encodeURIComponent(file.name)]) markdown = markdown.split('file://' + token).join('files/' + file.path.split('/').map(seg).join('/'));
                } catch (error) { if (job.controller.signal.aborted || error.budget) throw error; report.errors.push(`${letter}/${file.name}: ${error.message}`); }
              }
            }
          }
          const config = isObject(pdoc.config) ? pdoc.config : {};
          files.push({ name: `${letter}/statement.md`, content: `# ${pdoc.title || letter}\n\nTime: ${config.timeMax ?? '?'} ms\nMemory: ${config.memoryMax ?? '?'} MiB\n\n${markdown}` }); record.title = pdoc.title;
        } catch (error) {
          if (job.controller.signal.aborted || error.budget) throw error;
          report.errors.push(`${letter}: ${error.message}`); files.push({ name: `${letter}/ERROR.txt`, content: error.message });
        }
      }
      if (target.files && target.kind === 'contest') for (const file of Array.isArray(tdoc.files) ? tdoc.files : []) {
        try {
          const name = safeArchivePath(file.name);
          files.push({ name: `attachments/${name}`, bytes: await jobBytes(job, contestURL(target.domain, target.kind, target.id, `/file/public/${seg(file.name)}`), file.name) });
        } catch (error) { if (job.controller.signal.aborted || error.budget) throw error; report.errors.push(`比赛附件 ${file.name}: ${error.message}`); }
      }
      report.complete = !report.errors.length; state.errors.push(...report.errors); report.exportedAt = new Date().toISOString();
      files.push({ name: 'REPORT.json', content: JSON.stringify(report, null, 2) });
      download(`contest-${target.id}.zip`, zipContent(files), 'application/zip'); state.message = `已打包 ${tdoc.pids.length} 道题；缺失项目 ${report.errors.length}，详见 REPORT.json`;
    });
  }
  async function collectContestRecords(job, target) {
    const body = await contestDocument(job, target), tdoc = body.tdoc, users = {}, problems = tdoc.pids.map((pid, i) => ({ id: alphabet(i), pid, title: body.pdict?.[pid]?.title || '', fullScore: tdoc.score?.[pid] || 100 }));
    const rows = await listPages(job, `/d/${seg(target.domain)}/record?tid=${seg(target.id)}`, 'rdocs', page => Object.assign(users, page.udict || {}));
    const unique = new Map();
    for (let record of rows) {
      const rid = objectId(record._id); if (!rid || unique.has(rid)) continue;
      let detail = {};
      if (target.details) { const response = await jobJSON(job, `/d/${seg(target.domain)}/record/${seg(rid)}`); detail = response; record = { ...record, ...response.rdoc }; }
      const problem = problems.find(p => String(p.pid) === String(record.pid ?? detail.pdoc?.docId)); if (!problem) continue;
      if (detail.udoc) users[record.uid] = detail.udoc;
      const cases = Array.isArray(record.testCases) ? record.testCases : [];
      const at = recordTime(record), begin = new Date(tdoc.beginAt).getTime();
      unique.set(rid, { rid, uid: record.uid, submitter: String(users[record.uid]?.uname || `User ${record.uid}`), problem: problem.id, pid: problem.pid,
        score: record.score ?? '', status: Number(record.status), verdict: VERDICTS[record.status] || `Status ${record.status}`,
        submitTime: at, elapsed: Number.isFinite(begin) && at ? at - begin : null,
        codeSize: typeof record.code === 'string' ? record.code.length : record.length ?? null,
        maxTime: cases.length ? Math.max(0, ...cases.map(x => +x.time || 0)) : record.time ?? null,
        maxMemory: cases.length ? Math.max(0, ...cases.map(x => +x.memory || 0)) : record.memory ?? null,
        judgedCases: cases.length ? cases.filter(x => ![0, 9, 20, 21].includes(+x.status)).length : null });
    }
    return { version: VERSION, target, title: tdoc.title || target.id, beginAt: tdoc.beginAt, endAt: tdoc.endAt, problems, records: [...unique.values()].sort((a, b) => a.submitTime - b.submitTime || a.rid.localeCompare(b.rid)) };
  }
  function ghostText(data) {
    const clean = value => String(value ?? '').replace(/[\r\n,"\t]/g, ' '), teams = [...new Set(data.records.map(x => String(x.uid)))];
    const minutes = Math.max(0, Math.round((new Date(data.endAt) - new Date(data.beginAt)) / 60000)) || 0;
    return [`@contest "${clean(data.title)}"`, `@contlen ${minutes}`, `@problems ${data.problems.length}`, `@teams ${teams.length}`, `@submissions ${data.records.length}`,
      ...data.problems.map(p => `@p ${p.id},${clean(p.title)},20,0`), ...teams.map((uid, i) => `@t ${i + 1},0,1,${clean(data.records.find(r => String(r.uid) === uid).submitter)}`),
      ...data.records.map(r => `@s ${teams.indexOf(String(r.uid)) + 1},${r.problem},0,${Math.max(0, Math.ceil((r.elapsed || 0) / 1000))},${r.status === 1 ? 'AC' : 'RJ'},${r.score}`)].join('\n') + '\n';
  }
  async function exportContestRecords(target, format) {
    return runWork('contest', async (job, state) => {
      const data = await collectContestRecords(job, target); state.result = data;
      if (format === 'json') download(`contest-${target.id}-records.json`, JSON.stringify(data, null, 2));
      else if (format === 'ghost') download(`contest-${target.id}.ghost`, ghostText(data), 'text/plain;charset=utf-8');
      else download(`contest-${target.id}-records.csv`, csvContent(['submitter', 'uid', 'problem', 'pid', 'score', 'status', 'submitTime', 'elapsedMs', 'codeSize', 'maxTimeMs', 'maxMemoryKiB', 'judgedCases'],
        data.records.map(r => [r.submitter, r.uid, r.problem, r.pid, r.score, r.verdict, r.submitTime ? new Date(r.submitTime).toISOString() : '', r.elapsed, r.codeSize, r.maxTime, r.maxMemory, r.judgedCases])), 'text/csv;charset=utf-8');
      state.message = `已导出 ${data.records.length} 次提交，${data.problems.length} 道题`;
    });
  }
  function attendTargets() {
    const targets = [];
    for (const line of settings.autoAttendTargets.split(/[\s,]+/).filter(Boolean)) {
      const [domain, kind, extra] = line.split('/');
      domainList(domain);
      if (extra || !['contest', 'homework'].includes(kind)) throw workError('报名目标格式应为 域ID/contest 或 域ID/homework');
      if (!targets.some(t => t.domain === domain && t.kind === kind)) targets.push({ domain, kind });
    }
    if (!targets.length) throw workError('请先在设置中填写报名目标');
    return targets;
  }
  async function findAttendCandidates(job) {
    const results = [], known = stored(ATTEND_KEY, {}), rules = settings.autoAttendRules.split(/[\s,]+/).filter(Boolean);
    for (const target of attendTargets()) {
      const statuses = {}, docs = await listPages(job, `/d/${seg(target.domain)}/${target.kind}`, 'tdocs', page => Object.assign(statuses, page.tsdict || {}));
      for (const tdoc of docs) {
        const id = String(tdoc.docId || tdoc._id || ''), key = `${target.domain}/${target.kind}/${id}`, end = new Date(tdoc.endAt).getTime();
        if (!id || !Number.isFinite(end) || end <= Date.now() || (settings.autoAttendTitle && !String(tdoc.title).includes(settings.autoAttendTitle)) || (rules.length && !rules.includes(tdoc.rule))) continue;
        if (known[key] || statuses[id]?.attend === 1) continue;
        const detail = await jobJSON(job, contestURL(target.domain, target.kind, id));
        if (detail.tsdoc?.attend || +detail.tdoc?.owner === +user()._id) continue;
        results.push({ ...target, id, key, title: String(tdoc.title || id), endAt: end });
      }
    }
    return results;
  }
  async function attendOne(job, candidate) {
    await jobJSON(job, contestURL(candidate.domain, candidate.kind, candidate.id), postOptions({ operation: 'attend' }));
    const known = stored(ATTEND_KEY, {}), next = {};
    if (isObject(known)) for (const [key, end] of Object.entries(known)) if (end > Date.now()) next[key] = end;
    next[candidate.key] = candidate.endAt; save(ATTEND_KEY, next);
  }
  function renderAttendCandidates() {
    const box = $('#exhloj-attend-results'); if (!box) return;
    const list = workStates.auto.candidates || []; box.replaceChildren(el('p', {}, `待报名 ${list.length} 项`));
    list.forEach((item, index) => { const row = el('p'); row.append(el('a', { href: contestURL(item.domain, item.kind, item.id), target: '_blank', rel: 'noopener noreferrer' }, `${item.domain} · ${item.title}`), button('报名', 'attend-one', { 'data-index': index })); box.append(row); });
  }
  async function checkAttendance(automatic = false) {
    return runWork('auto', async (job, state) => {
      state.candidates = []; renderAttendCandidates();
      state.candidates = await findAttendCandidates(job); renderAttendCandidates();
      if (automatic) {
        for (const item of state.candidates) {
          if (!settings.autoAttend || !settings.contestHelper) break;
          await attendOne(job, item);
        }
        state.message = `自动报名处理 ${state.candidates.length} 项`; state.candidates = []; renderAttendCandidates();
      } else state.message = `检查完成，待报名 ${state.candidates.length} 项`;
    });
  }
  let autoTimer, autoSignature = '';
  function configureAutoAttend() {
    const signature = JSON.stringify([settings.contestHelper, settings.autoAttend, settings.autoAttendTargets, settings.autoAttendTitle, settings.autoAttendRules, settings.autoAttendInterval, user()._id]);
    if (signature === autoSignature) return;
    autoSignature = signature; clearTimeout(autoTimer); workJobs.get('auto')?.controller.abort();
    if (!settings.contestHelper || !settings.autoAttend || !(+user()._id > 0) || !settings.autoAttendTargets) return;
    const tick = async () => {
      if (signature !== autoSignature) return;
      const last = stored('exhloj.local.autoAttend.lastRun', 0), gap = settings.autoAttendInterval * 1000;
      if (Date.now() - last >= gap && !workJobs.has('auto')) {
        save('exhloj.local.autoAttend.lastRun', Date.now()); await task(() => checkAttendance(true));
      }
      if (signature === autoSignature) autoTimer = setTimeout(tick, gap);
    };
    autoTimer = setTimeout(tick, 300);
  }

  // 榜单按原始 score（100 分制）判断满分，不能把列中最高的部分分当作 AC。
  function boardAccepts(cell, rule, fullScore) {
    if (!cell) return [];
    if (cell.type === 'records' && Array.isArray(cell.raw)) return cell.raw.flatMap(part => boardAccepts({ ...part, type: 'record' }, rule, fullScore));
    const raw = cell.raw;
    const explicit = isObject(raw) ? raw.status : undefined;
    let accepted;
    if (explicit !== undefined) accepted = +explicit === 1;
    else if (cell.score !== undefined && cell.score !== null) accepted = Number(cell.score) >= 100;
    else if (rule === 'acm') accepted = /icon-check/.test(String(cell.value)) || /^\+\d*(?:\s|$)/.test(textOnly(cell.value).trim());
    else accepted = /^\d+(?:\.\d+)?(?:\s|\(|$)/.test(textOnly(cell.value).trim()) && parseFloat(textOnly(cell.value)) >= fullScore;
    return accepted ? [{ time: recordTime({ _id: objectId(raw) }), rid: objectId(raw) }] : [];
  }
  function acceptedBoard(body, domain, onAccept, onName) {
    const rows = body.rows; if (!Array.isArray(rows)) throw workError('榜单没有返回 rows，可能无权访问');
    const header = rows.find(row => Array.isArray(row) && row.some(cell => cell?.type === 'problem'));
    if (!header) { if (rows.length > 1 && body.tdoc?.pids?.length) throw workError('无法识别榜单题目列'); return; }
    const columns = header.map((cell, index) => ({ cell, index })).filter(x => x.cell?.type === 'problem');
    for (const row of rows) {
      if (row === header || !Array.isArray(row)) continue;
      const u = row.find(cell => cell?.type === 'user'), uid = Number(u?.raw);
      if (!Number.isSafeInteger(uid) || uid <= 0) continue;
      onName(uid, String(body.udict?.[uid]?.uname || textOnly(u.value) || `User ${uid}`));
      for (const { cell, index } of columns) {
        const pid = isObject(cell.raw) ? cell.raw.docId ?? cell.raw.pid : cell.raw;
        if (pid === undefined || pid === null) continue;
        for (const evidence of boardAccepts(row[index], body.tdoc?.rule, Number(body.tdoc?.score?.[pid]) || 100)) onAccept(uid, domain, pid, evidence.time);
      }
    }
  }
  function monitorFormSettings() {
    const form = $('#exhloj-juan-form'), domains = domainList(form.elements.domains.value);
    return { domains, records: form.elements.records.checked, contests: form.elements.contests.checked, homeworks: form.elements.homeworks.checked, period: +form.elements.period.value };
  }
  function openJuanMonitor() {
    if (!settings.juanMonitor) throw workError('请先启用 juan-monitor');
    const body = modal('卷王监视器'), form = el('form', { id: 'exhloj-juan-form' });
    body.append(el('p', {}, '同一用户在同一域通过同一道题只计一次。区间 AC 按可见提交时间去重；缺少时间的榜单成绩仅计入累计。'));
    const label = el('label', {}, '训练域 ID（每行一个）'), domains = el('textarea', { name: 'domains' }); domains.value = settings.juanDomains || domainId(); label.append(domains); form.append(label, button('读取可访问域', 'juan-domains'), el('div', { id: 'exhloj-juan-domains' }));
    for (const [name, text, checked] of [['records', '公开 AC 提交', settings.juanRecords], ['contests', '比赛榜单', settings.juanContests], ['homeworks', '作业榜单', settings.juanHomeworks]]) {
      const label = el('label'), input = el('input', { type: 'checkbox', name }); input.checked = checked; label.append(input, text); form.append(label);
    }
    const period = el('select', { name: 'period' });
    for (const [days, text] of [[0.25, '6 小时'], [1, '1 天'], [3, '3 天'], [7, '7 天'], [30, '30 天'], [90, '90 天'], [365, '1 年']]) period.append(el('option', { value: days }, text));
    period.value = String(settings.juanPeriod); form.append(el('span', {}, '近期范围 '), period, button('开始统计', 'juan-start'));
    body.append(form); workProgress(body, 'juan');
    body.append(button('导出 CSV', 'juan-csv'), button('导出 JSON', 'juan-json'), button('复制榜单', 'juan-copy'), el('div', { class: 'exhloj-work-results', id: 'exhloj-juan-results' }));
    renderJuanResults(); showWorkErrors(workStates.juan);
  }
  function renderJuanResults() {
    const box = $('#exhloj-juan-results'), state = workStates.juan; if (!box || !state.result) return;
    const result = state.result;
    box.replaceChildren(el('p', {}, `${result.complete ? '扫描完成' : '部分结果（不保存快照）'} · ${result.rows.length} 名用户 · ${result.period} 天内 AC · 无时间证据 ${result.unknownTime} 项`));
    box.append(el('p', {}, result.baseline ? `新增列与 ${new Date(result.baseline).toLocaleString()} 的相同范围快照比较` : '暂无可比较的完整快照，新增列显示 —'));
    const table = el('table'), head = el('tr'); for (const title of ['排名', '用户', '累计 AC', '区间 AC', '较上次新增']) head.append(el('th', {}, title)); table.append(head);
    result.rows.slice(0, 100).forEach((row, index) => {
      const tr = el('tr'), who = el('td'); who.append(el('a', { href: `/user/${row.uid}`, target: '_blank', rel: 'noopener noreferrer' }, `${row.name} (${row.uid})`));
      tr.append(el('td', {}, index + 1), who, el('td', {}, row.total), el('td', {}, row.recent), el('td', {}, row.added ?? '—')); table.append(tr);
    }); box.append(table);
  }
  async function scanJuan(config) {
    if (!config.records && !config.contests && !config.homeworks) throw workError('请至少选择一种统计来源');
    settings.juanDomains = config.domains.join('\n'); settings.juanRecords = config.records; settings.juanContests = config.contests; settings.juanHomeworks = config.homeworks; settings.juanPeriod = config.period; save(SETTINGS_KEY, settings);
    return runWork('juan', async (job, state) => {
      state.result = undefined; const users = new Map(), now = Date.now(), cutoff = now - config.period * 86400000;
      const get = uid => { if (!users.has(uid)) users.set(uid, { uid, name: `User ${uid}`, solved: new Map() }); return users.get(uid); };
      const name = (uid, value) => { if (+uid > 0 && value) get(+uid).name = String(value); };
      const accept = (uid, domain, pid, time) => {
        uid = +uid; if (!Number.isSafeInteger(uid) || uid <= 0 || pid === undefined || pid === null) return;
        const solved = get(uid).solved, key = `${domain}/${pid}`; solved.set(key, Math.max(solved.get(key) || 0, time > 0 && time <= now + 60000 ? time : 0));
      };
      const ingestRecords = (rows, domain) => { for (const r of rows) if (+r.status === 1) accept(r.uid, domain, r.pid, recordTime(r)); };
      const fail = (label, error) => { if (job.controller.signal.aborted || error.budget) throw error; state.errors.push(`${label}: ${error.message}`); };
      try { for (const domain of config.domains) {
        if (config.records) {
          try { ingestRecords(await listPages(job, `/d/${seg(domain)}/record?status=1`, 'rdocs', page => { for (const [uid, u] of Object.entries(page.udict || {})) name(uid, u.uname); }), domain); }
          catch (error) { if (error.rows) ingestRecords(error.rows, domain); fail(`${domain} 提交`, error); }
        }
        for (const [kind, enabled] of [['contest', config.contests], ['homework', config.homeworks]]) {
          if (!enabled) continue; let docs = [];
          try { docs = await listPages(job, `/d/${seg(domain)}/${kind}`, 'tdocs'); }
          catch (error) { docs = error.rows || []; fail(`${domain}/${kind} 列表`, error); }
          const seen = new Set();
          for (const doc of docs) {
            const id = String(doc.docId || doc._id || ''); if (!id || seen.has(id)) continue; seen.add(id);
            try { acceptedBoard(await jobJSON(job, contestURL(domain, kind, id, '/scoreboard')), domain, accept, name); }
            catch (error) { fail(`${domain}/${kind}/${id}`, error); }
          }
        }
      } } catch (error) { state.errors.push(error.message); state.status = job.controller.signal.aborted ? '已取消' : '未完成'; }
      const complete = !state.errors.length, scope = JSON.stringify([+user()._id, [...config.domains].sort(), config.records, config.contests, config.homeworks]);
      const snapshots = stored(SNAPSHOT_KEY, {}), prior = isObject(snapshots) ? snapshots[scope] : undefined;
      const baseline = complete && isObject(prior?.solved) ? prior : null;
      let unknownTime = 0;
      const rows = [...users.values()].filter(u => u.solved.size).map(u => {
        const before = new Set(baseline?.solved?.[u.uid] || []), keys = [...u.solved.keys()]; unknownTime += [...u.solved.values()].filter(time => !time).length;
        return { uid: u.uid, name: u.name, total: keys.length, recent: [...u.solved.values()].filter(time => time >= cutoff).length, added: baseline ? keys.filter(key => !before.has(key)).length : null };
      }).sort((a, b) => b.recent - a.recent || b.total - a.total || a.uid - b.uid);
      state.result = { version: VERSION, generatedAt: now, config, period: config.period, complete, baseline: baseline?.time || null, unknownTime, rows, errors: state.errors };
      if (complete) {
        const saved = { time: now, solved: Object.fromEntries([...users.values()].filter(u => u.solved.size).map(u => [u.uid, [...u.solved.keys()].sort()])),
          history: [...(Array.isArray(prior?.history) ? prior.history : []).slice(-30), { time: now, counts: Object.fromEntries(rows.map(r => [r.uid, r.total])) }] };
        const entries = Object.entries(isObject(snapshots) ? snapshots : {}).filter(([key]) => key !== scope).sort((a, b) => (a[1]?.time || 0) - (b[1]?.time || 0)).slice(-4);
        const next = { ...Object.fromEntries(entries), [scope]: saved };
        if (JSON.stringify(next).length <= 8 * 1024 * 1024) save(SNAPSHOT_KEY, next);
        else state.errors.push('结果过大，本次快照未保存');
      }
      state.message = `统计 ${rows.length} 名用户；按区间 AC 排序，同题同域去重`; renderJuanResults();
      try { if (page.UiContext?.exhloj) page.UiContext.exhloj['juan-monitor'] = state.result; } catch {}
    });
  }
  function juanResult() { const result = workStates.juan.result; if (!result) throw workError('请先完成一次统计'); return result; }
  function installWorkMenu(menu) {
    if (!menu) return;
    for (const [enabled, action, title] of [[settings.contestHelper, 'contest-helper', '比赛助手'], [settings.juanMonitor, 'juan-open', '卷王监视器'], [settings.userModule, 'user-open', '用户工具']]) {
      const existing = $(`[data-exh-work-menu="${action}"]`, menu);
      if (!enabled) { existing?.remove(); continue; }
      if (existing) continue;
      const li = el('li', { class: 'menu__item', 'data-exh-work-menu': action }); li.append(el('a', { class: 'menu__link', href: '#exhloj-' + action, 'data-exh-action': action }, title)); menu.append(li);
    }
  }
  function contestToolbar() {
    if (!settings.contestHelper) { $('#exhloj-contest-tools')?.remove(); return; }
    if (!['contest_detail', 'homework_detail', 'contest_scoreboard', 'homework_scoreboard'].includes(pageName()) || $('#exhloj-contest-tools') || !mainColumn()) return;
    const tools = el('div', { id: 'exhloj-contest-tools', class: 'exhloj-local-toolbar' }); tools.append(button('比赛助手：导出与报名', 'contest-helper')); mainColumn().prepend(tools);
  }


  // user：所有资料编辑和 Rating 结算均在本机完成，不设置指定 UID 的编辑门槛。
  const USER_INITIAL_RATING = 1800;
  const USER_DISPLAY_MODES = [['no-change', '不更改'], ['display-realname', '显示姓名'], ['display-realname-color', '姓名及颜色'],
    ['display-username', '显示用户名'], ['display-username-color', '用户名及颜色'], ['display-username-realname', '姓名（用户名）'], ['display-username-realname-color', '姓名（用户名）及颜色']];
  let userMemo, userMemoSignature, userMemoRaw, userLoadError = '';
  const userNameNodes = new Map();
  function localUid(value) { const uid = Number(value); if (!Number.isSafeInteger(uid) || uid <= 0) throw workError('用户 ID 必须为正整数'); return uid; }
  function localNumber(value, label, min = 0, max = 1e9) {
    const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) throw workError(`${label} 应在 ${min}–${max} 之间`); return n;
  }
  function localText(value, max = 500) { return typeof value === 'string' ? value.slice(0, max) : ''; }
  function normalizeUserData(value = {}) {
    if (!isObject(value)) throw workError('用户资料必须是对象');
    const result = { oiers: {}, teachers: [], practice: {} };
    if (value.oiers !== undefined && !isObject(value.oiers) && !Array.isArray(value.oiers)) throw workError('oiers 必须为用户 ID 映射');
    for (const [key, item] of Object.entries(value.oiers || {})) {
      if (item === null) continue; const uid = localUid(key);
      if (!isObject(item)) throw workError(`用户 ${uid} 的资料必须是对象`);
      const data = { name: localText(item.name, 120), uname: localText(item.uname, 120), oierId: localNumber(item.oierId || 0, 'OIerDB ID'),
        level: localNumber(item.level || 0, 'CCF 级别', 0, 10), grade: localNumber(item.grade || 0, '高中毕业年份', 0, 3000), records: [] };
      for (const key of ['oierId', 'level', 'grade']) if (!Number.isInteger(data[key])) throw workError(`${key} 必须为整数`);
      for (const key of ['oierRank', 'oierScore']) if (item[key] !== undefined) {
        data[key] = localNumber(item[key], key, key === 'oierRank' ? 1 : 0, 1e12);
        if (key === 'oierRank' && !Number.isInteger(data[key])) throw workError('OIerDb 排名必须为整数');
      }
      if (item.records !== undefined && !Array.isArray(item.records)) throw workError(`用户 ${uid} 的获奖记录必须是数组`);
      if ((item.records?.length || 0) > 200) throw workError('每人至多 200 条获奖记录');
      data.records = (item.records || []).map(record => {
        if (!isObject(record)) throw workError('获奖记录必须为对象');
        const item = { contest: localText(record.contest, 250), awards: localText(record.awards, 120), score: record.score === '' || record.score === undefined ? '' : localNumber(record.score, '获奖分数', -1e6, 1e9) };
        for (const key of ['fullScore', 'rank', 'participants', 'contestId', 'schoolId']) if (record[key] !== undefined) {
          item[key] = localNumber(record[key], key, key === 'fullScore' ? 0 : 1);
          if (key !== 'fullScore' && !Number.isInteger(item[key])) throw workError(`${key} 必须为整数`);
        }
        for (const key of ['province', 'school', 'grade']) if (record[key] !== undefined) item[key] = localText(record[key], 250);
        return item;
      }); result.oiers[uid] = data;
    }
    if (value.teachers !== undefined && !Array.isArray(value.teachers)) throw workError('teachers 必须为用户 ID 数组');
    result.teachers = [...new Set((value.teachers || []).map(localUid))];
    if (value.practice !== undefined && !isObject(value.practice)) throw workError('practice 必须为用户 ID 映射');
    for (const [uid, score] of Object.entries(value.practice || {})) result.practice[localUid(uid)] = localNumber(score, '题目分');
    return result;
  }
  function normalizeUserRatings(value = {}) {
    if (!isObject(value) || value.contests !== undefined && !Array.isArray(value.contests) || value.records !== undefined && !Array.isArray(value.records)) throw workError('Rating 数据应包含 contests 和 records 数组');
    const contests = (value.contests || []).map(row => {
      if (!Array.isArray(row) || row.length < 3 || typeof row[0] !== 'string' || !row[0].trim()) throw workError('比赛信息格式应为 [比赛路径, 标题, 权重]');
      return [row[0].trim().slice(0, 250), localText(row[1], 250), localNumber(row[2], 'Rating 权重', 0, 10)];
    });
    if (new Set(contests.map(row => row[0])).size !== contests.length) throw workError('Rated 比赛路径不能重复');
    const seen = new Set(), records = (value.records || []).map(row => {
      if (!Array.isArray(row) || row.length < 5) throw workError('Rating 记录格式应为 [UID, 比赛下标, 排名, 新 Rating, 表现分]');
      const uid = localUid(row[0]), index = Number(row[1]), rank = Number(row[2]);
      if (!Number.isInteger(index) || index < 0 || index >= contests.length || !Number.isInteger(rank) || rank <= 0) throw workError('Rating 记录的比赛下标或排名无效');
      const key = `${uid}/${index}`; if (seen.has(key)) throw workError('同一比赛中同一用户的 Rating 记录重复'); seen.add(key);
      return [uid, index, rank, localNumber(row[3], 'Rating', -1e6, 1e6), localNumber(row[4], '表现分', -1e6, 1e6)];
    });
    return { contests, records, commands: localText(value.commands, 200000) };
  }
  function userStore() {
    let raw; try { raw = GM_getValue(CACHE_KEY, null); } catch {}
    if (typeof raw === 'string' && raw === userMemoRaw && userMemo) return userMemo;
    userMemoRaw = typeof raw === 'string' ? raw : undefined;
    const cache = cacheObject(), signature = JSON.stringify([cache['exhloj.user'], cache['exhloj.ratedcontests']]);
    if (userMemo && userMemoSignature === signature) return userMemo;
    userMemoSignature = signature; userLoadError = '';
    let users, ratings;
    try { users = normalizeUserData(cache['exhloj.user']); ratings = normalizeUserRatings(cache['exhloj.ratedcontests']); }
    catch (error) { userLoadError = error.message; users = normalizeUserData(); ratings = normalizeUserRatings(); }
    const histories = new Map(), byContest = new Map();
    for (const row of ratings.records) {
      const [uid, index, rank, rating, performance] = row, history = histories.get(uid) || [];
      const record = { uid, index, rank, rating, performance, old: history.at(-1)?.rating ?? USER_INITIAL_RATING };
      history.push(record); histories.set(uid, history); byContest.set(`${index}/${uid}`, record);
    }
    return userMemo = { users, ratings, histories, byContest };
  }
  function writeUserStore(users, ratings) {
    const nextUsers = normalizeUserData(users), nextRatings = normalizeUserRatings(ratings), cache = cacheObject();
    cache['exhloj.user'] = nextUsers; cache['exhloj.ratedcontests'] = nextRatings; cache['exhloj.userStoreVersion'] = Date.now();
    if (new Blob([JSON.stringify(cache)]).size > LIMIT - 32768) throw workError('本地用户资料过大，请减少获奖记录或比赛数量');
    save(CACHE_KEY, cache); userMemoSignature = userMemoRaw = undefined; refreshUserModule();
  }
  function userRating(uid) { return userStore().histories.get(+uid)?.at(-1)?.rating ?? USER_INITIAL_RATING; }
  function userLevel(rating) { const thresholds = [0, 0, 1200, 1400, 1600, 1900, 2100, 2400, 3000, 4000, 5000]; let level = 1; while (level < 10 && rating >= thresholds[level + 1]) level++; return level; }
  function ratingNode(rating) { return el('span', { class: `exhloj-user-rating exhloj-user-level-${userLevel(rating)}` }, rating); }
  function localUserName(uid) { return userStore().users.oiers[uid]?.uname || current('udict')?.[uid]?.uname || (+current('udoc')?._id === +uid ? current('udoc').uname : '') || `User ${uid}`; }
  function localUserLink(uid) { return el('a', { href: `/user/${uid}`, 'data-exh-user': uid }, localUserName(uid)); }
  function uidFromNode(node) {
    if (node.dataset.exhUser) return +node.dataset.exhUser;
    if (!node.getAttribute('href')) return node.classList.contains('user-profile-name') ? +current('udoc')?._id : 0;
    try { const url = new URL(node.getAttribute('href'), location.origin); return url.origin === location.origin ? +(url.pathname.match(/\/user\/(\d+)\/?$/)?.[1] || 0) : 0; } catch { return 0; }
  }
  function resetUserName(node, state) {
    if (state.applied === node.innerHTML) node.replaceChildren(...state.nodes);
    node.classList.remove('exhloj-user-name', ...Array.from({ length: 10 }, (_, i) => `exhloj-user-level-${i + 1}`), 'exhloj-user-level-teacher');
    node.removeAttribute('data-exh-user-rendered');
  }
  function ccfBadge(level) {
    const badge = el('span', { class: `exhloj-user-ccf exhloj-user-ccf-${level <= 5 ? 'green' : level <= 7 ? 'blue' : 'gold'}`, title: `本地资料：CCF ${level} 级`, 'aria-label': `CCF ${level} 级` });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M16 8C16 6.84375 15.25 5.84375 14.1875 5.4375C14.6562 4.4375 14.4688 3.1875 13.6562 2.34375C12.8125 1.53125 11.5625 1.34375 10.5625 1.8125C10.1562 0.75 9.15625 0 8 0C6.8125 0 5.8125 0.75 5.40625 1.8125C4.40625 1.34375 3.15625 1.53125 2.34375 2.34375C1.5 3.1875 1.3125 4.4375 1.78125 5.4375C0.71875 5.84375 0 6.84375 0 8C0 9.1875 0.71875 10.1875 1.78125 10.5938C1.3125 11.5938 1.5 12.8438 2.34375 13.6562C3.15625 14.5 4.40625 14.6875 5.40625 14.2188C5.8125 15.2812 6.8125 16 8 16C9.15625 16 10.1562 15.2812 10.5625 14.2188C11.5938 14.6875 12.8125 14.5 13.6562 13.6562C14.4688 12.8438 14.6562 11.5938 14.1875 10.5938C15.25 10.1875 16 9.1875 16 8ZM11.4688 6.625L7.375 10.6875C7.21875 10.8438 7 10.8125 6.875 10.6875L4.5 8.3125C4.375 8.1875 4.375 7.96875 4.5 7.8125L5.3125 7C5.46875 6.875 5.6875 6.875 5.8125 7.03125L7.125 8.34375L10.1562 5.34375C10.3125 5.1875 10.5312 5.1875 10.6562 5.34375L11.4688 6.15625C11.5938 6.28125 11.5938 6.5 11.4688 6.625Z');
    svg.append(path); badge.append(svg); return badge;
  }
  function refreshUserNames() {
    const store = userStore();
    for (const [node, state] of userNameNodes) if (!node.isConnected) userNameNodes.delete(node);
    if (!settings.userModule) { for (const [node, state] of userNameNodes) resetUserName(node, state); userNameNodes.clear(); return; }
    const candidates = $$('.user-profile-name, .col--submit-by>a, .col--user a[href], a.username[href], a[data-exh-user]')
      .filter(node => !node.closest('#exhloj-local-dialog, #exhloj-local-user-card, .user-profile-badge') && !$('.user-profile-name', node)
        && (node.matches('.user-profile-name, a.username, a[data-exh-user]') || node.textContent.trim()));
    const active = new Set(candidates);
    for (const [node, state] of userNameNodes) if (!active.has(node)) { resetUserName(node, state); userNameNodes.delete(node); }
    for (const node of candidates) {
      const uid = uidFromNode(node); if (!(uid > 0)) continue;
      let state = userNameNodes.get(node);
      if (!state || node.innerHTML !== state.applied) {
        for (const badge of $$(':scope > .exhloj-user-ccf', node)) badge.remove();
        if (state) { node.classList.remove('exhloj-user-name', ...Array.from({ length: 10 }, (_, i) => `exhloj-user-level-${i + 1}`), 'exhloj-user-level-teacher'); }
        const text = node.textContent.trim(), known = current('udict')?.[uid]?.uname || (+current('udoc')?._id === uid ? current('udoc').uname : '');
        state = { nodes: [...node.childNodes], text, uname: known || text.match(/\(([^()]*)\)\s*$/)?.[1] || text, applied: node.innerHTML }; userNameNodes.set(node, state);
      }
      const profile = store.users.oiers[uid], mode = settings.userDisplay, uname = profile?.uname || state.uname || `User ${uid}`, name = profile?.name || uname;
      const text = mode === 'no-change' ? state.text : mode.includes('username-realname') ? (profile?.name ? `${name} (${uname})` : uname) : mode.includes('realname') ? name : uname;
      const level = store.users.teachers.includes(uid) ? 'teacher' : userLevel(userRating(uid));
      const signature = JSON.stringify([uid, text, mode, settings.userCCF && profile?.level, level]);
      if (node.dataset.exhUserRendered === signature && node.innerHTML === state.applied) continue;
      if (mode === 'no-change') node.replaceChildren(...state.nodes); else node.textContent = text;
      node.classList.remove('exhloj-user-name', ...Array.from({ length: 10 }, (_, i) => `exhloj-user-level-${i + 1}`), 'exhloj-user-level-teacher');
      if (mode.endsWith('-color')) node.classList.add('exhloj-user-name', `exhloj-user-level-${level}`);
      if (settings.userCCF && profile?.level >= 3) node.append(ccfBadge(profile.level));
      node.dataset.exhUserRendered = signature; state.applied = node.innerHTML;
    }
  }
  function userProfileId() { return +(location.pathname.match(/\/user\/(\d+)/)?.[1] || 0) || +current('udoc')?._id; }
  function profileGrade(grade) {
    if (!grade) return '未填写'; const date = new Date(), year = date.getFullYear(), offset = grade - year + (date.getMonth() < 8 ? 1 : 0);
    return ({ 1: '高三', 2: '高二', 3: '高一', 4: '初三', 5: '初二', 6: '初一', 7: '六年级', 8: '五年级', 9: '四年级', 10: '三年级' })[offset] || (offset <= 0 ? `高中毕业 ${1 - offset} 年` : '未到对应年级');
  }
  function refreshUserProfile() {
    const prior = $('#exhloj-local-user-card'), uid = userProfileId();
    if (!settings.userModule || pageName() !== 'user_detail' || !(uid > 0)) { prior?.remove(); return; }
    const target = profilePanelTarget(); if (!target) return;
    if (prior && prior.parentElement !== target) target.prepend(prior);
    const store = userStore(), profile = store.users.oiers[uid], history = store.histories.get(uid) || [], teacher = store.users.teachers.includes(uid);
    const signature = JSON.stringify([uid, profile, teacher, store.users.practice[uid], history]); if (prior?.dataset.signature === signature) return;
    const section = el('section', { id: 'exhloj-local-user-card', class: 'section side', 'data-signature': signature }), body = el('div', { class: 'section__body typo' });
    section.append(el('h2', { class: 'section__title' }, '用户信息 · 本地资料'), body);
    const dl = el('dl', { class: 'exhloj-user-data' });
    for (const [title, value] of [['教练标记', teacher ? '是' : '否'], ['姓名', profile?.name || '未填写'], ['CCF 评级', profile?.level ? `${profile.level} 级` : '未填写'], ['就读年级', profileGrade(profile?.grade)], ['题目分', store.users.practice[uid] ?? '未填写']]) dl.append(el('dt', {}, title), el('dd', {}, value));
    const rating = el('dd'); rating.append(ratingNode(userRating(uid))); dl.append(el('dt', {}, 'Rating'), rating);
    if (profile?.oierId) { const dd = el('dd'); dd.append(el('a', { href: `https://oier.baoshuo.dev/oier/${profile.oierId}`, target: '_blank', rel: 'noopener noreferrer' }, `#${profile.oierId}`)); dl.append(el('dt', {}, 'OIerDB'), dd); }
    if (profile?.oierRank) dl.append(el('dt', {}, 'OIerDb 排名'), el('dd', {}, profile.oierRank));
    if (profile?.oierScore !== undefined) dl.append(el('dt', {}, 'OIerDb 积分'), el('dd', {}, profile.oierScore));
    body.append(dl, button('编辑本地资料', 'user-edit', { 'data-uid': uid }), button('Rating 历史', 'user-history', { 'data-uid': uid }), button('Rating 排行榜', 'user-ranking'));
    if (profile?.records.length) {
      body.append(el('h3', {}, '获奖信息'));
      for (const record of profile.records) {
        const p = el('p'), medal = ['一等奖', '金牌'].includes(record.awards) ? '🥇 ' : ['二等奖', '银牌'].includes(record.awards) ? '🥈 ' : ['三等奖', '铜牌'].includes(record.awards) ? '🥉 ' : '';
        p.append(el('strong', {}, record.contest), el('br'), el('span', {}, `${medal}${record.awards}${record.score === '' ? '' : `（${record.score}${record.fullScore === undefined ? '' : ` / ${record.fullScore}`} 分）`}`));
        const details = [record.rank ? `排名 ${record.rank}${record.participants ? ` / ${record.participants}` : ''}` : '', record.province, record.school, record.grade].filter(Boolean);
        if (details.length) p.append(el('br'), el('small', {}, details.join(' · '))); body.append(p);
      }
    }
    if (prior) prior.replaceWith(section); else target.prepend(section);
  }
  function refreshUserScoreboards() {
    const store = userStore(), context = contestContext(), index = store.ratings.contests.findIndex(row => row[0] === `${context.domain}/${context.id}`);
    for (const table of $$('.section__table-container > .data-table, table[data-exh-scoreboard]')) {
      if (!settings.userModule || pageName() !== 'contest_scoreboard' || index < 0) { for (const cell of $$('[data-exh-user-column]', table)) cell.remove(); delete table.dataset.exhUserRating; continue; }
      const signature = JSON.stringify([index, store.ratings.records]);
      if (table.dataset.exhUserRating !== signature) { for (const cell of $$('[data-exh-user-column]', table)) cell.remove(); table.dataset.exhUserRating = signature; }
      const col = $('col.col--total_score', table); if (col && !col.previousElementSibling?.hasAttribute('data-exh-user-column')) for (const name of ['performance', 'rating']) col.before(el('col', { 'data-exh-user-column': name }));
      for (const row of $$('tr', table)) {
        const total = $(':scope > .col--total_score', row); if (!total) continue;
        const uid = +$('button.star[data-uid]', row)?.dataset.uid || uidFromNode($('.col--user a', row) || el('span')), record = store.byContest.get(`${index}/${uid}`);
        const rowSignature = JSON.stringify([index, uid, total.tagName, record]);
        if (row.dataset.exhUserRatingRow === rowSignature && $$('[data-exh-user-column]', row).length === 2) continue;
        for (const cell of $$('[data-exh-user-column]', row)) cell.remove(); row.dataset.exhUserRatingRow = rowSignature;
        if (total.tagName === 'TH') { total.before(el('th', { 'data-exh-user-column': 'performance' }, '表现分'), el('th', { 'data-exh-user-column': 'rating' }, '本地 Rating Δ')); continue; }
        const performance = el('td', { 'data-exh-user-column': 'performance' }, record?.performance ?? ''), rating = el('td', { 'data-exh-user-column': 'rating' });
        if (record) { const diff = record.rating - record.old; rating.append(ratingNode(record.old), el('span', { class: diff > 0 ? 'exhloj-user-gain' : diff < 0 ? 'exhloj-user-loss' : '' }, ` ${diff >= 0 ? '+' : '−'}${Math.abs(diff)} = `), ratingNode(record.rating)); }
        total.before(performance, rating);
      }
    }
  }
  function refreshUserModule() {
    if (!settings.userModule) workJobs.get('user')?.controller.abort();
    try { if (page.UiContext?.exhloj) { if (settings.userModule) page.UiContext.exhloj.user = localUserAPI; else delete page.UiContext.exhloj.user; } } catch {}
    refreshUserProfile(); refreshUserScoreboards(); refreshUserNames();
  }
  function userToolBody(title) { if (!settings.userModule) throw workError('请先启用 user 模块'); return modal(title); }
  function openUserTools() {
    const body = userToolBody('用户工具 · 本地'), store = userStore();
    body.append(el('p', {}, '资料、教练标记和 Rating 只在本机生效。所有用户均可编辑，没有特定 UID 的管理员限制。'));
    if (userLoadError) body.append(el('p', { class: 'exhloj-work-errors' }, `本地数据格式异常：${userLoadError}；请用 JSON 工具修正或重新导入。`));
    const form = el('form', { id: 'exhloj-user-options' }), label = el('label', {}, '名字显示 '), display = el('select', { name: 'display' });
    for (const [value, title] of USER_DISPLAY_MODES) display.append(el('option', { value }, title)); display.value = settings.userDisplay; label.append(display); form.append(label);
    const ccf = el('input', { name: 'ccf', type: 'checkbox' }); ccf.checked = settings.userCCF; const ccfLabel = el('label'); ccfLabel.append(ccf, '显示本地 CCF 评级标记'); form.append(ccfLabel, button('保存显示设置', 'user-options-save')); body.append(form);
    body.append(el('p', {}, `${Object.keys(store.users.oiers).length} 份资料，${store.ratings.contests.length} 场比赛，${store.ratings.records.length} 条 Rating 记录。`));
    const uidLabel = el('label', {}, '编辑用户 ID '); uidLabel.append(el('input', { type: 'number', min: 1, step: 1, id: 'exhloj-user-id', value: userProfileId() || +user()._id || 1 })); body.append(uidLabel, button('编辑资料', 'user-edit'), button('查看 Rating 历史', 'user-history'));
    body.append(button('Rating 排行榜', 'user-ranking'), button('Rated 比赛与结算', 'user-rated'), button('资料 JSON 导入 / 编辑', 'user-json'), button('导出用户数据', 'user-export'), button('从卷王统计更新题目分', 'user-practice'));
  }
  function oierText(value) {
    return String(value || '').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\*\*|__|`/g, '').replace(/&#(x[0-9a-f]+|\d+);/gi, (all, code) => { const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : +code; return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; })
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
      .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\u00a0/g, ' ').normalize('NFKC').trim();
  }
  function oierPathId(value, kind) {
    try { const url = new URL(value, 'https://oier.baoshuo.dev'); return url.hostname === 'oier.baoshuo.dev' && /^https?:$/.test(url.protocol) && !url.username && !url.password ? +(url.pathname.match(new RegExp(`^/${kind}/(\\d+)/?$`))?.[1] || 0) : 0; } catch { return 0; }
  }
  function oierCellId(cell, kind) {
    for (const match of String(cell).matchAll(/(?:https?:\/\/oier\.baoshuo\.dev)?\/(?:oier|contest|school)\/\d+\/?(?:\?[^\s)"'<>]*)?/g)) {
      if (match.index > 0 && /[\w.:/]/.test(String(cell)[match.index - 1]) && !match[0].startsWith('http')) continue;
      const id = oierPathId(match[0], kind); if (id) return id;
    } return 0;
  }
  function oierGradeYear(grade, date = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric' }).formatToParts(date).map(part => [part.type, part.value]));
    const offsets = { 高三: 1, 高二: 2, 高一: 3, 初三: 4, 初二: 5, 初一: 6, 六年级: 7, 五年级: 8, 四年级: 9, 三年级: 10, 二年级: 11, 一年级: 12 };
    const graduated = grade.match(/^高中毕业\s*(\d+)\s*年$/), offset = graduated ? 1 - +graduated[1] : offsets[grade];
    return offset === undefined ? undefined : +parts.year + offset - (+parts.month < 9 ? 1 : 0);
  }
  function oierHTMLDocument(html) {
    const template = document.createElement('template'); template.innerHTML = html;
    for (const node of template.content.querySelectorAll('script,style,noscript,iframe,object,embed,link,meta,svg')) node.remove();
    for (const img of template.content.querySelectorAll('img')) img.replaceWith(document.createTextNode(img.alt || ''));
    return template.content;
  }
  function oierHTMLText(root) {
    let text = ''; const block = /^(?:DIV|P|H[1-6]|SECTION|ARTICLE|LI|TR|BR)$/;
    const visit = node => { if (node.nodeType === Node.TEXT_NODE) { text += node.nodeValue; return; } const split = block.test(node.nodeName); if (split) text += '\n'; for (const child of node.childNodes) visit(child); if (split) text += '\n'; };
    visit(root); return text;
  }
  function oierRatio(value, label) {
    const clean = oierText(value).replace(/,/g, '').replace(/\s+/g, '');
    if (!clean || /^[-—–]$/.test(clean)) return {};
    const match = clean.match(/^(-?\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/);
    if (!match) throw workError(`${label}格式无法识别：${oierText(value).slice(0, 50)}`);
    return { value: +match[1], total: match[2] === undefined ? undefined : +match[2] };
  }
  function parseOIerPaste(text, html = '', sourceURL = '', date = new Date()) {
    if (new Blob([text, html]).size > 512 * 1024) throw workError('粘贴内容超过 512 KiB，请只复制选手信息和获奖表格');
    if (!String(text).trim() && !String(html).trim()) throw workError('请先粘贴 OIerDb 选手页面内容');
    const root = html ? oierHTMLDocument(html) : null, plain = root ? oierHTMLText(root) : text,
      lines = String(plain).split(/\r?\n/).map(line => oierText(line).replace(/^#{1,6}\s*/, '').trim()).filter(Boolean), all = lines.join('\n'), profile = {}, warnings = [];
    const info = lines.findIndex(line => /^选手信息\s*$/.test(line));
    if (info > 0) {
      const candidate = lines[info - 1].replace(/\s*[-|·]\s*OIerDb.*$/i, '').trim();
      if (candidate && candidate.length <= 80 && !/https?:|选手信息|获奖信息|OIerDb|首页|Source Code|Made with/i.test(candidate)) profile.name = candidate;
    }
    const level = all.match(/CCF\s*(?:程序设计能力等级|评级|等级)\s*[:：]?\s*(\d+)\s*级/i);
    if (level) { if (+level[1] <= 10) profile.level = +level[1]; else warnings.push('CCF 等级超出 0–10，已保留原值'); }
    const grade = all.match(/现在(?:就读于?|是|读)?\s*(高中毕业\s*\d+\s*年|高[一二三]|初[一二三]|[一二三四五六]年级)/)?.[1];
    if (grade) profile.grade = oierGradeYear(grade, date);
    const ranking = all.match(/OIerDb\s*排名\s*[:：]?\s*([\d,]+)\s*\(\s*([\d,.]+)\s*分/i);
    if (ranking) { profile.oierRank = +ranking[1].replace(/,/g, ''); profile.oierScore = +ranking[2].replace(/,/g, ''); }
    if (sourceURL.trim()) { const id = oierPathId(sourceURL.trim(), 'oier'); if (!id) throw workError('选手页链接格式应为 https://oier.baoshuo.dev/oier/数字ID'); profile.oierId = id; }
    else {
      const ids = new Set();
      for (const match of String(text).matchAll(/https?:\/\/oier\.baoshuo\.dev\/oier\/\d+\/?(?:[?#][^\s)"'<>]*)?/g)) { const id = oierPathId(match[0], 'oier'); if (id) ids.add(id); }
      for (const link of root?.querySelectorAll('a[href]') || []) { const id = oierPathId(link.getAttribute('href'), 'oier'); if (id) ids.add(id); }
      if (ids.size === 1) profile.oierId = [...ids][0]; else if (ids.size > 1) warnings.push('出现多个选手 ID，已保留原值');
    }
    const records = [], seen = new Set(); let failed = 0;
    const headerMap = cells => { const map = {}; cells.forEach((cell, i) => { const label = oierText(cell).replace(/\s/g, ''); for (const [name, title] of [['award', '奖项'], ['score', '分数'], ['rank', '选手排名'], ['province', '省份'], ['school', '就读学校'], ['grade', '年级']]) if (label === title) map[name] = i; }); return map; };
    const readRow = (cells, map, raw = cells) => {
      if (cells.length <= Math.max(map.award, map.score) || cells.every(cell => /^:?-{2,}:?$/.test(oierText(cell)))) return;
      try {
        const awardText = oierText(cells[map.award]), match = awardText.match(/一等奖|二等奖|三等奖|金牌|银牌|铜牌|优胜奖|鼓励奖|成功参赛奖|参赛奖|参与奖/);
        if (!match) { if (awardText) failed++; return; }
        const medal = awardText.match(/[🥇🥈🥉]/u)?.[0], award = match[0], contest = awardText.replace(award, '').replace(/[🥇🥈🥉🏅🎖\ufe0f]/gu, '').trim();
        if (!contest) throw workError('缺少比赛名称');
        const score = oierRatio(cells[map.score], '分数'), rank = map.rank === undefined ? {} : oierRatio(cells[map.rank], '排名');
        const record = { contest, awards: award || ({ '🥇': '金牌', '🥈': '银牌', '🥉': '铜牌' })[medal], score: score.value ?? '' };
        if (score.total !== undefined) record.fullScore = score.total;
        if (rank.value !== undefined) record.rank = rank.value; if (rank.total !== undefined) record.participants = rank.total;
        for (const field of ['province', 'school', 'grade']) if (map[field] !== undefined) record[field] = oierText(cells[map[field]]);
        for (const [field, kind, index] of [['contestId', 'contest', map.award], ['schoolId', 'school', map.school]]) { const id = index === undefined ? 0 : oierCellId(raw[index], kind); if (id) record[field] = id; }
        const key = JSON.stringify(record); if (!seen.has(key)) { seen.add(key); records.push(record); }
      } catch { failed++; }
    };
    for (const table of root?.querySelectorAll('table') || []) {
      let map;
      for (const row of table.rows) {
        const cells = [...row.cells].map(cell => oierText(oierHTMLText(cell))), next = headerMap(cells);
        if (next.award !== undefined && next.score !== undefined) { map = next; continue; }
        if (map) readRow(cells, map, [...row.cells].map(cell => cell.innerHTML));
      }
    }
    if (!records.length) {
      let map; const rawLines = String(text || plain).split(/\r?\n/);
      for (const line of rawLines) {
        let cells;
        if (line.includes('|')) cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(value => value.replace(/\\\|/g, '|').trim());
        else if (line.includes('\t')) cells = line.split('\t').map(value => value.trim());
        else continue;
        const next = headerMap(cells); if (next.award !== undefined && next.score !== undefined) { map = next; continue; }
        if (map) readRow(cells, map);
      }
      if (!records.length) {
        const start = lines.findIndex((line, index) => line === '奖项' && lines[index + 1] === '分数' && lines[index + 2] === '选手排名' && lines[index + 3] === '省份' && lines[index + 4] === '就读学校' && lines[index + 5] === '年级');
        if (start >= 0) for (let i = start + 6; i + 5 < lines.length; i += 6) readRow(lines.slice(i, i + 6), { award: 0, score: 1, rank: 2, province: 3, school: 4, grade: 5 });
      }
    }
    if (records.length > 200) throw workError('一次至多识别 200 条获奖记录');
    if (records.length) profile.records = records;
    if (failed) warnings.push(`${failed} 行获奖信息未能识别，请对照原文检查`);
    if (!profile.name) warnings.push('未识别到姓名，已保留原值');
    if (profile.grade === undefined) warnings.push('未识别到当前年级，已保留原值');
    if (!profile.oierId) warnings.push('内容中没有唯一的选手页 ID，已保留原值；排名不是选手 ID');
    if (!records.length && !level && info < 0) throw workError('未识别到 OIerDb 选手信息，请复制姓名、选手信息和获奖表格');
    return { profile, grade, warnings, records: records.length };
  }
  function fillUserFromOIer() {
    const form = $('#exhloj-user-editor'), area = $('#exhloj-user-oier-paste'), status = $('#exhloj-user-oier-status');
    try {
      const parsed = parseOIerPaste(area.value, area.exhlojClipboardHTML || '', form.elements.oierURL.value);
      normalizeUserData({ oiers: { [form.dataset.uid]: { ...userStore().users.oiers[form.dataset.uid], ...parsed.profile } } });
      for (const key of ['name', 'level', 'grade', 'oierId']) if (Object.hasOwn(parsed.profile, key)) form.elements[key].value = parsed.profile[key];
      if (parsed.profile.records) form.elements.awards.value = JSON.stringify(parsed.profile.records, null, 2);
      form.exhlojOIerPreview = parsed.profile;
      status.textContent = `已填入${parsed.profile.name ? ` ${parsed.profile.name}` : ''} · ${parsed.records} 条获奖记录${parsed.grade ? ` · 当前${parsed.grade}，高中毕业年份 ${parsed.profile.grade}` : ''}。点击“保存本地资料”后生效。\n${parsed.warnings.join('\n')}`;
    } catch (error) { status.textContent = `识别失败：${error.message}`; }
  }
  function userOIerPasteControls(form) {
    const box = el('details', { open: '', class: 'exhloj-oier-import' }); box.append(el('summary', {}, '粘贴 OIerDb 选手页面，自动识别'));
    box.append(el('p', {}, '复制选手页面后粘贴到下方，支持网页、普通文本和 Markdown。识别到的字段会填入表单，获奖记录会替换为本次识别结果；检查后点击保存。'));
    const area = el('textarea', { id: 'exhloj-user-oier-paste', placeholder: '粘贴姓名、选手信息和获奖表格…', spellcheck: 'false' });
    const url = el('label', {}, '选手页链接（可选，用于识别 OIerDB ID）'); url.append(el('input', { type: 'text', class: 'exhloj-source-input', name: 'oierURL', placeholder: 'https://oier.baoshuo.dev/oier/12345' }));
    box.append(url, area, button('识别并填入资料', 'user-oier-parse'), el('pre', { id: 'exhloj-user-oier-status', role: 'status', 'aria-live': 'polite' })); form.append(box);
    area.addEventListener('input', () => { area.exhlojClipboardHTML = ''; });
    area.addEventListener('paste', event => { if (!event.clipboardData) return; event.preventDefault(); area.value = event.clipboardData.getData('text/plain') || ''; area.exhlojClipboardHTML = event.clipboardData.getData('text/html') || ''; fillUserFromOIer(); });
  }

  function openUserEditor(uid) {
    uid = localUid(uid); const body = userToolBody(`编辑本地用户 #${uid}`), store = userStore(), profile = store.users.oiers[uid] || {}, form = el('form', { id: 'exhloj-user-editor', 'data-uid': uid });
    userOIerPasteControls(form);
    for (const [name, title, type, value] of [['name', '姓名', 'text', profile.name || ''], ['uname', 'OJ 用户名', 'text', profile.uname || localUserName(uid)], ['oierId', 'OIerDB ID（0 表示未填写）', 'number', profile.oierId || 0], ['level', 'CCF 级别（0–10）', 'number', profile.level || 0], ['grade', '高中毕业年份（0 表示未填写）', 'number', profile.grade || 0], ['practice', '题目分', 'number', store.users.practice[uid] ?? 0]]) {
      const label = el('label', {}, title + ' '); label.append(el('input', { name, type, value, ...(type === 'number' ? { min: 0, step: 1 } : { maxlength: 120 }) })); form.append(label);
    }
    const teacher = el('input', { type: 'checkbox', name: 'teacher' }); teacher.checked = store.users.teachers.includes(uid); const teacherLabel = el('label'); teacherLabel.append(teacher, '教练标记（本地）'); form.append(teacherLabel);
    const awardsLabel = el('label', {}, '获奖记录 JSON：[{"contest":"NOIP 2026","awards":"一等奖","score":300}]'), awards = el('textarea', { name: 'awards', spellcheck: 'false' }); awards.value = JSON.stringify(profile.records || [], null, 2); awardsLabel.append(awards); form.append(awardsLabel);
    form.append(button('保存本地资料', 'user-save'), button('读取 OJ 用户名', 'user-fetch-name'), button('清除此用户的本地资料', 'user-clear')); body.append(form);
  }
  function saveUserEditor(clear = false) {
    const form = $('#exhloj-user-editor'); if (!form.reportValidity()) return;
    const uid = localUid(form.dataset.uid), { users, ratings } = userStore(), next = clone(users);
    next.teachers = next.teachers.filter(id => id !== uid);
    if (clear) { delete next.oiers[uid]; delete next.practice[uid]; }
    else {
      next.oiers[uid] = { ...next.oiers[uid], ...form.exhlojOIerPreview, name: form.elements.name.value, uname: form.elements.uname.value, oierId: +form.elements.oierId.value, level: +form.elements.level.value, grade: +form.elements.grade.value, records: JSON.parse(form.elements.awards.value) };
      next.practice[uid] = +form.elements.practice.value; if (form.elements.teacher.checked) next.teachers.push(uid);
    }
    writeUserStore(next, ratings); notify(clear ? '本地资料已清除' : '本地资料已保存');
  }
  function userExportData() { const { users, ratings } = userStore(); return { format: 'exhloj-user', schemaVersion: 1, version: VERSION, users, ratings }; }
  function openUserJSON() {
    const body = userToolBody('用户数据 JSON'), area = el('textarea', { id: 'exhloj-user-json', spellcheck: 'false' }); area.value = JSON.stringify(userExportData(), null, 2);
    body.append(el('p', {}, '保存将替换这里提供的用户资料和 Rating。也可粘贴旧版 exhloj.user / exhloj.ratedcontests 缓存；未提供的部分保留。'), area, button('校验并保存', 'user-json-save'), button('导出用户数据', 'user-export'));
  }
  function importUserJSON(text) {
    if (new Blob([text]).size > LIMIT) throw workError('用户数据超过 2 MiB');
    const data = JSON.parse(text); if (!isObject(data)) throw workError('用户数据必须为对象');
    let users, ratings; const current = userStore();
    if (data.format === 'exhloj-user') { if (data.schemaVersion !== 1 || !Object.hasOwn(data, 'users') || !Object.hasOwn(data, 'ratings')) throw workError('用户备份格式无效'); users = data.users; ratings = data.ratings; }
    else if (Object.hasOwn(data, 'exhloj.user') || Object.hasOwn(data, 'exhloj.ratedcontests')) { users = data['exhloj.user'] ?? current.users; ratings = data['exhloj.ratedcontests'] ?? current.ratings; }
    else if (Object.hasOwn(data, 'oiers') || Object.hasOwn(data, 'teachers') || Object.hasOwn(data, 'practice')) { users = data; ratings = current.ratings; }
    else if (Object.hasOwn(data, 'contests') && Object.hasOwn(data, 'records')) { users = current.users; ratings = data; }
    else throw workError('没有找到用户资料或 Rating 数据');
    writeUserStore(users, ratings); notify('用户数据已保存');
  }
  function openUserHistory(uid) {
    uid = localUid(uid); const body = userToolBody(`Rating 历史 · ${localUserName(uid)} (#${uid})`), store = userStore(), history = store.histories.get(uid) || [];
    const p = el('p'); p.append('本地 Rating：', ratingNode(userRating(uid)), `；最高 ${Math.max(USER_INITIAL_RATING, ...history.map(record => record.rating))}`); body.append(p);
    if (!history.length) body.append(el('p', {}, '暂无结算记录；初始 Rating 为 1800。'));
    const table = el('table'), head = el('tr'); for (const text of ['比赛', '排名', '表现分', 'Rating 变化']) head.append(el('th', {}, text)); table.append(head);
    for (const row of [...history].reverse()) {
      const contest = store.ratings.contests[row.index], tr = el('tr'), title = el('td'), url = ratedContestPath(contest[0], false), diff = row.rating - row.old;
      title.append(url ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, contest[1] || contest[0]) : el('span', {}, contest[1] || contest[0]));
      const rating = el('td'); rating.append(ratingNode(row.old), ` ${diff >= 0 ? '+' : '−'}${Math.abs(diff)} → `, ratingNode(row.rating)); tr.append(title, el('td', {}, row.rank), el('td', {}, row.performance), rating); table.append(tr);
    } body.append(table, button('Rating 排行榜', 'user-ranking'));
  }
  function userRanking(mode = 'current') {
    const store = userStore(), minIndex = store.ratings.contests.length - 20;
    const rows = [...store.histories].map(([uid, history]) => ({ uid, current: history.at(-1).rating, max: Math.max(USER_INITIAL_RATING, ...history.map(row => row.rating)),
      up: history.filter(row => row.index >= minIndex).reduce((sum, row) => sum + Math.max(0, row.rating - row.old), 0),
      down: history.filter(row => row.index >= minIndex).reduce((sum, row) => sum + Math.max(0, row.old - row.rating), 0), eligible: history.some(row => row.index >= minIndex) }))
      .filter(row => !['up', 'down'].includes(mode) || row.eligible).sort((a, b) => b[mode] - a[mode] || a.uid - b.uid);
    rows.forEach((row, i) => { row.rank = i && row[mode] === rows[i - 1][mode] ? rows[i - 1].rank : i + 1; }); return rows;
  }
  function openUserRanking(mode = 'current') {
    if (!['current', 'max', 'up', 'down'].includes(mode)) throw workError('排行榜类型无效');
    const body = userToolBody('本地 Rating 排行榜'); for (const [key, title] of [['current', '当前 Rating'], ['max', '历史最高'], ['up', '近 20 场上分'], ['down', '近 20 场下分']]) body.append(button(title, 'user-ranking', { 'data-mode': key, ...(key === mode ? { disabled: '' } : {}) }));
    body.append(el('p', {}, ['up', 'down'].includes(mode) ? '按比赛列表最后 20 场的变化量累计；只显示参与过这些比赛的用户。' : '仅显示有结算记录的用户，同分并列。'));
    const table = el('table'), head = el('tr'); for (const title of ['排名', '用户', '数值', '历史']) head.append(el('th', {}, title)); table.append(head);
    const rows = userRanking(mode); for (const row of rows) { const tr = el('tr'), who = el('td'), value = el('td'), history = el('td'); who.append(localUserLink(row.uid)); value.append(['current', 'max'].includes(mode) ? ratingNode(row[mode]) : el('span', {}, row[mode])); history.append(button('查看', 'user-history', { 'data-uid': row.uid })); tr.append(el('td', {}, row.rank), who, value, history); table.append(tr); }
    body.append(table, el('p', {}, `${rows.length} 名用户`));
  }
  function ratedContestPath(value, strict = true) {
    const parts = String(value).split('/');
    if (parts.length === 2 && /^[\p{L}\p{N}_-]{1,80}$/u.test(parts[0]) && /^(?:[\da-f]{24}|\d+)$/i.test(parts[1])) return contestURL(parts[0], 'contest', parts[1]);
    if (strict) throw workError('Rated 比赛格式应为 域ID/比赛ID'); return '';
  }
  function openUserRated() {
    const body = userToolBody('Rated 比赛 · 本地结算'), area = el('textarea', { id: 'exhloj-user-commands', spellcheck: 'false' }); area.value = userStore().ratings.commands;
    body.append(el('p', {}, '先定义比赛，再按顺序结算。相同 rating 行中的多场比赛并行计算，对每人采用加权变化最大的场次。数据完整且结算成功后才替换本地 Rating。'),
      el('pre', {}, 'version:2\ncontest:域ID/比赛ID,比赛标题,1\nrating:域ID/比赛ID'),
      el('p', {}, 'version:1 只结算正分选手；version:2 结算所有有提交且有排名的选手。权重范围 0–10。contest 行可在第四项附上 [[UID,排名],...]，使用已有名次时无需读取 OJ。# 开头的行是注释。'), area,
      button('保存命令草稿', 'user-commands-save'), button('读取榜单并结算到本地', 'user-calculate'), button('导出用户数据', 'user-export'));
    workProgress(body, 'user'); showWorkErrors(workStates.user);
  }
  function parseRatedCommands(text) {
    const contests = [], groups = [], ids = new Map(); let version = 1;
    for (const [offset, raw] of String(text).split(/\r?\n/).entries()) {
      const line = raw.trim(); if (!line || line.startsWith('#')) continue;
      const split = line.indexOf(':'), op = line.slice(0, split), rest = line.slice(split + 1).trim();
      try {
        if (op === 'version') { if (!['1', '2'].includes(rest)) throw workError('仅支持 version:1 或 version:2'); version = +rest; }
        else if (op === 'contest') {
          const match = rest.match(/^([^,]+),([^,]*),([^,]+)(?:,(.*))?$/); if (!match) throw workError('比赛行格式不正确');
          const [, rawId, title, weight, participants] = match, id = rawId.trim(); ratedContestPath(id);
          if (ids.has(id)) throw workError('比赛不能重复定义');
          let users = null; if (participants?.trim()) { try { users = JSON.parse(participants); } catch { users = JSON.parse(participants.replace(/-/g, ',')); } users = validateRatedUsers(users); }
          ids.set(id, contests.length); contests.push({ id, title: title.trim(), weight: localNumber(weight, 'Rating 权重', 0, 10), users, version });
        } else if (op === 'rating') {
          const group = rest.split(',').map(id => id.trim()); if (!group.length || new Set(group).size !== group.length || group.some(id => !ids.has(id))) throw workError('结算引用了未定义或重复的比赛'); groups.push(group.map(id => ids.get(id)));
        } else throw workError('未知命令');
      } catch (error) { throw workError(`第 ${offset + 1} 行：${error.message}`); }
    }
    if (!contests.length || !groups.length) throw workError('请至少定义一场比赛及一条 rating 结算命令');
    if (contests.length > 200) throw workError('一次至多结算 200 场比赛');
    const used = groups.flat(); if (new Set(used).size !== used.length) throw workError('同一比赛不能重复结算'); return { contests, groups };
  }
  function validateRatedUsers(rows) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw workError('每场比赛需要 1–1000 名选手');
    const seen = new Set(); return rows.map(row => {
      if (!Array.isArray(row) || row.length < 2) throw workError('名次格式应为 [[UID,排名],...]'); const uid = localUid(row[0]), rank = Number(row[1]);
      if (!Number.isInteger(rank) || rank < 1 || rank > rows.length || seen.has(uid)) throw workError('名次无效或用户重复'); seen.add(uid); return [uid, rank];
    });
  }
  function ratedUsersFromBoard(body, version) {
    if (!Array.isArray(body.rows)) throw workError('榜单未返回 rows，可能无查看权限');
    const result = [];
    for (const row of body.rows) {
      if (!Array.isArray(row)) continue; const uid = +row.find(cell => cell?.type === 'user')?.raw, rank = Number(textOnly(row.find(cell => cell?.type === 'rank')?.value));
      if (!(uid > 0) || !(rank > 0)) continue;
      const records = row.filter(cell => ['record', 'records'].includes(cell?.type)).flatMap(cell => cell.type === 'records' && Array.isArray(cell.raw) ? cell.raw.slice(0, 1) : [cell]);
      const submitted = records.some(cell => !!objectId(cell.raw)), scored = records.some(cell => cell.score !== undefined ? +cell.score > 0 : parseFloat(textOnly(cell.value)) > 0 || boardAccepts(cell, body.tdoc?.rule, 100).length);
      if (version === 1 ? scored : submitted) result.push([uid, rank]);
    }
    return validateRatedUsers(result);
  }
  async function calculateUserRatings(text) {
    if (!settings.userModule) throw workError('请先启用 user 模块');
    const plan = parseRatedCommands(text);
    return runWork('user', async (job, state) => {
      for (const contest of plan.contests) if (!contest.users) {
        const body = await jobJSON(job, ratedContestPath(contest.id) + '/scoreboard'); contest.users = ratedUsersFromBoard(body, contest.version);
      }
      const currentRatings = new Map(), records = [], sum = values => values.reduce((a, b) => a + b, 0);
      const expected = (rows, uid, rating) => sum(rows.map(other => other.uid === uid ? 1 : 1 / (1 + 10 ** ((rating - other.old) / 400))));
      const search = (rows, uid, target, left, right) => { while (right - left > 0.1) { const mid = (left + right) / 2; if (expected(rows, uid, mid) > target) left = mid; else right = mid; } return (left + right) / 2; };
      for (const [groupIndex, group] of plan.groups.entries()) {
        checkJob(job); const chosen = new Map();
        for (const index of group) {
          const contest = plan.contests[index], rows = contest.users.map(([uid, rank]) => ({ uid, rank, old: currentRatings.get(uid) ?? USER_INITIAL_RATING }));
          const low = Math.min(...rows.map(row => row.old)) - 400, high = Math.max(...rows.map(row => row.old)) + 400;
          for (const [i, row] of rows.entries()) {
            if (i % 8 === 0) { state.message = `结算 ${groupIndex + 1}/${plan.groups.length} 组 · ${contest.title || contest.id} · ${i}/${rows.length}`; updateWorkProgress('user'); await pauseWork(0, job.controller.signal); checkJob(job); }
            const target = Math.sqrt(expected(rows, row.uid, row.old) * row.rank), diff = (search(rows, row.uid, target, -5000, 10000) - row.old) / 2,
              performance = Math.round(search(rows, row.uid, row.rank, low, high)), candidate = { ...row, index, diff, performance, weight: contest.weight }, prior = chosen.get(row.uid);
            if (!prior || prior.diff * prior.weight < diff * contest.weight) chosen.set(row.uid, candidate);
          }
        }
        const values = [...chosen.values()], correction = 1 - sum(values.map(row => row.diff)) / values.length;
        for (const row of values) { const rating = row.old + Math.round((row.diff + correction) * row.weight); currentRatings.set(row.uid, rating); records.push([row.uid, row.index, row.rank, rating, row.performance]); }
      }
      checkJob(job); writeUserStore(userStore().users, { contests: plan.contests.map(row => [row.id, row.title, row.weight]), records, commands: text });
      state.message = `已完成本地结算：${plan.contests.length} 场比赛，${records.length} 条记录；未上传数据`; notify('Rating 已在本机结算');
    }, true);
  }
  function importPracticeToUsers() {
    const result = workStates.juan.result; if (!result?.complete) throw workError('请先在卷王监视器完成一次完整统计');
    const { users, ratings } = userStore(), next = clone(users); for (const row of result.rows) next.practice[row.uid] = row.total;
    writeUserStore(next, ratings); notify(`已更新 ${result.rows.length} 人的本地题目分`);
  }
  const localUserAPI = Object.freeze({ getData: () => clone(userExportData()), getRating: userRating, open: openUserTools,
    edit: openUserEditor, history: openUserHistory, ranking: mode => clone(userRanking(mode)), calculate: calculateUserRatings,
    parseOIer: (text, html = '', sourceURL = '', date) => clone(parseOIerPaste(text, html, sourceURL, date ? new Date(date) : new Date())) });


  // 下面的权限位与描述取自原 Extend HLOJ 1.16.1，不改变站点权限。
  const PERMISSIONS = [
  {
    "name": "PERM_VIEW",
    "bit": 0,
    "description": "View this domain"
  },
  {
    "name": "PERM_VIEW_DISPLAYNAME",
    "bit": 67,
    "description": "View domain user displayname"
  },
  {
    "name": "PERM_EDIT_DOMAIN",
    "bit": 1,
    "description": "Edit domain settings"
  },
  {
    "name": "PERM_MOD_BADGE",
    "bit": 2,
    "description": "Show MOD badge"
  },
  {
    "name": "PERM_CREATE_PROBLEM",
    "bit": 4,
    "description": "Create problems"
  },
  {
    "name": "PERM_EDIT_PROBLEM",
    "bit": 5,
    "description": "Edit problems"
  },
  {
    "name": "PERM_EDIT_PROBLEM_SELF",
    "bit": 6,
    "description": "Edit own problems"
  },
  {
    "name": "PERM_VIEW_PROBLEM",
    "bit": 7,
    "description": "View problems"
  },
  {
    "name": "PERM_VIEW_PROBLEM_HIDDEN",
    "bit": 8,
    "description": "View hidden problems"
  },
  {
    "name": "PERM_SUBMIT_PROBLEM",
    "bit": 9,
    "description": "Submit problem"
  },
  {
    "name": "PERM_READ_PROBLEM_DATA",
    "bit": 10,
    "description": "Read data of problem"
  },
  {
    "name": "PERM_VIEW_RECORD",
    "bit": 70,
    "description": "View other's records"
  },
  {
    "name": "PERM_READ_RECORD_CODE",
    "bit": 12,
    "description": "Read all record codes"
  },
  {
    "name": "PERM_READ_RECORD_CODE_ACCEPT",
    "bit": 66,
    "description": "Read record codes after accept"
  },
  {
    "name": "PERM_REJUDGE_PROBLEM",
    "bit": 13,
    "description": "Rejudge problems"
  },
  {
    "name": "PERM_REJUDGE",
    "bit": 14,
    "description": "Rejudge records"
  },
  {
    "name": "PERM_VIEW_PROBLEM_SOLUTION",
    "bit": 15,
    "description": "View problem solutions"
  },
  {
    "name": "PERM_VIEW_PROBLEM_SOLUTION_ACCEPT",
    "bit": 65,
    "description": "View problem solutions after accept"
  },
  {
    "name": "PERM_CREATE_PROBLEM_SOLUTION",
    "bit": 16,
    "description": "Create problem solutions"
  },
  {
    "name": "PERM_VOTE_PROBLEM_SOLUTION",
    "bit": 17,
    "description": "Vote problem solutions"
  },
  {
    "name": "PERM_EDIT_PROBLEM_SOLUTION",
    "bit": 18,
    "description": "Edit problem solutions"
  },
  {
    "name": "PERM_EDIT_PROBLEM_SOLUTION_SELF",
    "bit": 19,
    "description": "Edit own problem solutions"
  },
  {
    "name": "PERM_DELETE_PROBLEM_SOLUTION",
    "bit": 20,
    "description": "Delete problem solutions"
  },
  {
    "name": "PERM_DELETE_PROBLEM_SOLUTION_SELF",
    "bit": 21,
    "description": "Delete own problem solutions"
  },
  {
    "name": "PERM_REPLY_PROBLEM_SOLUTION",
    "bit": 22,
    "description": "Reply problem solutions"
  },
  {
    "name": "PERM_EDIT_PROBLEM_SOLUTION_REPLY_SELF",
    "bit": 24,
    "description": "Edit own problem solution replies"
  },
  {
    "name": "PERM_DELETE_PROBLEM_SOLUTION_REPLY",
    "bit": 25,
    "description": "Delete problem solution replies"
  },
  {
    "name": "PERM_DELETE_PROBLEM_SOLUTION_REPLY_SELF",
    "bit": 26,
    "description": "Delete own problem solution replies"
  },
  {
    "name": "PERM_VIEW_DISCUSSION",
    "bit": 27,
    "description": "View discussions"
  },
  {
    "name": "PERM_CREATE_DISCUSSION",
    "bit": 28,
    "description": "Create discussions"
  },
  {
    "name": "PERM_HIGHLIGHT_DISCUSSION",
    "bit": 29,
    "description": "Highlight discussions"
  },
  {
    "name": "PERM_PIN_DISCUSSION",
    "bit": 61,
    "description": "Pin discussions"
  },
  {
    "name": "PERM_EDIT_DISCUSSION",
    "bit": 30,
    "description": "Edit discussions"
  },
  {
    "name": "PERM_EDIT_DISCUSSION_SELF",
    "bit": 31,
    "description": "Edit own discussions"
  },
  {
    "name": "PERM_LOCK_DISCUSSION",
    "bit": 64,
    "description": "Lock discussions"
  },
  {
    "name": "PERM_DELETE_DISCUSSION",
    "bit": 32,
    "description": "Delete discussions"
  },
  {
    "name": "PERM_DELETE_DISCUSSION_SELF",
    "bit": 33,
    "description": "Delete own discussions"
  },
  {
    "name": "PERM_REPLY_DISCUSSION",
    "bit": 34,
    "description": "Reply discussions"
  },
  {
    "name": "PERM_ADD_REACTION",
    "bit": 62,
    "description": "React to discussion"
  },
  {
    "name": "PERM_EDIT_DISCUSSION_REPLY_SELF",
    "bit": 36,
    "description": "Edit own discussion replies"
  },
  {
    "name": "PERM_DELETE_DISCUSSION_REPLY",
    "bit": 38,
    "description": "Delete discussion replies"
  },
  {
    "name": "PERM_DELETE_DISCUSSION_REPLY_SELF",
    "bit": 39,
    "description": "Delete own discussion replies"
  },
  {
    "name": "PERM_DELETE_DISCUSSION_REPLY_SELF_DISCUSSION",
    "bit": 40,
    "description": "Delete discussion replies of own discussion"
  },
  {
    "name": "PERM_VIEW_CONTEST",
    "bit": 41,
    "description": "View contests"
  },
  {
    "name": "PERM_VIEW_CONTEST_SCOREBOARD",
    "bit": 42,
    "description": "View contest scoreboard"
  },
  {
    "name": "PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD",
    "bit": 43,
    "description": "View hidden contest submission status and scoreboard"
  },
  {
    "name": "PERM_CREATE_CONTEST",
    "bit": 44,
    "description": "Create contests"
  },
  {
    "name": "PERM_ATTEND_CONTEST",
    "bit": 45,
    "description": "Attend contests"
  },
  {
    "name": "PERM_EDIT_CONTEST",
    "bit": 50,
    "description": "Edit any contests"
  },
  {
    "name": "PERM_EDIT_CONTEST_SELF",
    "bit": 51,
    "description": "Edit own contests"
  },
  {
    "name": "PERM_VIEW_HIDDEN_CONTEST",
    "bit": 68,
    "description": "View all contests"
  },
  {
    "name": "PERM_VIEW_HOMEWORK",
    "bit": 52,
    "description": "View homework"
  },
  {
    "name": "PERM_VIEW_HOMEWORK_SCOREBOARD",
    "bit": 53,
    "description": "View homework scoreboard"
  },
  {
    "name": "PERM_VIEW_HOMEWORK_HIDDEN_SCOREBOARD",
    "bit": 54,
    "description": "View hidden homework submission status and scoreboard"
  },
  {
    "name": "PERM_CREATE_HOMEWORK",
    "bit": 55,
    "description": "Create homework"
  },
  {
    "name": "PERM_ATTEND_HOMEWORK",
    "bit": 56,
    "description": "Claim homework"
  },
  {
    "name": "PERM_EDIT_HOMEWORK",
    "bit": 57,
    "description": "Edit any homework"
  },
  {
    "name": "PERM_EDIT_HOMEWORK_SELF",
    "bit": 58,
    "description": "Edit own homework"
  },
  {
    "name": "PERM_VIEW_HIDDEN_HOMEWORK",
    "bit": 69,
    "description": "View all homework"
  },
  {
    "name": "PERM_VIEW_TRAINING",
    "bit": 46,
    "description": "View training plans"
  },
  {
    "name": "PERM_CREATE_TRAINING",
    "bit": 47,
    "description": "Create training plans"
  },
  {
    "name": "PERM_EDIT_TRAINING",
    "bit": 48,
    "description": "Edit training plans"
  },
  {
    "name": "PERM_PIN_TRAINING",
    "bit": 63,
    "description": "Pin training plans"
  },
  {
    "name": "PERM_EDIT_TRAINING_SELF",
    "bit": 49,
    "description": "Edit own training plans"
  },
  {
    "name": "PERM_VIEW_RANKING",
    "bit": 59,
    "description": "View ranking"
  }
];
  function permissionValue() {
    const value = current('udoc')?.perm;
    if (value === undefined || value === null) return null;
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
    try { return BigInt(String(value).replace(/^BigInt::/, '')); } catch { return null; }
  }
  function permissionTools() {
    const prior = $('#exhloj-local-permissions'), value = permissionValue();
    if (value === null) { prior?.remove(); return; }
    const target = profilePanelTarget();
    if (!target) return;
    const count = PERMISSIONS.filter(p => (value & (1n << BigInt(p.bit))) !== 0n).length;
    if (prior) {
      if (prior.parentElement !== target) target.prepend(prior);
      const button = $('[data-exh-action="permissions"]', prior), text = `拥有权限 (${count})`; if (button && button.textContent !== text) button.textContent = text;
      return;
    }
    const section = el('div', { class: 'section side', id: 'exhloj-local-permissions' });
    section.append(button(`拥有权限 (${count})`, 'permissions')); target.prepend(section);
  }
  function showPermissions() {
    const value = permissionValue();
    if (value === null) throw new Error('页面未提供完整的权限位');
    const body = modal('用户权限');
    body.append(el('p', {}, `当前域：${domainId()}；角色：${current('udoc')?.role || '未知'}。权限位对应原版 Hydro 定义。`));
    const table = el('table'), head = el('tr'); head.append(el('th', {}, '权限'), el('th', {}, '状态')); table.append(head);
    for (const p of PERMISSIONS) {
      const row = el('tr'); row.append(el('td', { title: p.name }, translate(p.description)),
        el('td', {}, (value & (1n << BigInt(p.bit))) !== 0n ? '✓' : '—')); table.append(row);
    }
    body.append(table);
  }

  const busyActions = new Set();
  document.addEventListener('click', event => {
    const control = event.target.closest?.('[data-exh-action]');
    if (!control) return;
    event.preventDefault();
    const action = control.dataset.exhAction;
    if (busyActions.has(action)) return;
    busyActions.add(action);
    task(async () => {
      switch (action) {
        case 'settings': openSettings(); break;
        case 'close': $('#exhloj-local-dialog')?.close(); break;
        case 'reload': location.reload(); break;
        case 'save-settings': {
          const form = $('#exhloj-local-settings');
          if (!form.reportValidity()) return;
          const value = { ...settings, ui: form.elements.ui.checked, options: {}, cphPort: +form.elements.cphPort.value, editorPort: +form.elements.editorPort.value };
          for (const key of ['captcha', 'remote', 'captchaHide', 'captchaRemember', 'remoteAuto', 'contestHelper', 'juanMonitor', 'autoAttend', 'userModule']) value[key] = form.elements[key].checked;
          for (const key of ['helperDelay', 'helperPageLimit', 'helperRequestLimit', 'autoAttendInterval']) value[key] = +form.elements[key].value;
          for (const key of ['autoAttendTargets', 'autoAttendTitle', 'autoAttendRules']) value[key] = form.elements[key].value;
          value.remoteContest = form.elements.remoteContest.value; value.remoteColor = form.elements.remoteColor.value;
          for (const key of Object.keys(OPTIONS)) value.options[key] = form.elements[key].checked;
          const next = normalizeSettings(value); save(SETTINGS_KEY, next); settings = next;
          configureAutoAttend();
          refreshUserModule();
          notify('设置已保存，刷新页面后完整生效'); break;
        }
        case 'export': download('exhloj-backup.json', JSON.stringify(exportData(), null, 2)); break;
        case 'import': importData($('#exhloj-local-import').value); notify('导入成功，刷新页面后完整生效'); break;
        case 'legacy': {
          const value = {};
          for (const key of LEGACY_KEYS) { const data = stored(key, null); if (data !== null) value[key] = data; }
          if (!Object.keys(value).length) throw new Error('此脚本的存储中没有旧版缓存；请从旧脚本导出 JSON 后导入');
          save(CACHE_KEY, { ...validateCache(stored(CACHE_KEY, {})), ...value }); notify('已保留旧版缓存'); break;
        }
        case 'view-cache': { const body = modal('本地缓存'); body.append(el('pre', {}, JSON.stringify(exportData(), null, 2))); break; }
        case 'problem-copy': await copyText(markdownContent((await problemDocument()).content)); break;
        case 'solution-copy': await copySolution(control); break;
        case 'cph': case 'editor': {
          const payload = await cphPayload();
          await sendLocal(action === 'cph' ? settings.cphPort : settings.editorPort, payload);
          notify(`已发送到 ${action === 'cph' ? 'CPH' : 'CP Editor'}（${payload.tests.length} 组样例）`); break;
        }
        case 'avatar-save': await saveAvatar(); break;
        case 'permissions': showPermissions(); break;
        case 'user-open': openUserTools(); break;
        case 'user-edit': openUserEditor(control.dataset.uid || $('#exhloj-user-id')?.value); break;
        case 'user-history': openUserHistory(control.dataset.uid || $('#exhloj-user-id')?.value); break;
        case 'user-ranking': openUserRanking(control.dataset.mode || 'current'); break;
        case 'user-save': saveUserEditor(); break;
        case 'user-oier-parse': fillUserFromOIer(); break;
        case 'user-clear': saveUserEditor(true); break;
        case 'user-fetch-name': {
          const form = $('#exhloj-user-editor'), uid = localUid(form.dataset.uid), data = await requestJSON(`/user/${uid}`);
          if (!data.udoc?.uname) throw workError('OJ 没有返回用户名');
          if (form.isConnected) form.elements.uname.value = data.udoc.uname; notify('已读取用户名，点击保存后写入本地'); break;
        }
        case 'user-options-save': {
          const form = $('#exhloj-user-options'), next = normalizeSettings({ ...settings, userDisplay: form.elements.display.value, userCCF: form.elements.ccf.checked });
          save(SETTINGS_KEY, next); settings = next; refreshUserNames(); notify('名字显示设置已保存'); break;
        }
        case 'user-json': openUserJSON(); break;
        case 'user-json-save': importUserJSON($('#exhloj-user-json').value); break;
        case 'user-export': download('exhloj-user-data.json', JSON.stringify(userExportData(), null, 2)); break;
        case 'user-rated': openUserRated(); break;
        case 'user-commands-save': {
          const { users, ratings } = userStore(); writeUserStore(users, { ...ratings, commands: $('#exhloj-user-commands').value }); notify('结算命令草稿已保存'); break;
        }
        case 'user-calculate': await calculateUserRatings($('#exhloj-user-commands').value); break;
        case 'user-practice': importPracticeToUsers(); break;
        case 'captcha-history': showCaptchaHistory(); break;
        case 'captcha-clear': save(CAPTCHA_KEY, []); showCaptchaHistory(); break;
        case 'captcha-retry': runCaptcha(true); break;
        case 'captcha-toggle': {
          const state = [...$$('input[name="captcha"]')].map(input => captchaStates.get(input)).find(state => state?.tools === control.closest('.exhloj-captcha-tools'));
          if (state) captchaVisible(state, state.collapsed); break;
        }
        case 'remote-meta': await loadRemoteMeta(stateFor(control), true); break;
        case 'remote-config': configureOrigin(); break;
        case 'remote-save-origin': saveOrigin(); break;
        case 'remote-reset-origin': saveOrigin(true); break;
        case 'luogu-tool': openLuoguTool($('#exhloj-luogu-id').value); break;
        case 'remote-statement': {
          const state = stateFor(control);
          if (!state.problem) state.problem = await luoguProblem(state.origin.luoguId);
          state.showStatement = !state.showStatement; renderRemote(state); break;
        }
        case 'remote-solutions': {
          const state = stateFor(control);
          if (!state.solutionPage) await loadRemoteSolutions(state);
          else { state.showSolutions = !state.showSolutions; renderRemote(state); } break;
        }
        case 'remote-more': await loadRemoteSolutions(stateFor(control)); break;
        case 'remote-export': await exportRemote(stateFor(control)); break;
        case 'remote-copy-statement': await copyText(stateFor(control).problem?.statement); break;
        case 'remote-copy-solution': await copyText(stateFor(control).solutions[+control.dataset.index]?.content); break;
        case 'remote-code': await loadSubmissionCode(control); break;
        case 'contest-helper': openContestHelper(); break;
        case 'contest-statements': await exportContestStatements(contestInput()); break;
        case 'contest-records-csv': await exportContestRecords(contestInput(), 'csv'); break;
        case 'contest-records-json': await exportContestRecords(contestInput(), 'json'); break;
        case 'contest-ghost': await exportContestRecords(contestInput(), 'ghost'); break;
        case 'work-cancel': workJobs.get(control.dataset.kind)?.controller.abort(); break;
        case 'attend-preview': await checkAttendance(); break;
        case 'attend-one': {
          const candidate = workStates.auto.candidates?.[+control.dataset.index]; if (!candidate) throw workError('报名列表已变化，请重新检查');
          await runWork('auto', async (job, state) => { await attendOne(job, candidate); state.candidates = state.candidates.filter(x => x.key !== candidate.key); state.message = `已报名 ${candidate.title}`; renderAttendCandidates(); }); break;
        }
        case 'juan-open': openJuanMonitor(); break;
        case 'juan-start': await scanJuan(monitorFormSettings()); break;
        case 'juan-domains': {
          const result = await requestJSON('/home/domain'); if (!Array.isArray(result.ddocs)) throw workError('接口未返回可访问域');
          const selected = new Set(domainList($('#exhloj-juan-form').elements.domains.value)); const box = $('#exhloj-juan-domains'); box.replaceChildren();
          for (const doc of result.ddocs) { const label = el('label'), input = el('input', { type: 'checkbox', 'data-juan-domain': doc._id }); input.checked = selected.has(doc._id); label.append(input, `${doc.name || doc._id} (${doc._id})`); box.append(label); } break;
        }
        case 'juan-csv': { const result = juanResult(); download('exhloj-practice.csv', csvContent(['uid', 'name', 'totalAC', 'periodAC', 'newSinceSnapshot'], result.rows.map(row => [row.uid, row.name, row.total, row.recent, row.added])), 'text/csv;charset=utf-8'); break; }
        case 'juan-json': download('exhloj-practice.json', JSON.stringify(juanResult(), null, 2)); break;
        case 'juan-copy': { const result = juanResult(); await copyText(`卷王榜（${result.complete ? '完整扫描' : '部分数据'}，${result.period} 天内 AC）\n` + result.rows.slice(0, 100).map((row, i) => `${i + 1}. ${row.name}：区间 ${row.recent}，累计 ${row.total}${row.added === null ? '' : `，新增 ${row.added}`}`).join('\n')); break; }
      }
    }).finally(() => busyActions.delete(action));
  });
  document.addEventListener('change', event => {
    if (event.target.matches?.('[data-juan-domain]')) {
      const form = $('#exhloj-juan-form'); if (form) form.elements.domains.value = $$('[data-juan-domain]:checked').map(input => input.dataset.juanDomain).join('\n'); return;
    }
    if (event.target.id !== 'exhloj-local-import-file') return;
    const file = event.target.files[0]; if (!file) return;
    task(async () => {
      if (file.size > LIMIT) throw new Error('导入文件超过 2 MiB');
      $('#exhloj-local-import').value = await file.text(); notify('文件已读取，点击“导入 JSON”应用');
    });
  });
  document.addEventListener('keydown', event => {
    if (settings.remote && settings.remoteContest === 'shortcut' && pageName() === 'contest_detail_problem' && event.ctrlKey && event.key.toLowerCase() === 'q' && !event.target.closest?.('input,textarea,[contenteditable]')) {
      event.preventDefault(); contestRevealed = !contestRevealed;
      $('#exhloj-local-remote')?.remove(); remoteState = undefined; remoteProblem();
    }
  });

  function refresh() {
    if (location.href !== route) {
      route = location.href; routeEpoch++; contextBody = {}; pageRequest = undefined;
      lastPageError = ''; homeworkStarted = recordStarted = solutionStarted = false;
      remoteState = undefined; remotePending = false; contestRevealed = false;
      lastEvents.delete('homework_detail.prepare'); lastEvents.delete('record_detail.prepare');
      for (const id of ['exhloj-local-problem-tools', 'exhloj-local-homework-files', 'exhloj-local-avatar', 'exhloj-local-permissions', 'exhloj-local-remote', 'exhloj-local-origin-code', 'exhloj-contest-tools', 'exhloj-local-user-card']) $(`#${id}`)?.remove();
    }
    document.documentElement.classList.toggle('exhloj-local-rounded', enabled('rounded'));
    document.documentElement.classList.toggle('exhloj-local-ui', settings.ui);
    installMenu();
    try {
      if (page.UiContext) {
        if (!page.UiContext.exhloj) page.UiContext.exhloj = {};
        page.UiContext.exhloj.core = core;
        page.UiContext.exhloj.getTimeByObjectId = core.getTimeByObjectId;
        if (settings.userModule) page.UiContext.exhloj.user = localUserAPI;
        else delete page.UiContext.exhloj.user;
      }
    } catch { /* 部分站点可能将上下文设为只读。 */ }
    const name = pageName();
    if (enabled('homework') && name === 'homework_detail') homework();
    if (enabled('scoreboard') && name.endsWith('scoreboard')) scoreboard();
    if ((enabled('markdown') || enabled('cph')) && (name === 'problem_detail' || name.endsWith('detail_problem'))) problemToolbar();
    if (enabled('markdown') && name === 'problem_solution') solutionTools();
    if (enabled('avatar') && name === 'home_account') avatarTools();
    if (enabled('permissions') && name === 'user_detail') permissionTools();
    if (settings.captcha) runCaptcha();
    if (settings.remote && (name === 'problem_detail' || name.endsWith('detail_problem'))) remoteProblem();
    if (settings.remote && name === 'record_detail') remoteSubmissionTools();
    contestToolbar(); configureAutoAttend(); refreshUserModule();
    if (settings.ui && name === 'record_detail' && !recordStarted && current('rdoc')) {
      recordStarted = true; broadcast('record_detail.prepare', current('rdoc'));
    }
  }
  let refreshTimer;
  function schedule() { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => task(refresh), 120); }
  const observer = new MutationObserver(records => {
    if (records.some(record => {
      const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      if (target?.closest('#exhloj-local-dialog, #exhloj-local-toast')) return false;
      // 仅监听 DOM 内容、页面名称和上下文脚本变化，避免自身样式修改形成循环。
      return true;
    })) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src'] });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-page'] });
  for (const event of ['pjax:end', 'vjContentNew', 'popstate', 'pageshow']) window.addEventListener(event, schedule);
  // Hydro 的部分版本通过 jQuery 触发 vjContentNew，原生监听器无法接收。
  try { (page.jQuery || page.$)?.(document).on('vjContentNew.exhlojLocal pjax:end.exhlojLocal', schedule); } catch {}
  if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Extend HLOJ 设置', openSettings);
  refresh();
  // 为晚于 userscript 初始化的 UiContext 提供有界重试，不产生网络轮询。
  for (const delay of [300, 1000, 3000, 8000]) setTimeout(schedule, delay);
})();


/* THIRD-PARTY LICENSE NOTICES
marked 18.1.1
# License information

## Contribution License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`

## Marked

Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)
Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Markdown

Copyright © 2004, John Gruber
http://daringfireball.net/
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
* Neither the name “Markdown” nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

This software is provided by the copyright holders and contributors “as is” and any express or implied warranties, including, but not limited to, the implied warranties of merchantability and fitness for a particular purpose are disclaimed. In no event shall the copyright owner or contributors be liable for any direct, indirect, incidental, special, exemplary, or consequential damages (including, but not limited to, procurement of substitute goods or services; loss of use, data, or profits; or business interruption) however caused and on any theory of liability, whether in contract, strict liability, or tort (including negligence or otherwise) arising in any way out of the use of this software, even if advised of the possibility of such damage.


dompurify 3.4.17

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.


katex 0.18.10
The MIT License (MIT)

Copyright (c) 2013-2020 Khan Academy and other contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


marked-katex-extension 5.1.13
MIT License

Copyright (c) 2021 @markedjs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
