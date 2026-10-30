#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { expandQuery, makeSnippet, responseText, safeOfficialUrl, scoreText } from "./search.js";
import type { Language, SearchItem } from "./search.js";

type CacheEntry = { time: number; value: unknown };
type RepositoryConfig = {
  courseRepositories: string[];
  discussionRepositories: string[];
  officialHosts: string[];
  sitemapUrls: string[];
  officialSeeds: Array<{ title: string; url: string; text: string; date?: string }>;
};
type GitTree = { tree?: Array<{ type: string; path: string; size?: number }> };
type GitHubIssue = {
  title: string;
  html_url: string;
  body: string | null;
  updated_at?: string;
  pull_request?: unknown;
};
type DiscussionResponse = {
  errors?: Array<{ message: string }>;
  data?: {
    repository?: {
      discussions?: {
        nodes?: Array<{
          title: string;
          body: string | null;
          url: string;
          updatedAt: string;
          category?: { name: string };
          comments?: { nodes?: Array<{ body: string | null }> };
        }>;
      } | null;
    } | null;
  };
};

const config = JSON.parse(
  readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"),
) as RepositoryConfig;
const API_ROOT = "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN;
const COURSE_REPOS = process.env.EKKE_COURSE_REPOS?.split(",").map((value) => value.trim()).filter(Boolean)
  ?? config.courseRepositories;
const DISCUSSION_REPOS = process.env.EKKE_DISCUSSION_REPOS?.split(",").map((value) => value.trim()).filter(Boolean)
  ?? config.discussionRepositories;
const CACHE_TTL = 15 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

async function fetchResponse<T>(url: string, options: RequestInit = {}): Promise<T> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.value as T;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "ekke-mcp/0.1.0",
        ...(options.headers ?? {}),
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const contentType = response.headers.get("content-type") ?? "";
    const value: unknown = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    cache.set(url, { time: Date.now(), value });
    return value as T;
  } finally {
    clearTimeout(timeout);
  }
}

