# EKKE chat MVP

A local bilingual chat interface that connects Groq to the existing read-only EKKE MCP search tools. The chat searches course repositories and GitHub Discussions, and official EKKE pages. Conversations are held in the browser memory and are not stored by this app.

## Requirements

- Node.js 22+
- pnpm
- A Groq API key from [Groq Console](https://console.groq.com/keys)
- Optional: a GitHub token with read access to public repositories, for GitHub Discussions

## Run locally

From this directory:

```sh
pnpm install
cp .env.example .env
```

Put your Groq key in `.env`. On Windows, copy the template with `Copy-Item .env.example .env`. The app binds to `127.0.0.1` by default, so it is only reachable on your computer.

Start the chat:

```sh
pnpm dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The backend launches `npx --yes ekke-mcp` when the model searches. You can set `GITHUB_TOKEN` in `.env` to enable Discussion search; course and official-page search work without it.

The model is configurable with `GROQ_MODEL`. The default is `openai/gpt-oss-20b`. Groq rate limits depend on your account and the selected model.

## Security and scope

- Keep `.env` private. Never commit API keys.
- The browser never receives the Groq API key.
- This MVP has no user accounts, saved conversation history, or public hosting configuration.
- The backend has a small in-memory request limit intended for local experimentation, not production deployment.
- Answers should be checked against the linked official source for important matters.
