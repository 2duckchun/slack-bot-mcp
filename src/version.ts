import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Reads the version from package.json.
 *
 * One directory up is the package root whether this runs from source
 * (`src/index.ts`) or from the bundle (`dist/index.js`), so a single path
 * covers both. A version string is not worth crashing over, so a failure falls
 * back quietly.
 */
function readVersion(): string {
    try {
        const path = fileURLToPath(new URL('../package.json', import.meta.url));
        const pkg: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (typeof pkg === 'object' && pkg !== null && 'version' in pkg) {
            const { version } = pkg as { version: unknown };
            if (typeof version === 'string') return version;
        }
    } catch {
        // Ignored — fall through to the default below.
    }
    return '0.0.0';
}

export const SERVER_VERSION = readVersion();
