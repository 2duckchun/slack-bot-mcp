import * as z from 'zod';

import { SlackToolError } from '../slack/errors.js';
import { asRecord, buildResult, compactChannel, compactMessage, compactUser } from '../slack/shape.js';
import { defineTool, type ToolDefinition } from './registry.js';

const channelField = z.string().describe('Channel ID (C…/D…/G…), #name, or channel name.');

const listChannels = defineTool({
    name: 'slack_list_channels',
    toolset: 'conversations',
    title: 'List Slack channels',
    description: 'Browse channels the token can see. Private channels appear only where the bot is a member. Use this to turn a channel name into the ID other tools need.',
    inputSchema: z.object({
        types: z.string().default('public_channel,private_channel').describe('Comma-separated conversation types: public_channel, private_channel, mpim, im.'),
        exclude_archived: z.boolean().default(true).describe('Hide archived channels.'),
        name_contains: z.string().optional().describe('Client-side filter on the channel name, applied after fetching.'),
        max_items: z.number().int().min(1).max(3000).default(300).describe('Ceiling on channels returned across pages.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const params: Record<string, unknown> = { types: args.types, exclude_archived: args.exclude_archived, limit: 200 };
        if (config.teamId) params['team_id'] = config.teamId;

        const page = await gateway.paginate<Record<string, unknown>>('conversations.list', params, { itemsKey: 'channels', maxItems: args.max_items });
        gateway.resolver.rememberChannels(page.items as Array<{ id?: string; name?: string }>);

        let channels = page.items.map(compactChannel);
        if (args.name_contains) {
            const needle = args.name_contains.toLowerCase();
            channels = channels.filter((channel) => channel.name?.toLowerCase().includes(needle));
        }

        return buildResult(
            `${channels.length} channel(s)${page.nextCursor ? ' (more pages remain)' : ''}.`,
            { channels, pages_fetched: page.pages, next_cursor: page.nextCursor },
            config.maxResponseChars
        );
    }
});

const getChannelInfo = defineTool({
    name: 'slack_get_channel_info',
    toolset: 'conversations',
    title: 'Get channel details',
    description: 'Read one channel: topic, purpose, membership, archive state, and whether the bot has joined.',
    inputSchema: z.object({
        channel: channelField,
        include_num_members: z.boolean().default(true).describe('Include the member count.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolver.channelId(args.channel);
        const result = asRecord(await gateway.call('conversations.info', { channel, include_num_members: args.include_num_members }));
        const raw = asRecord(result['channel']);
        gateway.resolver.rememberChannels([raw as { id?: string; name?: string }]);

        const info = compactChannel(raw);
        return buildResult(`#${info.name ?? channel}${info.is_member === false ? ' — the bot is not a member' : ''}.`, { channel: info, created: raw['created'], creator: raw['creator'] }, config.maxResponseChars);
    }
});

const getChannelHistory = defineTool({
    name: 'slack_get_channel_history',
    toolset: 'conversations',
    title: 'Read channel history',
    description: 'Fetch recent messages from a channel, newest first. Thread replies are not included — follow reply_count with slack_get_thread.',
    inputSchema: z.object({
        channel: channelField,
        limit: z.number().int().min(1).max(1000).default(50).describe('How many messages to return.'),
        oldest: z.string().optional().describe('Only messages after this Unix timestamp.'),
        latest: z.string().optional().describe('Only messages before this Unix timestamp.'),
        inclusive: z.boolean().optional().describe('Include messages exactly at oldest/latest.'),
        include_full_text: z.boolean().default(true).describe('Set false to omit message text and return only metadata.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolver.channelId(args.channel);
        const params: Record<string, unknown> = { channel, limit: Math.min(args.limit, 200) };
        for (const key of ['oldest', 'latest', 'inclusive'] as const) {
            if (args[key] !== undefined) params[key] = args[key];
        }

        const page = await gateway.paginate<Record<string, unknown>>('conversations.history', params, { itemsKey: 'messages', maxItems: args.limit });
        const messages = page.items.map((raw) => {
            const message = compactMessage(raw, gateway.resolver);
            if (!args.include_full_text) delete message.text;
            return message;
        });

        return buildResult(
            `${messages.length} message(s) from ${gateway.resolver.channelName(channel)}${page.nextCursor ? '; older messages remain' : ''}.`,
            { channel, messages, next_cursor: page.nextCursor },
            config.maxResponseChars
        );
    }
});

const getThread = defineTool({
    name: 'slack_get_thread',
    toolset: 'conversations',
    title: 'Read a thread',
    description: 'Fetch a parent message and all of its replies in order.',
    inputSchema: z.object({
        channel: channelField,
        thread_ts: z.string().describe("Parent message ts. Passing a reply's ts returns the same thread."),
        limit: z.number().int().min(1).max(1000).default(100).describe('Ceiling on messages returned.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolver.channelId(args.channel);
        const page = await gateway.paginate<Record<string, unknown>>('conversations.replies', { channel, ts: args.thread_ts, limit: Math.min(args.limit, 200) }, { itemsKey: 'messages', maxItems: args.limit });

        const messages = page.items.map((raw) => compactMessage(raw, gateway.resolver));
        return buildResult(`Thread ${args.thread_ts}: ${messages.length} message(s) including the parent.`, { channel, thread_ts: args.thread_ts, messages, next_cursor: page.nextCursor }, config.maxResponseChars);
    }
});

const listChannelMembers = defineTool({
    name: 'slack_list_channel_members',
    toolset: 'conversations',
    title: 'List channel members',
    description: 'List the users in a channel. Returns IDs; set resolve_names to also fetch their profiles.',
    inputSchema: z.object({
        channel: channelField,
        max_items: z.number().int().min(1).max(3000).default(500).describe('Ceiling on members returned.'),
        resolve_names: z.boolean().default(false).describe('Look up each member profile. Slower, and expensive on large channels.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolver.channelId(args.channel);
        const page = await gateway.paginate<string>('conversations.members', { channel, limit: 200 }, { itemsKey: 'members', maxItems: args.max_items });

        if (!args.resolve_names) {
            return buildResult(`${page.items.length} member(s) in ${gateway.resolver.channelName(channel)}.`, { channel, member_ids: page.items, next_cursor: page.nextCursor }, config.maxResponseChars);
        }

        const members = [];
        for (const id of page.items) {
            const info = asRecord(await gateway.call('users.info', { user: id }));
            members.push(compactUser(asRecord(info['user'])));
        }
        gateway.resolver.rememberUsers(members);

        return buildResult(`${members.length} member(s) in ${gateway.resolver.channelName(channel)}.`, { channel, members, next_cursor: page.nextCursor }, config.maxResponseChars);
    }
});

const joinChannel = defineTool({
    name: 'slack_join_channel',
    toolset: 'conversations',
    title: 'Join a channel',
    description: 'Add the bot to a public channel. Required before posting where the bot is not yet a member. Private channels must invite the bot from Slack instead.',
    inputSchema: z.object({ channel: channelField }),
    annotations: { readOnly: false, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        const result = asRecord(await gateway.call('conversations.join', { channel }, { channelAlreadyChecked: true }));
        return buildResult(`Joined ${gateway.resolver.channelName(channel)}.`, { channel: compactChannel(asRecord(result['channel'])), warning: result['warning'] }, config.maxResponseChars);
    }
});

const leaveChannel = defineTool({
    name: 'slack_leave_channel',
    toolset: 'conversations',
    title: 'Leave a channel',
    description: 'Remove the bot from a channel. It will stop receiving events and lose the ability to post there.',
    inputSchema: z.object({ channel: channelField }),
    annotations: { readOnly: false, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        await gateway.call('conversations.leave', { channel }, { channelAlreadyChecked: true });
        return buildResult(`Left ${gateway.resolver.channelName(channel)}.`, { channel, left: true }, config.maxResponseChars);
    }
});

const createChannel = defineTool({
    name: 'slack_create_channel',
    toolset: 'conversations',
    title: 'Create a channel',
    description: 'Create a channel and put the bot in it. Names are lowercase, hyphenated, and permanent enough that a typo is worth avoiding.',
    inputSchema: z.object({
        name: z.string().describe('Channel name without "#": lowercase letters, digits, hyphens, underscores; max 80 characters.'),
        is_private: z.boolean().default(false).describe('Create it as a private channel.'),
        topic: z.string().optional().describe('Set the topic right after creating.'),
        purpose: z.string().optional().describe('Set the purpose right after creating.')
    }),
    annotations: { readOnly: false },
    handler: async (args, { gateway, config }) => {
        const result = asRecord(await gateway.call('conversations.create', { name: args.name, is_private: args.is_private }));
        const raw = asRecord(result['channel']);
        const id = String(raw['id'] ?? '');
        gateway.resolver.rememberChannels([raw as { id?: string; name?: string }]);

        if (args.topic) await gateway.call('conversations.setTopic', { channel: id, topic: args.topic });
        if (args.purpose) await gateway.call('conversations.setPurpose', { channel: id, purpose: args.purpose });

        return buildResult(`Created #${raw['name']} (${id}).`, { channel: compactChannel(raw) }, config.maxResponseChars);
    }
});

const inviteToChannel = defineTool({
    name: 'slack_invite_to_channel',
    toolset: 'conversations',
    title: 'Invite users to a channel',
    description: 'Add people to a channel. Accepts IDs, @handles, or emails; up to 1000 per call.',
    inputSchema: z.object({
        channel: channelField,
        users: z.array(z.string()).min(1).describe('Users to add: U… IDs, @handles, or email addresses.')
    }),
    annotations: { readOnly: false },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        const ids: string[] = [];
        for (const user of args.users) ids.push(await gateway.resolver.userId(user));

        const result = asRecord(await gateway.call('conversations.invite', { channel, users: ids.join(',') }, { channelAlreadyChecked: true }));
        return buildResult(`Invited ${ids.length} user(s) to ${gateway.resolver.channelName(channel)}.`, { channel, invited: ids, errors: result['errors'] }, config.maxResponseChars);
    }
});

const setChannelTopicOrPurpose = defineTool({
    name: 'slack_set_channel_topic',
    toolset: 'conversations',
    title: 'Set channel topic or purpose',
    description: 'Replace a channel\'s topic, purpose, or both. Passing neither is an error, since an empty call would silently do nothing.',
    inputSchema: z.object({
        channel: channelField,
        topic: z.string().optional().describe('New topic. Max 250 characters.'),
        purpose: z.string().optional().describe('New purpose. Max 250 characters.')
    }),
    annotations: { readOnly: false, idempotent: true },
    handler: async (args, { gateway, config }) => {
        if (args.topic === undefined && args.purpose === undefined) {
            throw new SlackToolError('Pass topic, purpose, or both.');
        }
        const channel = await gateway.resolveWritableChannel(args.channel);
        const updated: Record<string, unknown> = { channel };

        if (args.topic !== undefined) {
            const result = asRecord(await gateway.call('conversations.setTopic', { channel, topic: args.topic }, { channelAlreadyChecked: true }));
            updated['topic'] = asRecord(result['channel'])['topic'];
        }
        if (args.purpose !== undefined) {
            const result = asRecord(await gateway.call('conversations.setPurpose', { channel, purpose: args.purpose }, { channelAlreadyChecked: true }));
            updated['purpose'] = asRecord(result['channel'])['purpose'];
        }

        return buildResult(`Updated ${gateway.resolver.channelName(channel)}.`, updated, config.maxResponseChars);
    }
});

const archiveChannel = defineTool({
    name: 'slack_archive_channel',
    toolset: 'conversations',
    title: 'Archive a channel',
    description: 'Archive a channel. Its history stays readable but nobody can post; unarchiving is a separate manual step.',
    inputSchema: z.object({ channel: channelField }),
    annotations: { readOnly: false, destructive: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        await gateway.call('conversations.archive', { channel }, { channelAlreadyChecked: true });
        return buildResult(`Archived ${gateway.resolver.channelName(channel)}.`, { channel, archived: true }, config.maxResponseChars);
    }
});

const openDm = defineTool({
    name: 'slack_open_dm',
    toolset: 'conversations',
    title: 'Open a DM',
    description: 'Open (or reuse) a direct message channel with one or more users, and return the D…/G… ID to post into.',
    inputSchema: z.object({
        users: z.array(z.string()).min(1).describe('One user for a DM, several for a group DM. IDs, @handles, or emails.')
    }),
    annotations: { readOnly: false, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const ids: string[] = [];
        for (const user of args.users) ids.push(await gateway.resolver.userId(user));

        const result = asRecord(await gateway.call('conversations.open', { users: ids.join(',') }));
        const channel = asRecord(result['channel']);

        return buildResult(`DM channel ${channel['id']} ready.`, { channel_id: channel['id'], users: ids, already_open: result['already_open'] }, config.maxResponseChars);
    }
});

export const conversationTools: ToolDefinition[] = [
    listChannels,
    getChannelInfo,
    getChannelHistory,
    getThread,
    listChannelMembers,
    joinChannel,
    leaveChannel,
    createChannel,
    inviteToChannel,
    setChannelTopicOrPurpose,
    archiveChannel,
    openDm
];
