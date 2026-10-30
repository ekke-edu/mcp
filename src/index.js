import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const API_ROOT = "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN;
const COURSE_REPOS = (process.env.EKKE_COURSE_REPOS ??
  "ekke-edu/advanced-databases-2,ekke-edu/complex-ai-applications,ekke-edu/modern-databases,ekke-edu/cloud-computing")
  .split(",").map((value) => value.trim()).filter(Boolean);
const DISCUSSION_REPOS = (process.env.EKKE_DISCUSSION_REPOS ??
  [...COURSE_REPOS, "ekke-edu/.github"].join(","))
  .split(",").map((value) => value.trim()).filter(Boolean);
const CACHE_TTL = 15 * 60 * 1000;
const cache = new Map();

const termGroups = [
  ["tanulmányi időszak", "tanév rendje", "academic calendar", "academic year", "semester dates"],
  ["szorgalmi időszak", "oktatási időszak", "teaching period", "instruction period"],
  ["vizsgaidőszak", "vizsga", "exam period", "examination period", "exam"],
  ["tárgybővítés", "tárgyfelvétel", "kurzusfelvétel", "course add", "course registration", "course enrollment"],
  ["ösztöndíj", "ösztöndíjak", "scholarship", "scholarships", "grant"],
  ["tanulmányi osztály", "tanulmányi ügyek", "study office", "student administration", "student affairs"],
  ["határidő", "határidők", "deadline", "deadlines", "due date"],
  ["kurzus", "tantárgy", "tárgy", "course", "subject", "class"],
  ["szakdolgozat", "diplomamunka", "thesis", "dissertation"],
  ["adatbázisrendszerek", "adatbázis", "database systems", "database management systems"],
  ["komplex ai alkalmazások", "complex ai applications", "advanced ai applications"],
];

const officialHosts = [
  "uni-eszterhazy.hu",
  "oktatas.uni-eszterhazy.hu",
  "io.uni-eszterhazy.hu",
  "neptunh.uni-eszterhazy.hu",
];
const officialSeeds = [
  {
    title: "Tanév rendje 2026/27 / Academic calendar 2026/27",
    url: "https://uni-eszterhazy.hu/api/media/file/545b870eb827db566a71d372fe5cdae0a22d5e1e",
    text: "Tanév rendje, tanulmányi időszak, szorgalmi időszak, vizsgaidőszak, szünetek, academic calendar, academic year, teaching period, exam period 2026/27",
    date: "2026/27",
  },
  {
    title: "Tantárgyleírások / Course descriptions",
    url: "https://io.uni-eszterhazy.hu/szolgaltatasok_tantargyleirasok.html",
    text: "Tantárgyleírások, kurzusok, tantárgyak, course descriptions, courses, subjects",
  },
  {
    title: "Tanulmányi és Oktatásszervezési Osztály (TO) / Study Office",
    url: "https://oktatas.uni-eszterhazy.hu/hu/okt_ig/szervezet/tanulmanyi-es-oktatasszervezesi-osztaly-to-eg",
    text: "Tanulmányi osztály, tanulmányi ügyek, ügyintézés, hallgatói ügyek, study office, student administration, student affairs",
  },
  {
    title: "Ösztöndíjak / Scholarships",
    url: "https://neptunh.uni-eszterhazy.hu/osztondij/",
    text: "Ösztöndíjak, ösztöndíj, támogatások, határidők, scholarships, grants, deadlines",
  },
];
const sitemapUrls = officialHosts.flatMap((host) => [
  `https://${host}/sitemap.xml`,
  `https://${host}/sitemap_index.xml`,
]);

