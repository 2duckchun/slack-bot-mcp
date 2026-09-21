import * as z from 'zod';

import { getMethod, loadCatalog, searchMethods, suggestMethods } from '../slack/catalog.js';
import { SlackToolError } from '../slack/errors.js';
import { isReadMethod } from '../slack/policy.js';
import { asRecord, buildResult } from '../slack/shape.js';
import { unsupportedReason } from '../slack/unsupported.js';
import { defineTool, type ToolDefinition } from './registry.js';

const listApiMethods = defineTool({
    name: 'slack_list_api_methods',
    toolset: 'core',
    title: 'List Slack API methods',
    description: [
        'Search every method of the Slack Web API, including ones this server has no dedicated tool for.',
        'Use this to discover a capability, then slack_describe_api_method for its arguments and slack_call_api to run it.',
        'Prefer a dedicated slack_* tool when one exists — they return compact, pre-shaped results.'
    ].join(' '),
    inputSchema: z.object({
        query: z.string().optional().describe('Substring matched against method names first, then descriptions. e.g. "canvas", "upload", "reminder".'),
        family: z.string().optional().describe('Restrict to one family, e.g. "chat", "conversations", "canvases", "slackLists", "assistant".'),
        limit: z.number().int().min(1).max(200).default(50).describe('Maximum methods to return.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { config }) => {
        const catalog = loadCatalog();
        const options: Parameters<typeof searchMethods>[0] = { limit: args.limit };
        if (args.query) options.query = args.query;
        if (args.family) options.family = args.family;

        const matches = searchMethods(options);
        const methods = matches.map((method) => ({
            method: method.method,
            description: method.description,
            writes: !isReadMethod(method.method),
            paginated: method.cursorPaginated || undefined,
            // Present only on methods a bot token cannot reach, so the model
            // does not spend a turn discovering the refusal by calling them.
            unavailable: unsupportedReason(method.method)
        }));

        const summary = args.query || args.family ? `${methods.length} of ${catalog.methodCount} Slack API methods match.` : `Slack API has ${catalog.methodCount} methods across ${catalog.families.length} families; showing ${methods.length}.`;

        return buildResult(summary, { families: catalog.families, methods }, config.maxResponseChars);
    }
});

const describeApiMethod = defineTool({
    name: 'slack_describe_api_method',
    toolset: 'core',
    title: 'Describe a Slack API method',
    description: 'Show the arguments, types, and documentation link for one Slack Web API method, so it can be called correctly through slack_call_api.',
    inputSchema: z.object({
        method: z.string().describe('Exact method name, e.g. "chat.postMessage", "canvases.edit", "slackLists.items.create".')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { config }) => {
        const method = getMethod(args.method);
        if (!method) {
            throw new SlackToolError(`Unknown Slack API method "${args.method}". Closest matches: ${suggestMethods(args.method).join(', ')}. Use slack_list_api_methods to browse.`);
        }

        const payload: Record<string, unknown> = {
            method: method.method,
            description: method.description,
            docs: method.docUrl,
            writes: !isReadMethod(method.method),
            cursor_paginated: method.cursorPaginated,
            arguments_optional: method.argsOptional,
            arguments: method.args
        };
        if (method.requiredOneOf) payload['requires_one_of'] = method.requiredOneOf;
        if (method.deprecated) payload['deprecated'] = true;

        const unavailable = unsupportedReason(method.method);
        if (unavailable) payload['unavailable'] = unavailable;
        if (method.argsUnknown) {
            payload['arguments_note'] = 'Slack documents this method but the local typings do not describe its arguments. Follow the docs link and pass params through slack_call_api.';
        }

        const required = method.args.filter((arg) => arg.required).map((arg) => arg.name);
        const summary = unavailable
            ? `${method.method} ${unavailable}.`
            : method.argsUnknown
            ? `${method.method} — argument details are not available locally; see ${method.docUrl}.`
            : `${method.method} — ${method.args.length} arguments${required.length > 0 ? `, required: ${required.join(', ')}` : ''}.`;

        return buildResult(summary, payload, config.maxResponseChars);
    }
});

const callApi = defineTool({
    name: 'slack_call_api',
    toolset: 'core',
    title: 'Call any Slack API method',
    description: [
        'Escape hatch: call any Slack Web API method by name with a raw parameter object.',
        'Covers every method that has no dedicated tool here — canvases, lists, workflows, calls, and anything Slack ships next.',
        'Call slack_describe_api_method first to get the argument names right. Responses are returned as Slack sends them, so prefer a dedicated tool when one exists.'
    ].join(' '),
    inputSchema: z.object({
        method: z.string().describe('Exact method name, e.g. "reminders.add", "canvases.edit".'),
        params: z.record(z.string(), z.unknown()).default({}).describe('Arguments as a JSON object, exactly as Slack documents them.'),
        auto_paginate: z.boolean().default(false).describe('Follow cursors and merge pages. Only valid for cursor-paginated methods.'),
        items_key: z.string().optional().describe('With auto_paginate, the response key holding the items, e.g. "channels", "members", "messages".'),
        max_items: z.number().int().min(1).max(5000).default(500).describe('With auto_paginate, the ceiling on collected items.')
    }),
    annotations: { readOnly: false, destructive: true, enforcesReadOnlyItself: true },
    handler: async (args, { gateway, config }) => {
        const requested = args.method.trim();
        if (!/^[a-zA-Z][\w.]*$/.test(requested)) {
            throw new SlackToolError(`"${args.method}" is not a Slack method name. Expected something like "chat.postMessage".`);
        }

        // An unlisted name is attempted rather than refused: Slack ships methods
        // faster than the local catalog learns about them, and Slack's own
        // `unknown_method` is a clearer verdict than a guess made here.
        const known = getMethod(requested);
        const method = known?.method ?? requested;

        const params = args.params as Record<string, unknown>;
        // A token belongs to the server's configuration, not to model-supplied arguments.
        if ('token' in params) {
            throw new SlackToolError('Remove "token" from params. The server authenticates with its configured bot token.');
        }

        if (args.auto_paginate) {
            if (known && !known.cursorPaginated) {
                throw new SlackToolError(`${method} is not cursor-paginated; call it without auto_paginate.`);
            }
            if (!args.items_key) {
                throw new SlackToolError(`auto_paginate needs items_key — the response field holding the items for ${method}.`);
            }

            const page = await gateway.paginate<unknown>(method, params, {
                itemsKey: args.items_key,
                maxItems: args.max_items
            });

            return buildResult(
                `${method}: collected ${page.items.length} items over ${page.pages} page(s)${page.nextCursor ? '; more remain' : ''}.`,
                { method, items: page.items, pages: page.pages, next_cursor: page.nextCursor },
                config.maxResponseChars
            );
        }

        let result: Awaited<ReturnType<typeof gateway.call>>;
        try {
            result = await gateway.call(method, params);
        } catch (error) {
            if (!known && error instanceof SlackToolError && error.slackError === 'unknown_method') {
                throw new SlackToolError(`Slack does not recognise "${method}". Closest known methods: ${suggestMethods(method).join(', ')}.`);
            }
            throw error;
        }

        // `ok` adds nothing once the call has succeeded.
        const { ok: _ok, response_metadata, ...rest } = asRecord(result);
        const payload: Record<string, unknown> = { method, ...rest };
        if (response_metadata) payload['response_metadata'] = response_metadata;

        return buildResult(`${method} succeeded.`, payload, config.maxResponseChars);
    }
});

const whoami = defineTool({
    name: 'slack_auth_test',
    toolset: 'core',
    title: 'Check Slack authentication',
    description: 'Report which bot the configured token belongs to, and which workspace. Use this first when a call fails with an auth or permission error.',
    inputSchema: z.object({}),
    annotations: { readOnly: true, idempotent: true },
    handler: async (_args, { gateway, config }) => {
        const bot = asRecord(await gateway.whoami());
        const catalog = loadCatalog();

        return buildResult(
            `Authenticated as ${bot['user'] ?? 'the bot'} in ${bot['team'] ?? 'the workspace'}.`,
            {
                bot: { user_id: bot['user_id'], user: bot['user'], bot_id: bot['bot_id'], team: bot['team'], team_id: bot['team_id'], url: bot['url'] },
                server: {
                    toolsets: [...config.toolsets],
                    read_only: config.readOnly,
                    allowed_channels: config.allowedChannels.size > 0 ? [...config.allowedChannels] : 'all',
                    api_catalog: `${catalog.methodCount} methods from ${catalog.source.package}@${catalog.source.version}`
                }
            },
            config.maxResponseChars
        );
    }
});

export const coreTools: ToolDefinition[] = [whoami, listApiMethods, describeApiMethod, callApi];
