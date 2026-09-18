import * as z from 'zod';

import { SlackToolError } from '../slack/errors.js';
import { asRecord, buildResult, compactMessage, tsToIso } from '../slack/shape.js';
import { defineTool, type ToolDefinition } from './registry.js';

/**
 * The four ways Slack accepts message content. Exactly one is needed; the
 * others are ignored or rejected depending on the combination, so the
 * descriptions steer toward picking one deliberately.
 */
const contentFields = {
    text: z.string().optional().describe('Plain message text with Slack mrkdwn (*bold*, _italic_, `code`, <https://url|label>). Also used as notification fallback when blocks are given.'),
    markdown_text: z.string().optional().describe('Standard Markdown, converted by Slack. Do not combine with text or blocks. Max 12,000 characters.'),
    blocks: z.array(z.record(z.string(), z.unknown())).optional().describe('Block Kit blocks as a JSON array. Pair with text for the notification preview. Validate with slack_validate_blocks if unsure.'),
    attachments: z.array(z.record(z.string(), z.unknown())).optional().describe('Legacy secondary attachments. Prefer blocks.')
};

const channelField = z.string().describe('Channel ID (C…/D…/G…), #name, or channel name. DMs need the D… ID from slack_open_dm.');

type Content = {
    text?: string | undefined;
    markdown_text?: string | undefined;
    blocks?: Array<Record<string, unknown>> | undefined;
    attachments?: Array<Record<string, unknown>> | undefined;
};

/** Copies whichever content fields were supplied, and insists that one was. */
function contentArgs(args: Content, toolName: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (args.text !== undefined) out['text'] = args.text;
    if (args.markdown_text !== undefined) out['markdown_text'] = args.markdown_text;
    if (args.blocks !== undefined) out['blocks'] = args.blocks;
    if (args.attachments !== undefined) out['attachments'] = args.attachments;

    if (Object.keys(out).length === 0) {
        throw new SlackToolError(`${toolName} needs message content: pass one of text, markdown_text, blocks, or attachments.`);
    }
    if (out['markdown_text'] !== undefined && (out['text'] !== undefined || out['blocks'] !== undefined)) {
        throw new SlackToolError('markdown_text cannot be combined with text or blocks. Pick one representation.');
    }
    return out;
}

const sendMessage = defineTool({
    name: 'slack_send_message',
    toolset: 'messaging',
    title: 'Send a Slack message',
    description: 'Post a message to a channel, DM, or thread as the bot. Supply exactly one of text, markdown_text, blocks, or attachments.',
    inputSchema: z.object({
        channel: channelField,
        ...contentFields,
        thread_ts: z.string().optional().describe("Parent message ts to reply in a thread. Use the parent's ts, never a reply's."),
        reply_broadcast: z.boolean().optional().describe('With thread_ts, also show the reply in the channel.'),
        unfurl_links: z.boolean().optional().describe('Expand link previews. Slack decides by default.'),
        unfurl_media: z.boolean().optional().describe('Expand media previews.'),
        icon_emoji: z.string().optional().describe('Override the bot icon for this message, e.g. ":robot_face:".'),
        username: z.string().optional().describe('Override the bot display name for this message.'),
        metadata: z.record(z.string(), z.unknown()).optional().describe('Message metadata object ({event_type, event_payload}) for apps that listen for it.')
    }),
    annotations: { readOnly: false },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        const params: Record<string, unknown> = { channel, ...contentArgs(args, 'slack_send_message') };

        for (const key of ['thread_ts', 'reply_broadcast', 'unfurl_links', 'unfurl_media', 'icon_emoji', 'username', 'metadata'] as const) {
            if (args[key] !== undefined) params[key] = args[key];
        }

        const result = asRecord(await gateway.call('chat.postMessage', params, { channelAlreadyChecked: true }));
        const ts = String(result['ts'] ?? '');

        return buildResult(`Message posted to ${gateway.resolver.channelName(channel)} at ts ${ts}.`, { channel, ts, iso_time: tsToIso(ts), thread_ts: args.thread_ts }, config.maxResponseChars);
    }
});

