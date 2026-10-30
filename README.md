# EKKE University Assistant MCP

A read-only Model Context Protocol server for finding answers in EKKE course repositories, GitHub Discussions, and official university pages. It returns source links and dates where available. No model or backend is included: the MCP client supplies the model.

Magyarul és angolul is lehet keresni. The search expands common Hungarian and English academic terms in both directions (for example, `vizsgaidőszak` ↔ `exam period`, `tárgybővítés` ↔ `course add`). Results stay in the language they were published in, so the MCP client can answer in the user's language while citing the original source.

## Tools

- `search_course_content(query, language?, limit?)` searches Markdown/text course materials, public issues, and GitHub Discussions from the configured repositories.
- `search_official_ekke(query, language?, limit?)` searches indexed pages from official EKKE domains and includes curated links for the academic calendar, course descriptions, the Study Office, and scholarships.

The `language` option (`auto`, `hu`, `en`, `both`) controls response labels; it never restricts search to one language. Query expansion is rule-based and deliberately small, not machine translation.

## npm package

The package is named `ekke-mcp`. After release, it can be installed with:

```sh
npx ekke-mcp
```

For local development and packing:

```sh
pnpm install
pnpm build
pnpm test
pnpm pack
```

## Versioning and releases

Use the repository script to bump the patch version and create a conventional commit plus an annotated `vX.Y.Z` Git tag:

```sh
pnpm release:patch
git push origin main --follow-tags
```

This runs `pnpm version patch --message "chore: release v%s"`. The working tree must be clean. Note that `pnpm patch` by itself patches a dependency; `pnpm version patch` is the version bump.

Pushing the tag starts the release workflow. It reruns the build and tests, packs the npm package, then creates a GitHub Release with generated release notes and the `.tgz` attached. It does not publish to npm automatically; npm publishing remains a separate release action until trusted publishing is configured.

## Requirements

- Node.js 22+ and pnpm 11.25.0 for development
- A GitHub token with read-only access to the public EKKE repositories. GitHub's Discussions GraphQL API requires authentication. For a classic token, GitHub documents `public_repo` scope for public repositories; a fine-grained token can be limited to the required repositories and read-only permissions.
- Network access to GitHub and the official EKKE domains.

Without `GITHUB_TOKEN`, course files and issues can still be searched (subject to GitHub's unauthenticated API rate limit), but Discussions are skipped. The official-site search does not require a token.

## Run locally

Set `GITHUB_TOKEN` in the environment running the MCP client. For PowerShell:

```powershell
$env:GITHUB_TOKEN = "YOUR_READ_ONLY_TOKEN"
pnpm dev
```

After building, run `pnpm start`. A host can also launch the npm binary as a stdio MCP server and pass `GITHUB_TOKEN` in its environment:

```json
{
  "mcpServers": {
    "ekke-university-assistant": {
      "command": "npx",
      "args": ["-y", "ekke-mcp"],
      "env": {
        "GITHUB_TOKEN": "${input:ekkeGitHubToken}"
      }
    }
  }
}
```

Do not commit a real token. See `.env.example` for the supported environment variables.

## Configuration

Non-secret defaults are stored in `config/sources.json`. You can edit repository lists, official host allowlists, sitemaps, and curated links there. Environment variables override repository lists:

- `EKKE_COURSE_REPOS`: comma-separated public repositories containing course materials.
- `EKKE_DISCUSSION_REPOS`: comma-separated repositories whose Discussions should be searched.

Search results are cached in memory for 15 minutes. Official-site discovery uses sitemaps when available and only fetches HTTPS pages hosted under configured EKKE domains.

No student records or Neptun credentials are accessed. This first version is read-only and has no hosted chat or model API key.
