import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";

const API_BASE = "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions";
const MODEL_FALLBACKS = ["glm-5-turbo", "glm-4.7", "glm-4.7-flash"];
const MAX_TOKENS = 50000;
const TIMEOUT_MS = 480_000;
const MAX_RETRIES = 3;

const TAG_CATEGORIES = [
  "認知神經科學",
  "視覺意象",
  "心理意象",
  "自傳式記憶",
  "臉孔辨識",
  "創造力",
  "夢境",
  "自閉症",
  "理論心智",
  "PTSD",
  "意象治療",
  "神經影像",
  "現象學",
  "教育學",
  "社會科學",
  "獲得性心盲症",
  "先天性心盲症",
  "超級想像力",
  "計算模型",
  "精神醫學",
  "發展心理學",
  "哲學意識",
];

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizePromptInput(str) {
  return String(str)
    .replace(/[<>]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .slice(0, 4000);
}

function buildSystemPrompt() {
  return `你是「心盲症與心智盲區研究」領域的資深學者，同時具備認知神經科學、精神醫學、發展心理學與哲學意識研究的跨領域專長。你的任務是分析最新的 aphantasia / mind blindness 相關研究文獻，產出一份繁體中文（台灣）的每日研究簡報。

## 標籤分類
請從以下標籤中為每篇文獻選擇最相關的 1-3 個分類標籤：
${TAG_CATEGORIES.join("、")}

## 輸出格式
請嚴格以 JSON 格式回應，結構如下：
{
  "summary": {
    "overview": "一段 200-400 字的今日研究概覽，涵蓋重要發現與趨勢",
    "highlights": [
      "亮點1：簡述今日最值得關注的發現",
      "亮點2",
      "亮點3"
    ],
    "trend": "研究趨勢觀察：指出近期 aphantasia / mind blindness 領域的發展方向"
  },
  "top_picks": [
    {
      "rank": 1,
      "pmid": "PMID 或 DOI",
      "title_zh": "論文標題的中文翻譯",
      "title_en": "Original English Title",
      "journal": "期刊名稱",
      "date": "發表日期",
      "url": "連結",
      "relevance": "high/medium/low",
      "category": ["標籤1", "標籤2"],
      "summary": "100-200 字的繁體中文摘要，說明研究重點、方法、發現",
      "clinical_implication": "臨床或應用意涵（如適用）",
      "pico": {
        "population": "研究對象",
        "intervention": "介入或測量方式",
        "comparison": "對照組或比較基準",
        "outcome": "主要研究結果"
      }
    }
  ],
  "all_papers": [
    {
      "pmid": "PMID 或 DOI",
      "title_zh": "中文標題",
      "title_en": "英文標題",
      "journal": "期刊",
      "date": "日期",
      "url": "連結",
      "relevance": "high/medium/low",
      "category": ["標籤"],
      "summary": "50-100 字簡短摘要"
    }
  ],
  "topic_distribution": {
    "標籤名稱": 篇數,
    ...
  },
  "keywords": ["關鍵字1", "關鍵字2", ...]
}

## 分析準則
1. top_picks 最多 8 篇，按重要性排序
2. 每篇文獻的 relevance 要合理評估
3. PICO 分析要精確，如果文獻不是臨床試驗，PICO 可填寫觀察性研究描述
4. 摘要要用繁體中文（台灣），專業術語保留英文並在前後加空格
5. topic_distribution 要涵蓋所有出現的分類
6. 如果文獻數量為 0，請在 summary.overview 中說明「今日無新增文獻」`;
}

function buildUserPrompt(papers) {
  const paperTexts = papers.map((p, i) => {
    const parts = [`[${i + 1}]`];
    if (p.title) parts.push(`Title: ${sanitizePromptInput(p.title)}`);
    if (p.journal) parts.push(`Journal: ${sanitizePromptInput(p.journal)}`);
    if (p.date) parts.push(`Date: ${sanitizePromptInput(p.date)}`);
    if (p.abstract) parts.push(`Abstract: ${sanitizePromptInput(p.abstract)}`);
    if (p.pmid) parts.push(`PMID: ${sanitizePromptInput(p.pmid)}`);
    if (p.doi) parts.push(`DOI: ${sanitizePromptInput(p.doi)}`);
    if (p.url) parts.push(`URL: ${sanitizePromptInput(p.url)}`);
    if (p.keywords?.length)
      parts.push(`Keywords: ${sanitizePromptInput(p.keywords.join(", "))}`);
    return parts.join("\n");
  });
  return `以下是今天收集到的 ${papers.length} 篇 aphantasia / mind blindness 相關研究文獻。請分析並生成繁體中文每日研究簡報。\n\n${paperTexts.join("\n\n---\n\n")}`;
}

function tryParseJson(text) {
  const cleaned = text
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .replace(/^[^{]*?(\{)/, "$1")
    .replace(/(\})[^}]*$/, "$1")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const braceStart = cleaned.indexOf("{");
  const braceEnd = cleaned.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) {
    try {
      return JSON.parse(cleaned.slice(braceStart, braceEnd + 1));
    } catch {}
  }
  try {
    const fixed = cleaned
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/'/g, '"')
      .replace(/(\w+)(?=\s*:)/g, '"$1"');
    return JSON.parse(fixed);
  } catch {}
  return null;
}