function normalize(value) {
  return value.toLocaleLowerCase("hu")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function expandQuery(query) {
  const normalized = normalize(query);
  const expanded = new Set([query]);
  for (const group of termGroups) {
    const normalizedGroup = group.map(normalize);
    if (normalizedGroup.some((term) => term && normalized.includes(term))) {
      for (const term of group) expanded.add(term);
    }
  }
  return [...expanded].map(normalize).filter(Boolean);
}

function scoreText(queryTerms, title, text) {
  const titleText = normalize(title);
  const bodyText = normalize(text);
  const allText = `${titleText} ${bodyText}`;
  let score = 0;
  for (const term of queryTerms) {
    if (allText.includes(term)) score += titleText.includes(term) ? 5 : 2;
  }
  return score;
}

function makeSnippet(queryTerms, text, maxLength = 360) {
  const plain = String(text ?? "").replace(/\s+/g, " ").trim();
  const normalized = normalize(plain);
  let index = -1;
  for (const term of queryTerms) {
    const found = normalized.indexOf(term);
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  if (index < 0 || plain.length <= maxLength) return plain.slice(0, maxLength);
  const start = Math.max(0, index - 100);
  const end = Math.min(plain.length, start + maxLength);
  return `${start ? "…" : ""}${plain.slice(start, end)}${end < plain.length ? "…" : ""}`;
}

function escapeMarkdown(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function responseText(results, language, notes = []) {
  const en = language === "en";
  const both = language === "both";
  const lines = [];
  lines.push(en ? "Search results (source text is kept in its original language):" :
    both ? "Találatok / Search results (az eredeti forrásszöveg nyelvén / in the source language):" :
      "Találatok (az eredeti forrásszöveg nyelvén):");
  if (results.length === 0) {
    lines.push(en ? "No matching source was found. Try a shorter phrase or a Hungarian/English synonym." :
      both ? "Nincs találat. Próbálj rövidebb kifejezést vagy magyar/angol megfelelőjét. / No results. Try a shorter phrase or its Hungarian/English equivalent." :
        "Nincs találat. Próbálj rövidebb kifejezést vagy annak magyar/angol megfelelőjét.");
  }
  results.forEach((item, index) => {
    const source = item.source ? ` · ${escapeMarkdown(item.source)}` : "";
    const date = item.date ? ` · ${escapeMarkdown(item.date)}` : "";
    lines.push(`\n${index + 1}. **[${escapeMarkdown(item.title)}](${item.url})**${source}${date}`);
    if (item.snippet) lines.push(`   ${escapeMarkdown(item.snippet)}`);
  });
  if (notes.length) {
    lines.push(en ? "\nNotes:" : both ? "\nMegjegyzés / Notes:" : "\nMegjegyzés:");
    for (const note of notes) lines.push(`- ${note}`);
  }
  return lines.join("\n");
}

async function fetchResponse(url, options = {}) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.value;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "ekke-edu-mcp/0.1.0",
        ...(options.headers ?? {}),
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const contentType = response.headers.get("content-type") ?? "";
    const value = contentType.includes("application/json") ? await response.json() : await response.text();
    cache.set(url, { time: Date.now(), value });
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

function githubHeaders(json = false) {
  return {
    Accept: json ? "application/vnd.github+json" : "application/vnd.github.raw+json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fetchCourseFiles(repository) {
  const [owner, name] = repository.split("/");
  if (!owner || !name) return [];
  const tree = await fetchResponse(
    `${API_ROOT}/repos/${owner}/${name}/git/trees/main?recursive=1`,
    { headers: githubHeaders(true) },
  );
  const candidates = (tree.tree ?? [])
    .filter((item) => item.type === "blob" && item.size <= 150_000 && /\.(md|mdx|txt|rst|html?)$/i.test(item.path))
    .sort((a, b) => {
      const priority = (path) => /readme|course|kurzus|syllabus|tematika|anyag|lecture|week|lab|feladat/i.test(path) ? 1 : 0;
      return priority(b.path) - priority(a.path) || a.path.localeCompare(b.path);
    })
    .slice(0, 12);
  return Promise.all(candidates.map(async (item) => {
    try {
      const url = `https://raw.githubusercontent.com/${owner}/${name}/main/${item.path.split("/").map(encodeURIComponent).join("/")}`;
      const text = await fetchResponse(url);
      return {
        title: item.path,
        url: `https://github.com/${owner}/${name}/blob/main/${item.path.split("/").map(encodeURIComponent).join("/")}`,
        text: typeof text === "string" ? text : "",
        source: repository,
        kind: "course material",
      };
    } catch {
      return null;
    }
  })).then((items) => items.filter(Boolean));
}

async function fetchCourseIssues(repository) {
  const [owner, name] = repository.split("/");
  if (!owner || !name) return [];
  const issues = await fetchResponse(
    `${API_ROOT}/repos/${owner}/${name}/issues?state=all&per_page=100&sort=updated&direction=desc`,
    { headers: githubHeaders(true) },
  );
  return (Array.isArray(issues) ? issues : [])
    .filter((item) => !item.pull_request)
    .map((item) => ({
      title: item.title,
      url: item.html_url,
      text: item.body ?? "",
      source: repository,
      date: item.updated_at?.slice(0, 10),
      kind: "course issue",
    }));
}

async function fetchDiscussions(repository) {
  if (!TOKEN) throw new Error("GITHUB_TOKEN is not configured");
  const [owner, name] = repository.split("/");
  const query = `query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      discussions(first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          title body url updatedAt
          category { name }
          comments(first: 20) { nodes { body } }
        }
      }
    }
  }`;
  const result = await fetchResponse(`${API_ROOT}/graphql?repo=${repository}`, {
    method: "POST",
    headers: { ...githubHeaders(true), Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query, variables: { owner, name } }),
  });
  if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join("; "));
  return (result.data?.repository?.discussions?.nodes ?? []).map((item) => ({
    title: item.title,
    url: item.url,
    text: [item.body, ...(item.comments?.nodes ?? []).map((comment) => comment.body)].filter(Boolean).join("\n"),
    source: `${repository} · ${item.category?.name ?? "Discussion"}`,
    date: item.updatedAt?.slice(0, 10),
    kind: "discussion",
  }));
}

async function searchCourses(query, limit) {
  const terms = expandQuery(query);
  const notes = [];
  const perRepo = await Promise.all(COURSE_REPOS.map(async (repository) => {
    try {
      return await Promise.all([fetchCourseFiles(repository), fetchCourseIssues(repository)]);
    } catch (error) {
      notes.push(`${repository}: ${error.message}`);
      return [[], []];
    }
  }));
  const discussionResults = await Promise.all(DISCUSSION_REPOS.map(async (repository) => {
    try {
      return await fetchDiscussions(repository);
    } catch (error) {
      if (TOKEN) notes.push(`${repository} discussions: ${error.message}`);
      return [];
    }
  }));
  if (!TOKEN) {
    notes.push("A Discussionök kereséséhez állíts be read-only hozzáférésű GITHUB_TOKEN-t (public_repo scope vagy fine-grained read hozzáférés). / Set a read-only GITHUB_TOKEN to search Discussions.");
  }
  const items = [...perRepo.flat(2), ...discussionResults.flat()];
  const results = items.map((item) => ({
    ...item,
    score: scoreText(terms, item.title, item.text),
  })).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, limit);
  return responseText(results, "both", notes.slice(0, 8));
}

function safeOfficialUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && officialHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function parsePage(url, html) {
  const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? new URL(url).pathname)
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const text = decodeHtml(html
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
  return { title, text };
}

function extractLocations(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => decodeHtml(match[1].trim()));
}

