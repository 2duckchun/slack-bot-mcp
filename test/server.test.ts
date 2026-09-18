import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import type { Config } from '../src/config.js';
import { createServer } from '../src/server.js';
import { testConfig } from './helpers.js';

/** Boots the real server over an in-memory transport and returns a connected client. */
async function connect(config: Config) {
    const { server, summary } = createServer(config);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    return { client, summary, close: async () => { await client.close(); await server.close(); } };
}

describe('MCP surface', () => {
    it('advertises the default toolsets over the protocol', async () => {
        const { client, close } = await connect(testConfig());
        const { tools } = await client.listTools();
        const names = tools.map((tool) => tool.name);

        expect(names).toContain('slack_auth_test');
        expect(names).toContain('slack_send_message');
        expect(names).toContain('slack_list_channels');
        expect(names).toContain('slack_upload_file');
        // Opt-in toolsets stay out of the default listing.
        expect(names).not.toContain('slack_create_canvas');
        expect(names).not.toContain('slack_search_messages');

        await close();
    });

    it('registers every tool when all toolsets are enabled', async () => {
        const { client, close } = await connect(testConfig({ SLACK_MCP_TOOLSETS: 'all' }));
        const { tools } = await client.listTools();

        expect(tools.length).toBeGreaterThanOrEqual(45);
        expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['slack_create_canvas', 'slack_search_messages', 'slack_create_list', 'slack_set_assistant_status', 'slack_publish_home_view']));

        await close();
    });

    it('names every tool with the slack_ prefix and gives each a description', async () => {
        const { client, close } = await connect(testConfig({ SLACK_MCP_TOOLSETS: 'all' }));
        const { tools } = await client.listTools();

        for (const tool of tools) {
            expect(tool.name).toMatch(/^slack_[a-z0-9_]+$/);
            expect(tool.description ?? '').not.toBe('');
            expect(tool.inputSchema).toBeDefined();
        }

        await close();
    });

    it('marks read-only tools with readOnlyHint and destructive ones with destructiveHint', async () => {
        const { client, close } = await connect(testConfig({ SLACK_MCP_TOOLSETS: 'all' }));
        const { tools } = await client.listTools();
        const byName = new Map(tools.map((tool) => [tool.name, tool]));

        expect(byName.get('slack_list_channels')?.annotations?.readOnlyHint).toBe(true);
        expect(byName.get('slack_get_thread')?.annotations?.readOnlyHint).toBe(true);
        expect(byName.get('slack_send_message')?.annotations?.readOnlyHint).toBe(false);
        expect(byName.get('slack_delete_message')?.annotations?.destructiveHint).toBe(true);
        expect(byName.get('slack_archive_channel')?.annotations?.destructiveHint).toBe(true);

        await close();
    });

    it('withholds write tools in read-only mode but keeps the escape hatch', async () => {
        const { client, summary, close } = await connect(testConfig({ SLACK_MCP_TOOLSETS: 'all', SLACK_MCP_READ_ONLY: 'true' }));
        const names = (await client.listTools()).tools.map((tool) => tool.name);

        expect(names).not.toContain('slack_send_message');
        expect(names).not.toContain('slack_delete_message');
        expect(names).not.toContain('slack_upload_file');
        expect(names).toContain('slack_list_channels');
        // slack_call_api survives because it re-checks the gate per method;
        // withholding it would take every read-only API method with it.
        expect(names).toContain('slack_call_api');
        expect(summary.skippedByReadOnly.length).toBeGreaterThan(10);

        await close();
    });

    it('answers a real tool call end to end', async () => {
        const { client, close } = await connect(testConfig());
        const result = await client.callTool({ name: 'slack_describe_api_method', arguments: { method: 'canvases.edit' } });

        const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
        expect(text).toContain('canvases.edit');
        expect(text).toContain('canvas_id');
        expect(result.isError).toBeFalsy();

        await close();
    });

    it('reports a bad argument as a tool error rather than a crash', async () => {
        const { client, close } = await connect(testConfig());
        const result = await client.callTool({ name: 'slack_describe_api_method', arguments: { method: 'chat.nonsense' } });

        expect(result.isError).toBe(true);
        expect((result.content as Array<{ text?: string }>)[0]?.text).toMatch(/Unknown Slack API method/);

        await close();
    });

    it('groups tools so a narrowed toolset only pays for what it uses', async () => {
        const { client, summary, close } = await connect(testConfig({ SLACK_MCP_TOOLSETS: 'canvas' }));
        const names = (await client.listTools()).tools.map((tool) => tool.name);

        expect(names).toContain('slack_create_canvas');
        expect(names).toContain('slack_call_api');
        expect(names).not.toContain('slack_send_message');
        expect(summary.skippedByToolset).toContain('slack_send_message');
        expect(names.length).toBeLessThan(12);

        await close();
    });
});