async function callZhipuAPI(apiKey, model, messages) {
  const resp = await fetch(API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: MAX_TOKENS,
      temperature: 0.3,
      top_p: 0.85,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`API ${resp.status}: ${body.slice(0, 500)}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from API");
  return content;
}

async function analyzeWithFallback(apiKey, papers) {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(papers);
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  for (const model of MODEL_FALLBACKS) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.error(`[INFO] Trying ${model} (attempt ${attempt})...`);
        const raw = await callZhipuAPI(apiKey, model, messages);
        const parsed = tryParseJson(raw);
        if (parsed) {
          console.error(`[OK] ${model} succeeded on attempt ${attempt}`);
          return parsed;
        }
        console.error(`[WARN] ${model} returned non-JSON, retrying...`);
      } catch (e) {
        console.error(`[WARN] ${model} attempt ${attempt} failed: ${e.message}`);
      }
    }
  }
  return null;
}

function generateEmptyReport(dateStr) {
  return {
    summary: {
      overview: "今日無新增 aphantasia / mind blindness 相關研究文獻。",
      highlights: ["目前沒有新的文獻發表"],
      trend: "請持續關注此領域的最新發展。",
    },
    top_picks: [],
    all_papers: [],
    topic_distribution: {},
    keywords: [],
  };
}

function generateHtml(report, dateStr) {
  const weekdayNames = ["日", "一", "二", "三", "四", "五", "六"];
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  const weekday = weekdayNames[d.getDay()];
  const dateDisplay = `${year} 年 ${month} 月 ${day} 日（週${weekday}）`;

  const overview = escapeHtml(report.summary?.overview || "");
  const highlights = (report.summary?.highlights || []).map((h) => escapeHtml(h));
  const trend = escapeHtml(report.summary?.trend || "");
  const topPicks = report.top_picks || [];
  const allPapers = report.all_papers || [];
  const topicDist = report.topic_distribution || {};
  const keywords = report.keywords || [];
  const maxTopicCount = Math.max(...Object.values(topicDist), 1);

  const topicBars = Object.entries(topicDist)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([name, count]) => `
      <div class="topic-bar-row">
        <span class="topic-bar-label">${escapeHtml(name)}</span>
        <div class="topic-bar-track">
          <div class="topic-bar-fill" style="width:${Math.round((count / maxTopicCount) * 100)}%"></div>
        </div>
        <span class="topic-bar-count">${count}</span>
      </div>`
    )
    .join("");

  const highlightItems = highlights
    .map((h) => `<li>${h}</li>`)
    .join("");

  const keywordBadges = keywords
    .slice(0, 20)
    .map((kw) => `<span class="keyword-badge">${escapeHtml(kw)}</span>`)
    .join("");

  const pickCards = topPicks
    .map(
      (p) => `
    <article class="card pick-card" data-pmid="${escapeHtml(p.pmid || "")}">
      <div class="card-header">
        <span class="rank-badge">#${p.rank}</span>
        <div class="card-title-group">
          <h3 class="card-title-zh">${escapeHtml(p.title_zh || "")}</h3>
          <p class="card-title-en">${escapeHtml(p.title_en || "")}</p>
        </div>
      </div>
      <div class="card-meta">
        <span class="meta-journal">${escapeHtml(p.journal || "")}</span>
        <span class="meta-date">${escapeHtml(p.date || "")}</span>
      </div>
      <div class="card-tags">
        ${(p.category || []).map((c) => `<span class="tag">${escapeHtml(c)}</span>`).join("")}
        <span class="relevance-badge relevance-${escapeHtml(p.relevance || "medium")}">${
        p.relevance === "high"
          ? "★ 高相關"
          : p.relevance === "medium"
          ? "● 中相關"
          : "○ 低相關"
      }</span>
      </div>
      <p class="card-summary">${escapeHtml(p.summary || "")}</p>
      ${
        p.clinical_implication
          ? `<div class="clinical-box"><strong>臨床意涵：</strong>${escapeHtml(p.clinical_implication)}</div>`
          : ""
      }
      ${
        p.pico
          ? `<div class="pico-grid">
        <div class="pico-item"><span class="pico-label">P</span><span class="pico-text">${escapeHtml(
          p.pico.population || "N/A"
        )}</span></div>
        <div class="pico-item"><span class="pico-label">I</span><span class="pico-text">${escapeHtml(
          p.pico.intervention || "N/A"
        )}</span></div>
        <div class="pico-item"><span class="pico-label">C</span><span class="pico-text">${escapeHtml(
          p.pico.comparison || "N/A"
        )}</span></div>
        <div class="pico-item"><span class="pico-label">O</span><span class="pico-text">${escapeHtml(
          p.pico.outcome || "N/A"
        )}</span></div>
      </div>`
          : ""
      }
      <div class="card-footer">
        <a href="${escapeHtml(p.url || "#")}" target="_blank" rel="noopener" class="card-link">查看原文 →</a>
      </div>
    </article>`
    )
    .join("");

  const paperRows = allPapers
    .map(
      (p) => `
    <tr class="paper-row">
      <td class="paper-title-cell">
        <a href="${escapeHtml(p.url || "#")}" target="_blank" rel="noopener" class="paper-link">${escapeHtml(
        p.title_zh || p.title_en || ""
      )}</a>
        <div class="paper-meta-inline">
          <span>${escapeHtml(p.journal || "")}</span>
          ${(p.category || []).map((c) => `<span class="mini-tag">${escapeHtml(c)}</span>`).join("")}
        </div>
      </td>
      <td class="paper-summary-cell">${escapeHtml(p.summary || "")}</td>
      <td class="paper-rel-cell">
        <span class="relevance-badge relevance-${escapeHtml(p.relevance || "medium")}">${
        p.relevance === "high" ? "★" : p.relevance === "medium" ? "●" : "○"
      }</span>
      </td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="心盲症與心智盲區每日研究簡報 ${dateDisplay}">
