import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';

import * as z from 'zod';

import { SlackToolError } from '../slack/errors.js';
import { asRecord, buildResult, compactFile } from '../slack/shape.js';
import { defineTool, type ToolDefinition } from './registry.js';

const uploadFile = defineTool({
    name: 'slack_upload_file',
    toolset: 'files',
    title: 'Upload a file to Slack',
    description: [
        'Upload a file and optionally share it into a channel or thread.',
        'Pass content for text you already have (logs, snippets, CSV), or file_path to upload a file from the machine this server runs on.',
        'Uses the current three-step upload flow; the retired files.upload endpoint is not involved.'
    ].join(' '),
    inputSchema: z.object({
        filename: z.string().optional().describe('Name shown in Slack, including extension. Defaults to the basename of file_path.'),
        content: z.string().optional().describe('File contents as text. Use for snippets, logs, and generated output.'),
        file_path: z.string().optional().describe('Absolute path on the machine running this server. Use for binaries and existing files.'),
        channel: z.string().optional().describe('Channel to share into: ID or #name. Omit to upload privately to the bot.'),
        thread_ts: z.string().optional().describe('Share as a reply in this thread. Requires channel.'),
        title: z.string().optional().describe('Title shown above the file.'),
        initial_comment: z.string().optional().describe('Message posted alongside the file.'),
        snippet_type: z.string().optional().describe('Syntax highlighting hint for text snippets, e.g. "python", "sql", "diff".')
    }),
    annotations: { readOnly: false },
    handler: async (args, { gateway, config }) => {
        if (args.content === undefined && args.file_path === undefined) {
            throw new SlackToolError('slack_upload_file needs content (text) or file_path (a file on this machine).');
        }
        if (args.content !== undefined && args.file_path !== undefined) {
            throw new SlackToolError('Pass content or file_path, not both.');
        }

        // Uploading is a write; route it through the same gate as a post.
        const channel = args.channel ? await gateway.resolveWritableChannel(args.channel) : undefined;
        if (args.thread_ts && !channel) throw new SlackToolError('thread_ts needs a channel to reply in.');

        const upload: Record<string, unknown> = {};
        let filename = args.filename;

        if (args.file_path !== undefined) {
            const path = isAbsolute(args.file_path) ? args.file_path : resolve(process.cwd(), args.file_path);
            try {
                upload['file'] = await readFile(path);
            } catch (error) {
                throw new SlackToolError(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
            }
            filename ??= basename(path);
        } else {
            upload['content'] = args.content;
            filename ??= 'upload.txt';
        }

        upload['filename'] = filename;
        if (channel) upload['channel_id'] = channel;
        for (const key of ['thread_ts', 'title', 'initial_comment', 'snippet_type'] as const) {
            if (args[key] !== undefined) upload[key] = args[key];
        }

        // `filesUploadV2` is an SDK helper, not an API method; gate on the call it ends with.
        const client = gateway.clientFor('files.completeUploadExternal');
        const result = asRecord(await client.filesUploadV2(upload as never));
        const files = ((result['files'] ?? []) as Array<Record<string, unknown>>).flatMap((entry) => (asRecord(entry)['files'] ?? [entry]) as Array<Record<string, unknown>>);

        return buildResult(
            `Uploaded ${filename}${channel ? ` to ${gateway.resolver.channelName(channel)}` : ' (private to the bot)'}.`,
            { files: files.map(compactFile), channel },
            config.maxResponseChars
        );
    }
});

const getFileInfo = defineTool({
    name: 'slack_get_file_info',
    toolset: 'files',
    title: 'Get file details',
    description: 'Read a file record: name, type, size, permalink, and where it is shared.',
    inputSchema: z.object({ file: z.string().describe('File ID (F…).') }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const result = asRecord(await gateway.call('files.info', { file: args.file }));
        const file = compactFile(asRecord(result['file']));
        return buildResult(`${file.name ?? args.file} (${file.mimetype ?? 'unknown type'}).`, { file, comments_count: result['comments_count'] }, config.maxResponseChars);
    }
});

const listFiles = defineTool({
    name: 'slack_list_files',
    toolset: 'files',
    title: 'List files',
    description: 'Browse files visible to the token, optionally narrowed to a channel, a user, or a time range.',
    inputSchema: z.object({
        channel: z.string().optional().describe('Only files shared in this channel.'),
        user: z.string().optional().describe('Only files uploaded by this user.'),
        types: z.string().optional().describe('Comma-separated filter: all, spaces, snippets, images, gdocs, zips, pdfs.'),
        ts_from: z.string().optional().describe('Unix timestamp lower bound.'),
        ts_to: z.string().optional().describe('Unix timestamp upper bound.'),
        count: z.number().int().min(1).max(200).default(50).describe('Files per page.')
    }),
    annotations: { readOnly: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        const params: Record<string, unknown> = { count: args.count };
        if (args.channel) params['channel'] = await gateway.resolver.channelId(args.channel);
        if (args.user) params['user'] = await gateway.resolver.userId(args.user);
        for (const key of ['types', 'ts_from', 'ts_to'] as const) {
            if (args[key] !== undefined) params[key] = args[key];
        }

        const result = asRecord(await gateway.call('files.list', params));
        const files = ((result['files'] ?? []) as Array<Record<string, unknown>>).map(compactFile);

        return buildResult(`${files.length} file(s).`, { files, paging: result['paging'] }, config.maxResponseChars);
    }
});

const deleteFile = defineTool({
    name: 'slack_delete_file',
    toolset: 'files',
    title: 'Delete a file',
    description: 'Permanently delete a file and every message that shared it. This cannot be undone.',
    inputSchema: z.object({ file: z.string().describe('File ID (F…).') }),
    annotations: { readOnly: false, destructive: true, idempotent: true },
    handler: async (args, { gateway, config }) => {
        await gateway.call('files.delete', { file: args.file });
        return buildResult(`File ${args.file} deleted.`, { file: args.file, deleted: true }, config.maxResponseChars);
    }
});

export const fileTools: ToolDefinition[] = [uploadFile, getFileInfo, listFiles, deleteFile];
