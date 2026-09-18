#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { loadConfig } from './config.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';

/**
 * stdio entry point. Everything printed here goes to stderr: stdout carries
 * the JSON-RPC stream and a stray `console.log` corrupts the session.
 */
function main(): void {
    let config;
    try {
        config = loadConfig();
    } catch (error) {
        console.error(`[${SERVER_NAME}] ${error instanceof Error ? error.message : String(error)}`);
        console.error('');
        console.error('Minimum configuration:');
        console.error('  SLACK_BOT_TOKEN=xoxb-...   bot token from your Slack app');
        console.error('  SLACK_USER_TOKEN=xoxp-...  optional; needed for search.* and other user-token methods');
        console.error('');
        console.error('See README.md for the full list of settings.');
        process.exit(1);
    }

    const { server, summary } = createServer(config);

    serveStdio(() => server);

    console.error(`[${SERVER_NAME} ${SERVER_VERSION}] ${summary.registered.length} tools registered on stdio.`);
    console.error(`  toolsets: ${[...config.toolsets].join(', ')}`);
    if (config.readOnly) console.error(`  read-only mode: ${summary.skippedByReadOnly.length} write tools withheld`);
    if (summary.skippedByToolset.length > 0) console.error(`  ${summary.skippedByToolset.length} tools not registered (toolset disabled); set SLACK_MCP_TOOLSETS=all to enable everything`);
}

main();
