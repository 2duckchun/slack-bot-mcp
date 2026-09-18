import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runTool, SlackMock, structured } from './slack-mock.js';
import { testConfig } from './helpers.js';

const slack = new SlackMock();

beforeAll(() => slack.server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => slack.server.resetHandlers());
afterAll(() => slack.server.close());
beforeEach(() => slack.reset());

const CHANNEL_LIST = {
    ok: true,
    channels: [
        { id: 'C0GENERAL', name: 'general', is_private: false, is_member: true, num_members: 12, topic: { value: 'chatter' }, purpose: { value: '' } },
        { id: 'C0RANDOM', name: 'random', is_private: false, is_member: false, num_members: 3, topic: { value: '' }, purpose: { value: '' } }
    ],
    response_metadata: { next_cursor: '' }
};

describe('slack_send_message', () => {
    it('resolves a #name to an ID before posting', async () => {
        slack.on('conversations.list', CHANNEL_LIST).on('chat.postMessage', { ok: true, ts: '1700000000.000100', channel: 'C0GENERAL' });

        const result = await runTool('slack_send_message', { channel: '#general', text: 'hello' }, testConfig());

        expect(slack.lastCall('chat.postMessage')?.params).toMatchObject({ channel: 'C0GENERAL', text: 'hello' });
        expect(structured(result)).toMatchObject({ channel: 'C0GENERAL', ts: '1700000000.000100' });
        expect(result.content[0]?.text).toContain('1700000000.000100');
    });

    it('passes an ID straight through without a directory lookup', async () => {
        slack.on('chat.postMessage', { ok: true, ts: '1.1', channel: 'C0GENERAL' });

        await runTool('slack_send_message', { channel: 'C0GENERAL', text: 'hi' }, testConfig());

        expect(slack.callsTo('conversations.list')).toHaveLength(0);
    });

    it('refuses a message with no content', async () => {
        await expect(runTool('slack_send_message', { channel: 'C0GENERAL' }, testConfig())).rejects.toThrow(/needs message content/);
    });

    it('refuses markdown_text combined with blocks', async () => {
        await expect(runTool('slack_send_message', { channel: 'C0GENERAL', markdown_text: '# hi', blocks: [{ type: 'divider' }] }, testConfig())).rejects.toThrow(/cannot be combined/);
    });

    it('forwards thread and unfurl options', async () => {
        slack.on('chat.postMessage', { ok: true, ts: '2.0' });

        await runTool('slack_send_message', { channel: 'C0GENERAL', text: 'reply', thread_ts: '1.0', reply_broadcast: true, unfurl_links: false }, testConfig());

        expect(slack.lastCall('chat.postMessage')?.params).toMatchObject({ thread_ts: '1.0', reply_broadcast: true, unfurl_links: false });
    });
});

describe('error translation', () => {
    it('explains a missing scope and how to fix it', async () => {
        slack.on('chat.postMessage', { ok: false, error: 'missing_scope', needed: 'chat:write', provided: 'channels:read' });

        await expect(runTool('slack_send_message', { channel: 'C0GENERAL', text: 'hi' }, testConfig())).rejects.toThrow(/Needs scope\(s\): chat:write.*Token has: channels:read.*reinstall the app/s);
    });

    it('tells the model to join the channel first', async () => {
        slack.on('chat.postMessage', { ok: false, error: 'not_in_channel' });

        await expect(runTool('slack_send_message', { channel: 'C0GENERAL', text: 'hi' }, testConfig())).rejects.toThrow(/slack_join_channel/);
    });

    it('points at slack_validate_blocks when Block Kit is rejected', async () => {
        slack.on('chat.postMessage', { ok: false, error: 'invalid_blocks' });

        await expect(runTool('slack_send_message', { channel: 'C0GENERAL', blocks: [{ type: 'nonsense' }] }, testConfig())).rejects.toThrow(/slack_validate_blocks/);
    });
});

