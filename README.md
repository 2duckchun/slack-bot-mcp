# slack-bot-mcp

An MCP server that gives an AI agent a Slack bot's full Web API surface — **298 catalogued methods**, including the ones most Slack integrations never reach: AI message streaming, canvases, lists, and the assistant thread APIs.

Requires Node.js 20+ and a Slack app with a bot token.

It works in two layers:

- **64 dedicated tools** for the surface a bot actually uses day to day. Typed arguments, `#channel`/`@user`/email resolution, compact responses, and error messages that say what to do next.
- **A discovery trio** — `slack_list_api_methods`, `slack_describe_api_method`, `slack_call_api` — that reaches every remaining method, plus anything Slack ships tomorrow.

## Why not the official Slack MCP server?

Slack hosts one at `mcp.slack.com` (GA February 2026), and it is the right choice for letting a person's AI client search and read their workspace. It authenticates as a **user** over OAuth and exposes a focused read/search toolset.

This server is the other case: acting **as a bot**, with a bot token, across the whole API — posting, editing, uploading, streaming, managing channels, driving canvases and lists.

## How it stays current

Slack's published OpenAPI spec is stale — it lists 174 methods and is missing `chat.startStream`, every `canvases.*` and `slackLists.*` method, `assistant.*`, and the current file upload flow. So the method catalog is **generated from the `@slack/web-api` TypeScript declarations**, which do track the platform:

```bash
npm i @slack/web-api@latest   # SDK bump
npm run gen:catalog           # regenerates src/generated/catalog.json
```

That one step teaches the server every new method, its arguments, and its docs link. A short hand-maintained list (`src/slack/extra-methods.ts`) covers the handful Slack documents before the SDK types them, such as `assistant.search.context`. And `slack_call_api` will attempt a method it has never heard of rather than refuse it, so a brand-new endpoint works before either list catches up.

## Setup

### 1. Create the Slack app

