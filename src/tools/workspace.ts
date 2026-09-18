import * as z from 'zod';

import { asRecord, buildResult } from '../slack/shape.js';
import { defineTool, type ToolDefinition } from './registry.js';

const getTeamInfo = defineTool({
    name: 'slack_get_team_info',
    toolset: 'workspace',
    title: 'Get workspace info',
    description: 'Read the workspace name, domain, icon, and enterprise details.',
    inputSchema: z.object({
        team: z.string().optional().describe('Team ID to inspect. Defaults to the token\'s own workspace.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const params = args.team ? { team: args.team } : {};
        const result = asRecord(await gateway.call('team.info', params));
        const team = asRecord(result['team']);

        return buildResult(
            `${team['name']} (${team['domain']}.slack.com)`,
            { id: team['id'], name: team['name'], domain: team['domain'], email_domain: team['email_domain'], enterprise_id: team['enterprise_id'], enterprise_name: team['enterprise_name'] },
            config.maxResponseChars
        );
    }
});

const listEmoji = defineTool({
    name: 'slack_list_emoji',
    toolset: 'workspace',
    title: 'List custom emoji',
    description: 'List the workspace\'s custom emoji names. Useful before reacting with a name that may not exist.',
    inputSchema: z.object({
        name_contains: z.string().optional().describe('Filter to names containing this substring.'),
        max_items: z.number().int().min(1).max(5000).default(500).describe('Ceiling on names returned; workspaces often have thousands.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const result = asRecord(await gateway.call('emoji.list', {}));
        const emoji = asRecord(result['emoji']);

        let names = Object.keys(emoji);
        if (args.name_contains) {
            const needle = args.name_contains.toLowerCase();
            names = names.filter((name) => name.toLowerCase().includes(needle));
        }
        const truncated = names.length > args.max_items;

        return buildResult(
            `${names.length} custom emoji${truncated ? `, showing ${args.max_items}` : ''}.`,
            { total: names.length, names: names.slice(0, args.max_items), truncated },
            config.maxResponseChars
        );
    }
});

const listUsergroups = defineTool({
    name: 'slack_list_usergroups',
    toolset: 'workspace',
    title: 'List user groups',
    description: 'List @-mentionable user groups, optionally with their members. Handles are what you type as @handle in a message.',
    inputSchema: z.object({
        include_users: z.boolean().default(false).describe('Include each group\'s member IDs.'),
        include_disabled: z.boolean().default(false).describe('Include disabled groups.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const params: Record<string, unknown> = { include_users: args.include_users, include_disabled: args.include_disabled, include_count: true };
        if (config.teamId) params['team_id'] = config.teamId;

        const result = asRecord(await gateway.call('usergroups.list', params));
        const groups = ((result['usergroups'] ?? []) as Array<Record<string, unknown>>).map((group) => ({
            id: group['id'],
            handle: group['handle'],
            name: group['name'],
            description: group['description'],
            user_count: group['user_count'],
            date_delete: group['date_delete'],
            users: args.include_users ? group['users'] : undefined
        }));

        return buildResult(`${groups.length} user group(s).`, { usergroups: groups }, config.maxResponseChars);
    }
});

export const workspaceTools: ToolDefinition[] = [getTeamInfo, listEmoji, listUsergroups];
