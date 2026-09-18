import * as z from 'zod';

import { SlackToolError } from '../slack/errors.js';
import { asRecord, buildResult } from '../slack/shape.js';
import { defineTool, type ToolDefinition } from './registry.js';

/**
 * Block Kit surfaces. Modals are only openable in response to a user
 * interaction, because Slack requires the short-lived `trigger_id` (or
 * `interactivity_pointer`) that the interaction delivers — this server cannot
 * manufacture one, so these tools are for an agent that already has it.
 */
const viewField = z.record(z.string(), z.unknown()).describe('Block Kit view object: { type: "modal"|"home", title?, blocks, submit?, close?, callback_id? }.');

const validateBlocks = defineTool({
    name: 'slack_validate_blocks',
    toolset: 'views',
    title: 'Validate Block Kit',
    description: 'Check a Block Kit payload against Slack\'s schema without sending it anywhere. Use this when a message or view was rejected with invalid_blocks.',
    inputSchema: z.object({
        blocks: z.array(z.record(z.string(), z.unknown())).optional().describe('Blocks array to validate.'),
        view: z.record(z.string(), z.unknown()).optional().describe('Whole view object to validate instead.'),
        message: z.record(z.string(), z.unknown()).optional().describe('Whole message payload to validate instead.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const params: Record<string, unknown> = {};
        for (const key of ['blocks', 'view', 'message'] as const) {
            if (args[key] !== undefined) params[key] = args[key];
        }
        if (Object.keys(params).length === 0) throw new SlackToolError('Pass blocks, view, or message to validate.');

        // A validation failure is the answer here, not an error to propagate.
        try {
            await gateway.call('blocks.validate', params);
            return buildResult('Valid Block Kit payload.', { valid: true }, config.maxResponseChars);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return buildResult('Block Kit payload is invalid.', { valid: false, error: message }, config.maxResponseChars);
        }
    }
});

const publishHomeView = defineTool({
    name: 'slack_publish_home_view',
    toolset: 'views',
    title: 'Publish an App Home view',
    description: 'Replace the App Home tab a specific user sees. Unlike modals this needs no trigger_id, so it can be called at any time.',
    inputSchema: z.object({
        user: z.string().describe('Whose App Home to update: user ID, @handle, or email.'),
        view: viewField,
        hash: z.string().optional().describe('Hash of the view being replaced, to avoid clobbering a concurrent update.')
    }),
    annotations: { readOnly: false, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const user = await gateway.resolver.userId(args.user);
        const params: Record<string, unknown> = { user_id: user, view: args.view };
        if (args.hash) params['hash'] = args.hash;

        const result = asRecord(await gateway.call('views.publish', params));
        const view = asRecord(result['view']);
        return buildResult(`App Home published for ${gateway.resolver.userName(user)}.`, { user, view_id: view['id'], hash: view['hash'] }, config.maxResponseChars);
    }
});

/** `views.open` and `views.push` differ only in whether they stack. */
function modalTool(name: string, method: 'views.open' | 'views.push', title: string, description: string) {
    return defineTool({
        name,
        toolset: 'views',
        title,
        description,
        inputSchema: z.object({
            view: viewField,
            trigger_id: z.string().optional().describe('trigger_id from the interaction payload. Valid for about 3 seconds.'),
            interactivity_pointer: z.string().optional().describe('Newer alternative to trigger_id, from the interaction payload.')
        }),
        annotations: { readOnly: false },
        handler: async (args, { gateway, config }) => {
            if (!args.trigger_id && !args.interactivity_pointer) {
                throw new SlackToolError(`${name} needs trigger_id or interactivity_pointer from a user interaction. Slack will not open a modal without one.`);
            }
            const params: Record<string, unknown> = { view: args.view };
            if (args.trigger_id) params['trigger_id'] = args.trigger_id;
            if (args.interactivity_pointer) params['interactivity_pointer'] = args.interactivity_pointer;

            const result = asRecord(await gateway.call(method, params));
            const view = asRecord(result['view']);
            return buildResult(`Modal ${view['id']} opened.`, { view_id: view['id'], hash: view['hash'], root_view_id: view['root_view_id'] }, config.maxResponseChars);
        }
    });
}

const openModal = modalTool('slack_open_modal', 'views.open', 'Open a modal', 'Open a modal in response to a user interaction. Requires the trigger_id from that interaction, which expires in about 3 seconds.');

const pushModal = modalTool('slack_push_modal', 'views.push', 'Push a modal', 'Stack a new modal on top of the one already open. Requires a fresh trigger_id from the interaction that requested it.');

const updateModal = defineTool({
    name: 'slack_update_modal',
    toolset: 'views',
    title: 'Update an open modal',
    description: 'Replace the contents of a modal that is already open. Identify it by view_id or by the external_id it was opened with.',
    inputSchema: z.object({
        view: viewField,
        view_id: z.string().optional().describe('ID of the open view.'),
        external_id: z.string().optional().describe('external_id the view was created with, as an alternative to view_id.'),
        hash: z.string().optional().describe('Hash of the view being replaced, to avoid clobbering a concurrent update.')
    }),
    annotations: { readOnly: false, idempotent: true },
    handler: async (args, { gateway, config }) => {
        if (!args.view_id && !args.external_id) throw new SlackToolError('slack_update_modal needs view_id or external_id.');

        const params: Record<string, unknown> = { view: args.view };
        for (const key of ['view_id', 'external_id', 'hash'] as const) {
            if (args[key] !== undefined) params[key] = args[key];
        }

        const result = asRecord(await gateway.call('views.update', params));
        const view = asRecord(result['view']);
        return buildResult(`Modal ${view['id']} updated.`, { view_id: view['id'], hash: view['hash'] }, config.maxResponseChars);
    }
});

export const viewTools: ToolDefinition[] = [validateBlocks, publishHomeView, openModal, pushModal, updateModal];
