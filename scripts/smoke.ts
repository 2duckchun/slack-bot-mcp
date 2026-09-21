/**
 * End-to-end check of the built server: spawns `dist/index.js`, speaks MCP over
 * stdio, and exercises the tools that need no workspace plus one that does.
 *
 *   npm run build && npm run smoke              # offline checks, auth expected to fail
 *   SLACK_BOT_TOKEN=xoxb-… npm run smoke        # also confirms the token works
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hasRealToken = (process.env['SLACK_BOT_TOKEN'] ?? '').startsWith('xoxb-') && process.env['SLACK_BOT_TOKEN'] !== 'xoxb-smoke-test';

const firstLine = (result: { content: unknown }): string => ((result.content as Array<{ text?: string }>)[0]?.text ?? '').split('\n')[0] ?? '';

async function main(): Promise<void> {
    const transport = new StdioClientTransport({
        command: 'node',
        args: [join(root, 'dist', 'index.js')],
        env: { ...process.env, SLACK_BOT_TOKEN: process.env['SLACK_BOT_TOKEN'] ?? 'xoxb-smoke-test', SLACK_MCP_TOOLSETS: 'all' } as Record<string, string>
    });

    const client = new Client({ name: 'smoke', version: '1.0.0' });
    await client.connect(transport);

    const { tools } = await client.listTools();
    console.log(`tools/list           ${tools.length} tools`);
    console.log(`                     ${tools.slice(0, 5).map((tool) => tool.name).join(', ')}, …`);

    const described = await client.callTool({ name: 'slack_describe_api_method', arguments: { method: 'slackLists.items.update' } });
    console.log(`describe_api_method  ${firstLine(described)}`);

    const listed = await client.callTool({ name: 'slack_list_api_methods', arguments: { query: 'stream' } });
    console.log(`list_api_methods     ${firstLine(listed)}`);

    const auth = await client.callTool({ name: 'slack_auth_test', arguments: {} });
    console.log(`auth_test            ${auth.isError ? `refused — ${firstLine(auth).slice(0, 100)}` : firstLine(auth)}`);

    if (hasRealToken) {
        const channels = await client.callTool({ name: 'slack_list_channels', arguments: { max_items: 5 } });
        console.log(`list_channels        ${channels.isError ? `refused — ${firstLine(channels).slice(0, 100)}` : firstLine(channels)}`);
    } else {
        console.log('list_channels        skipped (set SLACK_BOT_TOKEN to a real xoxb- token to exercise it)');
    }

    await client.close();
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