<meta name="author" content="Mind Blindness Research Bot">
<title>心盲症與心智盲區研究日報｜${dateDisplay}</title>
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
  --card-bg: color-mix(in srgb, var(--surface) 92%, white);
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  font-family: "Noto Sans TC", "PingFang TC", "Helvetica Neue", Arial, sans-serif;
  color: var(--text);
  background: radial-gradient(circle at top, #fff6ea 0, var(--bg) 55%, #ead8c6 100%);
  min-height: 100vh;
  line-height: 1.75;
  -webkit-font-smoothing: antialiased;
}
.container { max-width: 880px; margin: 0 auto; padding: 40px 20px 60px; }
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeDown {
  from { opacity: 0; transform: translateY(-16px); }
  to { opacity: 1; transform: translateY(0); }
}
.page-header {
  text-align: center;
  margin-bottom: 48px;
  animation: fadeDown 0.6s ease-out;
}
.page-header h1 {
  font-size: 1.65rem;
  font-weight: 700;
  color: var(--accent);
  margin-bottom: 6px;
  letter-spacing: 0.03em;
}
.page-header .subtitle {
  font-size: 0.95rem;
  color: var(--muted);
  font-weight: 400;
}
.page-header .date-badge {
  display: inline-block;
  margin-top: 12px;
  padding: 6px 20px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
  font-size: 0.88rem;
}
.section { margin-bottom: 44px; animation: fadeUp 0.6s ease-out both; }
.section:nth-child(2) { animation-delay: 0.08s; }
.section:nth-child(3) { animation-delay: 0.16s; }
.section:nth-child(4) { animation-delay: 0.24s; }
.section-title {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--accent);
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--accent-soft);
}
.overview-box {
  background: var(--surface);
  border-radius: 20px;
  padding: 28px 32px;
  box-shadow: 0 20px 60px rgba(61,36,15,0.06);
  margin-bottom: 20px;
  font-size: 0.96rem;
  line-height: 1.9;
}
.highlight-list {
  list-style: none;
  padding: 0;
  margin-top: 16px;
}
.highlight-list li {
  padding: 8px 0 8px 24px;
  position: relative;
  font-size: 0.93rem;
}
.highlight-list li::before {
  content: "◆";
  position: absolute;
  left: 0;
  color: var(--accent);
  font-size: 0.7rem;
  top: 12px;
}
.trend-box {
  background: linear-gradient(135deg, var(--accent-soft) 0, #f5e6d5 100%);
  border-radius: 16px;
  padding: 20px 24px;
  margin-top: 16px;
  font-size: 0.92rem;
  color: var(--text);
}
.trend-box strong { color: var(--accent); }
.card {
  background: var(--card-bg);
  border-radius: 24px;
  padding: 28px 32px;
  box-shadow: 0 8px 30px rgba(61,36,15,0.04);
  margin-bottom: 24px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 40px rgba(61,36,15,0.08);
}
.card-header { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 12px; }
.rank-badge {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
}
.card-title-group { flex: 1; }
.card-title-zh {
  font-size: 1.08rem;
  font-weight: 600;
  line-height: 1.5;
  margin-bottom: 2px;
}
.card-title-en {
  font-size: 0.82rem;
  color: var(--muted);
  font-weight: 400;
  line-height: 1.4;
}
.card-meta {
  display: flex;
  gap: 16px;
  font-size: 0.82rem;
  color: var(--muted);
  margin-bottom: 10px;
}
.card-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.tag {
  padding: 3px 12px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 500;
}
.relevance-badge {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 500;
}
.relevance-high { background: #d4e8c2; color: #5a7a3a; }
.relevance-medium { background: #f5e6c8; color: #9f7a2e; }
.relevance-low { background: #e8e2da; color: var(--muted); }
.card-summary { font-size: 0.92rem; line-height: 1.8; margin-bottom: 12px; }
.clinical-box {
  background: #fdf0e2;
  border-left: 3px solid var(--accent);
  border-radius: 0 12px 12px 0;
  padding: 12px 16px;
  margin-bottom: 12px;
  font-size: 0.88rem;
  line-height: 1.7;
}
.clinical-box strong { color: var(--accent); }
.pico-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}
.pico-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 0.84rem;
}
.pico-label {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.72rem;
}
.pico-text { color: var(--muted); line-height: 1.5; }
.card-footer { text-align: right; }
.card-link {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.88rem;
  font-weight: 500;
  transition: color 0.2s;
}
.card-link:hover { text-decoration: underline; }
.topic-dist-box {
  background: var(--surface);
  border-radius: 20px;
  padding: 24px 28px;
  box-shadow: 0 8px 30px rgba(61,36,15,0.04);
}
.topic-bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.topic-bar-label {
  width: 100px;
  font-size: 0.82rem;
  color: var(--text);
  text-align: right;
  flex-shrink: 0;
}
.topic-bar-track {
  flex: 1;
  height: 18px;
  background: #ede4d6;
  border-radius: 9px;
  overflow: hidden;
}
.topic-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), #c47a4a);
  border-radius: 9px;
  transition: width 0.6s ease;
}
.topic-bar-count {
  width: 28px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--accent);
}
.keyword-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}
.keyword-badge {
  padding: 4px 14px;
  border-radius: 999px;
  background: #ede4d6;
  color: var(--text);
  font-size: 0.78rem;
  font-weight: 400;
}
.paper-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0 10px;
}
.paper-row {
  background: var(--surface);
  border-radius: 14px;
}
.paper-row td {
  padding: 14px 16px;
  font-size: 0.88rem;
  vertical-align: top;
}
.paper-row td:first-child { border-radius: 14px 0 0 14px; }
.paper-row td:last-child { border-radius: 0 14px 14px 0; }
.paper-link {
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
  line-height: 1.4;
  display: block;
}
.paper-link:hover { text-decoration: underline; }
.paper-meta-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
  font-size: 0.78rem;
  color: var(--muted);
}
.mini-tag {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.7rem;
}
.paper-summary-cell { color: var(--muted); line-height: 1.6; max-width: 320px; }
.paper-rel-cell { text-align: center; width: 48px; }
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
.back-link {
  display: inline-block;
  margin-bottom: 24px;
  color: var(--accent);
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 500;
  animation: fadeDown 0.4s ease-out;
}
.back-link:hover { text-decoration: underline; }
@media (max-width: 640px) {
  .container { padding: 20px 14px 40px; }
  .pico-grid { grid-template-columns: 1fr; }
  .card { padding: 20px 18px; }
  .overview-box { padding: 20px; }
  .topic-bar-label { width: 70px; font-size: 0.75rem; }
  .page-header h1 { font-size: 1.3rem; }
}
</style>
</head>
<body>
<div class="container">
  <a href="index.html" class="back-link">← 回到日報列表</a>

  <header class="page-header">
    <h1>心盲症與心智盲區研究日報</h1>
    <p class="subtitle">Aphantasia &amp; Mind Blindness Daily Research Briefing</p>
    <span class="date-badge">${dateDisplay}</span>
  </header>

  <section class="section">
    <h2 class="section-title">今日研究概覽</h2>
    <div class="overview-box">
      <p>${overview}</p>
      ${
        highlights.length
          ? `<ul class="highlight-list">${highlightItems}</ul>`
          : ""
      }
      ${trend ? `<div class="trend-box"><strong>趨勢觀察：</strong>${trend}</div>` : ""}
    </div>
  </section>

  ${
    topPicks.length
      ? `<section class="section">
    <h2 class="section-title">精選文獻（Top Picks）</h2>
    ${pickCards}
  </section>`
      : ""
  }

  ${
    Object.keys(topicDist).length
      ? `<section class="section">
    <h2 class="section-title">主題分佈</h2>
    <div class="topic-dist-box">
      ${topicBars}
      ${
        keywords.length
          ? `<div class="keyword-cloud">${keywordBadges}</div>`
          : ""
      }
    </div>
  </section>`
      : ""
  }

  ${
    allPapers.length
      ? `<section class="section">
    <h2 class="section-title">所有文獻</h2>
    <table class="paper-table">
      <tbody>${paperRows}</tbody>
    </table>
  </section>`
      : ""
  }

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
}

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      input: { type: "string", default: "papers.json" },
      output: { type: "string", required: true },
      date: { type: "string", default: "" },
      "api-key": { type: "string", default: "" },
    },
    strict: false,
  });
  return {
    input: values.input,
    output: values.output,
    date: values.date,
    apiKey: values["api-key"],
  };
}