const updateMessage = defineTool({
    name: 'slack_update_message',
    toolset: 'messaging',
    title: 'Edit a Slack message',
    description: 'Replace the content of a message this app posted. Slack refuses edits to messages posted by anyone else.',
    inputSchema: z.object({
        channel: channelField,
        ts: z.string().describe('Timestamp of the message to edit, exactly as Slack returned it.'),
        ...contentFields,
        reply_broadcast: z.boolean().optional().describe('Broadcast an edited thread reply to the channel.')
    }),
    annotations: { readOnly: false, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        const params: Record<string, unknown> = { channel, ts: args.ts, ...contentArgs(args, 'slack_update_message') };
        if (args.reply_broadcast !== undefined) params['reply_broadcast'] = args.reply_broadcast;

        const result = asRecord(await gateway.call('chat.update', params, { channelAlreadyChecked: true }));
        return buildResult(`Message ${args.ts} updated.`, { channel, ts: result['ts'] ?? args.ts }, config.maxResponseChars);
    }
});

const deleteMessage = defineTool({
    name: 'slack_delete_message',
    toolset: 'messaging',
    title: 'Delete a Slack message',
    description: 'Permanently delete a message this app posted. This cannot be undone.',
    inputSchema: z.object({
        channel: channelField,
        ts: z.string().describe('Timestamp of the message to delete.')
    }),
    annotations: { readOnly: false, destructive: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        await gateway.call('chat.delete', { channel, ts: args.ts }, { channelAlreadyChecked: true });
        return buildResult(`Message ${args.ts} deleted.`, { channel, ts: args.ts, deleted: true }, config.maxResponseChars);
    }
});

const sendEphemeral = defineTool({
    name: 'slack_send_ephemeral',
    toolset: 'messaging',
    title: 'Send an ephemeral message',
    description: 'Post a message only one user can see, and only until they reload. Useful for confirmations and errors that should not clutter the channel.',
    inputSchema: z.object({
        channel: channelField,
        user: z.string().describe('Who sees it: user ID (U…), @handle, or email.'),
        ...contentFields,
        thread_ts: z.string().optional().describe('Show it inside this thread.')
    }),
    annotations: { readOnly: false },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        const user = await gateway.resolver.userId(args.user);
        const params: Record<string, unknown> = { channel, user, ...contentArgs(args, 'slack_send_ephemeral') };
        if (args.thread_ts !== undefined) params['thread_ts'] = args.thread_ts;

        const result = asRecord(await gateway.call('chat.postEphemeral', params, { channelAlreadyChecked: true }));
        return buildResult(`Ephemeral message sent to ${gateway.resolver.userName(user)}.`, { channel, user, message_ts: result['message_ts'] }, config.maxResponseChars);
    }
});

const scheduleMessage = defineTool({
    name: 'slack_schedule_message',
    toolset: 'messaging',
    title: 'Schedule a Slack message',
    description: 'Queue a message for a future time. Slack accepts times up to 120 days ahead.',
    inputSchema: z.object({
        channel: channelField,
        post_at: z.union([z.number().int(), z.string()]).describe('When to send, as a Unix epoch timestamp in seconds.'),
        ...contentFields,
        thread_ts: z.string().optional().describe('Post as a reply in this thread.'),
        unfurl_links: z.boolean().optional().describe('Expand link previews.')
    }),
    annotations: { readOnly: false },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        const params: Record<string, unknown> = { channel, post_at: args.post_at, ...contentArgs(args, 'slack_schedule_message') };
        if (args.thread_ts !== undefined) params['thread_ts'] = args.thread_ts;
        if (args.unfurl_links !== undefined) params['unfurl_links'] = args.unfurl_links;

        const result = asRecord(await gateway.call('chat.scheduleMessage', params, { channelAlreadyChecked: true }));
        const postAt = Number(args.post_at);

        return buildResult(
            `Message scheduled for ${Number.isFinite(postAt) ? new Date(postAt * 1000).toISOString() : args.post_at}.`,
            { channel, scheduled_message_id: result['scheduled_message_id'], post_at: result['post_at'] ?? args.post_at },
            config.maxResponseChars
        );
    }
});

