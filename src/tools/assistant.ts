import * as z from 'zod';

import { buildResult } from '../slack/shape.js';
import { defineTool, type ToolDefinition } from './registry.js';

/**
 * The AI-app surface. These only do anything in an assistant thread — the
 * side-panel conversation Slack opens for apps with the assistant feature
 * enabled — so each one takes the channel and thread that identify it.
 */
const channelField = z.string().describe('Channel of the assistant thread: ID or #name.');
const threadField = z.string().describe('thread_ts of the assistant thread.');

const setStatus = defineTool({
    name: 'slack_set_assistant_status',
    toolset: 'assistant',
    title: 'Set assistant thread status',
    description: 'Show a transient status line in an assistant thread, e.g. "searching the handbook…". Set it to an empty string to clear.',
    inputSchema: z.object({
        channel: channelField,
        thread_ts: threadField,
        status: z.string().describe('Status text shown to the user. Empty string clears it.'),
        loading_messages: z.array(z.string()).optional().describe('Messages cycled while the status is showing.')
    }),
    annotations: { readOnly: false, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        const params: Record<string, unknown> = { channel_id: channel, thread_ts: args.thread_ts, status: args.status };
        if (args.loading_messages) params['loading_messages'] = args.loading_messages;

        await gateway.call('assistant.threads.setStatus', params, { channelAlreadyChecked: true });
        return buildResult(args.status ? `Status set to "${args.status}".` : 'Status cleared.', { channel, thread_ts: args.thread_ts, status: args.status }, config.maxResponseChars);
    }
});

const setTitle = defineTool({
    name: 'slack_set_assistant_title',
    toolset: 'assistant',
    title: 'Set assistant thread title',
    description: 'Name an assistant thread so the user can find it again in their history.',
    inputSchema: z.object({ channel: channelField, thread_ts: threadField, title: z.string().describe('Thread title.') }),
    annotations: { readOnly: false, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        await gateway.call('assistant.threads.setTitle', { channel_id: channel, thread_ts: args.thread_ts, title: args.title }, { channelAlreadyChecked: true });
        return buildResult(`Thread titled "${args.title}".`, { channel, thread_ts: args.thread_ts, title: args.title }, config.maxResponseChars);
    }
});

const setSuggestedPrompts = defineTool({
    name: 'slack_set_suggested_prompts',
    toolset: 'assistant',
    title: 'Set suggested prompts',
    description: 'Offer up to four clickable follow-up prompts in an assistant thread.',
    inputSchema: z.object({
        channel: channelField,
        thread_ts: z.string().optional().describe('Assistant thread. Omit to set the prompts shown on a new thread.'),
        title: z.string().optional().describe('Heading shown above the prompts.'),
        prompts: z
            .array(z.object({ title: z.string().describe('Short label on the button.'), message: z.string().describe('Text sent when the user clicks it.') }))
            .min(1)
            .max(4)
            .describe('One to four prompts.')
    }),
    annotations: { readOnly: false, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const channel = await gateway.resolveWritableChannel(args.channel);
        const params: Record<string, unknown> = { channel_id: channel, prompts: args.prompts };
        if (args.thread_ts) params['thread_ts'] = args.thread_ts;
        if (args.title) params['title'] = args.title;

        await gateway.call('assistant.threads.setSuggestedPrompts', params, { channelAlreadyChecked: true });
        return buildResult(`${args.prompts.length} suggested prompt(s) set.`, { channel, thread_ts: args.thread_ts, prompts: args.prompts }, config.maxResponseChars);
    }
});

export const assistantTools: ToolDefinition[] = [setStatus, setTitle, setSuggestedPrompts];
