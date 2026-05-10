// content.js - QTline v1.0.0

(function () {
  'use strict';

  const state = {
    theme: 'default',
    timelineItems: [],   // 消息时间轴（每次用户发送 = 一个条目）
    fileItems: [],       // 文件时间轴（每次发送携带文件 = 一个条目）
    timelineMode: 'messages',
    settings: { showFloatButton: true, timelineVisible: true },
    prompts: [],
    observer: null,
    initialized: false,
  };

  // ===================== INIT =====================
  async function init() {
    if (state.initialized) return;
    state.initialized = true;
    await loadFromStorage();
    injectUI();
    scanMessages();
    setupObserver();
    applyTheme(state.theme, false);

    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(() => { state.timelineItems = []; state.fileItems = []; scanMessages(); }, 1500);
      }
    }).observe(document, { subtree: true, childList: true });
  }

  function loadFromStorage() {
    return new Promise(resolve => {
      chrome.storage.local.get(['theme','settings','prompts'], res => {
        if (res.theme) state.theme = res.theme;
        if (res.settings) state.settings = { ...state.settings, ...res.settings };
        if (res.prompts) state.prompts = res.prompts;
        resolve();
      });
    });
  }

  // ===================== MESSAGE SCANNING =====================
  // 关键修复：每次"用户发送"只算一个圆点
  // 策略：找到最顶层的用户消息容器，去重，不把子元素重复计入
  function scanMessages() {
    state.timelineItems = [];
    state.fileItems = [];

    // Qwen 的用户消息容器优先级列表（越具体越优先）
    const candidateSelectors = [
      '[class*="bubble-user"]',
      '[class*="user-bubble"]',
      '[class*="user-message"]',
      '[class*="human-message"]',
      '[class*="message-user"]',
      '[data-role="user"]',
      '[class*="chat-item-user"]',
      '[class*="role-user"]',
      '[class*="msg-user"]',
    ];

    let rawElements = [];

    for (const sel of candidateSelectors) {
      const found = Array.from(document.querySelectorAll(sel));
      if (found.length > 0) {
        rawElements = found;
        break;
      }
    }

    // 去重：如果一个元素是另一个元素的祖先，只保留最外层
    // 这样避免同一条消息因嵌套 DOM 出现多个匹配
    const deduped = deduplicateAncestors(rawElements);

    deduped.forEach((el, index) => {
      const text = extractText(el);
      if (!text || text.length < 1) return;

      const rawTime = extractTime(el);
      const timeInfo = formatItemTime(rawTime, index);

      // 检测该消息是否含有文件附件
      const hasFile = detectFileInMessage(el);

      state.timelineItems.push({
        id: 'msg-' + index,
        element: el,
        text,
        index,
        type: 'message',
        hasFile,
        timeDisplay: timeInfo.display,
        timeFull: timeInfo.full,
      });

      // 文件时间轴：该条消息含文件则加入 fileItems（一条消息只算一个文件圆点）
      if (hasFile) {
        const fileLabel = extractFileLabel(el);
        state.fileItems.push({
          id: 'file-' + index,
          element: el,
          text: fileLabel,
          index: state.fileItems.length,
          type: 'file',
          timeDisplay: timeInfo.display,
          timeFull: timeInfo.full,
        });
      }
    });

    renderTimeline();
  }

  // 保留最外层元素，过滤掉被其他元素包含的子孙元素
  function deduplicateAncestors(els) {
    if (els.length === 0) return [];
    const set = new Set(els);
    return els.filter(el => {
      let cur = el.parentElement;
      while (cur) {
        if (set.has(cur)) return false; // 父级已在列表中，跳过自己
        cur = cur.parentElement;
      }
      return true;
    });
  }

  function extractText(el) {
    return (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 120);
  }

  function extractTime(el) {
    const sels = ['time', '[class*="time"]', '[class*="timestamp"]', '[class*="date"]'];
    for (const s of sels) {
      let timeEl = el.querySelector(s);
      if (!timeEl) timeEl = el.closest('[class*="message"],[class*="chat-item"]')?.querySelector(s);
      if (timeEl) {
        const t = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
        if (t && t.length > 0) return t;
      }
    }
    return null;
  }

  // 检测消息中是否含有文件附件
  function detectFileInMessage(el) {
    const fileIndicators = [
      '[class*="file"]', '[class*="attach"]', '[class*="upload"]',
      'img:not([class*="avatar"]):not([class*="icon"])',
      '[class*="doc"]', '[class*="pdf"]', '[class*="image"]',
    ];
    for (const s of fileIndicators) {
      if (el.querySelector(s)) return true;
    }
    return false;
  }

  function extractFileLabel(el) {
    const nameEl = el.querySelector('[class*="file-name"],[class*="filename"],[class*="name"]');
    if (nameEl) return nameEl.textContent.trim().substring(0, 40);
    const imgEl = el.querySelector('img[alt]');
    if (imgEl && imgEl.alt) return imgEl.alt.substring(0, 40);
    return '附件';
  }

  function formatItemTime(rawTime, index) {
    if (!rawTime) return { display: '#' + (index+1), full: '消息 ' + (index+1) };
    try {
      const d = new Date(rawTime);
      if (!isNaN(d.getTime())) {
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        if (isToday) return { display: timeStr, full: timeStr };
        const dateStr = (d.getMonth()+1) + '/' + d.getDate();
        const fullDateStr = d.getFullYear() + '/' + (d.getMonth()+1).toString().padStart(2,'0') + '/' + d.getDate().toString().padStart(2,'0');
        return { display: dateStr, full: fullDateStr + ' ' + timeStr };
      }
    } catch(e) {}
    return { display: rawTime.substring(0, 10), full: rawTime };
  }

  // ===================== OBSERVER =====================
  function setupObserver() {
    if (state.observer) state.observer.disconnect();
    state.observer = new MutationObserver(() => {
      clearTimeout(window._qtRescan);
      window._qtRescan = setTimeout(scanMessages, 1000);
    });
    state.observer.observe(document.querySelector('main') || document.body,
      { childList: true, subtree: true });
  }

  // ===================== UI INJECTION =====================
  function injectUI() {
    document.getElementById('qtline-root')?.remove();
    const root = document.createElement('div');
    root.id = 'qtline-root';
    root.innerHTML = `
      <div class="qt-timeline" id="qt-timeline">
        <div class="qt-timeline-tabs">
          <button class="qt-tab active" data-mode="messages" title="对话记录">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="12" r="3"/><path d="M12 5v2M12 17v2M5 12H7M17 12h2"/>
            </svg>
          </button>
          <button class="qt-tab" data-mode="files" title="文件列表">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
              <polyline points="13 2 13 9 20 9"/>
            </svg>
          </button>
        </div>
        <div class="qt-track-wrap">
          <div class="qt-track-line"></div>
          <div class="qt-dots" id="qt-dots"></div>
        </div>
      </div>

      <div class="qt-ball" id="qt-ball" title="QTline">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <line x1="5" y1="7" x2="19" y2="7"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
          <line x1="5" y1="17" x2="19" y2="17"/>
          <circle cx="8" cy="7" r="2" fill="currentColor" stroke="none"/>
          <circle cx="11" cy="12" r="2" fill="currentColor" stroke="none"/>
          <circle cx="9" cy="17" r="2" fill="currentColor" stroke="none"/>
        </svg>
      </div>

      <div class="qt-menu" id="qt-menu">
        <button class="qt-menu-item" id="qt-btn-prompts"><span class="qt-micon">💡</span><span>提示词库</span></button>
        <button class="qt-menu-item" id="qt-btn-delete"><span class="qt-micon">🗑️</span><span>批量删除</span></button>
        <button class="qt-menu-item" id="qt-btn-theme"><span class="qt-micon">🎨</span><span>主题切换</span></button>
        <button class="qt-menu-item" id="qt-btn-timeline"><span class="qt-micon">📍</span><span>时间轴开关</span></button>
        <button class="qt-menu-item" id="qt-btn-reset"><span class="qt-micon">🔄</span><span>重置页面样式</span></button>
      </div>

      <div class="qt-panel" id="qt-panel-prompts">
        <div class="qt-panel-hd">
          <span>💡 提示词库</span>
          <div style="display:flex;gap:4px;align-items:center">
            <button class="qt-ico-btn" id="qt-prompt-add" title="新增">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button class="qt-ico-btn" id="qt-prompt-export" title="导出">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button class="qt-ico-btn" id="qt-prompt-import" title="导入">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </button>
            <button class="qt-ico-btn qt-cp" data-target="qt-panel-prompts">✕</button>
          </div>
        </div>
        <div class="qt-tag-bar" id="qt-tag-bar"></div>
        <div class="qt-prompt-list" id="qt-prompt-list"></div>
        <input type="file" id="qt-import-file" accept=".json" style="display:none"/>
      </div>

      <div class="qt-panel" id="qt-panel-delete">
        <div class="qt-panel-hd">
          <span>🗑️ 批量删除对话</span>
          <button class="qt-ico-btn qt-cp" data-target="qt-panel-delete">✕</button>
        </div>
        <div style="padding:14px 16px;overflow-y:auto;max-height:55vh">
          <p class="qt-hint">扫描左侧对话列表，选择后批量删除。</p>
          <button class="qt-btn qt-btn-primary" id="qt-scan-btn" style="margin-bottom:10px">扫描对话列表</button>
          <div id="qt-conv-list" class="qt-conv-list"></div>
          <div id="qt-conv-actions" class="qt-conv-actions" style="display:none">
            <button class="qt-btn qt-btn-outline" id="qt-select-all">全选</button>
            <button class="qt-btn qt-btn-danger" id="qt-delete-sel">删除选中</button>
          </div>
        </div>
      </div>

      <div class="qt-panel" id="qt-panel-theme">
        <div class="qt-panel-hd">
          <span>🎨 主题切换</span>
          <button class="qt-ico-btn qt-cp" data-target="qt-panel-theme">✕</button>
        </div>
        <div class="qt-theme-grid">
          <div class="qt-theme-tile" data-theme="default"><div class="qt-tile-sw sw-default"></div><span>默认</span></div>
          <div class="qt-theme-tile" data-theme="dark"><div class="qt-tile-sw sw-dark"></div><span>暗色</span></div>
          <div class="qt-theme-tile" data-theme="eye"><div class="qt-tile-sw sw-eye"></div><span>护眼</span></div>
          <div class="qt-theme-tile" data-theme="ebook"><div class="qt-tile-sw sw-ebook"></div><span>阅读</span></div>
          <div class="qt-theme-tile" data-theme="night"><div class="qt-tile-sw sw-night"></div><span>午夜</span></div>
        </div>
      </div>

      <div class="qt-overlay" id="qt-modal-wrap">
        <div class="qt-modal">
          <div class="qt-panel-hd">
            <span id="qt-modal-ttl">新增提示词</span>
            <button class="qt-ico-btn qt-cp" data-target="qt-modal-wrap">✕</button>
          </div>
          <input class="qt-input" id="qt-edit-title" placeholder="提示词标题"/>
          <textarea class="qt-textarea" id="qt-edit-content" placeholder="提示词内容…"></textarea>
          <div class="qt-modal-tag-row">
            <input class="qt-input" id="qt-edit-tag-input" placeholder="输入标签后按 Enter 添加"/>
            <div id="qt-edit-tags"></div>
          </div>
          <div class="qt-modal-foot">
            <button class="qt-btn qt-btn-outline qt-cp" data-target="qt-modal-wrap">取消</button>
            <button class="qt-btn qt-btn-primary" id="qt-save-prompt">保存</button>
          </div>
        </div>
      </div>

      <div class="qt-tip" id="qt-tip"></div>
      <div class="qt-notif" id="qt-notif"></div>
    `;
    document.body.appendChild(root);

    // 按保存的设置决定初始可见性
    if (!state.settings.timelineVisible) {
      root.querySelector('#qt-timeline').style.display = 'none';
    }
    if (!state.settings.showFloatButton) {
      root.querySelector('#qt-ball').style.display = 'none';
      root.querySelector('#qt-menu').style.display = 'none';
    }

    bindEvents();
    makeBallDraggable();
    renderPrompts();
  }

  // ===================== DRAG =====================
  function makeBallDraggable() {
    const ball = document.getElementById('qt-ball');
    const menu = document.getElementById('qt-menu');
    if (!ball) return;
    let drag = false, moved = false, sx, sy, origLeft, origBottom;

    ball.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      drag = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      const r = ball.getBoundingClientRect();
      origLeft = r.left;
      origBottom = window.innerHeight - r.bottom;
      ball.style.transition = 'box-shadow 0.25s';
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!drag) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      const newL = Math.max(4, Math.min(window.innerWidth - ball.offsetWidth - 4, origLeft + dx));
      const newB = Math.max(4, Math.min(window.innerHeight - ball.offsetHeight - 4, origBottom - dy));
      ball.style.left = newL + 'px'; ball.style.right = 'auto';
      ball.style.bottom = newB + 'px'; ball.style.top = 'auto';
      menu.style.left = newL + 'px'; menu.style.right = 'auto';
      menu.style.bottom = (newB + ball.offsetHeight + 8) + 'px'; menu.style.top = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = false;
      ball.style.transition = '';
      if (!moved) menu.classList.toggle('visible');
    });
  }

  // ===================== TIMELINE RENDER =====================
  function renderTimeline() {
    const dotsEl = document.getElementById('qt-dots');
    if (!dotsEl) return;
    dotsEl.innerHTML = '';

    const items = state.timelineMode === 'messages' ? state.timelineItems : state.fileItems;
    const total = items.length;

    if (total === 0) {
      dotsEl.innerHTML = '<div class="qt-no-item">' + (state.timelineMode === 'messages' ? '暂无对话' : '暂无文件') + '</div>';
      return;
    }

    items.forEach((item, i) => {
      const dot = document.createElement('div');
      dot.className = 'qt-dot' + (item.type === 'file' ? ' qt-dot-file' : '');
      // 均匀分布：5% ~ 95%
      dot.style.top = (total === 1 ? 50 : 5 + (i / (total - 1)) * 90) + '%';
      dot.addEventListener('mouseenter', e => showTip(e, item));
      dot.addEventListener('mouseleave', hideTip);
      dot.addEventListener('click', () => jumpTo(item));
      dotsEl.appendChild(dot);
    });
  }

  function jumpTo(item) {
    if (!item.element) return;
    item.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    item.element.classList.add('qt-flash');
    setTimeout(() => item.element.classList.remove('qt-flash'), 2200);
  }

  function showTip(e, item) {
    const tip = document.getElementById('qt-tip');
    if (!tip) return;
    const preview = item.text.length > 90 ? item.text.substring(0,90) + '…' : item.text;
    const fileTag = item.hasFile ? ' 📎' : '';
    tip.innerHTML =
      '<div class="qt-tip-meta">' + esc(item.timeFull || item.timeDisplay || '') + ' · #' + (item.index+1) + fileTag + '</div>' +
      '<div class="qt-tip-body">' + esc(preview) + '</div>';
    const r = e.currentTarget.getBoundingClientRect();
    tip.style.top = Math.max(10, r.top - 10) + 'px';
    tip.style.right = '52px';
    tip.classList.add('visible');
  }

  function hideTip() { document.getElementById('qt-tip')?.classList.remove('visible'); }

  // ===================== THEMES =====================
  const THEME_CSS = {
    default: '',
    dark: `
      body,html{background:#111827!important;color:#e5e7eb!important}
      *:not(#qtline-root):not(#qtline-root *){color:#e5e7eb!important}
      [class*="layout"],[class*="container"],[class*="wrapper"],main,[role="main"],
      [class*="chat"],[class*="content"],[class*="page"],[class*="app"]{background:#111827!important}
      [class*="sidebar"],[class*="side-bar"],nav,aside,[class*="left-panel"],[class*="sider"]{background:#1f2937!important;border-color:#374151!important}
      header,[class*="header"],[class*="top-bar"],[class*="navbar"],[class*="topbar"]{background:#1f2937!important;border-color:#374151!important;color:#e5e7eb!important}
      [class*="input-area"],[class*="footer"],[class*="compose"],[class*="bottom"],[class*="input-wrap"],[class*="send"]{background:#1f2937!important;border-color:#374151!important}
      textarea,input:not([type="checkbox"]){background:#374151!important;color:#e5e7eb!important;border-color:#4b5563!important}
      [class*="message"],[class*="bubble"],[class*="chat-item"],[class*="turn"]{color:#e5e7eb!important}
      [class*="assistant"],[class*="ai-"],[class*="bot"],[class*="role-assistant"]{background:#1f2937!important;color:#e5e7eb!important}
      [class*="user-bubble"],[class*="bubble-user"],[class*="role-user"],[class*="human"]{background:#312e81!important;color:#e0e7ff!important}
      pre,code,[class*="code-block"],[class*="hljs"]{background:#0f172a!important;color:#7dd3fc!important;border-color:#1e3a5f!important}
      [class*="card"],[class*="modal"],[class*="popup"],[class*="dropdown"],[class*="menu"]:not(#qtline-root [class*="menu"]){background:#1f2937!important;border-color:#374151!important;color:#e5e7eb!important}
      svg:not(#qtline-root svg){color:#e5e7eb!important}
      [class*="icon"]:not(#qtline-root [class*="icon"]){color:#e5e7eb!important}
      a:not(#qtline-root a){color:#818cf8!important}
      *{scrollbar-color:#4b5563 #1f2937}`,
    eye: `
      body,html{background:#f0f7ee!important}
      [class*="layout"],[class*="container"],[class*="wrapper"],main,[role="main"]{background:#f0f7ee!important}
      [class*="sidebar"],[class*="side-bar"],nav,aside,[class*="left-panel"],[class*="sider"]{background:#d9eed5!important}
      header,[class*="header"],[class*="top-bar"],[class*="navbar"]{background:#d9eed5!important;border-color:#b8ddb2!important}
      [class*="input-area"],[class*="footer"],[class*="compose"],[class*="bottom"]{background:#e4f2e0!important}
      textarea,input:not([type="checkbox"]){background:#f8fff6!important;border-color:#a8d5a2!important}
      [class*="user-bubble"],[class*="bubble-user"],[class*="role-user"]{background:#b8ddb4!important}
      pre,code{background:#e2f0df!important}`,
    ebook: `
      body,html{background:#fdf6e3!important;color:#433422!important}
      [class*="layout"],[class*="container"],[class*="wrapper"],main,[role="main"]{background:#fdf6e3!important}
      [class*="sidebar"],[class*="side-bar"],nav,aside,[class*="left-panel"],[class*="sider"]{background:#f5e6d0!important;border-color:#e0c9a8!important}
      header,[class*="header"],[class*="top-bar"],[class*="navbar"]{background:#f5e6d0!important;border-color:#e0c9a8!important}
      [class*="input-area"],[class*="footer"],[class*="compose"],[class*="bottom"]{background:#f5e6d0!important}
      textarea,input:not([type="checkbox"]){background:#fff8ec!important;color:#433422!important;border-color:#d4b896!important}
      [class*="message"],[class*="bubble"],p{line-height:1.9!important;font-size:15.5px!important}
      [class*="user-bubble"],[class*="bubble-user"],[class*="role-user"]{background:#e8d5b0!important}
      pre,code{background:#f0e2c8!important;color:#5c3d1e!important}
      *{scrollbar-color:#c9a87a #fdf6e3}`,
    night: `
      body,html{background:#0d1117!important;color:#c9d1d9!important}
      *:not(#qtline-root):not(#qtline-root *){color:#c9d1d9!important}
      [class*="layout"],[class*="container"],[class*="wrapper"],main,[role="main"],
      [class*="chat"],[class*="content"],[class*="page"],[class*="app"]{background:#0d1117!important}
      [class*="sidebar"],[class*="side-bar"],nav,aside,[class*="left-panel"],[class*="sider"]{background:#161b22!important;border-color:#21262d!important}
      header,[class*="header"],[class*="top-bar"],[class*="navbar"]{background:#161b22!important;border-color:#21262d!important;color:#c9d1d9!important}
      [class*="input-area"],[class*="footer"],[class*="compose"],[class*="bottom"],[class*="input-wrap"],[class*="send"]{background:#161b22!important;border-color:#21262d!important}
      textarea,input:not([type="checkbox"]){background:#1c2128!important;color:#c9d1d9!important;border-color:#30363d!important}
      [class*="message"],[class*="bubble"],[class*="turn"]{color:#c9d1d9!important}
      [class*="assistant"],[class*="ai-"],[class*="bot"],[class*="role-assistant"]{background:#161b22!important;color:#c9d1d9!important}
      [class*="user-bubble"],[class*="bubble-user"],[class*="role-user"],[class*="human"]{background:#1c2128!important;color:#e6edf3!important}
      pre,code,[class*="code-block"],[class*="hljs"]{background:#161b22!important;color:#7ee787!important;border-color:#30363d!important}
      [class*="card"],[class*="modal"],[class*="popup"],[class*="dropdown"],[class*="menu"]:not(#qtline-root [class*="menu"]){background:#161b22!important;border-color:#21262d!important;color:#c9d1d9!important}
      svg:not(#qtline-root svg){color:#c9d1d9!important}
      a:not(#qtline-root a){color:#58a6ff!important}
      *{scrollbar-color:#30363d #0d1117}`,
  };

  let themeStyleEl = null;

  function applyTheme(theme, save = true) {
    if (!themeStyleEl) {
      themeStyleEl = document.createElement('style');
      themeStyleEl.id = 'qtline-theme-style';
      document.head.appendChild(themeStyleEl);
    }
    themeStyleEl.textContent = THEME_CSS[theme] || '';
    document.documentElement.setAttribute('data-qttheme', theme || 'default');
    state.theme = theme;
    if (save) chrome.storage.local.set({ theme });
    document.querySelectorAll('.qt-theme-tile').forEach(t => t.classList.toggle('active', t.dataset.theme === theme));
  }

  function resetTheme() {
    applyTheme('default');
    showNotification('已重置为默认页面样式');
  }

  // ===================== PROMPTS =====================
  function renderPrompts(activeTag = 'all') {
    const listEl = document.getElementById('qt-prompt-list');
    const barEl = document.getElementById('qt-tag-bar');
    if (!listEl || !barEl) return;

    const allTags = new Set();
    state.prompts.forEach(p => (p.tags||[]).forEach(t => allTags.add(t)));
    barEl.innerHTML = '';

    const mkBtn = (tag, label) => {
      const b = document.createElement('button');
      b.className = 'qt-tag-btn' + (activeTag === tag ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', () => renderPrompts(tag));
      barEl.appendChild(b);
    };
    mkBtn('all', '全部');
    allTags.forEach(t => mkBtn(t, t));

    const filtered = activeTag === 'all' ? state.prompts
      : state.prompts.filter(p => (p.tags||[]).includes(activeTag));

    listEl.innerHTML = '';
    if (!filtered.length) {
      listEl.innerHTML = '<div class="qt-empty">暂无提示词，点击 + 新增</div>';
      return;
    }

    filtered.forEach(p => {
      const card = document.createElement('div');
      card.className = 'qt-prompt-card';
      card.innerHTML =
        '<div class="qt-card-hd">' +
          '<span class="qt-card-title">' + esc(p.title) + '</span>' +
          '<div class="qt-card-acts">' +
            '<button class="qt-ico-btn" data-edit="' + p.id + '" title="编辑">✏️</button>' +
            '<button class="qt-ico-btn" data-del="' + p.id + '" title="删除">🗑️</button>' +
          '</div>' +
        '</div>' +
        '<div class="qt-card-preview">' + esc(p.content.substring(0,70)) + (p.content.length>70?'…':'') + '</div>' +
        '<div class="qt-card-tags">' + (p.tags||[]).map(t=>'<span class="qt-chip">'+esc(t)+'</span>').join('') + '</div>' +
        '<button class="qt-use-btn" data-use="' + p.id + '">▶ 使用此提示词</button>';
      listEl.appendChild(card);
    });

    listEl.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', () => usePrompt(b.dataset.use)));
    listEl.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openPromptModal(b.dataset.edit)));
    listEl.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deletePrompt(b.dataset.del)));
  }

  // ===================== USE PROMPT (with robust fallback) =====================
  function usePrompt(id) {
    const p = state.prompts.find(x => x.id === id);
    if (!p) return;

    // 尝试多种方式找到 Qwen 输入框
    const inputEl = findQwenInput();

    if (inputEl) {
      const filled = fillInput(inputEl, p.content);
      if (filled) {
        closePanel('qt-panel-prompts');
        showNotification('提示词已填入输入框');
        return;
      }
    }

    // 填入失败 → 复制到剪贴板
    navigator.clipboard.writeText(p.content)
      .then(() => showNotification('填入失败，已复制到剪贴板，请手动粘贴'))
      .catch(() => showNotification('已准备好，请手动粘贴'));
    closePanel('qt-panel-prompts');
  }

  function findQwenInput() {
    // Qwen 使用 contenteditable div 作为输入框
    const prioritySelectors = [
      'div[contenteditable="true"][class*="input"]',
      'div[contenteditable="true"][class*="editor"]',
      'div[contenteditable="true"][class*="chat"]',
      'div[contenteditable="true"][class*="compose"]',
      'div[contenteditable="true"]',
      'textarea[class*="input"]',
      'textarea[class*="chat"]',
      'textarea',
    ];
    for (const s of prioritySelectors) {
      const el = document.querySelector(s);
      // 排除 QTline 自身元素
      if (el && !document.getElementById('qtline-root')?.contains(el)) return el;
    }
    return null;
  }

  function fillInput(el, text) {
    try {
      el.focus();
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        // 方法1：原生 value setter（对 React 受控组件有效）
        const descriptor = Object.getOwnPropertyDescriptor(
          el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
          'value'
        );
        if (descriptor && descriptor.set) {
          descriptor.set.call(el, text);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return el.value === text || el.value.length > 0;
        }
      } else if (el.contentEditable === 'true') {
        // contenteditable：先清空再插入
        el.focus();
        // 全选
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        // 用 execCommand 插入（兼容性最好）
        const ok = document.execCommand('insertText', false, text);
        if (!ok || el.textContent.trim() === '') {
          // 直接设置 innerHTML 作为最后手段
          el.textContent = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
        return el.textContent.trim().length > 0;
      }
    } catch(e) {}
    return false;
  }

  // ===================== PROMPT MODAL =====================
  function openPromptModal(id) {
    const p = id ? state.prompts.find(x => x.id === id) : null;
    const modal = document.getElementById('qt-modal-wrap');
    document.getElementById('qt-modal-ttl').textContent = p ? '编辑提示词' : '新增提示词';
    document.getElementById('qt-edit-title').value = p ? p.title : '';
    document.getElementById('qt-edit-content').value = p ? p.content : '';
    modal._editId = id || null;

    let tags = p ? [...(p.tags||[])] : [];
    const tagsEl = document.getElementById('qt-edit-tags');

    const refreshTags = () => {
      tagsEl.innerHTML = tags.map(t =>
        '<span class="qt-chip qt-chip-rm" data-t="' + esc(t) + '">' + esc(t) + '<span class="qt-rm">×</span></span>'
      ).join('');
      tagsEl.querySelectorAll('.qt-chip-rm').forEach(chip =>
        chip.querySelector('.qt-rm').addEventListener('click', () => {
          tags = tags.filter(x => x !== chip.dataset.t); refreshTags();
        })
      );
    };
    refreshTags();

    const tagInput = document.getElementById('qt-edit-tag-input');
    tagInput.value = '';
    tagInput.onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = tagInput.value.trim();
        if (v && !tags.includes(v)) { tags.push(v); refreshTags(); }
        tagInput.value = '';
      }
    };

    document.getElementById('qt-save-prompt').onclick = () => {
      const title = document.getElementById('qt-edit-title').value.trim();
      const content = document.getElementById('qt-edit-content').value.trim();
      if (!title || !content) { showNotification('标题和内容不能为空'); return; }
      if (modal._editId) {
        const i = state.prompts.findIndex(x => x.id === modal._editId);
        if (i !== -1) state.prompts[i] = { ...state.prompts[i], title, content, tags };
      } else {
        state.prompts.push({ id: 'p' + Date.now(), title, content, tags, createdAt: Date.now() });
      }
      chrome.storage.local.set({ prompts: state.prompts });
      renderPrompts();
      closePanel('qt-modal-wrap');
    };
    modal.classList.add('visible');
  }

  function deletePrompt(id) {
    if (!confirm('确认删除此提示词？')) return;
    state.prompts = state.prompts.filter(p => p.id !== id);
    chrome.storage.local.set({ prompts: state.prompts });
    renderPrompts();
  }

  // ===================== BATCH DELETE =====================
  function scanConversations() {
    const listEl = document.getElementById('qt-conv-list');
    const actEl = document.getElementById('qt-conv-actions');
    let items = [];
    for (const s of ['[class*="conversation-item"]','[class*="chat-item"]','[class*="history-item"]','[class*="session-item"]','aside li','nav li']) {
      items = [...document.querySelectorAll(s)];
      if (items.length) break;
    }
    if (!items.length) {
      listEl.innerHTML = '<div class="qt-empty">未找到对话列表，请展开左侧侧边栏后重试</div>';
      return;
    }
    listEl.innerHTML = '';
    items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'qt-conv-row';
      row.innerHTML = '<label><input type="checkbox" class="qt-check"/><span>' + esc(extractText(item).substring(0,50) || '对话 '+(i+1)) + '</span></label>';
      row._el = item;
      listEl.appendChild(row);
    });
    actEl.style.display = 'flex';
    document.getElementById('qt-select-all').onclick = () => {
      const checks = listEl.querySelectorAll('.qt-check');
      const allOn = [...checks].every(c => c.checked);
      checks.forEach(c => c.checked = !allOn);
    };
    document.getElementById('qt-delete-sel').onclick = () => {
      const rows = [...listEl.querySelectorAll('.qt-check:checked')].map(c => c.closest('.qt-conv-row'));
      if (!rows.length) { showNotification('请先选择对话'); return; }
      if (!confirm('删除选中的 ' + rows.length + ' 个对话？')) return;
      rows.forEach(row => {
        const btn = row._el?.querySelector('[class*="delete"],[title*="删除"],[aria-label*="delete"]');
        if (btn) btn.click();
        else row._el?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        row.remove();
      });
      showNotification('已处理 ' + rows.length + ' 个对话');
    };
  }

  // ===================== EVENT BINDINGS =====================
  function bindEvents() {
    const root = document.getElementById('qtline-root');
    const menu = document.getElementById('qt-menu');
    const hideMenu = () => menu.classList.remove('visible');

    // 关闭面板代理
    root.addEventListener('click', e => {
      const cp = e.target.closest('.qt-cp');
      if (cp) closePanel(cp.dataset.target);
    });

    // 时间轴 Tab
    root.addEventListener('click', e => {
      const tab = e.target.closest('.qt-tab');
      if (!tab) return;
      root.querySelectorAll('.qt-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.timelineMode = tab.dataset.mode;
      renderTimeline();
    });

    // 点击 QTline 外部关闭菜单
    document.addEventListener('click', e => {
      if (!e.target.closest('#qtline-root')) hideMenu();
    });

    // 悬浮球菜单按钮
    document.getElementById('qt-btn-prompts').addEventListener('click', () => { togglePanel('qt-panel-prompts'); hideMenu(); });
    document.getElementById('qt-btn-delete').addEventListener('click', () => { togglePanel('qt-panel-delete'); hideMenu(); });
    document.getElementById('qt-btn-theme').addEventListener('click', () => { togglePanel('qt-panel-theme'); hideMenu(); });
    document.getElementById('qt-btn-reset').addEventListener('click', () => { resetTheme(); hideMenu(); });
    document.getElementById('qt-btn-timeline').addEventListener('click', () => {
      const tl = document.getElementById('qt-timeline');
      const wasVisible = tl.style.display !== 'none';
      tl.style.display = wasVisible ? 'none' : 'flex';
      state.settings.timelineVisible = !wasVisible;
      chrome.storage.local.set({ settings: state.settings });
      hideMenu();
    });

    // 提示词面板
    document.getElementById('qt-prompt-add').addEventListener('click', () => openPromptModal(null));
    document.getElementById('qt-prompt-export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state.prompts, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'qtline-prompts.json' });
      a.click();
    });
    document.getElementById('qt-prompt-import').addEventListener('click', () => document.getElementById('qt-import-file').click());
    document.getElementById('qt-import-file').addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const arr = JSON.parse(ev.target.result);
          if (Array.isArray(arr)) {
            state.prompts = [...state.prompts, ...arr];
            chrome.storage.local.set({ prompts: state.prompts });
            renderPrompts();
            showNotification('导入 ' + arr.length + ' 条提示词');
          }
        } catch { showNotification('格式错误'); }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // 主题
    root.querySelectorAll('.qt-theme-tile').forEach(tile =>
      tile.addEventListener('click', () => { applyTheme(tile.dataset.theme); closePanel('qt-panel-theme'); })
    );

    // 批量删除
    document.getElementById('qt-scan-btn').addEventListener('click', scanConversations);

    // 模态框背景关闭
    document.getElementById('qt-modal-wrap').addEventListener('click', e => {
      if (e.target === e.currentTarget) closePanel('qt-modal-wrap');
    });

    window.addEventListener('scroll', debounce(renderTimeline, 400), true);
    window.addEventListener('resize', debounce(renderTimeline, 400));
  }

  // ===================== PANEL HELPERS =====================
  function togglePanel(id) { document.getElementById(id)?.classList.toggle('visible'); }
  function closePanel(id)  { document.getElementById(id)?.classList.remove('visible'); }

  // ===================== UTILS =====================
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function showNotification(msg) {
    const el = document.getElementById('qt-notif');
    if (!el) return;
    el.textContent = msg; el.classList.add('visible');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('visible'), 3000);
  }

  // ===================== POPUP MESSAGE LISTENER =====================
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'TOGGLE_FLOAT_BTN') {
      const ball = document.getElementById('qt-ball');
      const menu = document.getElementById('qt-menu');
      if (ball) ball.style.display = msg.visible ? 'flex' : 'none';
      if (menu && !msg.visible) menu.classList.remove('visible');
      state.settings.showFloatButton = msg.visible;
      chrome.storage.local.set({ settings: state.settings });
    }
    if (msg.type === 'TOGGLE_TIMELINE') {
      const tl = document.getElementById('qt-timeline');
      if (tl) tl.style.display = msg.visible ? 'flex' : 'none';
      state.settings.timelineVisible = msg.visible;
      chrome.storage.local.set({ settings: state.settings });
    }
    if (msg.type === 'OPEN_PANEL') togglePanel(msg.panel);
    if (msg.type === 'RESET_THEME') resetTheme();
    if (msg.type === 'APPLY_THEME') applyTheme(msg.theme);
  });

  // ===================== BOOT =====================
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
