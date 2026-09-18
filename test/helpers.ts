import { loadConfig, type Config } from '../src/config.js';

/** A config built from an explicit env, with the defaults a test rarely cares about. */
export function testConfig(overrides: Record<string, string> = {}): Config {
    return loadConfig({
        SLACK_BOT_TOKEN: 'xoxb-test-token',
        SLACK_API_URL: 'https://slack.test/api/',
        ...overrides
    } as NodeJS.ProcessEnv);
}
