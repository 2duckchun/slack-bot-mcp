import { LogLevel, type RetryOptions, type WebAPICallResult, WebClient } from '@slack/web-api';

import type { Config } from '../config.js';
import { SlackToolError, toSlackToolError } from './errors.js';
import { asRecord } from './shape.js';
import { assertChannelAllowed, assertMethodAllowed, isReadMethod } from './policy.js';
import { Resolver } from './resolve.js';
import { preferredToken, type TokenKind, unsupportedTokenReason } from './token-routing.js';

/** Argument keys that name the channel a write would land in. */
const CHANNEL_ARG_KEYS = ['channel', 'channel_id'] as const;

/**
 * The SDK's `fiveRetriesInFiveMinutes`, inlined. Its default policy spans about
 * thirty minutes, far longer than a tool call should block; the constant is
 * copied rather than imported because `@slack/web-api` is CommonJS and Node's
 * ESM interop does not expose `retryPolicies` as a named export.
 */
const RETRY_CONFIG: RetryOptions = { retries: 5, factor: 3.86 };

export interface CallOptions {
    /** Overrides the token this method would normally use. */
    tokenKind?: TokenKind;
    /**
     * Skips the channel allowlist check. Only for calls whose `channel`
     * argument has already been checked by the caller.
     */
    channelAlreadyChecked?: boolean;
}

export interface PaginateOptions extends CallOptions {
    /** Response key holding the page's items, e.g. `members` or `channels`. */
    itemsKey: string;
    /** Hard ceiling on items collected across pages. */
    maxItems: number;
}

export interface PaginateResult<T> {
    items: T[];
    pages: number;
    /** Set when the ceiling was hit before Slack ran out of pages. */
    nextCursor?: string;
}

/**
 * The single door every Slack call goes through: token selection, the
 * configured safety gates, pagination, and error translation all live here so
 * no individual tool can accidentally skip them.
 */
export class SlackGateway {
    readonly resolver: Resolver;

    readonly #bot?: WebClient;
    readonly #user?: WebClient;
    #authCache = new Map<TokenKind, WebAPICallResult>();

    constructor(readonly config: Config) {
        const options = {
            logLevel: LogLevel.ERROR,
            retryConfig: RETRY_CONFIG,
            ...(config.slackApiUrl ? { slackApiUrl: config.slackApiUrl } : {}),
            ...(config.teamId ? { teamId: config.teamId } : {})
        };

        if (config.botToken) this.#bot = new WebClient(config.botToken, options);
        if (config.userToken) this.#user = new WebClient(config.userToken, options);

        const forResolution = this.#bot ?? this.#user;
        if (!forResolution) throw new Error('SlackGateway requires at least one token.');
        this.resolver = new Resolver(forResolution, config.teamId);
    }

