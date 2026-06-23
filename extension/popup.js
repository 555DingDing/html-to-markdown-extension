// ===== Turndown 初始化（从存储加载用户配置） =====
const TURNDOWN_DEFAULTS = {
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined'
};

let turndownService;

function createTurndownService(opts) {
  const config = { ...TURNDOWN_DEFAULTS, ...opts, fence: '```' };
  const tds = new TurndownService(config);
  tds.use(turndownPluginGfm.gfm);
  return tds;
}

// 加载配置并初始化
chrome.storage.sync.get('turndownOptions', (data) => {
  turndownService = createTurndownService(data.turndownOptions);
  checkPendingConversion();
});

// ===== DOM 引用 =====
const $ = (id) => document.getElementById(id);
const htmlInput = $('htmlInput');
const markdownOutput = $('markdownOutput');
const previewOutput = $('previewOutput');
const outputSection = $('outputSection');
const charCount = $('charCount');
const convertPasteBtn = $('convertPasteBtn');
const convertPageBtn = $('convertPageBtn');
const convertSelectionBtn = $('convertSelectionBtn');
const copyBtn = $('copyBtn');
const downloadBtn = $('downloadBtn');

let currentMarkdown = '';

// ===== 检查是否有待转换内容（来自右键菜单） =====
function checkPendingConversion() {
  chrome.storage.session.get('pendingConversion', (data) => {
    if (data.pendingConversion) {
      const { html, title, mode } = data.pendingConversion;
      chrome.storage.session.remove('pendingConversion');

      switchTab('paste');
      htmlInput.value = html;

      const markdown = turndownService.turndown(html);
      showResult(mode === 'page' && title ? `# ${title}\n\n${markdown}` : markdown);
    }
  });
}

// ===== 设置按钮 =====
$('settingsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ===== 标签页切换 =====
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const target = document.querySelector(`.tab[data-tab="${tabName}"]`);
  if (target) {
    target.classList.add('active');
    $(tabName + '-tab').classList.add('active');
  }
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// ===== 输出视图切换（源码/预览） =====
document.querySelectorAll('.output-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.output-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.output-view').forEach(v => v.classList.remove('active'));
    tab.classList.add('active');
    const view = tab.dataset.view;
    $(view === 'source' ? 'markdownOutput' : 'previewOutput').classList.add('active');

    // 切换到预览时渲染
    if (view === 'preview') {
      previewOutput.innerHTML = renderMarkdown(currentMarkdown);
    }
  });
});

// ===== 粘贴HTML转换 =====
convertPasteBtn.addEventListener('click', () => {
  const html = htmlInput.value.trim();
  if (!html) {
    showNotice('请先粘贴HTML代码');
    return;
  }
  showResult(turndownService.turndown(html));
});

// ===== 转换当前页面 =====
convertPageBtn.addEventListener('click', async () => {
  setButtonLoading(convertPageBtn, true, '转换中...');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!isInjectable(tab.url)) {
      showNotice('无法在此页面使用（浏览器内部页面）');
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const article = document.querySelector('article')
          || document.querySelector('[role="main"]')
          || document.querySelector('main')
          || document.querySelector('.content')
          || document.querySelector('.post')
          || document.body;
        return { html: article.innerHTML, title: document.title };
      }
    });

    const { html, title } = results[0].result;
    showResult(`# ${title}\n\n${turndownService.turndown(html)}`);
  } catch (err) {
    showNotice('转换失败: ' + err.message);
  } finally {
    setButtonLoading(convertPageBtn, false, '转换当前页面');
  }
});

// ===== 转换选中内容 =====
convertSelectionBtn.addEventListener('click', async () => {
  setButtonLoading(convertSelectionBtn, true, '转换中...');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!isInjectable(tab.url)) {
      showNotice('无法在此页面使用（浏览器内部页面）');
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const range = sel.getRangeAt(0);
        const div = document.createElement('div');
        div.appendChild(range.cloneContents());
        return div.innerHTML;
      }
    });

    const html = results[0].result;
    if (!html) {
      showNotice('请先在页面上选中内容');
      return;
    }
    showResult(turndownService.turndown(html));
  } catch (err) {
    showNotice('转换失败: ' + err.message);
  } finally {
    setButtonLoading(convertSelectionBtn, false, '转换选中内容');
  }
});

