import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    clean: true,
    sourcemap: true,
    dts: false,
    // The generated API catalog is a JSON import; bundling inlines it so the
    // published artifact is a single file with no data file to locate.
    banner: { js: '#!/usr/bin/env node' }
});
