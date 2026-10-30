# EKKE University Assistant MCP

A read-only Model Context Protocol server for finding answers in EKKE course repositories, GitHub Discussions, and official university pages. It returns source links and dates where available. No model or backend is included: the MCP client supplies the model.

Magyarul és angolul is lehet keresni. The search expands common Hungarian and English academic terms in both directions (for example, `vizsgaidőszak` ↔ `exam period`, `tárgybővítés` ↔ `course add`). Results stay in the language they were published in, so the MCP client can answer in the user's language while citing the original source.

## Tools

- `search_course_content(query, language?, limit?)` searches Markdown/text course materials, public issues, and GitHub Discussions from the configured repositories.
- `search_official_ekke(query, language?, limit?)` searches indexed pages from official EKKE domains and includes curated links for the academic calendar, course descriptions, the Study Office, and scholarships.

The `language` option (`auto`, `hu`, `en`, `both`) controls response labels; it never restricts search to one language. Query expansion is rule-based and deliberately small, not machine translation.

## Requirements

- Node.js 20+
- A GitHub token with read-only access to the public EKKE repositories. GitHub's Discussions GraphQL API requires authentication. For a classic token, GitHub documents `public_repo` scope for public repositories; a fine-grained token can be limited to the required repositories and read-only permissions.
- Network access to GitHub and the official EKKE domains.

Without `GITHUB_TOKEN`, course files and issues can still be searched (subject to GitHub's unauthenticated API rate limit), but Discussions are skipped. The official-site search does not require a token.

## Run locally

```sh
npm install
```

Set `GITHUB_TOKEN` in the environment running the MCP client. For PowerShell:

```powershell
$env:GITHUB_TOKEN = "YOUR_READ_ONLY_TOKEN"
npm start
```

For VS Code, add an MCP server entry to `.vscode/mcp.json` (replace the path and provide the token outside the repository):

```json
{
  "servers": {
    "ekke-university-assistant": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/path/to/ekke-edu/mcp/src/index.js"],
      "env": {
        "GITHUB_TOKEN": "${input:ekkeGitHubToken}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "ekkeGitHubToken",
      "description": "Read-only GitHub token for public EKKE Discussions",
      "password": true
    }
  ]
}
```

## Configuration

- `EKKE_COURSE_REPOS`: comma-separated public repositories containing course materials. Defaults to the four EKKE-EDU course repositories.
- `EKKE_DISCUSSION_REPOS`: repositories whose Discussions should be searched. Defaults to the course repositories plus `ekke-edu/.github` for organization-wide discussions.
- Search results are cached in memory for 15 minutes. Official-site discovery uses sitemaps when available and only fetches HTTPS pages hosted under `*.uni-eszterhazy.hu`.

No credentials, student records, or Neptun data are accessed. This first version is read-only and has no hosted chat or model API key.
