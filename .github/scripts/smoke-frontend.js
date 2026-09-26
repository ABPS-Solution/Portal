// Headless-browser smoke test for the frontend, run by the Pages workflow
// before publishing. It serves the folder locally, loads index.html in
// Chromium and fails the deploy if:
//   - any <script src> fails to load,
//   - any uncaught JavaScript error happens while the page loads,
//   - any inline handler (onclick="fn(...)" etc.) in the markup names a
//     function that doesn't exist once every script has loaded.
// It does not log in (there is no backend here), so it checks that every
// screen's code loads and wires up, not what a screen shows with data.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(process.argv[2] || '.');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', err => problems.push(`Uncaught error: ${err.message}`));
  page.on('response', r => {
    if (r.url().startsWith(base) && r.url().endsWith('.js') && r.status() >= 400) problems.push(`Script failed to load (${r.status()}): ${r.url()}`);
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  const missing = await page.evaluate(() => {
    const out = new Set();
    const attrs = ['onclick', 'onchange', 'oninput', 'onblur', 'onfocus', 'onkeyup', 'onkeydown', 'onsubmit', 'onmousedown', 'onmouseover', 'onmouseout'];
    const skip = new Set(['if', 'return', 'event', 'this', 'document', 'window', 'setTimeout', 'alert', 'confirm', 'Number', 'String', 'parseFloat', 'parseInt', 'JSON', 'Math']);
    document.querySelectorAll('*').forEach(el => {
      attrs.forEach(a => {
        const code = el.getAttribute(a);
        if (!code) return;
        const re = /(^|[;\s(!&|])([A-Za-z_$][\w$]*)\s*\(/g;
        let m;
        while ((m = re.exec(code))) {
          const name = m[2];
          if (skip.has(name)) continue;
          const before = code.slice(0, m.index + m[1].length);
          if (/\.\s*$/.test(before)) continue;           // method call like x.focus()
          if (typeof window[name] !== 'function') out.add(`${a}="${code.slice(0, 80)}" -> ${name}`);
        }
      });
    });
    return [...out];
  });
  missing.forEach(m => problems.push(`Handler calls an undefined function: ${m}`));

  await browser.close();
  server.close();
  if (problems.length) {
    console.error(`Frontend smoke test FAILED (${problems.length}):`);
    problems.forEach(p => console.error('  - ' + p));
    process.exit(1);
  }
  console.log('Frontend smoke test passed: page loads, all scripts load, no uncaught errors, all inline handlers resolve.');
})().catch(err => { console.error(err); server.close(); process.exit(1); });
