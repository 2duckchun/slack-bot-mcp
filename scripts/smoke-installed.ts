/** Drives an already-installed copy of the server, to prove the bundle is self-contained. */
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const bin = process.argv[2];
if (!bin) throw new Error('usage: tsx scripts/smoke-installed.ts <path-to-installed-bin>');

const client = new Client({ name: 'smoke-installed', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: bin, args: [], env: { ...process.env, SLACK_BOT_TOKEN: 'xoxb-smoke-test', SLACK_MCP_TOOLSETS: 'all' } as Record<string, string> }));

const { tools } = await client.listTools();
console.log(`tools/list           ${tools.length} tools`);
const described = await client.callTool({ name: 'slack_describe_api_method', arguments: { method: 'canvases.edit' } });
console.log(`describe canvases.edit  ${((described.content as Array<{ text?: string }>)[0]?.text ?? '').split('\n')[0]}`);
const listed = await client.callTool({ name: 'slack_list_api_methods', arguments: {} });
console.log(`list_api_methods     ${((listed.content as Array<{ text?: string }>)[0]?.text ?? '').split('\n')[0]}`);
await client.close();
