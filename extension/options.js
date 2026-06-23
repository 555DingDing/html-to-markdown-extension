// 默认设置
const DEFAULTS = {
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  hr: '---',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined'
};

// 加载设置
function loadOptions() {
  chrome.storage.sync.get('turndownOptions', (data) => {
    const opts = { ...DEFAULTS, ...data.turndownOptions };
    for (const [key, value] of Object.entries(opts)) {
      const radio = document.querySelector(`input[name="${key}"][value="${value}"]`);
      if (radio) radio.checked = true;
    }
  });
}

// 保存设置
function saveOptions() {
  const opts = {};
  for (const key of Object.keys(DEFAULTS)) {
    const checked = document.querySelector(`input[name="${key}"]:checked`);
    if (checked) opts[key] = checked.value;
  }

  chrome.storage.sync.set({ turndownOptions: opts }, () => {
    const status = document.getElementById('saveStatus');
    status.textContent = '已保存!';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
}

// 恢复默认
function resetOptions() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const radio = document.querySelector(`input[name="${key}"][value="${value}"]`);
    if (radio) radio.checked = true;
  }

  chrome.storage.sync.set({ turndownOptions: DEFAULTS }, () => {
    const status = document.getElementById('saveStatus');
    status.textContent = '已恢复默认!';
    status.style.color = '#667eea';
    setTimeout(() => {
      status.textContent = '';
      status.style.color = '#28a745';
    }, 2000);
  });
}

// 事件绑定
document.getElementById('saveBtn').addEventListener('click', saveOptions);
document.getElementById('resetBtn').addEventListener('click', resetOptions);

// 初始化
loadOptions();
