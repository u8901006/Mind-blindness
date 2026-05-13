import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PUBMED_SEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_FETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const CROSSREF_API = "https://api.crossref.org/works";

const SEARCH_QUERIES = [
  '(aphantasia[Title/Abstract] OR "visual imagery deficit"[Title/Abstract] OR "mental imagery deficit"[Title/Abstract] OR "absent visual imagery"[Title/Abstract] OR "mind\'s eye"[Title/Abstract])',
  '(aphantasia[Title/Abstract] OR "visual imagery"[Title/Abstract]) AND (fMRI[Title/Abstract] OR EEG[Title/Abstract] OR "visual cortex"[Title/Abstract] OR connectivity[Title/Abstract] OR pupillometry[Title/Abstract] OR "binocular rivalry"[Title/Abstract])',
  '(aphantasia[Title/Abstract] OR "visual imagery"[Title/Abstract]) AND ("autobiographical memory"[Title/Abstract] OR "episodic memory"[Title/Abstract] OR "face recognition"[Title/Abstract] OR prosopagnosia[Title/Abstract] OR dreaming[Title/Abstract])',
  '(aphantasia[Title/Abstract] OR "visual imagery"[Title/Abstract]) AND (PTSD[Title/Abstract] OR trauma[Title/Abstract] OR "intrusive imagery"[Title/Abstract] OR "imagery rescripting"[Title/Abstract] OR EMDR[Title/Abstract])',
  '(aphantasia[Title/Abstract] OR "visual imagery"[Title/Abstract]) AND (autism[Title/Abstract] OR autistic[Title/Abstract] OR "autistic traits"[Title/Abstract])',
  '("mind blindness"[Title/Abstract] OR mindblindness[Title/Abstract] OR "mind-blindness"[Title/Abstract]) AND (autism[Title/Abstract] OR "theory of mind"[Title/Abstract] OR mentalizing[Title/Abstract])',
  '(aphantasia[Title/Abstract] OR "visual imagery"[Title/Abstract]) AND ("lived experience"[Title/Abstract] OR qualitative[Title/Abstract] OR neurodiversity[Title/Abstract] OR education[Title/Abstract])',
  '(aphantasia[Title/Abstract] OR "visual imagery"[Title/Abstract]) AND (creativity[Title/Abstract] OR imagination[Title/Abstract] OR "mental rotation"[Title/Abstract] OR "spatial cognition"[Title/Abstract])',
];

function buildDateFilter(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const lookback = d.toISOString().slice(0, 10).replace(/-/g, "/");
  return `"${lookback}"[Date - Publication] : "3000"[Date - Publication]`;
}

function getExistingPmids(docsDir) {
  const pmids = new Set();
  try {
    const files = readdirSync(docsDir).filter((f) =>
      f.startsWith("mindblindness-") && f.endsWith(".html")
    );
    for (const f of files) {
      try {
        const html = readFileSync(join(docsDir, f), "utf-8");
        const matches = html.matchAll(/data-pmid="(\d+)"/g);
        for (const m of matches) {
          pmids.add(m[1]);
        }
      } catch {}
    }
  } catch {}
  return pmids;
}

async function searchPubMed(query, retmax = 50) {
  const url = new URL(PUBMED_SEARCH);
  url.searchParams.set("db", "pubmed");
  url.searchParams.set("term", query);
  url.searchParams.set("retmax", String(retmax));
  url.searchParams.set("sort", "date");
  url.searchParams.set("retmode", "json");
  try {
    const resp = await fetch(url.toString(), {
      headers: { "User-Agent": "MindBlindnessBot/1.0 (research)" },
      signal: AbortSignal.timeout(30000),
    });
    const data = await resp.json();
    return data?.esearchresult?.idlist || [];
  } catch (e) {
    console.error(`[WARN] PubMed search failed: ${e.message}`);
    return [];
  }
}

async function fetchDetails(pmids) {
  if (!pmids.length) return [];
  const url = new URL(PUBMED_FETCH);
  url.searchParams.set("db", "pubmed");
  url.searchParams.set("id", pmids.join(","));
  url.searchParams.set("retmode", "xml");
  try {
    const resp = await fetch(url.toString(), {
      headers: { "User-Agent": "MindBlindnessBot/1.0 (research)" },
      signal: AbortSignal.timeout(60000),
    });
    const xml = await resp.text();
    return parseXml(xml);
  } catch (e) {
    console.error(`[WARN] PubMed fetch failed: ${e.message}`);
    return [];
  }
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseXml(xml) {
  const papers = [];
  const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let match;
  while ((match = articleRegex.exec(xml)) !== null) {
    const block = match[1];
    const titleMatch = block.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
    let title = "";
    if (titleMatch) {
      title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
    }
    const abstractParts = [];
    const absRegex = /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g;
    let absMatch;
    while ((absMatch = absRegex.exec(block)) !== null) {
      const labelMatch = absMatch[0].match(/Label="([^"]+)"/);
      const label = labelMatch ? labelMatch[1] : "";
      const text = absMatch[1].replace(/<[^>]+>/g, "").trim();
      if (text) {
        abstractParts.push(label ? `${label}: ${text}` : text);
      }
    }
    const abstract = abstractParts.join(" ").slice(0, 2000);
    const journalMatch = block.match(/<Title>([\s\S]*?)<\/Title>/);
    const journal = journalMatch ? journalMatch[1].trim() : "";
    const yearMatch = block.match(/<Year>(\d{4})<\/Year>/);
    const monthMatch = block.match(/<Month>([^<]+)<\/Month>/);
    const dayMatch = block.match(/<Day>(\d+)<\/Day>/);
    const dateParts = [
      yearMatch?.[1],
      monthMatch?.[1],
      dayMatch?.[1],
    ].filter(Boolean);
    const dateStr = dateParts.join(" ");
    const pmidMatch = block.match(/<PMID[^>]*>(\d+)<\/PMID>/);
    const pmid = pmidMatch?.[1] || "";
    const keywords = [];
    const kwRegex = /<Keyword>([\s\S]*?)<\/Keyword>/g;
    let kwMatch;
    while ((kwMatch = kwRegex.exec(block)) !== null) {
      const kw = kwMatch[1].trim();
      if (kw) keywords.push(kw);
    }
    if (title) {
      papers.push({
        pmid,
        title,
        journal,
        date: dateStr,
        abstract,
        url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : "",
        keywords,
      });
    }
  }
  return papers;
}

