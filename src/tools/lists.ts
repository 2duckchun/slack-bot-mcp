import * as z from 'zod';

import { asRecord, buildResult } from '../slack/shape.js';
import { defineTool, type ToolDefinition } from './registry.js';

/**
 * Slack lists are the spreadsheet-like objects introduced alongside canvases.
 * Items are addressed by `list_id` + item `id`, and values are written as
 * `cells` — one entry per column, keyed by the column id from the list schema.
 */
const createList = defineTool({
    name: 'slack_create_list',
    toolset: 'lists',
    title: 'Create a Slack list',
    description: 'Create a list. Pass a schema to define columns, or copy_from_list_id to clone an existing list\'s structure. Lists require a paid Slack plan.',
    inputSchema: z.object({
        name: z.string().describe('List name.'),
        description_blocks: z.array(z.record(z.string(), z.unknown())).optional().describe('Rich text blocks describing the list.'),
        schema: z.array(z.record(z.string(), z.unknown())).optional().describe('Column definitions: [{ key, name, type, options? }]. Types include text, number, date, select, user, channel, checkbox.'),
        copy_from_list_id: z.string().optional().describe('Clone the schema of this list instead of defining one.'),
        todo_mode: z.boolean().optional().describe('Create it as a to-do list.')
    }),
    annotations: { readOnly: false },
    handler: async (args, { gateway, config }) => {
        const params: Record<string, unknown> = { name: args.name };
        for (const key of ['description_blocks', 'schema', 'copy_from_list_id', 'todo_mode'] as const) {
            if (args[key] !== undefined) params[key] = args[key];
        }

        const result = asRecord(await gateway.call('slackLists.create', params));
        return buildResult(`List "${args.name}" created.`, { list_id: result['list_id'] ?? asRecord(result['list'])['id'], name: args.name }, config.maxResponseChars);
    }
});

const listListItems = defineTool({
    name: 'slack_list_list_items',
    toolset: 'lists',
    title: 'Read list items',
    description: 'Read the rows of a Slack list, including each row\'s cell values.',
    inputSchema: z.object({
        list_id: z.string().describe('List ID (F…).'),
        archived: z.boolean().optional().describe('Return archived items instead of active ones.'),
        max_items: z.number().int().min(1).max(2000).default(200).describe('Ceiling on items returned across pages.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const params: Record<string, unknown> = { list_id: args.list_id, limit: 100 };
        if (args.archived !== undefined) params['archived'] = args.archived;

        const page = await gateway.paginate<Record<string, unknown>>('slackLists.items.list', params, { itemsKey: 'items', maxItems: args.max_items });

        return buildResult(`${page.items.length} item(s) in list ${args.list_id}.`, { list_id: args.list_id, items: page.items, next_cursor: page.nextCursor }, config.maxResponseChars);
    }
});

const createListItem = defineTool({
    name: 'slack_create_list_item',
    toolset: 'lists',
    title: 'Add a list item',
    description: 'Add a row to a Slack list. initial_fields sets the starting cell values, keyed by the column ids in the list schema.',
    inputSchema: z.object({
        list_id: z.string().describe('List ID (F…).'),
        initial_fields: z.array(z.record(z.string(), z.unknown())).optional().describe('Starting cells: [{ column_id, text?, value?, user?, select?, date?, ... }].'),
        parent_item_id: z.string().optional().describe('Create this as a sub-item of an existing row.')
    }),
    annotations: { readOnly: false },
    handler: async (args, { gateway, config }) => {
        const params: Record<string, unknown> = { list_id: args.list_id };
        if (args.initial_fields) params['initial_fields'] = args.initial_fields;
        if (args.parent_item_id) params['parent_item_id'] = args.parent_item_id;

        const result = asRecord(await gateway.call('slackLists.items.create', params));
        return buildResult(`Item added to list ${args.list_id}.`, { list_id: args.list_id, item: result['item'] ?? result['id'] }, config.maxResponseChars);
    }
});

const updateListItem = defineTool({
    name: 'slack_update_list_item',
    toolset: 'lists',
    title: 'Update list cells',
    description: 'Change cell values on one or more rows of a Slack list.',
    inputSchema: z.object({
        list_id: z.string().describe('List ID (F…).'),
        cells: z.array(z.record(z.string(), z.unknown())).min(1).describe('Cells to write: [{ row_id, column_id, text?/value?/user?/select?/date? }].')
    }),
    annotations: { readOnly: false, idempotent: true },
    handler: async (args, { gateway, config }) => {
        await gateway.call('slackLists.items.update', { list_id: args.list_id, cells: args.cells });
        return buildResult(`Updated ${args.cells.length} cell(s) in list ${args.list_id}.`, { list_id: args.list_id, cells_written: args.cells.length }, config.maxResponseChars);
    }
});

export const listTools: ToolDefinition[] = [createList, listListItems, createListItem, updateListItem];
