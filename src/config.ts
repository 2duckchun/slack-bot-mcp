import * as z from 'zod';

/**
 * Tool groups. Everything outside `DEFAULT_TOOLSETS` is opt-in so a default
 * install does not spend thousands of context tokens on tools the host will
 * never call.
 */
export const TOOLSETS = ['core', 'messaging', 'conversations', 'users', 'reactions', 'files', 'workspace', 'canvas', 'lists', 'assistant', 'views'] as const;

export type Toolset = (typeof TOOLSETS)[number];

export const DEFAULT_TOOLSETS: Toolset[] = ['core', 'messaging', 'conversations', 'users', 'reactions', 'files', 'workspace'];

/**
 * Methods refused by default because a bot token that can reach them can also
 * lock its own workspace out. Override with `SLACK_MCP_DENIED_METHODS`.
 */
export const DEFAULT_DENIED_METHODS = ['auth.revoke', 'apps.uninstall', 'tooling.tokens.rotate', 'oauth.*', 'openid.*', 'migration.exchange'];

const csv = (value: string): string[] =>
    value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);

const boolish = z
    .string()
    .optional()
    .transform((value) => value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()));

const EnvSchema = z.object({
    SLACK_BOT_TOKEN: z.string().min(1).optional(),
    SLACK_MCP_TOOLSETS: z.string().optional(),
    SLACK_MCP_READ_ONLY: boolish,
    SLACK_MCP_ALLOWED_CHANNELS: z.string().optional(),
    SLACK_MCP_ALLOWED_METHODS: z.string().optional(),
    SLACK_MCP_DENIED_METHODS: z.string().optional(),
    SLACK_MCP_MAX_RESPONSE_CHARS: z.coerce.number().int().positive().default(40_000),
    SLACK_MCP_TEAM_ID: z.string().optional(),
    SLACK_API_URL: z.string().url().optional()
});

export interface Config {
    botToken: string;
    /** Only tools annotated `readOnlyHint` are registered, and writes are refused. */
    readOnly: boolean;
    toolsets: Set<Toolset>;
    /** Channel IDs or `#names` that writes are confined to. Empty means no restriction. */
    allowedChannels: Set<string>;
    /** When non-empty, only matching methods may be called. */
    allowedMethods: RegExp[];
    deniedMethods: RegExp[];
    maxResponseChars: number;
    teamId?: string;
    slackApiUrl?: string;
}

/** Turns `chat.*` / `admin.users.*` style patterns into anchored regexes. */
export function patternToRegExp(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
}

function parseToolsets(raw: string | undefined): Set<Toolset> {
    if (!raw) return new Set(DEFAULT_TOOLSETS);
    const requested = csv(raw);
    if (requested.some((name) => name.toLowerCase() === 'all')) return new Set(TOOLSETS);

    const unknown = requested.filter((name) => !TOOLSETS.includes(name as Toolset));
    if (unknown.length > 0) {
        throw new Error(`SLACK_MCP_TOOLSETS contains unknown toolset(s): ${unknown.join(', ')}. Known toolsets: ${TOOLSETS.join(', ')}, or "all".`);
    }

    // `core` carries auth/discovery tools the rest depend on; never drop it.
    return new Set<Toolset>(['core', ...(requested as Toolset[])]);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const parsed = EnvSchema.safeParse(env);
    if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
        throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    const e = parsed.data;

    if (!e.SLACK_BOT_TOKEN) {
        throw new Error('Set SLACK_BOT_TOKEN (xoxb-...). This server authenticates as a bot and accepts no other credential.');
    }

    const config: Config = {
        botToken: e.SLACK_BOT_TOKEN,
        readOnly: e.SLACK_MCP_READ_ONLY,
        toolsets: parseToolsets(e.SLACK_MCP_TOOLSETS),
        allowedChannels: new Set(csv(e.SLACK_MCP_ALLOWED_CHANNELS ?? '')),
        allowedMethods: csv(e.SLACK_MCP_ALLOWED_METHODS ?? '').map(patternToRegExp),
        deniedMethods: (e.SLACK_MCP_DENIED_METHODS ? csv(e.SLACK_MCP_DENIED_METHODS) : DEFAULT_DENIED_METHODS).map(patternToRegExp),
        maxResponseChars: e.SLACK_MCP_MAX_RESPONSE_CHARS
    };

    if (e.SLACK_MCP_TEAM_ID) config.teamId = e.SLACK_MCP_TEAM_ID;
    if (e.SLACK_API_URL) config.slackApiUrl = e.SLACK_API_URL;

    return config;
}
