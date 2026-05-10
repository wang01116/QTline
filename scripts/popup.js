// popup.js - QTline v1.0.0
(async function () {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const badge = document.getElementById("status-badge");
  const isQwen = tab && tab.url && tab.url.includes("chat.qwen.ai");

  if (!isQwen) {
    badge.textContent = "未激活";
    badge.className = "badge badge-off";
    document.querySelectorAll(".sec").forEach(s => s.style.opacity = "0.35");
    document.querySelectorAll("button,label,input,.t-dot").forEach(el => el.style.pointerEvents = "none");
    return;
  }

  async function send(msg) {
    try { await chrome.tabs.sendMessage(tab.id, msg); } catch(e) {}
  }

  chrome.storage.local.get(["settings","theme"], res => {
    const s = res.settings || {};
    document.getElementById("tog-timeline").checked = s.timelineVisible !== false;
    document.getElementById("tog-float").checked    = s.showFloatButton !== false;
    const cur = res.theme || "default";
    document.querySelectorAll(".t-dot").forEach(d => d.classList.toggle("cur", d.dataset.theme === cur));
  });

  document.getElementById("tog-timeline").addEventListener("change", e => {
    const v = e.target.checked;
    send({ type: "TOGGLE_TIMELINE", visible: v });
    chrome.storage.local.get(["settings"], r => {
      chrome.storage.local.set({ settings: { ...(r.settings||{}), timelineVisible: v } });
    });
  });

  document.getElementById("tog-float").addEventListener("change", e => {
    const v = e.target.checked;
    send({ type: "TOGGLE_FLOAT_BTN", visible: v });
    chrome.storage.local.get(["settings"], r => {
      chrome.storage.local.set({ settings: { ...(r.settings||{}), showFloatButton: v } });
    });
  });

  document.querySelectorAll(".t-dot").forEach(dot => {
    dot.addEventListener("click", () => {
      const theme = dot.dataset.theme;
      send({ type: "APPLY_THEME", theme });
      chrome.storage.local.set({ theme });
      document.querySelectorAll(".t-dot").forEach(d => d.classList.toggle("cur", d === dot));
    });
  });

  document.getElementById("btn-prompts").addEventListener("click", () => {
    send({ type: "OPEN_PANEL", panel: "qt-panel-prompts" }); window.close();
  });
  document.getElementById("btn-delete").addEventListener("click", () => {
    send({ type: "OPEN_PANEL", panel: "qt-panel-delete" }); window.close();
  });
  document.getElementById("btn-reset").addEventListener("click", () => {
    send({ type: "RESET_THEME" });
    chrome.storage.local.set({ theme: "default" });
    document.querySelectorAll(".t-dot").forEach(d => d.classList.toggle("cur", d.dataset.theme === "default"));
  });
})();
