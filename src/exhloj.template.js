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
/* @EXHLOJ_MARKDOWN_VENDOR@ */

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


/* @EXHLOJ_THIRD_PARTY_LICENSES@ */