import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXTRA_METHODS } from './extra-methods.js';

/**
 * The generated index of the Slack Web API. Produced by `scripts/gen-catalog.ts`
 * from the `@slack/web-api` type declarations — see that file for why the
 * published OpenAPI spec is not used.
 *
 * Read from disk rather than `import ... with { type: 'json' }` so `tsc` does
 * not have to infer a type for a 300 KB literal on every typecheck.
 */
export interface CatalogArg {
    name: string;
    type: string;
    required: boolean;
    description?: string;
}

export interface CatalogMethod {
    method: string;
    family: string;
    description?: string;
    docUrl?: string;
    argsOptional: boolean;
    cursorPaginated: boolean;
    args: CatalogArg[];
    /** Mutually exclusive argument shapes; each entry is one valid combination. */
    requiredOneOf?: string[][];
    /** Slack documents the method but no local typings describe its arguments. */
    argsUnknown?: boolean;
    /** Slack has retired the method. */
    deprecated?: boolean;
}

export interface Catalog {
    source: { package: string; version: string };
    methodCount: number;
    families: string[];
    methods: CatalogMethod[];
}

let cached: Catalog | undefined;
let byName: Map<string, CatalogMethod> | undefined;

export function loadCatalog(): Catalog {
    if (cached) return cached;

    const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'generated', 'catalog.json');
    const generated = JSON.parse(readFileSync(path, 'utf8')) as Catalog;

    // Hand-listed methods fill the gap where the SDK has no typings yet; a
    // generated entry of the same name always wins.
    const known = new Set(generated.methods.map((method) => method.method));
    const methods = [...generated.methods, ...EXTRA_METHODS.filter((method) => !known.has(method.method))].sort((a, b) => a.method.localeCompare(b.method));

    cached = {
        ...generated,
        methodCount: methods.length,
        families: [...new Set(methods.map((method) => method.family))].sort(),
        methods
    };
    byName = new Map(methods.map((method) => [method.method.toLowerCase(), method]));
    return cached;
}

export function getMethod(method: string): CatalogMethod | undefined {
    loadCatalog();
    return byName?.get(method.trim().toLowerCase());
}

export interface SearchOptions {
    family?: string;
    query?: string;
    limit?: number;
}

/**
 * Ranked lookup over the catalog. Exact and prefix matches on the method name
 * outrank substring hits, which in turn outrank description-only hits, so
 * `query: "upload"` surfaces `files.getUploadURLExternal` above a method that
 * merely mentions uploading.
 */
export function searchMethods({ family, query, limit = 50 }: SearchOptions): CatalogMethod[] {
    const catalog = loadCatalog();
    const needle = query?.trim().toLowerCase();
    const wantedFamily = family?.trim().toLowerCase();

    const scored: Array<{ method: CatalogMethod; score: number }> = [];
    for (const method of catalog.methods) {
        if (wantedFamily && method.family.toLowerCase() !== wantedFamily) continue;

        if (!needle) {
            scored.push({ method, score: 0 });
            continue;
        }

        const name = method.method.toLowerCase();
        const description = method.description?.toLowerCase() ?? '';
        let score: number | undefined;
        if (name === needle) score = 0;
        else if (name.startsWith(needle)) score = 1;
        else if (name.includes(needle)) score = 2;
        else if (description.includes(needle)) score = 3;

        if (score !== undefined) scored.push({ method, score });
    }

    scored.sort((a, b) => a.score - b.score || a.method.method.localeCompare(b.method.method));
    return scored.slice(0, limit).map((entry) => entry.method);
}

/** Method names closest to a typo, used to make "unknown method" errors actionable. */
export function suggestMethods(method: string, limit = 5): string[] {
    const catalog = loadCatalog();
    const needle = method.trim().toLowerCase();
    const [family] = needle.split('.');

    const sameFamily = catalog.methods.filter((m) => m.family.toLowerCase() === family);
    const pool = sameFamily.length > 0 ? sameFamily : catalog.methods;

    return pool
        .map((m) => ({ name: m.method, distance: editDistance(needle, m.method.toLowerCase()) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit)
        .map((entry) => entry.name);
}

function editDistance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min((current[j - 1] ?? 0) + 1, (previous[j] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
        }
        previous = current;
    }
    return previous[b.length] ?? Number.MAX_SAFE_INTEGER;
}
