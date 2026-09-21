import { ErrorCode, type WebAPICallError, type WebAPIPlatformError, type WebAPIRateLimitedError } from '@slack/web-api';

/**
 * An error whose message is written for the model that will read it: it names
 * the Slack error code and, where one exists, the next action that resolves it.
 */
export class SlackToolError extends Error {
    readonly slackError?: string;
    readonly details?: Record<string, unknown>;

    constructor(message: string, options: { slackError?: string; details?: Record<string, unknown> } = {}) {
        super(message);
        this.name = 'SlackToolError';
        if (options.slackError) this.slackError = options.slackError;
        if (options.details) this.details = options.details;
    }
}

/**
 * Fixes for the Slack error codes a bot actually trips over. Anything not
 * listed still surfaces its raw code — the hint is a bonus, not the contract.
 */
const HINTS: Record<string, string> = {
    not_in_channel: 'The bot is not a member of this channel. Call slack_join_channel first (public channels), or invite the bot from Slack (private channels).',
    channel_not_found: 'Unknown channel. Use slack_list_channels to find the ID; private channels and DMs are invisible until the bot is a member.',
    is_archived: 'The channel is archived. Unarchive it before posting.',
    message_not_found: 'No message at that channel + ts. Timestamps are per channel and must be the exact string Slack returned.',
    thread_not_found: 'No thread at that thread_ts. Pass the parent message ts, not a reply ts.',
    user_not_found: 'Unknown user. Use slack_lookup_user_by_email or slack_list_users to get the U... ID.',
    users_not_found: 'One or more users are unknown. Use slack_lookup_user_by_email or slack_list_users to get U... IDs.',
    invalid_auth: 'The token was rejected. Check SLACK_BOT_TOKEN and that the app is still installed.',
    token_revoked: 'The token has been revoked. Reinstall the Slack app and issue a new token.',
    account_inactive: 'The token belongs to a deactivated user or uninstalled app.',
    not_allowed_token_type: 'Slack refused a bot token for this method. It needs a user token (xoxp-...), which this bot-only server does not hold.',
    no_permission: 'The token lacks permission for this method. Usually a missing scope or an admin-only method.',
    restricted_action: 'Workspace settings forbid this action for apps.',
    invalid_blocks: 'Block Kit payload rejected. Run slack_validate_blocks on the blocks array to see which block is wrong.',
    invalid_blocks_format: 'blocks must be a JSON array of Block Kit blocks.',
    msg_too_long: 'Message text exceeds the 40,000 character limit. Split it or attach a file.',
    name_taken: 'That name is already in use in this workspace.',
    cant_update_message: 'Only messages posted by this app can be updated.',
    cant_delete_message: 'Only messages posted by this app can be deleted.',
    already_reacted: 'The bot has already added that reaction.',
    no_reaction: 'That reaction is not present on the message.',
    missing_charset: 'Slack could not determine the request charset — this is an SDK-level issue, please report it.',
    method_deprecated: 'Slack has retired this method. Use slack_list_api_methods to find the current replacement.',
    ekm_access_denied: 'Enterprise Key Management policy blocked the read.',
    team_access_not_granted: 'The token is not authorized for that workspace. Pass the right team_id on an org-wide install.'
};

function isPlatformError(error: unknown): error is WebAPIPlatformError {
    return typeof error === 'object' && error !== null && (error as WebAPICallError).code === ErrorCode.PlatformError;
}

function isRateLimitedError(error: unknown): error is WebAPIRateLimitedError {
    return typeof error === 'object' && error !== null && (error as WebAPICallError).code === ErrorCode.RateLimitedError;
}

/**
 * Converts anything thrown by `@slack/web-api` into a `SlackToolError` whose
 * message includes the failing method, the Slack error code, the scopes Slack
 * says are missing, and a remediation hint when one is known.
 */
export function toSlackToolError(error: unknown, method: string): SlackToolError {
    if (error instanceof SlackToolError) return error;

    if (isRateLimitedError(error)) {
        return new SlackToolError(`${method} was rate limited by Slack. Retry after ${error.retryAfter} seconds.`, {
            slackError: 'ratelimited',
            details: { retryAfter: error.retryAfter }
        });
    }

    if (isPlatformError(error)) {
        const data = error.data as { error?: string; needed?: string; provided?: string; errors?: unknown[]; response_metadata?: { messages?: string[] } };
        const code = data?.error ?? 'unknown_error';

        const parts = [`${method} failed: ${code}`];
        if (code === 'missing_scope' && data.needed) {
            parts.push(`Needs scope(s): ${data.needed}.`);
            if (data.provided) parts.push(`Token has: ${data.provided}.`);
            parts.push('Add the scope in the Slack app config, then reinstall the app.');
        }
        const hint = HINTS[code];
        if (hint) parts.push(hint);

        const messages = data.response_metadata?.messages;
        if (messages?.length) parts.push(`Slack said: ${messages.join(' | ')}`);
        if (Array.isArray(data.errors) && data.errors.length > 0) parts.push(`Details: ${JSON.stringify(data.errors).slice(0, 500)}`);

        const details: Record<string, unknown> = {};
        if (data.needed) details['needed'] = data.needed;
        if (data.provided) details['provided'] = data.provided;
        if (messages?.length) details['messages'] = messages;

        return new SlackToolError(parts.join(' '), { slackError: code, details });
    }

    if (typeof error === 'object' && error !== null && (error as WebAPICallError).code === ErrorCode.HTTPError) {
        const httpError = error as Extract<WebAPICallError, { statusCode: number }>;
        return new SlackToolError(`${method} failed: Slack returned HTTP ${httpError.statusCode}.`);
    }

    const message = error instanceof Error ? error.message : String(error);
    return new SlackToolError(`${method} failed: ${message}`);
}
