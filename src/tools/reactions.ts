import * as z from 'zod';

import { SlackToolError } from '../slack/errors.js';
import { asRecord, buildResult, compactMessage } from '../slack/shape.js';
import { defineTool, type ToolDefinition } from './registry.js';

const channelField = z.string().describe('Channel ID (C…/D…/G…), #name, or channel name.');
const emojiField = z.string().describe('Emoji name without colons, e.g. "white_check_mark", "eyes", "tada".');

/** Slack accepts `:name:` but the API wants the bare name; stripping is kinder than failing. */
const bareEmoji = (name: string): string => name.trim().replace(/^:|:$/g, '');

const addReaction = defineTool({
    name: 'slack_add_reaction',
    toolset: 'reactions',
    title: 'Add a reaction',
    description: 'React to a message with an emoji. Slack rejects a reaction the bot has already added.',
    inputSchema: z.object({ channel: channelField, timestamp: z.string().describe('ts of the message to react to.'), name: emojiField }),
    annotations: { readOnly: false, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        const name = bareEmoji(args.name);
        await gateway.call('reactions.add', { channel, timestamp: args.timestamp, name }, { channelAlreadyChecked: true });
        return buildResult(`Reacted :${name}: to ${args.timestamp}.`, { channel, timestamp: args.timestamp, name }, config.maxResponseChars);
    }
});

const removeReaction = defineTool({
    name: 'slack_remove_reaction',
    toolset: 'reactions',
    title: 'Remove a reaction',
    description: 'Remove a reaction this bot added to a message.',
    inputSchema: z.object({ channel: channelField, timestamp: z.string().describe('ts of the message.'), name: emojiField }),
    annotations: { readOnly: false, destructive: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        const name = bareEmoji(args.name);
        await gateway.call('reactions.remove', { channel, timestamp: args.timestamp, name }, { channelAlreadyChecked: true });
        return buildResult(`Removed :${name}: from ${args.timestamp}.`, { channel, timestamp: args.timestamp, name, removed: true }, config.maxResponseChars);
    }
});

const getReactions = defineTool({
    name: 'slack_get_reactions',
    toolset: 'reactions',
    title: 'Get reactions on a message',
    description: 'List every reaction on a message and who added it.',
    inputSchema: z.object({ channel: channelField, timestamp: z.string().describe('ts of the message.'), full: z.boolean().default(true).describe('Return the complete reaction list rather than a summary.') }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolver.channelId(args.channel);
        const result = asRecord(await gateway.call('reactions.get', { channel, timestamp: args.timestamp, full: args.full }));
        const message = asRecord(result['message']);
        const reactions = (message['reactions'] ?? []) as Array<Record<string, unknown>>;

        return buildResult(
            `${reactions.length} distinct reaction(s) on ${args.timestamp}.`,
            { channel, timestamp: args.timestamp, reactions: reactions.map((r) => ({ name: r['name'], count: r['count'], users: r['users'] })) },
            config.maxResponseChars
        );
    }
});

const pinMessage = defineTool({
    name: 'slack_pin_message',
    toolset: 'reactions',
    title: 'Pin a message',
    description: 'Pin a message to a channel. A channel holds at most 100 pins.',
    inputSchema: z.object({ channel: channelField, timestamp: z.string().describe('ts of the message to pin.') }),
    annotations: { readOnly: false, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        await gateway.call('pins.add', { channel, timestamp: args.timestamp }, { channelAlreadyChecked: true });
        return buildResult(`Pinned ${args.timestamp}.`, { channel, timestamp: args.timestamp, pinned: true }, config.maxResponseChars);
    }
});

const unpinMessage = defineTool({
    name: 'slack_unpin_message',
    toolset: 'reactions',
    title: 'Unpin a message',
    description: 'Remove a pin from a channel.',
    inputSchema: z.object({ channel: channelField, timestamp: z.string().describe('ts of the pinned message.') }),
    annotations: { readOnly: false, destructive: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        await gateway.call('pins.remove', { channel, timestamp: args.timestamp }, { channelAlreadyChecked: true });
        return buildResult(`Unpinned ${args.timestamp}.`, { channel, timestamp: args.timestamp, pinned: false }, config.maxResponseChars);
    }
});