async function main() {
  const args = parseCliArgs();
  const apiKey = args.apiKey || process.env.ZHIPU_API_KEY || "";
  if (!apiKey) {
    console.error("[FATAL] ZHIPU_API_KEY is required");
    process.exit(1);
  }

  const dateStr =
    args.date || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });

  let papersData;
  try {
    papersData = JSON.parse(readFileSync(args.input, "utf-8"));
  } catch {
    console.error(`[WARN] Cannot read ${args.input}, generating empty report`);
    papersData = { date: dateStr, count: 0, papers: [] };
  }

  const papers = papersData.papers || [];
  console.error(`[INFO] Processing ${papers.length} papers for ${dateStr}`);

  let report;
  if (papers.length === 0) {
    report = generateEmptyReport(dateStr);
  } else {
    report = await analyzeWithFallback(apiKey, papers);
    if (!report) {
      console.error("[WARN] All AI models failed, generating basic report");
      report = generateEmptyReport(dateStr);
      report.summary.overview = `今日收集到 ${papers.length} 篇相關文獻，但 AI 分析暫時不可用。以下是原始文獻列表。`;
      report.all_papers = papers.map((p, i) => ({
        pmid: p.pmid || "",
        title_zh: "",
        title_en: p.title || "",
        journal: p.journal || "",
        date: p.date || "",
        url: p.url || "",
        relevance: "medium",
        category: [],
        summary: p.abstract ? p.abstract.slice(0, 100) + "..." : "",
      }));
    }
  }

  const html = generateHtml(report, dateStr);
  writeFileSync(args.output, html, "utf-8");
  console.error(`[OK] Report saved to ${args.output}`);
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});
