import * as z from 'zod';

import { asRecord, buildResult, compactChannel, compactUser } from '../slack/shape.js';
import { defineTool, type ToolDefinition } from './registry.js';

const listUsers = defineTool({
    name: 'slack_list_users',
    toolset: 'users',
    title: 'List workspace members',
    description: 'Browse the member directory. Large workspaces are slow to page through — prefer slack_lookup_user_by_email when you already know who you want.',
    inputSchema: z.object({
        include_deleted: z.boolean().default(false).describe('Include deactivated accounts.'),
        include_bots: z.boolean().default(false).describe('Include bot and app users.'),
        name_contains: z.string().optional().describe('Client-side filter over name, display name, and real name.'),
        max_items: z.number().int().min(1).max(5000).default(500).describe('Ceiling on members returned across pages.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const params: Record<string, unknown> = { limit: 200 };
        if (config.teamId) params['team_id'] = config.teamId;

        const page = await gateway.paginate<Record<string, unknown>>('users.list', params, { itemsKey: 'members', maxItems: args.max_items });
        gateway.resolver.rememberUsers(page.items as Array<{ id?: string; name?: string }>);

        let users = page.items.map(compactUser);
        if (!args.include_deleted) users = users.filter((user) => !user.deleted);
        if (!args.include_bots) users = users.filter((user) => !user.is_bot);
        if (args.name_contains) {
            const needle = args.name_contains.toLowerCase();
            users = users.filter((user) => [user.name, user.real_name].some((value) => value?.toLowerCase().includes(needle)));
        }

        return buildResult(`${users.length} member(s)${page.nextCursor ? ' (more pages remain)' : ''}.`, { users, next_cursor: page.nextCursor }, config.maxResponseChars);
    }
});

const getUserInfo = defineTool({
    name: 'slack_get_user_info',
    toolset: 'users',
    title: 'Get a user profile',
    description: 'Read one member: display name, real name, title, timezone, and whether they are a bot or admin.',
    inputSchema: z.object({
        user: z.string().describe('User ID (U…), @handle, or email address.'),
        include_locale: z.boolean().default(false).describe('Include the user locale.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const user = await gateway.resolver.userId(args.user);
        const result = asRecord(await gateway.call('users.info', { user, include_locale: args.include_locale }));
        const raw = asRecord(result['user']);
        gateway.resolver.rememberUsers([raw as { id?: string; name?: string }]);

        const profile = compactUser(raw);
        return buildResult(`${profile.real_name ?? profile.name ?? user} (${user}).`, { user: profile, tz_offset: raw['tz_offset'], locale: raw['locale'], updated: raw['updated'] }, config.maxResponseChars);
    }
});

const lookupUserByEmail = defineTool({
    name: 'slack_lookup_user_by_email',
    toolset: 'users',
    title: 'Find a user by email',
    description: 'Resolve an email address to a Slack user. The cheapest way to get a U… ID when you know the person.',
    inputSchema: z.object({
        email: z.string().describe('Email address registered with the workspace.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const result = asRecord(await gateway.call('users.lookupByEmail', { email: args.email }));
        const raw = asRecord(result['user']);
        gateway.resolver.rememberUsers([raw as { id?: string; name?: string }]);

        const user = compactUser(raw);
        return buildResult(`${args.email} is ${user.real_name ?? user.name} (${user.id}).`, { user }, config.maxResponseChars);
    }
});

const getUserConversations = defineTool({
    name: 'slack_get_user_conversations',
    toolset: 'users',
    title: 'List a user\'s channels',
    description: 'List the conversations a user belongs to. With no user, lists the ones the bot itself is in — useful for finding where the bot can post.',
    inputSchema: z.object({
        user: z.string().optional().describe('User ID, @handle, or email. Defaults to the authenticated bot.'),
        types: z.string().default('public_channel,private_channel').describe('Comma-separated types: public_channel, private_channel, mpim, im.'),
        exclude_archived: z.boolean().default(true).describe('Hide archived channels.'),
        max_items: z.number().int().min(1).max(2000).default(300).describe('Ceiling on conversations returned.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const params: Record<string, unknown> = { types: args.types, exclude_archived: args.exclude_archived, limit: 200 };
        if (args.user) params['user'] = await gateway.resolver.userId(args.user);
        if (config.teamId) params['team_id'] = config.teamId;

        const page = await gateway.paginate<Record<string, unknown>>('users.conversations', params, { itemsKey: 'channels', maxItems: args.max_items });
        gateway.resolver.rememberChannels(page.items as Array<{ id?: string; name?: string }>);

        const channels = page.items.map(compactChannel);
        return buildResult(`${channels.length} conversation(s) for ${args.user ?? 'the bot'}.`, { channels, next_cursor: page.nextCursor }, config.maxResponseChars);
    }
});

export const userTools: ToolDefinition[] = [listUsers, getUserInfo, lookupUserByEmail, getUserConversations];