describe('pagination', () => {
    it('follows cursors and reports when the ceiling cut the list short', async () => {
        slack.on('conversations.list', (_params, index) =>
            index === 0
                ? { ok: true, channels: [{ id: 'C1', name: 'one' }, { id: 'C2', name: 'two' }], response_metadata: { next_cursor: 'page2' } }
                : { ok: true, channels: [{ id: 'C3', name: 'three' }], response_metadata: { next_cursor: 'page3' } }
        );

        const result = await runTool('slack_list_channels', { max_items: 3 }, testConfig());
        const data = structured(result);

        expect(data['channels']).toHaveLength(3);
        expect(data['next_cursor']).toBe('page3');
        expect(slack.callsTo('conversations.list')).toHaveLength(2);
        expect(slack.callsTo('conversations.list')[1]?.params['cursor']).toBe('page2');
    });

    it('stops when Slack runs out of pages', async () => {
        slack.on('conversations.list', CHANNEL_LIST);

        const data = structured(await runTool('slack_list_channels', { max_items: 100 }, testConfig()));

        expect(data['channels']).toHaveLength(2);
        expect(data['next_cursor']).toBeUndefined();
    });

    it('filters by name after fetching', async () => {
        slack.on('conversations.list', CHANNEL_LIST);

        const data = structured(await runTool('slack_list_channels', { name_contains: 'rand' }, testConfig()));

        expect(data['channels']).toHaveLength(1);
    });
});

describe('response shaping', () => {
    it('compacts messages and resolves author names it has seen', async () => {
        slack.on('users.list', {
            ok: true,
            members: [{ id: 'U0SUJIN', name: 'sujin', profile: { display_name: 'Sujin', real_name: 'Sujin Park' } }],
            response_metadata: { next_cursor: '' }
        }).on('conversations.history', {
            ok: true,
            messages: [
                {
                    ts: '1700000000.000100',
                    user: 'U0SUJIN',
                    text: 'ship it',
                    reply_count: 2,
                    reactions: [{ name: 'tada', count: 3, users: ['U1', 'U2', 'U3'] }],
                    blocks: [{ type: 'rich_text', elements: [] }],
                    // Noise the projection is expected to drop.
                    team: 'T1',
                    client_msg_id: 'abc',
                    edited: { user: 'U0SUJIN', ts: '1700000001.000000' }
                }
            ],
            response_metadata: { next_cursor: '' }
        });

        // Warm the directory so the message author can be named.
        await runTool('slack_list_users', {}, testConfig());
        const data = structured(await runTool('slack_get_channel_history', { channel: 'C0GENERAL', limit: 10 }, testConfig({ SLACK_API_URL: 'https://slack.test/api/' })));

        const [message] = data['messages'] as Array<Record<string, unknown>>;
        expect(message).toMatchObject({ ts: '1700000000.000100', text: 'ship it', reply_count: 2, has_blocks: true });
        expect(message?.['iso_time']).toBe('2023-11-14T22:13:20.000Z');
        expect(message?.['reactions']).toEqual([{ name: 'tada', count: 3 }]);
        expect(message).not.toHaveProperty('client_msg_id');
        expect(message).not.toHaveProperty('blocks');
    });

    it('truncates oversized payloads with a visible notice', async () => {
        const many = Array.from({ length: 400 }, (_, i) => ({ id: `C${i}`, name: `channel-${i}`, topic: { value: 'x'.repeat(200) }, purpose: { value: '' } }));
        slack.on('conversations.list', { ok: true, channels: many, response_metadata: { next_cursor: '' } });

        const result = await runTool('slack_list_channels', { max_items: 400 }, testConfig({ SLACK_MCP_MAX_RESPONSE_CHARS: '2000' }));

        expect(result.content[0]?.text).toContain('truncated');
        expect(result.content[0]?.text).toContain('SLACK_MCP_MAX_RESPONSE_CHARS=2000');
        // structuredContent stays whole; only the text rendering is cut.
        expect((structured(result)['channels'] as unknown[]).length).toBe(400);
    });
});