// ===== 拖拽文件 =====
htmlInput.addEventListener('dragover', (e) => {
  e.preventDefault();
  htmlInput.classList.add('drag-over');
});

htmlInput.addEventListener('dragleave', () => {
  htmlInput.classList.remove('drag-over');
});

htmlInput.addEventListener('drop', (e) => {
  e.preventDefault();
  htmlInput.classList.remove('drag-over');

  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (!file.name.match(/\.html?$/i)) {
    showNotice('只支持 .html 或 .htm 文件');
    return;
  }

  const reader = new FileReader();
  reader.onload = (ev) => {
    htmlInput.value = ev.target.result;
    showNotice(`已加载: ${file.name}`);
  };
  reader.readAsText(file);
});

// ===== 工具函数 =====

function isInjectable(url) {
  if (!url) return false;
  return !['chrome://', 'chrome-extension://', 'edge://', 'about:', 'chrome-search://', 'chrome-devtools://']
    .some(prefix => url.startsWith(prefix));
}

function showResult(markdown) {
  currentMarkdown = markdown;
  markdownOutput.value = markdown;
  charCount.textContent = `${markdown.length} 字符`;

  // 重置为源码视图
  document.querySelectorAll('.output-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.output-view').forEach(v => v.classList.remove('active'));
  document.querySelector('.output-tab[data-view="source"]').classList.add('active');
  markdownOutput.classList.add('active');

  outputSection.style.display = 'block';
  outputSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showNotice(msg) {
  const old = document.querySelector('.notice');
  if (old) old.remove();

  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.textContent = msg;
  document.body.appendChild(notice);
  setTimeout(() => {
    notice.style.opacity = '0';
    setTimeout(() => notice.remove(), 300);
  }, 2200);
}

function setButtonLoading(btn, loading, text) {
  btn.disabled = loading;
  btn.textContent = text;
}

// ===== 简单 Markdown → HTML 渲染器（预览用） =====
function renderMarkdown(md) {
  if (!md) return '';

  let html = md;

  // 转义HTML实体（先保存原始内容）
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 代码块 ```...```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`;
  });

  // 行内代码 `...`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 标题
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // 水平线
  html = html.replace(/^---+$/gm, '<hr>');

  // 粗体和斜体
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // 图片 ![alt](src)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">');

  // 链接 [text](href)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // 引用块
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
  // 合并连续引用
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  // 无序列表
  html = html.replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // 有序列表
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<oli>$1</oli>');
  html = html.replace(/(<oli>.*<\/oli>\n?)+/g, (match) => {
    return '<ol>' + match.replace(/<\/?oli>/g, (t) => t.replace('oli', 'li')) + '</ol>';
  });

  // 表格
  html = html.replace(/^(\|.+\|)\n(\|[-:\s|]+\|)\n((?:\|.+\|\n?)+)/gm, (match, header, sep, body) => {
    const headers = header.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
    const rows = body.trim().split('\n').map(row => {
      const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // 段落（双换行）
  html = html.replace(/\n\n+/g, '</p><p>');
  html = `<p>${html}</p>`;

  // 单换行 → <br>
  html = html.replace(/(?<!<\/?(?:p|div|h[1-6]|li|ul|ol|pre|blockquote|table|tr|hr))\n/g, '<br>');

  // 清理空段落
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>\s*(<(?:h[1-6]|ul|ol|pre|blockquote|table|hr))/g, '$1');
  html = html.replace(/(<\/(?:h[1-6]|ul|ol|pre|blockquote|table|hr)>)\s*<\/p>/g, '$1');

  return html;
}

// ===== 复制 =====
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentMarkdown);
    copyBtn.textContent = '已复制!';
    setTimeout(() => { copyBtn.textContent = '复制'; }, 1500);
  } catch {
    markdownOutput.select();
    document.execCommand('copy');
    copyBtn.textContent = '已复制!';
    setTimeout(() => { copyBtn.textContent = '复制'; }, 1500);
  }
});

// ===== 下载 =====
downloadBtn.addEventListener('click', () => {
  const blob = new Blob([currentMarkdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'converted.md';
  a.click();
  URL.revokeObjectURL(url);
});

// ===== 快捷键 =====
htmlInput.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    convertPasteBtn.click();
  }
});