const listPins = defineTool({
    name: 'slack_list_pins',
    toolset: 'reactions',
    title: 'List pinned items',
    description: 'Show everything pinned in a channel.',
    inputSchema: z.object({ channel: channelField }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolver.channelId(args.channel);
        const result = asRecord(await gateway.call('pins.list', { channel }));
        const items = (result['items'] ?? []) as Array<Record<string, unknown>>;

        const pins = items.map((item) => ({
            type: item['type'],
            created: item['created'],
            created_by: item['created_by'],
            message: item['message'] ? compactMessage(asRecord(item['message']), gateway.resolver) : undefined,
            file: item['file'] ? { id: asRecord(item['file'])['id'], name: asRecord(item['file'])['name'] } : undefined
        }));

        return buildResult(`${pins.length} pinned item(s) in ${gateway.resolver.channelName(channel)}.`, { channel, pins }, config.maxResponseChars);
    }
});

/**
 * Bookmarks are four near-identical endpoints; folding them into one tool with
 * an `action` keeps the tool list short without hiding anything.
 */
const manageBookmarks = defineTool({
    name: 'slack_manage_bookmarks',
    toolset: 'reactions',
    title: 'Manage channel bookmarks',
    description: 'List, add, edit, or remove the bookmarks pinned to the top of a channel.',
    inputSchema: z.object({
        action: z.enum(['list', 'add', 'edit', 'remove']).describe('Which operation to perform.'),
        channel: channelField,
        bookmark_id: z.string().optional().describe('Required for edit and remove; get it from action "list".'),
        title: z.string().optional().describe('Bookmark label. Required for add.'),
        link: z.string().optional().describe('Bookmark URL. Required for add when type is "link".'),
        emoji: z.string().optional().describe('Emoji shown beside the bookmark, e.g. ":books:".')
    }),
    annotations: { readOnly: false },
    handler: async (args, { gateway, config }) => {
        const needsWrite = args.action !== 'list';
        const channel = needsWrite ? await gateway.resolveWritableChannel(args.channel) : await gateway.resolver.channelId(args.channel);
        const options = { channelAlreadyChecked: true } as const;

        if (args.action === 'list') {
            const result = asRecord(await gateway.call('bookmarks.list', { channel_id: channel }, options));
            const bookmarks = (result['bookmarks'] ?? []) as Array<Record<string, unknown>>;
            return buildResult(
                `${bookmarks.length} bookmark(s).`,
                { channel, bookmarks: bookmarks.map((b) => ({ id: b['id'], title: b['title'], link: b['link'], emoji: b['emoji'], type: b['type'] })) },
                config.maxResponseChars
            );
        }

        if (args.action === 'add') {
            if (!args.title) throw new SlackToolError('Adding a bookmark needs a title.');
            const params: Record<string, unknown> = { channel_id: channel, title: args.title, type: 'link' };
            if (args.link) params['link'] = args.link;
            if (args.emoji) params['emoji'] = args.emoji;

            const result = asRecord(await gateway.call('bookmarks.add', params, options));
            return buildResult(`Bookmark "${args.title}" added.`, { channel, bookmark: result['bookmark'] }, config.maxResponseChars);
        }

        if (!args.bookmark_id) throw new SlackToolError(`Action "${args.action}" needs bookmark_id. Run action "list" to find it.`);

        if (args.action === 'remove') {
            await gateway.call('bookmarks.remove', { channel_id: channel, bookmark_id: args.bookmark_id }, options);
            return buildResult(`Bookmark ${args.bookmark_id} removed.`, { channel, bookmark_id: args.bookmark_id, removed: true }, config.maxResponseChars);
        }

        const params: Record<string, unknown> = { channel_id: channel, bookmark_id: args.bookmark_id };
        if (args.title) params['title'] = args.title;
        if (args.link) params['link'] = args.link;
        if (args.emoji) params['emoji'] = args.emoji;

        const result = asRecord(await gateway.call('bookmarks.edit', params, options));
        return buildResult(`Bookmark ${args.bookmark_id} updated.`, { channel, bookmark: result['bookmark'] }, config.maxResponseChars);
    }
});

export const reactionTools: ToolDefinition[] = [addReaction, removeReaction, getReactions, pinMessage, unpinMessage, listPins, manageBookmarks];
