import type { Resolver } from './resolve.js';

/**
 * Slack responses are verbose: a single `users.list` page carries icon URLs in
 * eight sizes for every member, and `conversations.history` repeats the full
 * block payload of every message. Handing that to a model burns the context
 * window for no benefit, so each tool projects the handful of fields a caller
 * actually reasons about. The full response is always one `slack_call_api` away.
 */

export interface CompactUser {
    id: string;
    name?: string;
    real_name?: string;
    email?: string;
    title?: string;
    tz?: string;
    is_bot?: boolean;
    is_admin?: boolean;
    deleted?: boolean;
}

export interface CompactChannel {
    id: string;
    name?: string;
    is_private?: boolean;
    is_archived?: boolean;
    is_member?: boolean;
    is_im?: boolean;
    num_members?: number;
    topic?: string;
    purpose?: string;
}

export interface CompactMessage {
    ts: string;
    iso_time?: string;
    user?: string;
    user_name?: string;
    bot_id?: string;
    subtype?: string;
    text?: string;
    thread_ts?: string;
    reply_count?: number;
    reactions?: Array<{ name: string; count: number }>;
    files?: Array<{ id?: string; name?: string; mimetype?: string }>;
    has_blocks?: boolean;
}

export interface CompactFile {
    id?: string;
    name?: string;
    title?: string;
    mimetype?: string;
    size?: number;
    created?: number;
    user?: string;
    permalink?: string;
    channels?: string[];
}

type Raw = Record<string, unknown>;

const str = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined);
const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
const bool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

/** Drops keys whose value is `undefined` so the JSON the model reads stays tight. */
function prune<T extends object>(value: T): T {
    for (const key of Object.keys(value) as Array<keyof T>) {
        if (value[key] === undefined) delete value[key];
    }
    return value;
}

/** Slack timestamps are `"1700000000.000100"` — seconds with a per-channel suffix. */
export function tsToIso(ts: string | undefined): string | undefined {
    if (!ts) return undefined;
    const seconds = Number.parseFloat(ts);
    if (!Number.isFinite(seconds)) return undefined;
    return new Date(seconds * 1000).toISOString();
}

export function compactUser(raw: Raw): CompactUser {
    const profile = (raw['profile'] ?? {}) as Raw;
    return prune({
        id: String(raw['id'] ?? ''),
        name: str(profile['display_name']) ?? str(raw['name']),
        real_name: str(profile['real_name']) ?? str(raw['real_name']),
        email: str(profile['email']),
        title: str(profile['title']),
        tz: str(raw['tz']),
        is_bot: bool(raw['is_bot']),
        is_admin: bool(raw['is_admin']),
        deleted: bool(raw['deleted'])
    });
}

export function compactChannel(raw: Raw): CompactChannel {
    const topic = (raw['topic'] ?? {}) as Raw;
    const purpose = (raw['purpose'] ?? {}) as Raw;
    return prune({
        id: String(raw['id'] ?? ''),
        name: str(raw['name']),
        is_private: bool(raw['is_private']),
        is_archived: bool(raw['is_archived']),
        is_member: bool(raw['is_member']),
        is_im: bool(raw['is_im']),
        num_members: num(raw['num_members']),
        topic: str(topic['value']),
        purpose: str(purpose['value'])
    });
}

export function compactMessage(raw: Raw, resolver?: Resolver): CompactMessage {
    const ts = String(raw['ts'] ?? '');
    const user = str(raw['user']);
    const reactions = raw['reactions'] as Array<Raw> | undefined;
    const files = raw['files'] as Array<Raw> | undefined;
    const blocks = raw['blocks'] as unknown[] | undefined;

    return prune({
        ts,
        iso_time: tsToIso(ts),
        user,
        user_name: user && resolver ? resolver.userName(user) : undefined,
        bot_id: str(raw['bot_id']),
        subtype: str(raw['subtype']),
        text: str(raw['text']),
        thread_ts: str(raw['thread_ts']),
        reply_count: num(raw['reply_count']),
        reactions: reactions?.map((reaction) => ({ name: String(reaction['name']), count: Number(reaction['count'] ?? 0) })),
        files: files?.map((file) => prune({ id: str(file['id']), name: str(file['name']), mimetype: str(file['mimetype']) })),
        has_blocks: blocks && blocks.length > 0 ? true : undefined
    });
}

export function compactFile(raw: Raw): CompactFile {
    return prune({
        id: str(raw['id']),
        name: str(raw['name']),
        title: str(raw['title']),
        mimetype: str(raw['mimetype']),
        size: num(raw['size']),
        created: num(raw['created']),
        user: str(raw['user']),
        permalink: str(raw['permalink']),
        channels: raw['channels'] as string[] | undefined
    });
}

export type ToolResult = {
    content: Array<{ type: 'text'; text: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
};

/** Slack response objects are typed as a closed shape; reading arbitrary keys needs a widen. */
export function asRecord(value: unknown): Record<string, unknown> {
    return (value ?? {}) as Record<string, unknown>;
}

/**
 * Renders a tool's payload once as JSON for the model and once as
 * `structuredContent` for hosts that consume it. Oversized payloads are cut at
 * the configured ceiling with a visible notice, because a silently truncated
 * list reads as a complete one.
 */
export function buildResult(summary: string, data: Record<string, unknown>, maxChars: number): ToolResult {
    const json = JSON.stringify(data, null, 2);
    const body = json.length > maxChars ? `${json.slice(0, maxChars)}\n... [truncated: ${json.length} chars of JSON exceeded SLACK_MCP_MAX_RESPONSE_CHARS=${maxChars}; narrow the query or page through it]` : json;

    return {
        content: [{ type: 'text', text: `${summary}\n\n${body}` }],
        structuredContent: data
    };
}

/** Result for tools whose entire answer is a sentence. */
export function textResult(text: string): ToolResult {
    return { content: [{ type: 'text', text }] };
}
