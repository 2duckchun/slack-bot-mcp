import { McpServer } from '@modelcontextprotocol/server';

import type { Config } from './config.js';
import { loadCatalog } from './slack/catalog.js';
import { SlackGateway } from './slack/client.js';
import { assistantTools } from './tools/assistant.js';
import { canvasTools } from './tools/canvas.js';
import { conversationTools } from './tools/conversations.js';
import { coreTools } from './tools/core.js';
import { fileTools } from './tools/files.js';
import { listTools } from './tools/lists.js';
import { messagingTools } from './tools/messaging.js';
import { reactionTools } from './tools/reactions.js';
import { registerTools, type RegistrationSummary, type ToolDefinition } from './tools/registry.js';
import { userTools } from './tools/users.js';
import { viewTools } from './tools/views.js';
import { workspaceTools } from './tools/workspace.js';
import { SERVER_VERSION } from './version.js';

export const ALL_TOOLS: ToolDefinition[] = [
    ...coreTools,
    ...messagingTools,
    ...conversationTools,
    ...userTools,
    ...reactionTools,
    ...fileTools,
    ...workspaceTools,
    ...canvasTools,
    ...listTools,
    ...assistantTools,
    ...viewTools
];

export const SERVER_NAME = 'slack-bot-mcp';

export interface CreatedServer {
    server: McpServer;
    gateway: SlackGateway;
    summary: RegistrationSummary;
}

/**
 * Builds the MCP server for a configuration. Transport-independent on purpose:
 * `index.ts` serves this over stdio today, and an HTTP entry point would reuse
 * it unchanged.
 */
export function createServer(config: Config): CreatedServer {
    const gateway = new SlackGateway(config);
    const catalog = loadCatalog();

    const server = new McpServer(
        { name: SERVER_NAME, version: SERVER_VERSION },
        {
            instructions: [
                `Slack Web API access for a Slack bot. ${catalog.methodCount} API methods are reachable.`,
                'Dedicated slack_* tools cover the common surface and return compact results — prefer them.',
                'For anything else, use slack_list_api_methods to find the method, slack_describe_api_method for its arguments, then slack_call_api to run it.',
                'Channel and user arguments accept IDs, #channel-names, @handles, or email addresses.',
                config.readOnly ? 'This server is in read-only mode: no tool will modify the workspace.' : 'Writes are enabled; posting, editing, and deleting are real and visible to the workspace.'
            ].join(' ')
        }
    );

    const summary = registerTools(server, ALL_TOOLS, { gateway, config });
    return { server, gateway, summary };
}
