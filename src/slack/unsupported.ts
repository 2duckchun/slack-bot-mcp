import { patternToRegExp } from '../config.js';

/**
 * This server holds exactly one credential: a bot token. Everything Slack will
 * not accept one for is listed here and refused before the call, so the caller
 * gets a reason it can act on instead of an opaque `not_allowed_token_type`.
 *
 * Patterns ending in `.*` match a whole family.
 */
const USER_TOKEN_ONLY: string[] = [
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
 * Methods needing a credential no workspace token can stand in for — an
 * app-level (`xapp-`) token, a configuration token, or a client secret.
 */
const OTHER_CREDENTIALS: Record<string, string> = {
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

const USER_TOKEN_MESSAGE = 'is a user-token (xoxp-...) method; this server authenticates as a bot and cannot call it';

const userTokenOnly = USER_TOKEN_ONLY.map(patternToRegExp);

/** Non-undefined when the method needs a credential this server cannot supply. */
export function unsupportedReason(method: string): string | undefined {
    const other = OTHER_CREDENTIALS[method];
    if (other) return other;
    return userTokenOnly.some((pattern) => pattern.test(method)) ? USER_TOKEN_MESSAGE : undefined;
}
