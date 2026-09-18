import type { Config } from '../config.js';
import { SlackToolError } from './errors.js';

/**
 * Methods whose name reads like an inspection but which change state, and the
 * reverse. Everything else is classified by the verb in its last path segment,
 * failing closed: an unrecognised verb counts as a write, so read-only mode
 * never leaks a mutation through a method this list has not seen.
 */
const FORCE_WRITE = new Set(['files.getUploadURLExternal', 'apps.connections.open', 'oauth.access', 'oauth.v2.access', 'oauth.v2.exchange', 'openid.connect.token']);

const FORCE_READ = new Set(['users.conversations', 'chat.getPermalink', 'chat.scheduledMessages.list', 'canvases.sections.lookup', 'blocks.validate', 'api.test', 'auth.test']);

const READ_PREFIXES = ['list', 'info', 'get', 'search', 'lookup', 'history', 'replies', 'members', 'test', 'export', 'identity', 'validate', 'download'];

const READ_SUFFIXES = ['info', 'list', 'get'];

/** True when calling the method cannot change anything in the workspace. */
export function isReadMethod(method: string): boolean {
    if (FORCE_WRITE.has(method)) return false;
    if (FORCE_READ.has(method)) return true;

    const segment = (method.split('.').pop() ?? '').toLowerCase();
    if (READ_PREFIXES.some((prefix) => segment.startsWith(prefix))) return true;
    return READ_SUFFIXES.some((suffix) => segment.endsWith(suffix));
}

/**
 * Applies every configured gate to a method name. Throws a `SlackToolError`
 * naming the setting responsible, so an operator reading the transcript knows
 * which knob to turn.
 */
export function assertMethodAllowed(method: string, config: Config): void {
    if (method.startsWith('admin.') && !config.enableAdmin) {
        throw new SlackToolError(`${method} is an admin method and is disabled. Set SLACK_MCP_ENABLE_ADMIN=true to allow admin.* calls.`);
    }

    if (config.deniedMethods.some((pattern) => pattern.test(method))) {
        throw new SlackToolError(`${method} is blocked by SLACK_MCP_DENIED_METHODS.`);
    }

    if (config.allowedMethods.length > 0 && !config.allowedMethods.some((pattern) => pattern.test(method))) {
        throw new SlackToolError(`${method} is not in SLACK_MCP_ALLOWED_METHODS.`);
    }

    if (config.readOnly && !isReadMethod(method)) {
        throw new SlackToolError(`${method} modifies the workspace and the server is running in read-only mode (SLACK_MCP_READ_ONLY).`);
    }
}

/**
 * Confines writes to the configured channels. Both the ID and the human name
 * are checked because an operator may have written either into the allowlist.
 */
export function assertChannelAllowed(config: Config, channelId: string, channelName?: string): void {
    if (config.allowedChannels.size === 0) return;

    const candidates = [channelId, channelName, channelName ? `#${channelName}` : undefined].filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase());

    const allowed = [...config.allowedChannels].map((value) => value.toLowerCase().replace(/^#/, ''));
    const matches = candidates.some((candidate) => allowed.includes(candidate.replace(/^#/, '')));

    if (!matches) {
        throw new SlackToolError(`Writing to ${channelName ? `#${channelName}` : channelId} is not permitted: SLACK_MCP_ALLOWED_CHANNELS limits writes to ${[...config.allowedChannels].join(', ')}.`);
    }
}

/** Argument keys that carry a channel a write would land in. */
export const CHANNEL_ARG_KEYS = ['channel', 'channel_id', 'channelId'] as const;
