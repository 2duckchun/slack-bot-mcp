import * as z from 'zod';

import { asRecord, buildResult, compactFile, tsToIso } from '../slack/shape.js';
import { defineTool, type ToolDefinition } from './registry.js';

/**
 * Slack's search endpoints reject bot tokens outright, so both tools here need
 * `SLACK_USER_TOKEN`. The gateway routes them automatically and explains the
 * requirement when the token is absent.
 */
const QUERY_HELP = 'Slack search syntax works: in:#channel, from:@user, before:2026-01-01, after:2026-01-01, has:link, is:thread, and "quoted phrases".';

const searchMessages = defineTool({
    name: 'slack_search_messages',
    toolset: 'search',
    title: 'Search Slack messages',
    description: `Full-text search across messages the searching user can see. Requires a user token (xoxp) — Slack does not allow bot tokens here. ${QUERY_HELP}`,
    inputSchema: z.object({
        query: z.string().describe(`What to search for. ${QUERY_HELP}`),
        count: z.number().int().min(1).max(100).default(20).describe('Results per page.'),
        page: z.number().int().min(1).max(100).default(1).describe('1-based page number.'),
        sort: z.enum(['score', 'timestamp']).default('score').describe('Rank by relevance or recency.'),
        sort_dir: z.enum(['asc', 'desc']).default('desc').describe('Sort direction.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const params: Record<string, unknown> = { query: args.query, count: args.count, page: args.page, sort: args.sort, sort_dir: args.sort_dir, highlight: false };
        if (config.teamId) params['team_id'] = config.teamId;

        const result = asRecord(await gateway.call('search.messages', params));
        const messages = asRecord(result['messages']);
        const matches = ((messages['matches'] ?? []) as Array<Record<string, unknown>>).map((match) => ({
            ts: match['ts'],
            iso_time: tsToIso(match['ts'] as string | undefined),
            channel: asRecord(match['channel'])['name'] ?? asRecord(match['channel'])['id'],
            channel_id: asRecord(match['channel'])['id'],
            username: match['username'],
            user: match['user'],
            text: match['text'],
            permalink: match['permalink']
        }));

        return buildResult(
            `${messages['total'] ?? matches.length} match(es) for "${args.query}"; showing page ${args.page}.`,
            { total: messages['total'], page: args.page, pagination: messages['pagination'], matches },
            config.maxResponseChars
        );
    }
});

const searchFiles = defineTool({
    name: 'slack_search_files',
    toolset: 'search',
    title: 'Search Slack files',
    description: `Full-text search across files the searching user can see. Requires a user token (xoxp). ${QUERY_HELP}`,
    inputSchema: z.object({
        query: z.string().describe(`What to search for. ${QUERY_HELP}`),
        count: z.number().int().min(1).max(100).default(20).describe('Results per page.'),
        page: z.number().int().min(1).max(100).default(1).describe('1-based page number.'),
        sort: z.enum(['score', 'timestamp']).default('score').describe('Rank by relevance or recency.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const params: Record<string, unknown> = { query: args.query, count: args.count, page: args.page, sort: args.sort, highlight: false };
        if (config.teamId) params['team_id'] = config.teamId;

        const result = asRecord(await gateway.call('search.files', params));
        const files = asRecord(result['files']);
        const matches = ((files['matches'] ?? []) as Array<Record<string, unknown>>).map(compactFile);

        return buildResult(`${files['total'] ?? matches.length} file match(es) for "${args.query}".`, { total: files['total'], page: args.page, paging: files['paging'], matches }, config.maxResponseChars);
    }
});

export const searchTools: ToolDefinition[] = [searchMessages, searchFiles];
