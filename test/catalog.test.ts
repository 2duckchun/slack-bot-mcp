import { describe, expect, it } from 'vitest';

import { getMethod, loadCatalog, searchMethods, suggestMethods } from '../src/slack/catalog.js';

describe('generated catalog', () => {
    it('covers the whole Web API surface', () => {
        const catalog = loadCatalog();
        expect(catalog.methodCount).toBeGreaterThan(280);
        expect(catalog.source.package).toBe('@slack/web-api');
    });

    /**
     * These are the methods Slack's published OpenAPI spec is missing. They are
     * the reason the catalog is generated from the SDK typings instead, so a
     * regression here means the server has quietly gone stale.
     */
    it.each([
        'chat.startStream',
        'chat.appendStream',
        'chat.stopStream',
        'canvases.create',
        'canvases.edit',
        'conversations.canvases.create',
        'slackLists.items.list',
        'slackLists.items.update',
        'assistant.threads.setStatus',
        'files.getUploadURLExternal',
        'files.completeUploadExternal',
        'bookmarks.add',
        'blocks.validate'
    ])('knows about %s', (method) => {
        expect(getMethod(method)).toBeDefined();
    });

    it('carries argument detail and a docs link', () => {
        const method = getMethod('chat.postMessage');
        expect(method?.docUrl).toBe('https://docs.slack.dev/reference/methods/chat.postMessage');
        expect(method?.args.find((arg) => arg.name === 'channel')?.required).toBe(true);
        expect(method?.args.find((arg) => arg.name === 'thread_ts')?.required).toBe(false);
        expect(method?.args.find((arg) => arg.name === 'text')?.description).toMatch(/text of the message/i);
    });

    it('reduces mutually exclusive shapes to the real either/or groups', () => {
        // chat.postMessage's type is a 16-way union; only four of those distinctions matter.
        expect(getMethod('chat.postMessage')?.requiredOneOf).toEqual([['attachments'], ['blocks'], ['markdown_text'], ['text']]);
    });

    it('marks cursor-paginated methods', () => {
        expect(getMethod('conversations.list')?.cursorPaginated).toBe(true);
        expect(getMethod('chat.postMessage')?.cursorPaginated).toBe(false);
    });

    it('includes documented methods the SDK has no typings for', () => {
        const contextSearch = getMethod('assistant.search.context');
        expect(contextSearch?.argsUnknown).toBe(true);
        expect(contextSearch?.docUrl).toContain('assistant.search.context');

        expect(getMethod('files.upload')?.deprecated).toBe(true);
    });

    it('does not let a supplement shadow a generated entry', () => {
        // `users.setActive` is listed in the supplement; if the SDK ever adds it,
        // the generated entry (with real arguments) must win.
        const method = getMethod('users.setActive');
        expect(method).toBeDefined();
        if (method?.args.length) expect(method.argsUnknown).toBeUndefined();
    });
});

describe('searchMethods', () => {
    it('ranks name matches above description matches', () => {
        const names = searchMethods({ query: 'upload' }).map((method) => method.method);
        expect(names[0]).toMatch(/upload/i);
        expect(names).toContain('files.getUploadURLExternal');
    });

    it('filters by family', () => {
        const results = searchMethods({ family: 'canvases' });
        expect(results.length).toBeGreaterThan(3);
        expect(results.every((method) => method.family === 'canvases')).toBe(true);
    });

    it('honours the limit', () => {
        expect(searchMethods({ limit: 7 })).toHaveLength(7);
    });
});

describe('suggestMethods', () => {
    it('recovers from a typo within the same family', () => {
        expect(suggestMethods('chat.postMesage')).toContain('chat.postMessage');
    });

    it('still suggests something for an unknown family', () => {
        expect(suggestMethods('nope.nothing').length).toBeGreaterThan(0);
    });
});
