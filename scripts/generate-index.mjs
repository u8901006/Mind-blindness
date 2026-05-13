import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DOCS_DIR = "docs";
const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

function getReportFiles() {
  try {
    return readdirSync(DOCS_DIR)
      .filter((f) => f.startsWith("mindblindness-") && f.endsWith(".html") && f !== "index.html")
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function formatDate(filename) {
  const dateStr = filename.replace("mindblindness-", "").replace(".html", "");
  try {
    const d = new Date(dateStr + "T00:00:00+08:00");
    if (isNaN(d.getTime())) return { display: dateStr, weekday: "" };
    const weekday = WEEKDAY_NAMES[d.getDay()];
    return {
      display: `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`,
      weekday: `週${weekday}`,
    };
  } catch {
    return { display: dateStr, weekday: "" };
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateIndex() {
  const files = getReportFiles();
  const total = files.length;
  const display = files.slice(0, 30);

  const listItems = display
    .map((f) => {
      const { display: dateDisplay, weekday } = formatDate(f);
      return `        <li class="report-item">
          <a href="${escapeHtml(f)}" class="report-link">
            <span class="report-icon">📅</span>
            <span class="report-date">${escapeHtml(dateDisplay)}</span>
            <span class="report-weekday">（${escapeHtml(weekday)}）</span>
          </a>
        </li>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="心盲症與心智盲區每日研究簡報索引">
<title>心盲症與心智盲區研究日報</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #f6f1e8;
  --surface: #fffaf2;
  --line: #d8c5ab;
  --text: #2b2118;
  --muted: #766453;
  --accent: #8c4f2b;
  --accent-soft: #ead2bf;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: "Noto Sans TC", "PingFang TC", "Helvetica Neue", Arial, sans-serif;
  color: var(--text);
  background: radial-gradient(circle at top, #fff6ea 0, var(--bg) 55%, #ead8c6 100%);
  min-height: 100vh;
  line-height: 1.75;
  -webkit-font-smoothing: antialiased;
}
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeDown {
  from { opacity: 0; transform: translateY(-16px); }
  to { opacity: 1; transform: translateY(0); }
}
.container { max-width: 640px; margin: 0 auto; padding: 60px 20px 80px; }
.page-header {
  text-align: center;
  margin-bottom: 48px;
  animation: fadeDown 0.6s ease-out;
}
.page-header h1 {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--accent);
  margin-bottom: 8px;
}
.page-header .subtitle {
  font-size: 0.92rem;
  color: var(--muted);
  font-weight: 400;
}
.page-header .total-badge {
  display: inline-block;
  margin-top: 14px;
  padding: 5px 18px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.82rem;
  font-weight: 500;
}
.report-list {
  list-style: none;
  padding: 0;
  animation: fadeUp 0.6s ease-out 0.1s both;
}
.report-item {
  margin-bottom: 10px;
}
.report-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  background: var(--surface);
  border-radius: 14px;
  text-decoration: none;
  color: var(--text);
  box-shadow: 0 4px 16px rgba(61,36,15,0.03);
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}
.report-link:hover {
  transform: translateX(4px);
  background: var(--accent-soft);
  box-shadow: 0 6px 24px rgba(61,36,15,0.06);
}
.report-icon { font-size: 1.1rem; flex-shrink: 0; }
.report-date { font-weight: 500; font-size: 0.95rem; }
.report-weekday { color: var(--muted); font-size: 0.88rem; }
.page-footer {
  text-align: center;
  margin-top: 60px;
  padding: 28px 0;
  border-top: 1px solid var(--line);
  font-size: 0.85rem;
  color: var(--muted);
}
.footer-links {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 20px;
  margin-top: 12px;
}
.footer-links a {
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.2s;
}
.footer-links a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="container">
  <header class="page-header">
    <h1>心盲症與心智盲區研究日報</h1>
    <p class="subtitle">Aphantasia &amp; Mind Blindness Daily Research Briefing</p>
    <span class="total-badge">共 ${total} 份報告</span>
  </header>

  <ul class="report-list">
${listItems}
  </ul>

  <footer class="page-footer">
    <p>由 AI 自動生成｜資料來源：PubMed、Crossref</p>
    <div class="footer-links">
      <a href="https://www.leepsyclinic.com/" target="_blank" rel="noopener">李政洋身心診所首頁</a>
      <a href="https://blog.leepsyclinic.com/" target="_blank" rel="noopener">訂閱電子報</a>
      <a href="https://buymeacoffee.com/CYlee" target="_blank" rel="noopener">Buy me a coffee ☕</a>
    </div>
  </footer>
</div>
</body>
</html>`;

  writeFileSync(join(DOCS_DIR, "index.html"), html, "utf-8");
  console.error(`[OK] Index page generated with ${display.length} entries (total: ${total})`);
}

generateIndex();
