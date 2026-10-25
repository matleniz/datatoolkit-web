# Agent bridge, panel and packs

How Studio talks to the engine's agent: the UI bridge, the chat panel,
the agent packs and the opt-in agent chat in Docker. Back to the
[README](../README.md).

## Agent bridge (dev)

Studio publishes its view (workspace, role, version, identity, selection, open
windows, editor) to the engine's `/api/ui` and runs the commands it relays
(`propose_steps`, `open_window`, `select_columns`, `set_view`), all through the
reducer (undoable). Agent step edits apply at once with an "Undo" notice;
destructive ones (a removed step, `drop_columns`, `filter_rows`,
`drop_low_variance`, `drop_correlated`) wait for Apply / Dismiss: Studio acks
them `pending: "review"` at once (the agent's call returns, the final ack is in
`GET /api/ui/commands/{id}` once the user decides), view commands keep running
while the banner is open, and another `propose_steps` answers `busy`. The page gets
the engine's per-run token from `<meta name="dtk-ui-token">` (never stored).
`dtk-studio` fills it in; with `npm run dev`, pass the same token to both sides:

```bash
export DTK_UI_TOKEN=$(openssl rand -hex 24)          # any random string
DTK_CORS_ORIGINS=http://localhost:5173 uv run --extra api dtk-api --port 8765
npm run dev                                           # same env: Vite injects the meta
```

Without `DTK_UI_TOKEN` the page has no meta and the bridge stays off, silently.
`npm run e2e` generates a token per run.

## Agent panel

The rail's last icon (**Agent**) opens a chat panel next to the tool rail
(datatoolkit-issues#67). It talks to the engine's agent pack over the same
bridge: `event: agent` on `/api/ui/events` (`user_message`, `assistant_delta`,
`tool_call`, `tool_result`, `permission_request`, `usage`, `done`, `error`),
and `GET /api/ui/agent`, `POST /api/ui/agent/send|cancel|permission`. Each tool
call shows as a chip; a click opens the window or highlights the step it
touched. Step edits apply at once with the bridge's Undo toast; destructive
ones wait in the review banner: the chip says "waiting for your review in
Studio", then follows the command status (`applied after your review` /
`dismissed in Studio`), and the UI context lists the open reviews (`reviews:
[{command, summary}]`) so the agent can see what awaits the user. The footer shows the session's cumulative
tokens and a Stop button while a turn runs. With no pack the panel says why.

The engine picks the pack from `DTK_AGENT_PACK`; see
[Agent packs](#agent-packs). In dev: `DTK_AGENT_PACK=agent-sdk uv run --extra
api --extra agent-sdk dtk-api` (or `dtk-api --agent`) next to `npm run dev`;
all-in-one: `dtk-studio --agent`. `npm run e2e` runs the engine with the
scripted `stub` pack.

### Agent packs

One variable, `DTK_AGENT_PACK`, for every way of running (names from the
engine's `chat_packs.py`, the `dtk-api --agent` help and `docker/entrypoint.sh`):

| Pack | Dev (`dtk-api`) | `dtk-studio --agent` | Docker (`DTK_AGENT=1`) |
|---|---|---|---|
| `agent-sdk` | yes: `DTK_AGENT_PACK=agent-sdk` or `dtk-api --agent`; needs engine extra `agent-sdk` | yes, the default of `--agent` (sets `DTK_AGENT_PACK`) | no: the entrypoint refuses it |
| `api-anthropic` | yes (`ANTHROPIC_API_KEY`) | `--agent api-anthropic` | yes, the default when `DTK_AGENT_PACK` is unset |
| `api-openai` | yes (`DTK_OPENAI_*`) | `--agent api-openai` | yes |
| `stub` | yes (scripted; used by `npm run e2e`) | `--agent stub` | yes (the `smoke` job) |
| unset / `off` | agent off | agent off (no `--agent`) | agent off: `DTK_AGENT` is the switch, `DTK_AGENT_PACK` alone is ignored |

## Agent chat in Docker (opt-in)

Off by default. Set `DTK_AGENT` and a `DTK_UI_TOKEN` in the shell (or in the
`.env` next to the compose file) to turn on the in-Studio agent chat
(datatoolkit-issues#148):

```bash
DTK_AGENT=1 DTK_UI_TOKEN=$(openssl rand -hex 16) ANTHROPIC_API_KEY=sk-... docker compose up -d
```

`compose.yml` passes these through to the containers only when they are set:

| Env | Goes to | Role |
|---|---|---|
| `DTK_AGENT` | engine | `1` / `true` / `yes` / `on` turns the chat on |
| `DTK_UI_TOKEN` | engine, web | Bridge token, required when `DTK_AGENT` is on (the engine exits 64 without it). The web container writes it into `index.html` as `<meta name="dtk-ui-token">` at start (`docker/40-dtk-ui-token.sh`), never at build; unset = no meta, bridge off. URL-safe characters only |
| `DTK_AGENT_PACK` | engine | Default pack: `api-anthropic` (default), `api-openai` or `stub` (table: [Agent packs](#agent-packs)) |
| `ANTHROPIC_API_KEY`, `DTK_ANTHROPIC_BASE_URL`, `DTK_ANTHROPIC_MODEL` | engine | `api-anthropic` |
| `DTK_OPENAI_BASE_URL`, `DTK_OPENAI_API_KEY`, `DTK_OPENAI_MODEL` | engine | `api-openai`. A model on the host is `http://host.docker.internal:11434/v1` (on Linux add `extra_hosts: ["host.docker.internal:host-gateway"]` to `engine` in an override file) |
| `DTK_UI_ALLOWED_HOSTS`, `DTK_CORS_ORIGINS` | engine | Not needed behind this nginx (same origin, `Host` forwarded); only when Studio is reached under another hostname or through TLS in front |

The token is in the served page, so the port stays bound to `127.0.0.1`:
loopback is the trust boundary, do not publish it on another interface. nginx
streams `/api/ui/events` (SSE) unbuffered, masks `token=` in its access log,
and does not proxy `/mcp` nor the agent terminal (`/api/ui/terminal`, no agent
CLI in the engine image). The engine also keeps the token in
`datatoolkit-data/agent/runtime.json` (0600). The `smoke` job in
`.github/workflows/docker.yml` checks both modes (agent off, and on with the
`stub` pack).
