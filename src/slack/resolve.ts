import type { WebClient } from '@slack/web-api';

import { SlackToolError } from './errors.js';
import { asRecord } from './shape.js';

const CHANNEL_ID = /^[CGD][A-Z0-9]{2,}$/i;
const USER_ID = /^[UW][A-Z0-9]{2,}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CACHE_TTL_MS = 10 * 60 * 1000;

interface Entry {
    id: string;
    name: string;
}

/**
 * Translates the identifiers a person would type — `#general`, `@sujin`,
 * `kim@example.com` — into the `C…`/`U…` IDs almost every Web API method
 * demands, and back again for display.
 *
 * Directory lookups are expensive on large workspaces, so each direction is
 * cached and the full channel/user listing is only paged in when a name that
 * is not already known needs resolving.
 */
export class Resolver {
    #channelsByName = new Map<string, Entry>();
    #channelsById = new Map<string, Entry>();
    #usersByName = new Map<string, Entry>();
    #usersById = new Map<string, Entry>();
    #channelsLoadedAt = 0;
    #usersLoadedAt = 0;

    constructor(
        private readonly client: WebClient,
        private readonly teamId?: string
    ) {}

    /** Accepts `C0123ABCD`, `#general`, or `general`. */
    async channelId(input: string): Promise<string> {
        const value = input.trim();
        if (CHANNEL_ID.test(value)) return value;

        const name = value.replace(/^#/, '').toLowerCase();
        if (!name) throw new SlackToolError('Channel is empty. Pass a channel ID (C…) or a #name.');

        const hit = this.#channelsByName.get(name);
        if (hit) return hit.id;

        await this.#loadChannels();
        const resolved = this.#channelsByName.get(name);
        if (!resolved) {
            throw new SlackToolError(
                `No channel named "#${name}" is visible to this token. Use slack_list_channels to see what is reachable; private channels require the bot to be a member.`,
                { slackError: 'channel_not_found' }
            );
        }
        return resolved.id;
    }

    /** Accepts `U0123ABCD`, `@sujin`, `sujin`, or an email address. */
    async userId(input: string): Promise<string> {
        const value = input.trim();
        if (USER_ID.test(value)) return value;

        if (EMAIL.test(value)) {
            const result = await this.client.users.lookupByEmail({ email: value });
            const id = (result.user as { id?: string } | undefined)?.id;
            if (!id) throw new SlackToolError(`No user found for email ${value}.`, { slackError: 'users_not_found' });
            this.#rememberUser({ id, name: value });
            return id;
        }

        const name = value.replace(/^@/, '').toLowerCase();
        if (!name) throw new SlackToolError('User is empty. Pass a user ID (U…), an @handle, or an email address.');

        const hit = this.#usersByName.get(name);
        if (hit) return hit.id;

        await this.#loadUsers();
        const resolved = this.#usersByName.get(name);
        if (!resolved) {
            throw new SlackToolError(`No user matches "${name}". Try slack_lookup_user_by_email, or slack_list_users to browse the directory.`, {
                slackError: 'users_not_found'
            });
        }
        return resolved.id;
    }

    /** Best-effort display name for an ID; returns the ID when unknown. */
    channelName(id: string): string {
        return this.#channelsById.get(id)?.name ?? id;
    }

    userName(id: string): string {
        return this.#usersById.get(id)?.name ?? id;
    }

    /** Populates the ID→name direction from data a tool already fetched. */
    rememberChannels(channels: Array<{ id?: string; name?: string }>): void {
        for (const channel of channels) {
            if (channel.id && channel.name) this.#rememberChannel({ id: channel.id, name: channel.name });
        }
    }

    rememberUsers(users: Array<{ id?: string; name?: string; profile?: { display_name?: string; real_name?: string } }>): void {
        for (const user of users) {
            if (!user.id) continue;
            const label = user.profile?.display_name || user.name || user.profile?.real_name;
            if (label) this.#rememberUser({ id: user.id, name: label });
        }
    }

    #rememberChannel(entry: Entry): void {
        this.#channelsById.set(entry.id, entry);
        this.#channelsByName.set(entry.name.toLowerCase(), entry);
    }

    #rememberUser(entry: Entry): void {
        this.#usersById.set(entry.id, entry);
        this.#aliasUser(entry.name, entry.id);
    }

    /** Extra spelling that should resolve to a user, without changing their display name. */
    #aliasUser(alias: string, id: string): void {
        this.#usersByName.set(alias.toLowerCase(), { id, name: alias });
    }

    async #loadChannels(): Promise<void> {
        if (Date.now() - this.#channelsLoadedAt < CACHE_TTL_MS) return;

        const args: Record<string, unknown> = { types: 'public_channel,private_channel', exclude_archived: false, limit: 1000 };
        if (this.teamId) args['team_id'] = this.teamId;

        for await (const page of this.client.paginate('conversations.list', args)) {
            const channels = (asRecord(page)['channels'] ?? []) as Array<{ id?: string; name?: string }>;
            for (const channel of channels) {
                if (channel.id && channel.name) this.#rememberChannel({ id: channel.id, name: channel.name });
            }
        }
        this.#channelsLoadedAt = Date.now();
    }

    async #loadUsers(): Promise<void> {
        if (Date.now() - this.#usersLoadedAt < CACHE_TTL_MS) return;

        const args: Record<string, unknown> = { limit: 1000 };
        if (this.teamId) args['team_id'] = this.teamId;

        for await (const page of this.client.paginate('users.list', args)) {
            const members = (asRecord(page)['members'] ?? []) as Array<{
                id?: string;
                name?: string;
                deleted?: boolean;
                profile?: { display_name?: string; real_name?: string; email?: string };
            }>;
            for (const member of members) {
                if (!member.id || member.deleted) continue;
                const display = member.profile?.display_name || member.name || member.profile?.real_name;
                if (display) this.#rememberUser({ id: member.id, name: display });
                // Index every other handle someone might type for this person.
                for (const alias of [member.name, member.profile?.display_name, member.profile?.real_name, member.profile?.email]) {
                    if (alias) this.#aliasUser(alias, member.id);
                }
            }
        }
        this.#usersLoadedAt = Date.now();
    }
}