function githubHeaders(json = false): HeadersInit {
  return {
    Accept: json ? "application/vnd.github+json" : "application/vnd.github.raw+json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fetchCourseFiles(repository: string): Promise<SearchItem[]> {
  const [owner, name] = repository.split("/");
  if (!owner || !name) return [];
  const tree = await fetchResponse<GitTree>(
    `${API_ROOT}/repos/${owner}/${name}/git/trees/main?recursive=1`,
    { headers: githubHeaders(true) },
  );
  const candidates = (tree.tree ?? [])
    .filter((item) => item.type === "blob" && (item.size ?? 0) <= 150_000 && /\.(md|mdx|txt|rst|html?)$/i.test(item.path))
    .sort((a, b) => {
      const priority = (path: string) => /readme|course|kurzus|syllabus|tematika|anyag|lecture|week|lab|feladat/i.test(path) ? 1 : 0;
      return priority(b.path) - priority(a.path) || a.path.localeCompare(b.path);
    })
    .slice(0, 12);
  const files = await Promise.all(candidates.map(async (item): Promise<SearchItem | null> => {
    try {
      const path = item.path.split("/").map(encodeURIComponent).join("/");
      const text = await fetchResponse<string>(`https://raw.githubusercontent.com/${owner}/${name}/main/${path}`);
      return {
        title: item.path,
        url: `https://github.com/${owner}/${name}/blob/main/${path}`,
        text,
        source: repository,
        kind: "course material",
      };
    } catch {
      return null;
    }
  }));
  return files.filter((item): item is SearchItem => item !== null);
}

async function fetchCourseIssues(repository: string): Promise<SearchItem[]> {
  const [owner, name] = repository.split("/");
  if (!owner || !name) return [];
  const issues = await fetchResponse<GitHubIssue[]>(
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

async function fetchDiscussions(repository: string): Promise<SearchItem[]> {
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
  const result = await fetchResponse<DiscussionResponse>(`${API_ROOT}/graphql?repo=${repository}`, {
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
    date: item.updatedAt.slice(0, 10),
    kind: "discussion",
  }));
}

async function searchCourses(query: string, limit: number, language: Language): Promise<string> {
  const terms = expandQuery(query);
  const notes: string[] = [];
  const perRepo = await Promise.all(COURSE_REPOS.map(async (repository) => {
    try {
      return await Promise.all([fetchCourseFiles(repository), fetchCourseIssues(repository)]);
    } catch (error) {
      notes.push(`${repository}: ${error instanceof Error ? error.message : String(error)}`);
      return [[], []] as SearchItem[][];
    }
  }));
  const discussions = await Promise.all(DISCUSSION_REPOS.map(async (repository) => {
    try {
      return await fetchDiscussions(repository);
    } catch (error) {
      if (TOKEN) notes.push(`${repository} discussions: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }));
  if (!TOKEN) {
    notes.push("A Discussionök kereséséhez állíts be read-only hozzáférésű GITHUB_TOKEN-t (public_repo scope vagy fine-grained read hozzáférés). / Set a read-only GITHUB_TOKEN to search Discussions.");
  }
  const items = [...perRepo.flat(2), ...discussions.flat()];
  const results = items.map((item) => ({ ...item, score: scoreText(terms, item.title, item.text) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, limit);
  return responseText(results, language, notes.slice(0, 8));
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function parsePage(url: string, html: string): { title: string; text: string } {
  const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? new URL(url).pathname)
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const text = decodeHtml(html
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
  return { title, text };
}

function extractLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => decodeHtml(match[1].trim()));
}

async function discoverOfficialUrls(): Promise<string[]> {
  const urls = new Set(config.officialSeeds.map((item) => item.url));
  const sitemapResults = await Promise.all(config.sitemapUrls.map(async (url) => {
    try {
      return await fetchResponse<string>(url);
    } catch {
      return "";
    }
  }));
  const nestedSitemaps = sitemapResults.flatMap((xml) =>
    /<sitemapindex\b/i.test(xml) ? extractLocations(xml).filter((url) => safeOfficialUrl(url, config.officialHosts)).slice(0, 5) : []);
  const nestedResults = await Promise.all(nestedSitemaps.map(async (url) => {
    try {
      return await fetchResponse<string>(url);
    } catch {
      return "";
    }
  }));
  for (const xml of [...sitemapResults, ...nestedResults]) {
    for (const url of extractLocations(xml)) {
      if (safeOfficialUrl(url, config.officialHosts) && !/\.(pdf|zip|jpg|jpeg|png|gif|docx?|xlsx?)($|\?)/i.test(url)) urls.add(url);
    }
  }
  return [...urls];
}

async function searchOfficial(query: string, limit: number, language: Language): Promise<string> {
  const terms = expandQuery(query);
  const urls = await discoverOfficialUrls();
  const rankedUrls = urls.map((url) => {
    const seed = config.officialSeeds.find((item) => item.url === url);
    return { url, seed, pathScore: scoreText(terms, seed?.title ?? "", url) };
  }).sort((a, b) => b.pathScore - a.pathScore);
  const pages = await Promise.all(rankedUrls.slice(0, 24).map(async ({ url, seed }): Promise<SearchItem | null> => {
    if (seed && url === seed.url && /\/api\/media\/file\//.test(url)) {
      return { title: seed.title, url, text: seed.text, date: seed.date, source: new URL(url).hostname };
    }
    try {
      const html = await fetchResponse<string>(url);
      const page = parsePage(url, html);
      return { ...page, url, source: new URL(url).hostname };
    } catch {
      return null;
    }
  }));
  const results = pages.filter((item): item is SearchItem => item !== null)
    .map((item) => ({ ...item, snippet: makeSnippet(terms, item.text), score: scoreText(terms, item.title, item.text) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
  return responseText(results, language);
}

const server = new McpServer({ name: "ekke-university-assistant", version: "0.2.0" });
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
    return { content: [{ type: "text", text: await searchCourses(query, limit, language) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: `Course search failed: ${error instanceof Error ? error.message : String(error)}` }] };
  }
});

server.registerTool("search_official_ekke", {
  description: "Search public pages from official Eszterházy Károly Catholic University websites. Queries may be Hungarian or English and are expanded with bilingual academic terms. Results include official source links and page text excerpts.",
  inputSchema: z.object({
    query: z.string().trim().min(2).max(300).describe("Search phrase in Hungarian or English / Keresőkifejezés magyarul vagy angolul"),
    language: languageSchema.describe("Response labels only; results are always searched in both languages"),
    limit: z.number().int().min(1).max(20).default(8),
  }),
}, async ({ query, language, limit }) => {
  try {
    return { content: [{ type: "text", text: await searchOfficial(query, limit, language) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: `Official EKKE search failed: ${error instanceof Error ? error.message : String(error)}` }] };
  }
});

void serveStdio(() => server);
console.error("EKKE university assistant MCP server started (stdio)");