const listScheduledMessages = defineTool({
    name: 'slack_list_scheduled_messages',
    toolset: 'messaging',
    title: 'List scheduled messages',
    description: 'Show messages this app has queued but not yet sent, with the IDs needed to cancel them.',
    inputSchema: z.object({
        channel: z.string().optional().describe('Limit to one channel.'),
        oldest: z.string().optional().describe('Only messages scheduled after this Unix timestamp.'),
        latest: z.string().optional().describe('Only messages scheduled before this Unix timestamp.'),
        max_items: z.number().int().min(1).max(1000).default(200).describe('Ceiling on messages returned.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const params: Record<string, unknown> = {};
        if (args.channel) params['channel'] = await gateway.resolver.channelId(args.channel);
        if (args.oldest) params['oldest'] = args.oldest;
        if (args.latest) params['latest'] = args.latest;

        const page = await gateway.paginate<Record<string, unknown>>('chat.scheduledMessages.list', params, {
            itemsKey: 'scheduled_messages',
            maxItems: args.max_items
        });

        const messages = page.items.map((item) => ({
            id: item['id'],
            channel_id: item['channel_id'],
            post_at: item['post_at'],
            post_at_iso: typeof item['post_at'] === 'number' ? new Date(item['post_at'] * 1000).toISOString() : undefined,
            text: item['text']
        }));

        return buildResult(`${messages.length} scheduled message(s).`, { messages, next_cursor: page.nextCursor }, config.maxResponseChars);
    }
});

const deleteScheduledMessage = defineTool({
    name: 'slack_delete_scheduled_message',
    toolset: 'messaging',
    title: 'Cancel a scheduled message',
    description: 'Cancel a queued message before it sends. Get the ID from slack_list_scheduled_messages.',
    inputSchema: z.object({
        channel: channelField,
        scheduled_message_id: z.string().describe('The scheduled_message_id returned when the message was queued.')
    }),
    annotations: { readOnly: false, destructive: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        await gateway.call('chat.deleteScheduledMessage', { channel, scheduled_message_id: args.scheduled_message_id }, { channelAlreadyChecked: true });
        return buildResult(`Scheduled message ${args.scheduled_message_id} cancelled.`, { channel, scheduled_message_id: args.scheduled_message_id, cancelled: true }, config.maxResponseChars);
    }
});

const getPermalink = defineTool({
    name: 'slack_get_permalink',
    toolset: 'messaging',
    title: 'Get a message permalink',
    description: 'Build the shareable URL for a message, so it can be linked from elsewhere.',
    inputSchema: z.object({
        channel: channelField,
        message_ts: z.string().describe('Timestamp of the message.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolver.channelId(args.channel);
        const result = asRecord(await gateway.call('chat.getPermalink', { channel, message_ts: args.message_ts }));
        return buildResult(String(result['permalink'] ?? ''), { channel, message_ts: args.message_ts, permalink: result['permalink'] }, config.maxResponseChars);
    }
});

/**
 * The streaming trio. Slack's AI-app surface: `startStream` opens a message
 * that shows a typing indicator, `appendStream` grows it, `stopStream` closes
 * it. Kept as three tools because the caller has to carry the returned `ts`
 * between calls.
 */
const startStream = defineTool({
    name: 'slack_start_stream',
    toolset: 'messaging',
    title: 'Start a streaming message',
    description: 'Open a streaming message in a thread — it renders progressively, the way an assistant reply does. Returns the ts to pass to slack_append_stream and slack_stop_stream.',
    inputSchema: z.object({
        channel: channelField,
        thread_ts: z.string().describe('Thread to stream into. Streaming requires a thread.'),
        markdown_text: z.string().optional().describe('Initial Markdown content. Either this or chunks is required.'),
        chunks: z.array(z.record(z.string(), z.unknown())).optional().describe('Initial chunk objects, for structured streaming.'),
        recipient_user_id: z.string().optional().describe('User receiving the stream, when streaming outside a DM.'),
        recipient_team_id: z.string().optional().describe('Team of recipient_user_id. Required alongside it outside a DM.')
    }),
    annotations: { readOnly: false },
    handler: async (args, { gateway, config }) => {
        if (args.markdown_text === undefined && args.chunks === undefined) {
            throw new SlackToolError('slack_start_stream needs markdown_text or chunks.');
        }
        const channel = await gateway.resolveWritableChannel(args.channel);
        const params: Record<string, unknown> = { channel, thread_ts: args.thread_ts };
        for (const key of ['markdown_text', 'chunks', 'recipient_user_id', 'recipient_team_id'] as const) {
            if (args[key] !== undefined) params[key] = args[key];
        }

        const result = asRecord(await gateway.call('chat.startStream', params, { channelAlreadyChecked: true }));
        return buildResult(`Stream open at ts ${result['ts']}. Append with slack_append_stream, then close with slack_stop_stream.`, { channel, ts: result['ts'], thread_ts: args.thread_ts }, config.maxResponseChars);
    }
});

const appendStream = defineTool({
    name: 'slack_append_stream',
    toolset: 'messaging',
    title: 'Append to a streaming message',
    description: 'Add content to an open streaming message. Call repeatedly as text becomes available.',
    inputSchema: z.object({
        channel: channelField,
        ts: z.string().describe('ts returned by slack_start_stream.'),
        markdown_text: z.string().optional().describe('Markdown to append.'),
        chunks: z.array(z.record(z.string(), z.unknown())).optional().describe('Chunk objects to append.')
    }),
    annotations: { readOnly: false },
    handler: async (args, { gateway, config }) => {
        if (args.markdown_text === undefined && args.chunks === undefined) {
            throw new SlackToolError('slack_append_stream needs markdown_text or chunks.');
        }
        const channel = await gateway.resolveWritableChannel(args.channel);
        const params: Record<string, unknown> = { channel, ts: args.ts };
        if (args.markdown_text !== undefined) params['markdown_text'] = args.markdown_text;
        if (args.chunks !== undefined) params['chunks'] = args.chunks;

        await gateway.call('chat.appendStream', params, { channelAlreadyChecked: true });
        return buildResult(`Appended to stream ${args.ts}.`, { channel, ts: args.ts }, config.maxResponseChars);
    }
});

const stopStream = defineTool({
    name: 'slack_stop_stream',
    toolset: 'messaging',
    title: 'Stop a streaming message',
    description: 'Close an open streaming message, optionally replacing its final content with blocks or a last chunk.',
    inputSchema: z.object({
        channel: channelField,
        ts: z.string().describe('ts returned by slack_start_stream.'),
        markdown_text: z.string().optional().describe('Final Markdown to append before closing.'),
        blocks: z.array(z.record(z.string(), z.unknown())).optional().describe('Block Kit blocks to render as the finished message.'),
        metadata: z.record(z.string(), z.unknown()).optional().describe('Message metadata to attach to the finished message.')
    }),
    annotations: { readOnly: false, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        const params: Record<string, unknown> = { channel, ts: args.ts };
        for (const key of ['markdown_text', 'blocks', 'metadata'] as const) {
            if (args[key] !== undefined) params[key] = args[key];
        }

        const result = asRecord(await gateway.call('chat.stopStream', params, { channelAlreadyChecked: true }));
        const message = result['message'] ? compactMessage(asRecord(result['message']), gateway.resolver) : undefined;

        return buildResult(`Stream ${args.ts} closed.`, { channel, ts: args.ts, message }, config.maxResponseChars);
    }
});

export const messagingTools: ToolDefinition[] = [
    sendMessage,
    updateMessage,
    deleteMessage,
    sendEphemeral,
    scheduleMessage,
    listScheduledMessages,
    deleteScheduledMessage,
    getPermalink,
    startStream,
    appendStream,
    stopStream
];
