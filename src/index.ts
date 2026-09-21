import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { type Config, DEFAULT_TOOLSETS, loadConfig, TOOLSETS } from './config.js';
import { createServer, SERVER_NAME } from './server.js';
import { SERVER_VERSION } from './version.js';

// stdout carries the JSON-RPC stream. Every log line must go to stderr.
const log = (message: string): void => {
    process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
};

const HELP = `${SERVER_NAME} v${SERVER_VERSION}
A Slack bot's full Web API surface as a stdio MCP server.

Usage
  npx -y github:2duckchun/slack-mcp

  With no arguments it speaks MCP over stdin/stdout. This is not a command you
  run yourself — an MCP client spawns it as a child process.

Options
  -h, --help      Show this help.
  -v, --version   Show the version.

Required environment
  SLACK_BOT_TOKEN        Bot token (xoxb-...) from your Slack app. The only
                         credential this server accepts — methods Slack allows
                         a user token for are refused with an explanation.
                         Create one at https://api.slack.com/apps — the README
                         has an app manifest with the scopes each toolset needs.

Optional environment
  SLACK_MCP_TOOLSETS             Default: ${DEFAULT_TOOLSETS.join(',')}
                                 Any of: ${TOOLSETS.join(', ')}, or "all".
  SLACK_MCP_READ_ONLY            Withhold every write tool. Default false.
  SLACK_MCP_ALLOWED_CHANNELS     Confine writes to these channels (IDs or #names).
  SLACK_MCP_DENIED_METHODS       Method patterns to refuse, e.g. "chat.delete,files.*".
  SLACK_MCP_ALLOWED_METHODS      If set, only matching methods may be called.
  SLACK_MCP_MAX_RESPONSE_CHARS   Cap on JSON rendered per result. Default 40000.
  SLACK_MCP_TEAM_ID              Team ID, for org-wide installs.

Register with Claude Code
  claude mcp add slack \\
    --env SLACK_BOT_TOKEN=xoxb-... \\
    -- npx -y github:2duckchun/slack-mcp

Docs: https://github.com/2duckchun/slack-mcp
`;

/** Without configuration there is nothing to serve. Say why, on stderr, and stop. */
function loadConfigOrExit(): Config {
    try {
        return loadConfig();
    } catch (error) {
        log(error instanceof Error ? error.message : String(error));
        log('Run `npx -y github:2duckchun/slack-mcp --help` for the full list of settings.');
        process.exit(1);
    }
}

function main(): void {
    const argv = process.argv.slice(2);

    // --help/--version are the paths a person takes at a terminal. They finish
    // without opening an MCP session, so writing to stdout is safe here.
    if (argv.includes('--help') || argv.includes('-h')) {
        process.stdout.write(HELP);
        return;
    }
    if (argv.includes('--version') || argv.includes('-v')) {
        process.stdout.write(`${SERVER_VERSION}\n`);
        return;
    }

    const config = loadConfigOrExit();
    const { server, summary } = createServer(config);

    const handle = serveStdio(() => server, {
        onerror: (error) => log(`transport error: ${error.message}`)
    });

    const shutdown = (signal: NodeJS.Signals): void => {
        log(`${signal} received, shutting down.`);
        void handle.close().finally(() => process.exit(0));
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    log(`v${SERVER_VERSION} ready — ${summary.registered.length} tools on stdio (toolsets: ${[...config.toolsets].join(', ')})`);
    if (config.readOnly) log(`read-only mode: ${summary.skippedByReadOnly.length} write tools withheld`);
    if (summary.skippedByToolset.length > 0) log(`${summary.skippedByToolset.length} tools not registered — set SLACK_MCP_TOOLSETS=all to enable every toolset`);
}

main();