async function discoverOfficialUrls() {
  const urls = new Set(officialSeeds.map((item) => item.url));
  const sitemapResults = await Promise.all(sitemapUrls.map(async (url) => {
    try {
      return await fetchResponse(url);
    } catch {
      return "";
    }
  }));
  const nestedSitemaps = sitemapResults.flatMap((xml) =>
    /<sitemapindex\b/i.test(xml) ? extractLocations(xml).filter(safeOfficialUrl).slice(0, 5) : []);
  const nestedResults = await Promise.all(nestedSitemaps.map(async (url) => {
    try {
      return await fetchResponse(url);
    } catch {
      return "";
    }
  }));
  for (const xml of [...sitemapResults, ...nestedResults]) {
    for (const url of extractLocations(xml)) {
      if (safeOfficialUrl(url) && !/\.(pdf|zip|jpg|jpeg|png|gif|docx?|xlsx?)($|\?)/i.test(url)) urls.add(url);
    }
  }
  return [...urls];
}

async function searchOfficial(query, limit) {
  const terms = expandQuery(query);
  const discovered = await discoverOfficialUrls();
  const rankedUrls = discovered.map((url) => {
    const seed = officialSeeds.find((item) => item.url === url);
    return { url, seed, pathScore: scoreText(terms, seed?.title ?? "", url) };
  }).sort((a, b) => b.pathScore - a.pathScore);
  const pages = await Promise.all(rankedUrls.slice(0, 24).map(async ({ url, seed }) => {
    if (seed && url === seed.url && /\/api\/media\/file\//.test(url)) {
      return { title: seed.title, url, text: seed.text, date: seed.date, source: new URL(url).hostname };
    }
    try {
      const html = await fetchResponse(url);
      if (typeof html !== "string") return null;
      const page = parsePage(url, html);
      return { ...page, url, source: new URL(url).hostname };
    } catch {
      return null;
    }
  }));
  const results = pages.filter(Boolean).map((item) => ({
    ...item,
    snippet: makeSnippet(terms, item.text),
    score: scoreText(terms, item.title, item.text),
  })).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return responseText(results, "both");
}

const server = new McpServer({
  name: "ekke-university-assistant",
  version: "0.1.0",
});

const languageSchema = z.enum(["auto", "hu", "en", "both"]).default("auto");
server.registerTool("search_course_content", {
  description: "Search public EKKE course repository files, issues, and GitHub Discussions. Queries may be written in Hungarian or English; bilingual equivalents are expanded automatically. Returns source links and update dates where available.",
  inputSchema: z.object({
    query: z.string().trim().min(2).max(300).describe("Search phrase in Hungarian or English / Keresőkifejezés magyarul vagy angolul"),
    language: languageSchema.describe("Response labels only; results are always searched in both languages"),
    limit: z.number().int().min(1).max(20).default(8),
  }),
}, async ({ query, language, limit }) => {
  try {
    return { content: [{ type: "text", text: await searchCourses(query, limit) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: `Course search failed: ${error.message}` }] };
  }
});

server.registerTool("search_official_ekke", {
  description: "Search public pages from the official Eszterházy Károly Catholic University websites. Queries may be Hungarian or English and are expanded with bilingual academic terms. Results include official source links and page text excerpts.",
  inputSchema: z.object({
    query: z.string().trim().min(2).max(300).describe("Search phrase in Hungarian or English / Keresőkifejezés magyarul vagy angolul"),
    language: languageSchema.describe("Response labels only; results are always searched in both languages"),
    limit: z.number().int().min(1).max(20).default(8),
  }),
}, async ({ query, language, limit }) => {
  try {
    return { content: [{ type: "text", text: await searchOfficial(query, limit) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: `Official EKKE search failed: ${error.message}` }] };
  }
});

void serveStdio(() => server);
console.error("EKKE university assistant MCP server started (stdio)");