async function fetchCrossrefPapers(days, maxPapers) {
  const keywords = [
    "aphantasia",
    "visual imagery deficit",
    "mind's eye mental imagery",
    "aphantasia hyperphantasia",
    "acquired aphantasia",
    "congenital aphantasia",
    "visual imagery vividness",
    "mental imagery spectrum",
  ];
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromDate = from.toISOString().slice(0, 10);
  const papers = [];
  for (const kw of keywords.slice(0, 4)) {
    try {
      const url = new URL(CROSSREF_API);
      url.searchParams.set("query", kw);
      url.searchParams.set("filter", `from-pub-date:${fromDate}`);
      url.searchParams.set("rows", String(Math.ceil(maxPapers / 4)));
      url.searchParams.set("sort", "published");
      url.searchParams.set("order", "desc");
      const resp = await fetch(url.toString(), {
        headers: { "User-Agent": "MindBlindnessBot/1.0 (mailto:research@example.com)" },
        signal: AbortSignal.timeout(30000),
      });
      const data = await resp.json();
      const items = data?.message?.items || [];
      for (const item of items) {
        const title = item.title?.[0] || "";
        const doi = item.DOI || "";
        const journal = item["container-title"]?.[0] || "";
        const dateParts = item.published?.["date-parts"]?.[0] || [];
        const dateStr = dateParts.join(" ");
        const abstract = (item.abstract || "").replace(/<[^>]+>/g, "").slice(0, 2000);
        if (title) {
          papers.push({
            pmid: "",
            doi,
            title,
            journal,
            date: dateStr,
            abstract,
            url: doi ? `https://doi.org/${doi}` : "",
            keywords: item.subject || [],
            source: "crossref",
          });
        }
      }
    } catch (e) {
      console.error(`[WARN] Crossref search for "${kw}" failed: ${e.message}`);
    }
  }
  return papers;
}

function dedupPapers(papers) {
  const seen = new Set();
  return papers.filter((p) => {
    const key = p.pmid || p.doi || p.title.toLowerCase().slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      days: { type: "string", default: "7" },
      "max-papers": { type: "string", default: "40" },
      output: { type: "string", default: "papers.json" },
      "docs-dir": { type: "string", default: "docs" },
    },
    strict: false,
  });
  return {
    days: parseInt(values.days, 10),
    maxPapers: parseInt(values["max-papers"], 10),
    output: values.output,
    docsDir: values["docs-dir"],
  };
}

async function main() {
  const args = parseCliArgs();
  const existingPmids = getExistingPmids(args.docsDir);
  console.error(`[INFO] Found ${existingPmids.size} existing PMIDs to skip`);

  const dateFilter = buildDateFilter(args.days);
  const allPmids = new Set();

  for (const query of SEARCH_QUERIES) {
    const fullQuery = `${query} AND ${dateFilter}`;
    const pmids = await searchPubMed(fullQuery, args.maxPapers);
    for (const id of pmids) {
      if (!existingPmids.has(id)) {
        allPmids.add(id);
      }
    }
  }

  console.error(`[INFO] Found ${allPmids.size} new PMIDs from PubMed`);

  const pmidArray = [...allPmids].slice(0, args.maxPapers);
  let pubmedPapers = await fetchDetails(pmidArray);
  console.error(`[INFO] Fetched details for ${pubmedPapers.length} PubMed papers`);

  const crossrefPapers = await fetchCrossrefPapers(args.days, args.maxPapers);
  console.error(`[INFO] Found ${crossrefPapers.length} Crossref papers`);

  let allPapers = dedupPapers([...pubmedPapers, ...crossrefPapers]).slice(
    0,
    args.maxPapers
  );

  const today = new Date();
  const tzOffset = 8 * 60;
  const localDate = new Date(today.getTime() + tzOffset * 60000);
  const dateStr = localDate.toISOString().slice(0, 10);

  const output = {
    date: dateStr,
    count: allPapers.length,
    papers: allPapers,
  };

  writeFileSync(args.output, JSON.stringify(output, null, 2), "utf-8");
  console.error(`[INFO] Saved ${allPapers.length} papers to ${args.output}`);
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});