    /** The client for a method, honouring Slack's token-type requirements. */
    clientFor(method: string, override?: TokenKind): { client: WebClient; kind: TokenKind } {
        const unsupported = unsupportedTokenReason(method);
        if (unsupported) throw new SlackToolError(`${method} ${unsupported}.`);

        const wanted = override ?? preferredToken(method);

        if (wanted === 'user') {
            if (this.#user) return { client: this.#user, kind: 'user' };
            throw new SlackToolError(`${method} requires a user token. Set SLACK_USER_TOKEN (xoxp-...) with the scopes this method needs.`);
        }

        if (this.#bot) return { client: this.#bot, kind: 'bot' };
        if (this.#user) return { client: this.#user, kind: 'user' };
        throw new SlackToolError('No Slack token is configured.');
    }

    /** Calls any Web API method after applying every configured gate. */
    async call(method: string, args: Record<string, unknown> = {}, options: CallOptions = {}): Promise<WebAPICallResult> {
        assertMethodAllowed(method, this.config);
        if (!options.channelAlreadyChecked) await this.#checkChannelArgs(method, args);

        const { client } = this.clientFor(method, options.tokenKind);
        try {
            return await client.apiCall(method, args);
        } catch (error) {
            throw toSlackToolError(error, method);
        }
    }

    /**
     * Walks a cursor-paginated method until `maxItems` is reached. Returning
     * the cursor rather than silently stopping lets the caller (and the model)
     * see that more data exists.
     */
    async paginate<T>(method: string, args: Record<string, unknown>, options: PaginateOptions): Promise<PaginateResult<T>> {
        assertMethodAllowed(method, this.config);
        if (!options.channelAlreadyChecked) await this.#checkChannelArgs(method, args);

        const { client } = this.clientFor(method, options.tokenKind);
        const items: T[] = [];
        let pages = 0;
        let nextCursor: string | undefined;

        try {
            for await (const page of client.paginate(method, args)) {
                pages += 1;
                const batch = (asRecord(page)[options.itemsKey] ?? []) as T[];
                items.push(...batch);

                const cursor = (asRecord(page)['response_metadata'] as { next_cursor?: string } | undefined)?.next_cursor;
                if (items.length >= options.maxItems) {
                    if (cursor) nextCursor = cursor;
                    break;
                }
                if (!cursor) break;
            }
        } catch (error) {
            throw toSlackToolError(error, method);
        }

        const result: PaginateResult<T> = { items: items.slice(0, options.maxItems), pages };
        if (nextCursor) result.nextCursor = nextCursor;
        return result;
    }

    /** Resolves `#name`/ID to an ID and enforces the write allowlist in one step. */
    async resolveWritableChannel(input: string): Promise<string> {
        const id = await this.resolver.channelId(input);
        assertChannelAllowed(this.config, id, await this.#channelName(id));
        return id;
    }

    /** `auth.test` for a token kind, cached for the process lifetime. */
    async whoami(kind: TokenKind = 'bot'): Promise<WebAPICallResult> {
        const cached = this.#authCache.get(kind);
        if (cached) return cached;

        const { client } = this.clientFor('auth.test', kind);
        try {
            const result = await client.auth.test();
            this.#authCache.set(kind, result);
            return result;
        } catch (error) {
            throw toSlackToolError(error, 'auth.test');
        }
    }

    hasUserToken(): boolean {
        return this.#user !== undefined;
    }

    hasBotToken(): boolean {
        return this.#bot !== undefined;
    }

    /** Applies the channel allowlist to whichever channel argument a write carries. */
    async #checkChannelArgs(method: string, args: Record<string, unknown>): Promise<void> {
        if (this.config.allowedChannels.size === 0) return;
        if (isReadMethod(method)) return;

        for (const key of CHANNEL_ARG_KEYS) {
            const value = args[key];
            if (typeof value !== 'string' || value.length === 0) continue;
            const id = await this.resolver.channelId(value);
            assertChannelAllowed(this.config, id, await this.#channelName(id));
        }

        // `files.completeUploadExternal` and friends take a comma-separated list.
        const channels = args['channels'];
        if (typeof channels === 'string') {
            for (const entry of channels.split(',').map((part) => part.trim())) {
                if (!entry) continue;
                const id = await this.resolver.channelId(entry);
                assertChannelAllowed(this.config, id, await this.#channelName(id));
            }
        }
    }

    /**
     * Name for a channel ID, fetched on demand. Needed because an operator may
     * have written `#general` into the allowlist while the tool was handed a
     * raw `C…` ID that the resolver cache has never seen.
     */
    async #channelName(id: string): Promise<string | undefined> {
        const cached = this.resolver.channelName(id);
        if (cached !== id) return cached;

        try {
            const { client } = this.clientFor('conversations.info');
            const result = await client.conversations.info({ channel: id });
            const name = (result.channel as { name?: string } | undefined)?.name;
            if (name) {
                this.resolver.rememberChannels([{ id, name }]);
                return name;
            }
        } catch {
            // A name we cannot read simply means the allowlist match falls back to the ID.
        }
        return undefined;
    }
}
