// background.js - Service Worker

chrome.runtime.onInstalled.addListener(() => {
  // Initialize default storage
  chrome.storage.local.get(['prompts', 'theme', 'settings'], (result) => {
    if (!result.prompts) {
      chrome.storage.local.set({
        prompts: [
          {
            id: 'p1',
            title: '代码审查',
            content: '请帮我审查以下代码，指出潜在的问题、性能优化点和最佳实践建议：\n\n',
            tags: ['编程', '代码'],
            createdAt: Date.now()
          },
          {
            id: 'p2',
            title: '翻译助手',
            content: '请将以下内容翻译成中文，保持原文的语气和风格：\n\n',
            tags: ['翻译', '语言'],
            createdAt: Date.now()
          },
          {
            id: 'p3',
            title: '总结归纳',
            content: '请对以下内容进行简洁的总结，提炼核心要点：\n\n',
            tags: ['写作', '总结'],
            createdAt: Date.now()
          }
        ]
      });
    }
    if (!result.theme) {
      chrome.storage.local.set({ theme: 'default' });
    }
    if (!result.settings) {
      chrome.storage.local.set({
        settings: {
          showFloatButton: true,
          timelineVisible: true
        }
      });
    }
  });
});

// Handle messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STORAGE') {
    chrome.storage.local.get(message.keys, (result) => {
      sendResponse({ success: true, data: result });
    });
    return true;
  }

  if (message.type === 'SET_STORAGE') {
    chrome.storage.local.set(message.data, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'EXPORT_PROMPTS') {
    chrome.storage.local.get(['prompts'], (result) => {
      sendResponse({ success: true, data: result.prompts || [] });
    });
    return true;
  }
});
