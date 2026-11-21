const pre = document.createElement('pre');
pre.style.cssText = 'position:fixed;inset:0 0 auto 0;z-index:99999;font:11px monospace;background:#fff;color:#111;padding:8px;margin:0;white-space:pre-wrap';
document.documentElement.appendChild(pre);
try {
  const rows = [...document.querySelectorAll('[data-journal-line]')];
  const codes = () => rows.map((r) => r.querySelector('[data-journal-field="account"]').value);
  const labels = () => rows.map((r) => (r.querySelector('.ss .ms-text')?.textContent || '').slice(0, 10));
  const before = codes();
  const box = rows[0].querySelector('.ss[data-ss="account"]');
  box.querySelector('.ms-trigger').click();
  const item = [...box.querySelectorAll('.ss-item')].find((b) => b.dataset.value === '4000');
  item.click();
  pre.textContent = `rows=${rows.length}\nbefore=${before.join(',')}\nafter =${codes().join(',')}\nlabels=${labels().join(' | ')}`;
} catch (e) { pre.textContent = 'ERR ' + e.message + '\n' + e.stack; }
