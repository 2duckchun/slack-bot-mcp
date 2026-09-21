import type { McpServer } from '@modelcontextprotocol/server';
import type * as z from 'zod';

import type { Config, Toolset } from '../config.js';
import type { SlackGateway } from '../slack/client.js';
import { toSlackToolError } from '../slack/errors.js';
import type { ToolResult } from '../slack/shape.js';

export interface ToolContext {
    gateway: SlackGateway;
    config: Config;
}

export interface ToolAnnotations {
    /** The tool cannot change anything in the workspace. */
    readOnly: boolean;
    /** The tool removes or overwrites something a person may miss. */
    destructive?: boolean;
    /** Calling twice with the same arguments has the same effect as calling once. */
    idempotent?: boolean;
    /**
     * Keep the tool available in read-only mode even though it can write.
     * Only for tools that re-check the read-only gate per call — currently just
     * `slack_call_api`, which would otherwise take every read-only method with
     * it when it is withheld.
     */
    enforcesReadOnlyItself?: boolean;
}

/** A tool after its argument type has been erased, so a mixed array can hold many. */
export interface ToolDefinition {
    name: string;
    toolset: Toolset;
    title: string;
    description: string;
    inputSchema: z.ZodObject<z.ZodRawShape>;
    annotations: ToolAnnotations;
    handler: (args: never, context: ToolContext) => Promise<ToolResult>;
}

/**
 * Declares one tool. The generic keeps `args` fully typed inside the handler
 * while the returned value is type-erased, so modules can export plain arrays
 * of tools with differing argument shapes.
 */
export function defineTool<Shape extends z.ZodRawShape>(def: {
    name: string;
    toolset: Toolset;
    title: string;
    description: string;
    inputSchema: z.ZodObject<Shape>;
    annotations: ToolAnnotations;
    handler: (args: z.output<z.ZodObject<Shape>>, context: ToolContext) => Promise<ToolResult>;
}): ToolDefinition {
    return def as unknown as ToolDefinition;
}

export interface RegistrationSummary {
    registered: string[];
    skippedByToolset: string[];
    skippedByReadOnly: string[];
}

/**
 * Registers the tools this configuration permits. Write tools are withheld
 * entirely in read-only mode rather than registered and then refused — a tool
 * the model cannot see is a tool it cannot waste a turn on.
 */
export function registerTools(server: McpServer, tools: ToolDefinition[], context: ToolContext): RegistrationSummary {
    const summary: RegistrationSummary = { registered: [], skippedByToolset: [], skippedByReadOnly: [] };

    for (const tool of tools) {
        if (!context.config.toolsets.has(tool.toolset)) {
            summary.skippedByToolset.push(tool.name);
            continue;
        }
        if (context.config.readOnly && !tool.annotations.readOnly && !tool.annotations.enforcesReadOnlyItself) {
            summary.skippedByReadOnly.push(tool.name);
            continue;
        }

        server.registerTool(
            tool.name,
            {
                title: tool.title,
                description: tool.description,
                inputSchema: tool.inputSchema,
                annotations: {
                    title: tool.title,
                    readOnlyHint: tool.annotations.readOnly,
                    destructiveHint: tool.annotations.destructive ?? false,
                    idempotentHint: tool.annotations.idempotent ?? false,
                    openWorldHint: true
                }
            },
            async (args: unknown) => {
                try {
                    return await tool.handler(args as never, context);
                } catch (error) {
                    const slackError = toSlackToolError(error, tool.name);
                    return { content: [{ type: 'text' as const, text: slackError.message }], isError: true };
                }
            }
        );

        summary.registered.push(tool.name);
    }

    return summary;
}
