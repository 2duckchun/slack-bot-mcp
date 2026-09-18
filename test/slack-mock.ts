import { http, HttpResponse, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';

import type { Config } from '../src/config.js';
import { SlackGateway } from '../src/slack/client.js';
import type { ToolResult } from '../src/slack/shape.js';
import { ALL_TOOLS } from '../src/server.js';
import type { ToolContext } from '../src/tools/registry.js';

export const SLACK_API_URL = 'https://slack.test/api/';

export interface RecordedCall {
    method: string;
    params: Record<string, unknown>;
}

type Responder = JsonBodyType | ((params: Record<string, unknown>, callIndex: number) => JsonBodyType);

/**
 * A stand-in Slack. Handlers are registered per method name; anything else
 * answers with `unknown_method`, which is what Slack itself would say.
 */
export class SlackMock {
    readonly calls: RecordedCall[] = [];
    readonly server = setupServer(
        http.post(`${SLACK_API_URL}:method`, async ({ params: pathParams, request }) => {
            const method = String(pathParams['method']);
            const params = await parseSlackBody(request);
            this.calls.push({ method, params });

            const responder = this.#responders.get(method);
            if (!responder) return HttpResponse.json({ ok: false, error: 'unknown_method' });

            const index = this.calls.filter((call) => call.method === method).length - 1;
            const body = typeof responder === 'function' ? responder(params, index) : responder;
            return HttpResponse.json(body as JsonBodyType);
        })
    );

    #responders = new Map<string, Responder>();

    on(method: string, responder: Responder): this {
        this.#responders.set(method, responder);
        return this;
    }

    reset(): void {
        this.calls.length = 0;
        this.#responders.clear();
    }

    /** Every call made to one method, in order. */
    callsTo(method: string): RecordedCall[] {
        return this.calls.filter((call) => call.method === method);
    }

    lastCall(method: string): RecordedCall | undefined {
        return this.callsTo(method).at(-1);
    }
}

/** Slack accepts form-encoded bodies; complex values arrive as JSON strings. */
async function parseSlackBody(request: Request): Promise<Record<string, unknown>> {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
        return (await request.json()) as Record<string, unknown>;
    }

    const text = await request.text();
    const params: Record<string, unknown> = {};
    for (const [key, value] of new URLSearchParams(text)) {
        params[key] = decodeFormValue(value);
    }
    return params;
}

/**
 * Objects, arrays, and booleans are JSON-encoded into the form body by the SDK
 * and are worth decoding. Bare numbers are not: a Slack timestamp like "1.0" is
 * a string on the wire and must stay one, or assertions see `1`.
 */
function decodeFormValue(value: string): unknown {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (!/^[[{]/.test(value)) return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

/** Runs one tool's handler against a gateway pointed at the mock. */
export async function runTool(name: string, args: Record<string, unknown>, config: Config): Promise<ToolResult> {
    const tool = ALL_TOOLS.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`No tool named ${name}`);

    const parsed = tool.inputSchema.parse(args);
    const context: ToolContext = { gateway: new SlackGateway(config), config };
    return tool.handler(parsed as never, context);
}

/** The structured payload a tool returned, for assertions. */
export function structured(result: ToolResult): Record<string, unknown> {
    if (!result.structuredContent) throw new Error('Tool returned no structuredContent');
    return result.structuredContent;
}
