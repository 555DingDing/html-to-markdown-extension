// 创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'convert-page',
    title: '将此页面转换为Markdown',
    contexts: ['page']
  });
  chrome.contextMenus.create({
    id: 'convert-selection',
    title: '将选中内容转换为Markdown',
    contexts: ['selection']
  });
});

// 右键菜单 → 提取HTML → 存入临时存储 → 打开popup
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    let result;

    if (info.menuItemId === 'convert-page') {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const article = document.querySelector('article')
            || document.querySelector('[role="main"]')
            || document.querySelector('main')
            || document.querySelector('.content')
            || document.querySelector('.post')
            || document.body;
          return { html: article.innerHTML, title: document.title, mode: 'page' };
        }
      });
      result = results[0].result;

    } else if (info.menuItemId === 'convert-selection') {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return null;
          const range = sel.getRangeAt(0);
          const div = document.createElement('div');
          div.appendChild(range.cloneContents());
          return { html: div.innerHTML, title: '选中内容', mode: 'selection' };
        }
      });
      result = results[0].result;

      if (!result) {
        await showNoticeOnPage(tab.id, '请先在页面上选中内容');
        return;
      }
    }

    // 存入session存储，popup打开后读取
    await chrome.storage.session.set({ pendingConversion: result });

  } catch (err) {
    console.error('提取失败:', err);
  }
});

// 注入通知到页面
async function showNoticeOnPage(tabId, message) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (msg) => {
      const notice = document.createElement('div');
      notice.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 2147483647;
        background: #333; color: white; padding: 12px 24px; border-radius: 8px;
        font-size: 14px; font-family: sans-serif;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: opacity 0.3s;
      `;
      notice.textContent = msg;
      document.body.appendChild(notice);
      setTimeout(() => {
        notice.style.opacity = '0';
        setTimeout(() => notice.remove(), 300);
      }, 2200);
    },
    args: [message]
  });
}
