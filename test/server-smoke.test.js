import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("starts over stdio and advertises both search tools", async () => {
  const client = new Client({ name: "ekke-mcp-smoke-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: { ...process.env, GITHUB_TOKEN: "" },
  });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      ["search_course_content", "search_official_ekke"],
    );
    for (const tool of tools) {
      assert.ok(tool.inputSchema.properties.query);
      assert.ok(tool.inputSchema.properties.language);
    }
  } finally {
    await client.close();
  }
});