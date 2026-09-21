import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { assertChannelAllowed, assertMethodAllowed, isReadMethod } from '../src/slack/policy.js';
import { unsupportedReason } from '../src/slack/unsupported.js';
import { testConfig } from './helpers.js';

describe('isReadMethod', () => {
    it.each(['conversations.list', 'conversations.history', 'conversations.replies', 'users.info', 'users.conversations', 'chat.getPermalink', 'auth.test', 'emoji.list', 'team.profile.get', 'dnd.teamInfo', 'blocks.validate', 'slackLists.download.get'])(
        'treats %s as a read',
        (method) => {
            expect(isReadMethod(method)).toBe(true);
        }
    );

    it.each(['chat.postMessage', 'chat.delete', 'conversations.create', 'conversations.join', 'conversations.mark', 'reactions.add', 'files.delete', 'canvases.edit', 'views.publish', 'chat.unfurl', 'slackLists.download.start'])(
        'treats %s as a write',
        (method) => {
            expect(isReadMethod(method)).toBe(false);
        }
    );

    it('fails closed on a method it has never seen', () => {
        expect(isReadMethod('future.frobnicate')).toBe(false);
    });

    it('classifies getUploadURLExternal as a write despite the "get" prefix', () => {
        // It reserves an upload slot, and read-only mode should not hand one out.
        expect(isReadMethod('files.getUploadURLExternal')).toBe(false);
    });
});

describe('assertMethodAllowed', () => {
    it('blocks the built-in dangerous defaults', () => {
        expect(() => assertMethodAllowed('auth.revoke', testConfig())).toThrow(/SLACK_MCP_DENIED_METHODS/);
        expect(() => assertMethodAllowed('apps.uninstall', testConfig())).toThrow(/SLACK_MCP_DENIED_METHODS/);
    });

    it('supports wildcard deny patterns', () => {
        const config = testConfig({ SLACK_MCP_DENIED_METHODS: 'conversations.*' });
        expect(() => assertMethodAllowed('conversations.archive', config)).toThrow(/blocked/);
        expect(() => assertMethodAllowed('chat.postMessage', config)).not.toThrow();
    });

    it('enforces an allowlist when one is set', () => {
        const config = testConfig({ SLACK_MCP_ALLOWED_METHODS: 'chat.*,conversations.list' });
        expect(() => assertMethodAllowed('chat.postMessage', config)).not.toThrow();
        expect(() => assertMethodAllowed('conversations.list', config)).not.toThrow();
        expect(() => assertMethodAllowed('users.list', config)).toThrow(/SLACK_MCP_ALLOWED_METHODS/);
    });

    it('refuses writes in read-only mode but permits reads', () => {
        const config = testConfig({ SLACK_MCP_READ_ONLY: 'true' });
        expect(() => assertMethodAllowed('chat.postMessage', config)).toThrow(/read-only/);
        expect(() => assertMethodAllowed('conversations.history', config)).not.toThrow();
    });
});

describe('assertChannelAllowed', () => {
    it('is a no-op without an allowlist', () => {
        expect(() => assertChannelAllowed(testConfig(), 'C123', 'random')).not.toThrow();
    });

    it('matches on channel ID', () => {
        const config = testConfig({ SLACK_MCP_ALLOWED_CHANNELS: 'C0BOTPLAY' });
        expect(() => assertChannelAllowed(config, 'C0BOTPLAY', 'bot-playground')).not.toThrow();
        expect(() => assertChannelAllowed(config, 'C0GENERAL', 'general')).toThrow(/not permitted/);
    });

    it('matches on name, with or without the leading hash', () => {
        const config = testConfig({ SLACK_MCP_ALLOWED_CHANNELS: '#bot-playground' });
        expect(() => assertChannelAllowed(config, 'C0BOTPLAY', 'bot-playground')).not.toThrow();

        const bare = testConfig({ SLACK_MCP_ALLOWED_CHANNELS: 'bot-playground' });
        expect(() => assertChannelAllowed(bare, 'C0BOTPLAY', 'bot-playground')).not.toThrow();
    });

    it('refuses when only an unknown ID is available', () => {
        const config = testConfig({ SLACK_MCP_ALLOWED_CHANNELS: '#bot-playground' });
        expect(() => assertChannelAllowed(config, 'C0GENERAL')).toThrow(/not permitted/);
    });
});

describe('unsupported methods', () => {
    it('refuses whole user-token-only families', () => {
        expect(unsupportedReason('search.messages')).toMatch(/user-token/);
        expect(unsupportedReason('admin.users.list')).toMatch(/user-token/);
        expect(unsupportedReason('reminders.add')).toMatch(/user-token/);
    });

    it('refuses the user-token-only methods inside otherwise reachable families', () => {
        expect(unsupportedReason('users.setPhoto')).toMatch(/user-token/);
        expect(unsupportedReason('chat.meMessage')).toMatch(/user-token/);
    });

    it('names the credential it cannot supply', () => {
        expect(unsupportedReason('apps.connections.open')).toMatch(/app-level token/);
        expect(unsupportedReason('oauth.v2.access')).toMatch(/client credentials/);
    });

    it('leaves everything a bot token can reach alone', () => {
        expect(unsupportedReason('chat.postMessage')).toBeUndefined();
        expect(unsupportedReason('conversations.list')).toBeUndefined();
        expect(unsupportedReason('users.info')).toBeUndefined();
    });
});

describe('config', () => {
    it('requires a bot token', () => {
        expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/SLACK_BOT_TOKEN/);
    });

    it('rejects a user token standing in for one', () => {
        expect(() => loadConfig({ SLACK_USER_TOKEN: 'xoxp-x' } as NodeJS.ProcessEnv)).toThrow(/SLACK_BOT_TOKEN/);
    });

    it('defaults to the core toolsets and always keeps core', () => {
        expect(testConfig().toolsets.has('messaging')).toBe(true);
        expect(testConfig().toolsets.has('canvas')).toBe(false);

        const narrowed = testConfig({ SLACK_MCP_TOOLSETS: 'canvas' });
        expect(narrowed.toolsets.has('canvas')).toBe(true);
        expect(narrowed.toolsets.has('core')).toBe(true);
        expect(narrowed.toolsets.has('messaging')).toBe(false);
    });

    it('supports "all"', () => {
        expect(testConfig({ SLACK_MCP_TOOLSETS: 'all' }).toolsets.size).toBeGreaterThan(10);
    });

    it('rejects an unknown toolset by name', () => {
        expect(() => testConfig({ SLACK_MCP_TOOLSETS: 'messaging,nope' })).toThrow(/nope/);
    });
});
