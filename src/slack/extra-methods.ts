import type { CatalogMethod } from './catalog.js';

/**
 * Methods Slack documents that `@slack/web-api` has no typings for, so the
 * generated catalog cannot see them. They are listed here — without invented
 * argument details — purely so discovery and `slack_call_api` know they exist
 * and can point at the real documentation.
 *
 * Whenever the SDK catches up, the generated entry wins and the duplicate here
 * is dropped at load time. Removing a stale line from this file is safe.
 */
const docs = (method: string): string => `https://docs.slack.dev/reference/methods/${method}`;

function unlisted(method: string, description: string): CatalogMethod {
    return {
        method,
        family: method.split('.')[0] ?? method,
        description,
        docUrl: docs(method),
        argsOptional: false,
        cursorPaginated: false,
        args: [],
        argsUnknown: true
    };
}

export const EXTRA_METHODS: CatalogMethod[] = [
    unlisted('assistant.search.context', 'Search messages and files for context to ground an AI assistant answer.'),
    unlisted('assistant.search.info', 'Retrieve details about an assistant search request.'),
    unlisted('apps.activities.list', 'Get logs for an app, for debugging functions and workflows.'),
    unlisted('apps.auth.external.get', 'Get an access token for an external auth provider linked to the app.'),
    unlisted('apps.auth.external.delete', 'Delete a stored external auth token.'),
    unlisted('apps.datastore.get', 'Read one item from an app datastore.'),
    unlisted('apps.datastore.put', 'Create or replace an item in an app datastore.'),
    unlisted('apps.datastore.update', 'Update fields of an item in an app datastore.'),
    unlisted('apps.datastore.delete', 'Delete an item from an app datastore.'),
    unlisted('apps.datastore.query', 'Query an app datastore.'),
    unlisted('apps.datastore.count', 'Count items in an app datastore.'),
    unlisted('apps.datastore.bulkGet', 'Read several app datastore items at once.'),
    unlisted('apps.datastore.bulkPut', 'Write several app datastore items at once.'),
    unlisted('apps.datastore.bulkDelete', 'Delete several app datastore items at once.'),
    unlisted('apps.icon.set', 'Set the app icon.'),
    unlisted('apps.managed.permissions.set', 'Set managed permissions for the app.'),
    unlisted('entity.presentDetails', 'Present entity details in Slack for a work object.'),
    unlisted('entity.presentComments', 'Present entity comments in Slack for a work object.'),
    unlisted('entity.acknowledgeCommentAction', 'Acknowledge a comment action on an entity.'),
    unlisted('functions.distributions.permissions.list', 'List who may use a custom function.'),
    unlisted('functions.distributions.permissions.add', 'Grant use of a custom function.'),
    unlisted('functions.distributions.permissions.remove', 'Revoke use of a custom function.'),
    unlisted('functions.distributions.permissions.set', 'Replace the permission list for a custom function.'),
    unlisted('functions.workflows.steps.list', 'List the steps of a workflow.'),
    unlisted('functions.workflows.steps.responses.export', 'Export the responses collected by a workflow step.'),
    unlisted('users.setActive', 'Mark the calling user as active. Deprecated by Slack.'),
    {
        ...unlisted('files.upload', 'Retired by Slack in March 2025. Use slack_upload_file, which performs the getUploadURLExternal + completeUploadExternal flow.'),
        deprecated: true
    }
];
