export type TokenKind = 'bot' | 'user';

/**
 * Methods Slack will not accept a bot token for. Bot tokens are the default
 * everywhere else; routing these to the user token (when one is configured)
 * turns an opaque `not_allowed_token_type` into a working call.
 *
 * Patterns ending in `.*` match a whole family.
 */
const USER_TOKEN_PATTERNS: string[] = [
    'search.*',
    'stars.*',
    'reminders.*',
    'admin.*',
    'users.identity',
    'users.setPhoto',
    'users.deletePhoto',
    'users.setPresence',
    'users.setActive',
    'users.profile.set',
    'users.discoverableContacts.lookup',
    'dnd.setSnooze',
    'dnd.endSnooze',
    'dnd.endDnd',
    'chat.meMessage',
    'files.comments.delete',
    'team.accessLogs',
    'team.integrationLogs',
    'team.billing.info',
    'team.billableInfo',
    'team.preferences.list'
];

/**
 * Methods that need a token this server does not manage at all — an app-level
 * (`xapp-`) token, a configuration token, or a client secret. Reported as an
 * up-front error instead of a confusing Slack rejection.
 */
const UNSUPPORTED_TOKEN_METHODS: Record<string, string> = {
    'apps.connections.open': 'requires an app-level token (xapp-...), which this server does not manage',
    'apps.manifest.create': 'requires an app configuration token',
    'apps.manifest.delete': 'requires an app configuration token',
    'apps.manifest.export': 'requires an app configuration token',
    'apps.manifest.update': 'requires an app configuration token',
    'apps.manifest.validate': 'requires an app configuration token',
    'tooling.tokens.rotate': 'requires a refresh token',
    'oauth.access': 'requires client credentials, not a workspace token',
    'oauth.v2.access': 'requires client credentials, not a workspace token',
    'oauth.v2.exchange': 'requires client credentials, not a workspace token',
    'openid.connect.token': 'requires client credentials, not a workspace token'
};

const compiled = USER_TOKEN_PATTERNS.map((pattern) => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
});

/** The token kind Slack expects for this method. */
export function preferredToken(method: string): TokenKind {
    return compiled.some((re) => re.test(method)) ? 'user' : 'bot';
}

/** Non-undefined when the method needs a credential this server cannot supply. */
export function unsupportedTokenReason(method: string): string | undefined {
    return UNSUPPORTED_TOKEN_METHODS[method];
}
