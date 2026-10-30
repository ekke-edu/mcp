import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../.env") });
const publicDir = resolve(here, "../public");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4173);
const model = process.env.GROQ_MODEL ?? "openai/gpt-oss-20b";
const maxBodyBytes = 24_000;
const requestTimes = new Map<string, number[]>();
const tools = [
  {
    type: "function",
    function: {
      name: "search_course_content",
      description: "Search EKKE course repositories, public issues and GitHub Discussions. Supports Hungarian and English queries.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search phrase in Hungarian or English" },
          language: { type: "string", enum: ["auto", "hu", "en", "both"], description: "Language of response labels" },
          limit: { type: "integer", minimum: 1, maximum: 8 }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_official_ekke",
      description: "Search official EKKE university pages for academic calendar, course registration, student administration, scholarships and other university information.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search phrase in Hungarian or English" },
          language: { type: "string", enum: ["auto", "hu", "en", "both"], description: "Language of response labels" },
          limit: { type: "integer", minimum: 1, maximum: 8 }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  }
] as const;

type ChatMessage = { role: "user" | "assistant"; content: string };
type GroqMessage = { role: string; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> };

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new Error("Request is too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (requestTimes.get(ip) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 12) return true;
  recent.push(now);
  requestTimes.set(ip, recent);
  return false;
}

async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const transport = new StdioClientTransport({
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["--yes", "ekke-mcp"],
    env: { ...process.env, ...(process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}) }
  });
  const client = new Client({ name: "ekke-chat", version: "0.1.0" }, { capabilities: {} });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args });
    return result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n")
      .slice(0, 18_000) || "No matching information was found.";
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function askGroq(history: ChatMessage[]): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is missing. Copy chat/.env.example to chat/.env and add your key.");
  let messages: GroqMessage[] = [
    {
      role: "system",
      content: "You are the EKKE University Assistant. Answer in the language of the latest user message (Hungarian or English). For current EKKE facts, search the relevant MCP tool before answering. Never invent dates, requirements, people, or links. Cite sources as Markdown links using URLs returned by tools. If sources do not answer the question, say so clearly and suggest the official Study Office. Do not claim to access private student records. Keep answers clear and concise."
    },
    ...history.slice(-10).map(({ role, content }) => ({ role, content }))
  ];
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools, tool_choice: "auto", temperature: 0.2 })
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error("The Groq free-tier limit was reached. Please wait a little and try again.");
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Groq returned HTTP ${response.status}: ${detail}`);
    }
    const data = await response.json() as { choices?: Array<{ message?: GroqMessage }> };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("Groq returned an empty response.");
    messages = [...messages, message];
    if (!message.tool_calls?.length) return message.content ?? "I could not generate an answer.";
    for (const call of message.tool_calls) {
      let content: string;
      try {
        if (call.function.name !== "search_course_content" && call.function.name !== "search_official_ekke") {
          throw new Error("Unknown search tool.");
        }
        const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
        if (typeof args.query !== "string" || args.query.length > 300) throw new Error("Invalid search query.");
        content = await callMcpTool(call.function.name, args);
      } catch (error) {
        content = `Search failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      messages.push({ role: "tool", content, tool_calls: undefined });
      (messages[messages.length - 1] as GroqMessage & { tool_call_id?: string; name?: string }).tool_call_id = call.id;
      (messages[messages.length - 1] as GroqMessage & { name?: string }).name = call.function.name;
    }
  }
  return "I could not complete the search in time. Please try a more specific question.";
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "POST" && url.pathname === "/api/chat") {
    const ip = request.socket.remoteAddress ?? "local";
    if (limited(ip)) return json(response, 429, { error: "Too many requests. Please wait a minute and try again." });
    try {
      const body = await readJson(request) as { messages?: unknown };
      if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 20) {
        return json(response, 400, { error: "Send between 1 and 20 chat messages." });
      }
      const history: ChatMessage[] = body.messages.map((message) => {
        if (typeof message !== "object" || message === null) throw new Error("Invalid message.");
        const item = message as Record<string, unknown>;
        if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string" || item.content.length > 4_000) {
          throw new Error("Invalid message.");
        }
        return { role: item.role, content: item.content };
      });
      if (history.at(-1)?.role !== "user") return json(response, 400, { error: "The last message must be from the user." });
      return json(response, 200, { answer: await askGroq(history) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected server error.";
      return json(response, message === "Invalid message." ? 400 : 500, { error: message });
    }
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405).end();
    return;
  }
  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const file = resolve(publicDir, requested);
  if (file !== publicDir && !file.startsWith(publicDir + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const content = await readFile(file);
    const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
    response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(port, host, () => console.log(`EKKE chat listening at http://${host}:${port}`));
