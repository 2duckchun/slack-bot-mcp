import * as z from 'zod';

import { asRecord, buildResult } from '../slack/shape.js';
import { defineTool, type ToolDefinition } from './registry.js';

/**
 * Canvases are markdown documents that live in Slack. Content goes in as a
 * `document_content` object — `{ type: "markdown", markdown: "..." }` — and
 * edits are expressed as a list of operations rather than a whole-document
 * replacement, so `slack_edit_canvas` mirrors that shape directly.
 */
const documentContent = z
    .object({
        type: z.literal('markdown').default('markdown'),
        markdown: z.string().describe('Canvas body in Markdown. Headings, lists, checkboxes, and links are supported.')
    })
    .describe('Canvas content: { "type": "markdown", "markdown": "# Title\\n..." }');

const createCanvas = defineTool({
    name: 'slack_create_canvas',
    toolset: 'canvas',
    title: 'Create a canvas',
    description: 'Create a standalone canvas, or a channel canvas when a channel is given. Canvases require a paid Slack plan.',
    inputSchema: z.object({
        title: z.string().optional().describe('Canvas title. Ignored for channel canvases, which take the channel name.'),
        document_content: documentContent.optional().describe('Initial content. Omit to create an empty canvas.'),
        channel: z.string().optional().describe('Create this channel\'s canvas instead of a standalone one. ID or #name.')
    }),
    annotations: { readOnly: false },
    handler: async (args, { gateway, config }) => {
        const content = args.document_content ? { type: 'markdown', markdown: args.document_content.markdown } : undefined;

        if (args.channel) {
            const channel = await gateway.resolveWritableChannel(args.channel);
            const params: Record<string, unknown> = { channel_id: channel };
            if (content) params['document_content'] = content;
            if (args.title) params['title'] = args.title;

            const result = asRecord(await gateway.call('conversations.canvases.create', params, { channelAlreadyChecked: true }));
            return buildResult(`Channel canvas created for ${gateway.resolver.channelName(channel)}.`, { canvas_id: result['canvas_id'], channel }, config.maxResponseChars);
        }

        const params: Record<string, unknown> = {};
        if (content) params['document_content'] = content;
        if (args.title) params['title'] = args.title;

        const result = asRecord(await gateway.call('canvases.create', params));
        return buildResult(`Canvas ${result['canvas_id']} created.`, { canvas_id: result['canvas_id'], title: args.title }, config.maxResponseChars);
    }
});

const editCanvas = defineTool({
    name: 'slack_edit_canvas',
    toolset: 'canvas',
    title: 'Edit a canvas',
    description: [
        'Apply a list of edit operations to a canvas.',
        'Each change is { operation, document_content, section_id? } where operation is insert_at_start, insert_at_end, insert_after, insert_before, replace, or delete.',
        'Find section IDs with slack_lookup_canvas_sections.'
    ].join(' '),
    inputSchema: z.object({
        canvas_id: z.string().describe('Canvas ID (F…).'),
        changes: z
            .array(
                z.object({
                    operation: z.enum(['insert_after', 'insert_before', 'insert_at_start', 'insert_at_end', 'replace', 'delete']).describe('What to do.'),
                    section_id: z.string().optional().describe('Target section. Required for insert_after, insert_before, replace, and delete.'),
                    document_content: documentContent.optional().describe('New content. Required for every operation except delete.')
                })
            )
            .min(1)
            .describe('Edit operations, applied in order.')
    }),
    annotations: { readOnly: false },
    handler: async (args, { gateway, config }) => {
        const changes = args.changes.map((change) => {
            const entry: Record<string, unknown> = { operation: change.operation };
            if (change.section_id) entry['section_id'] = change.section_id;
            if (change.document_content) entry['document_content'] = { type: 'markdown', markdown: change.document_content.markdown };
            return entry;
        });

        await gateway.call('canvases.edit', { canvas_id: args.canvas_id, changes });
        return buildResult(`Applied ${changes.length} change(s) to canvas ${args.canvas_id}.`, { canvas_id: args.canvas_id, changes_applied: changes.length }, config.maxResponseChars);
    }
});

const lookupCanvasSections = defineTool({
    name: 'slack_lookup_canvas_sections',
    toolset: 'canvas',
    title: 'Find canvas sections',
    description: 'Find section IDs inside a canvas by matching their content — the IDs slack_edit_canvas needs to target an existing part of the document.',
    inputSchema: z.object({
        canvas_id: z.string().describe('Canvas ID (F…).'),
        contains_text: z.string().optional().describe('Match sections containing this text.'),
        section_types: z.array(z.string()).optional().describe('Match section types, e.g. ["h1", "h2", "any_header"].')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const criteria: Record<string, unknown> = {};
        if (args.contains_text) criteria['contains_text'] = args.contains_text;
        if (args.section_types) criteria['section_types'] = args.section_types;

        const result = asRecord(await gateway.call('canvases.sections.lookup', { canvas_id: args.canvas_id, criteria }));
        const sections = (result['sections'] ?? []) as Array<Record<string, unknown>>;

        return buildResult(`${sections.length} matching section(s).`, { canvas_id: args.canvas_id, sections }, config.maxResponseChars);
    }
});

const setCanvasAccess = defineTool({
    name: 'slack_set_canvas_access',
    toolset: 'canvas',
    title: 'Set canvas access',
    description: 'Grant read or write access to a canvas for specific channels or users.',
    inputSchema: z.object({
        canvas_id: z.string().describe('Canvas ID (F…).'),
        access_level: z.enum(['read', 'write']).describe('Level to grant.'),
        channels: z.array(z.string()).optional().describe('Channels to grant access to: IDs or #names.'),
        users: z.array(z.string()).optional().describe('Users to grant access to: IDs, @handles, or emails.')
    }),
    annotations: { readOnly: false, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const params: Record<string, unknown> = { canvas_id: args.canvas_id, access_level: args.access_level };

        if (args.channels?.length) {
            const ids: string[] = [];
            for (const channel of args.channels) ids.push(await gateway.resolver.channelId(channel));
            params['channel_ids'] = ids;
        }
        if (args.users?.length) {
            const ids: string[] = [];
            for (const user of args.users) ids.push(await gateway.resolver.userId(user));
            params['user_ids'] = ids;
        }

        await gateway.call('canvases.access.set', params);
        return buildResult(`Granted ${args.access_level} access on canvas ${args.canvas_id}.`, { canvas_id: args.canvas_id, access_level: args.access_level, channel_ids: params['channel_ids'], user_ids: params['user_ids'] }, config.maxResponseChars);
    }
});

const deleteCanvas = defineTool({
    name: 'slack_delete_canvas',
    toolset: 'canvas',
    title: 'Delete a canvas',
    description: 'Permanently delete a canvas. This cannot be undone.',
    inputSchema: z.object({ canvas_id: z.string().describe('Canvas ID (F…).') }),
    annotations: { readOnly: false, destructive: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        await gateway.call('canvases.delete', { canvas_id: args.canvas_id });
        return buildResult(`Canvas ${args.canvas_id} deleted.`, { canvas_id: args.canvas_id, deleted: true }, config.maxResponseChars);
    }
});

export const canvasTools: ToolDefinition[] = [createCanvas, editCanvas, lookupCanvasSections, setCanvasAccess, deleteCanvas];