describe('safety gates', () => {
    it('refuses a write outside the channel allowlist', async () => {
        slack.on('conversations.info', { ok: true, channel: { id: 'C0GENERAL', name: 'general' } });

        const config = testConfig({ SLACK_MCP_ALLOWED_CHANNELS: '#bot-playground' });
        await expect(runTool('slack_send_message', { channel: 'C0GENERAL', text: 'hi' }, config)).rejects.toThrow(/SLACK_MCP_ALLOWED_CHANNELS/);
        expect(slack.callsTo('chat.postMessage')).toHaveLength(0);
    });

    it('allows a write to an allowlisted channel', async () => {
        slack.on('conversations.info', { ok: true, channel: { id: 'C0PLAY', name: 'bot-playground' } }).on('chat.postMessage', { ok: true, ts: '3.0' });

        const config = testConfig({ SLACK_MCP_ALLOWED_CHANNELS: '#bot-playground' });
        await runTool('slack_send_message', { channel: 'C0PLAY', text: 'hi' }, config);

        expect(slack.callsTo('chat.postMessage')).toHaveLength(1);
    });

    it('refuses a write through slack_call_api in read-only mode', async () => {
        const config = testConfig({ SLACK_MCP_READ_ONLY: 'true' });
        await expect(runTool('slack_call_api', { method: 'chat.postMessage', params: { channel: 'C1', text: 'x' } }, config)).rejects.toThrow(/read-only/);
    });

    it('still allows reads through slack_call_api in read-only mode', async () => {
        slack.on('emoji.list', { ok: true, emoji: { partyparrot: 'https://emoji.test/pp.gif' } });

        const config = testConfig({ SLACK_MCP_READ_ONLY: 'true' });
        const data = structured(await runTool('slack_call_api', { method: 'emoji.list', params: {} }, config));

        expect(data['method']).toBe('emoji.list');
        expect(data['emoji']).toMatchObject({ partyparrot: expect.any(String) });
    });

    it('will not let the model inject its own token', async () => {
        await expect(runTool('slack_call_api', { method: 'auth.test', params: { token: 'xoxb-someone-elses' } }, testConfig())).rejects.toThrow(/Remove "token"/);
    });

    it('requires a user token for search', async () => {
        await expect(runTool('slack_search_messages', { query: 'deploy' }, testConfig())).rejects.toThrow(/SLACK_USER_TOKEN/);
    });

    it('routes search to the user token when one is configured', async () => {
        slack.on('search.messages', { ok: true, messages: { total: 0, matches: [] } });

        const config = testConfig({ SLACK_USER_TOKEN: 'xoxp-test-token' });
        await runTool('slack_search_messages', { query: 'deploy' }, config);

        expect(slack.callsTo('search.messages')).toHaveLength(1);
    });
});

describe('slack_call_api', () => {
    it('attempts a method the local catalog has never heard of', async () => {
        slack.on('future.newThing', { ok: true, result: 'fine' });

        const data = structured(await runTool('slack_call_api', { method: 'future.newThing', params: {} }, testConfig()));

        expect(data).toMatchObject({ method: 'future.newThing', result: 'fine' });
    });

    it('turns Slack\'s unknown_method into a suggestion', async () => {
        await expect(runTool('slack_call_api', { method: 'chat.postMesage', params: {} }, testConfig())).rejects.toThrow(/chat\.postMessage/);
    });

    it('rejects auto_paginate on a method that does not page', async () => {
        await expect(runTool('slack_call_api', { method: 'chat.postMessage', params: {}, auto_paginate: true, items_key: 'x' }, testConfig())).rejects.toThrow(/not cursor-paginated/);
    });
});

describe('slack_describe_api_method', () => {
    it('reports arguments and the either/or groups', async () => {
        const data = structured(await runTool('slack_describe_api_method', { method: 'chat.postMessage' }, testConfig()));

        expect(data['requires_one_of']).toEqual([['attachments'], ['blocks'], ['markdown_text'], ['text']]);
        expect(data['token']).toBe('bot');
        expect(data['writes']).toBe(true);
    });

    it('is honest when it has no argument detail', async () => {
        const data = structured(await runTool('slack_describe_api_method', { method: 'assistant.search.context' }, testConfig()));

        expect(data['arguments_note']).toMatch(/do not describe its arguments/);
        expect(data['docs']).toContain('assistant.search.context');
    });
});