Create an app at [api.slack.com/apps](https://api.slack.com/apps) → **From an app manifest**, and paste this. Trim the scopes you do not need — every scope is a permission someone has to justify.

```yaml
display_information:
  name: MCP Bot
features:
  bot_user:
    display_name: MCP Bot
oauth_config:
  scopes:
    bot:
      # messaging
      - chat:write
      - chat:write.public      # post to public channels without joining
      - chat:write.customize   # icon_emoji / username overrides
      # channels
      - channels:read
      - groups:read
      - im:read
      - mpim:read
      - channels:history
      - groups:history
      - im:history
      - mpim:history
      - channels:join
      - channels:manage
      - groups:write
      - im:write
      # people
      - users:read
      - users:read.email
      # reactions, pins, bookmarks
      - reactions:read
      - reactions:write
      - pins:read
      - pins:write
      - bookmarks:read
      - bookmarks:write
      # files
      - files:read
      - files:write
      # workspace
      - emoji:read
      - team:read
      - usergroups:read
      # optional toolsets
      - canvases:read
      - canvases:write
      - lists:read
      - lists:write
      - assistant:write
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
```

Install it, then copy the **Bot User OAuth Token** (`xoxb-…`).

`slack_search_messages` and `slack_search_files` additionally need a **user** token (`xoxp-…`) with `search:read` — Slack does not accept bot tokens for search at all.

### 2. Register with your MCP client

Nothing to install. The client runs it straight from this repository, and npm
builds it on first use.

**Claude Code**

```bash
claude mcp add slack \
  --env SLACK_BOT_TOKEN=xoxb-your-token \
  -- npx -y github:2duckchun/slack-mcp
```

**Claude Desktop** (`claude_desktop_config.json`) **or any `mcp.json`**

```json
{
  "mcpServers": {
    "slack": {
      "command": "npx",
      "args": ["-y", "github:2duckchun/slack-mcp"],
      "env": {
        "SLACK_BOT_TOKEN": "xoxb-your-token",
        "SLACK_MCP_ALLOWED_CHANNELS": "#bot-playground"
      }
    }
  }
}
```

Pin a tag or branch with `#`:

```bash
npx -y github:2duckchun/slack-mcp#v0.1.0 --help
```

> To point at a local clone instead, use `"command": "node"` and
> `"args": ["/absolute/path/to/slack-mcp/dist/index.js"]` after `npm install && npm run build`.

Check it works before wiring anything up:

```bash
npx -y github:2duckchun/slack-mcp --help
```

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `SLACK_BOT_TOKEN` | — | Bot token (`xoxb-…`). Required unless a user token is set. |
| `SLACK_USER_TOKEN` | — | User token (`xoxp-…`). Needed for `search.*`, `reminders.*`, `admin.*`, and other user-token-only methods. |
| `SLACK_MCP_TOOLSETS` | `core,messaging,conversations,users,reactions,files,workspace` | Comma-separated toolsets, or `all`. `core` is always included. |
| `SLACK_MCP_READ_ONLY` | `false` | Withholds every write tool and refuses write methods through `slack_call_api`. |
| `SLACK_MCP_ALLOWED_CHANNELS` | — | Confines writes to these channels (IDs or `#names`). |
| `SLACK_MCP_ENABLE_ADMIN` | `false` | Allows `admin.*`. Off by default — these are org-wide operations. |
| `SLACK_MCP_DENIED_METHODS` | `auth.revoke, apps.uninstall, tooling.tokens.rotate, oauth.*, openid.*, migration.exchange` | Method patterns to refuse. Setting this replaces the defaults. |
| `SLACK_MCP_ALLOWED_METHODS` | — | If set, only matching methods may be called. |
| `SLACK_MCP_MAX_RESPONSE_CHARS` | `40000` | Ceiling on the JSON rendered into a tool result. Overflow is cut with a visible notice. |
| `SLACK_MCP_TEAM_ID` | — | Team ID for org-wide installs. |
| `SLACK_API_URL` | Slack's | Override the API base URL (for testing). |

**A note on defaults.** Writes are enabled and unconfined out of the box, because a bot that cannot post is not a bot. If the agent driving this is experimental, start with `SLACK_MCP_ALLOWED_CHANNELS` pointed at a scratch channel, or `SLACK_MCP_READ_ONLY=true`.

## Toolsets

Enabled by default:

| Toolset | Tools |
| --- | --- |
| `core` | `slack_auth_test`, `slack_list_api_methods`, `slack_describe_api_method`, `slack_call_api` |
| `messaging` | `slack_send_message`, `slack_update_message`, `slack_delete_message`, `slack_send_ephemeral`, `slack_schedule_message`, `slack_list_scheduled_messages`, `slack_delete_scheduled_message`, `slack_get_permalink`, `slack_start_stream`, `slack_append_stream`, `slack_stop_stream` |
| `conversations` | `slack_list_channels`, `slack_get_channel_info`, `slack_get_channel_history`, `slack_get_thread`, `slack_list_channel_members`, `slack_join_channel`, `slack_leave_channel`, `slack_create_channel`, `slack_invite_to_channel`, `slack_set_channel_topic`, `slack_archive_channel`, `slack_open_dm` |
| `users` | `slack_list_users`, `slack_get_user_info`, `slack_lookup_user_by_email`, `slack_get_user_conversations` |
| `reactions` | `slack_add_reaction`, `slack_remove_reaction`, `slack_get_reactions`, `slack_pin_message`, `slack_unpin_message`, `slack_list_pins`, `slack_manage_bookmarks` |
| `files` | `slack_upload_file`, `slack_get_file_info`, `slack_list_files`, `slack_delete_file` |
| `workspace` | `slack_get_team_info`, `slack_list_emoji`, `slack_list_usergroups` |

Opt-in — add to `SLACK_MCP_TOOLSETS`:

| Toolset | Tools | Notes |
| --- | --- | --- |
| `search` | `slack_search_messages`, `slack_search_files` | Requires `SLACK_USER_TOKEN`. |
| `canvas` | `slack_create_canvas`, `slack_edit_canvas`, `slack_lookup_canvas_sections`, `slack_set_canvas_access`, `slack_delete_canvas` | Paid Slack plan. |
| `lists` | `slack_create_list`, `slack_list_list_items`, `slack_create_list_item`, `slack_update_list_item` | Paid Slack plan. |
| `assistant` | `slack_set_assistant_status`, `slack_set_assistant_title`, `slack_set_suggested_prompts` | Apps with the assistant feature. |
| `views` | `slack_validate_blocks`, `slack_publish_home_view`, `slack_open_modal`, `slack_push_modal`, `slack_update_modal` | Modals need a live `trigger_id`. |

They are opt-in only to keep the tool list short: every registered tool costs context in the host, on every turn.

## Reaching the rest of the API

Around 65 methods have a dedicated tool. The rest are one call away:

```
slack_list_api_methods    { query: "reminder" }
  → reminders.add, reminders.complete, reminders.delete, reminders.info, reminders.list

slack_describe_api_method { method: "reminders.add" }
  → arguments, types, which are required, which token Slack wants, docs link

slack_call_api            { method: "reminders.add", params: { text: "ship it", time: "tomorrow at 9am" } }
```

`slack_call_api` runs through the same gates as every other tool: read-only mode, the channel allowlist, the admin switch, and the deny list all still apply. It refuses a `token` in `params` — credentials come from the server's configuration, not from model output.

## Design notes

**Responses are projected, not forwarded.** A raw `users.list` page carries eight icon URLs per member; `conversations.history` repeats every block of every message. Each tool returns the fields a caller reasons about, in `structuredContent` and as readable JSON. The untouched response is always available through `slack_call_api`.

**Identifiers are resolved.** `#general`, `@sujin`, and `sujin@example.com` all work wherever an ID is accepted. Directory lookups are cached for ten minutes and only performed when a name that is not already known needs resolving.

**Errors say what to do.** `missing_scope` reports the needed and provided scopes and tells you to reinstall; `not_in_channel` points at `slack_join_channel`; `invalid_blocks` points at `slack_validate_blocks`; rate limits report their retry delay.

**Read/write classification fails closed.** An unrecognised method counts as a write, so read-only mode never leaks a mutation through a method the classifier has not seen.

## Development

```bash
npm install
npm run gen:catalog   # regenerate the API catalog from @slack/web-api
npm run check         # typecheck + 99 tests
npm run dev           # run from source over stdio (reads .env if present)
npm run build         # tsup -> dist/index.js
npm run smoke         # build first; drives dist/index.js over real stdio MCP
npm run inspect       # build first; opens the MCP Inspector against it
```

Tests mock Slack with `msw` and drive the server over MCP's in-memory transport, so the suite needs no token and touches no workspace. `npm run smoke` goes one level out — it spawns the built binary and speaks the protocol to it; give it a real `SLACK_BOT_TOKEN` and it will also list channels from your workspace.

**How `npx -y github:…` works here.** `tsup` bundles everything into a single
`dist/index.js` with a `#!/usr/bin/env node` banner, and `"prepare": "tsup"`
makes npm run that build whenever the package is installed from a git source.
The generated API catalog is a JSON import, so it is inlined into the bundle —
the published artifact has no data file to find at runtime. `dist/` is
therefore not committed; it is built on the consumer's machine.

To verify that path end to end:

```bash
npm pack                                   # runs prepare, produces the tarball
npm i -g ./slack-bot-mcp-0.1.0.tgz
slack-bot-mcp --version
```

## Known limits

- **stdio only.** `createServer()` in `src/server.ts` is transport-independent; adding a Streamable HTTP entry point alongside `src/index.ts` is the natural next step.
- **No event handling.** MCP is request/response; receiving Slack events needs Socket Mode in a separate process.
- **Single workspace.** Tokens come from the environment. Multi-workspace OAuth would need a token store, for which `src/slack/client.ts` is the seam.
- **Some methods need credentials this server does not hold** — app-level tokens (`apps.connections.open`), app configuration tokens (`apps.manifest.*`), client secrets (`oauth.*`). These are refused up front with an explanation rather than a confusing Slack error.
