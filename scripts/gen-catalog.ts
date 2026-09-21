/**
 * Generates `src/generated/catalog.json` — the machine-readable index of every
 * Slack Web API method, derived from the TypeScript declarations shipped by
 * `@slack/web-api`.
 *
 * Why not Slack's OpenAPI spec? It is stale: it lists 174 methods and is missing
 * everything added since ~2023 (`chat.startStream`, `canvases.*`, `slackLists.*`,
 * `assistant.*`, `files.getUploadURLExternal`, ...). The SDK's `.d.ts` files, in
 * contrast, track the platform closely and carry per-method and per-argument
 * JSDoc. Bumping `@slack/web-api` and re-running this script is how this server
 * stays current.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type InterfaceDeclaration, Node, Project, type Symbol as TsSymbol, type Type, type TypeAliasDeclaration } from 'ts-morph';

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdkRoot = dirname(require.resolve('@slack/web-api/package.json'));
const sdkVersion = require('@slack/web-api/package.json').version as string;

/** One argument of a Web API method. */
interface CatalogArg {
    name: string;
    type: string;
    required: boolean;
    description?: string;
}

/** One Web API method. */
interface CatalogMethod {
    method: string;
    family: string;
    description?: string;
    docUrl?: string;
    /** True when the whole argument object may be omitted. */
    argsOptional: boolean;
    cursorPaginated: boolean;
    args: CatalogArg[];
    /**
     * Present when the method accepts mutually exclusive argument shapes; each
     * entry lists the fields that one valid shape requires.
     */
    requiredOneOf?: string[][];
}

interface FlattenedArgs {
    args: CatalogArg[];
    requiredOneOf: string[][];
}

const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
        strict: true,
        skipLibCheck: true,
        moduleResolution: 100 /* NodeNext */,
        module: 199 /* NodeNext */,
        target: 9 /* ES2022 */
    }
});

const methodsFile = project.addSourceFileAtPath(join(sdkRoot, 'dist', 'methods.d.ts'));
project.resolveSourceFileDependencies();

const methodsClass = methodsFile.getClassOrThrow('Methods');

/** Collapses the sprawling structural types in the SDK into something readable. */
function simplifyType(text: string): string {
    let out = text
        .replace(/import\("[^"]*"\)\./g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*\|\s*undefined$/, '')
        .trim();
    if (out.length > 140) out = `${out.slice(0, 137)}...`;
    return out;
}

function jsDocTag(node: Node, tagName: string): string | undefined {
    if (!Node.isJSDocable(node)) return undefined;
    for (const doc of node.getJsDocs()) {
        for (const tag of doc.getTags()) {
            if (tag.getTagName() !== tagName) continue;
            const text = tag.getCommentText()?.replace(/\s+/g, ' ').trim();
            if (text) return text;
        }
    }
    return undefined;
}

/** Pulls `https://docs.slack.dev/reference/methods/<name>` out of an `@see` tag. */
function docUrlFrom(node: Node): string | undefined {
    if (!Node.isJSDocable(node)) return undefined;
    for (const doc of node.getJsDocs()) {
        const match = doc.getInnerText().match(/https:\/\/docs\.slack\.dev\/reference\/methods\/[\w.-]+/);
        if (match) return match[0];
    }
    return undefined;
}

/** Description for a node, preferring an explicit `@description` tag. */
function describe(node: Node): string | undefined {
    const tagged = jsDocTag(node, 'description');
    if (tagged) return tagged;
    if (!Node.isJSDocable(node)) return undefined;
    for (const doc of node.getJsDocs()) {
        const text = doc.getCommentText()?.replace(/\s+/g, ' ').trim();
        if (text) return text;
    }
    return undefined;
}

/**
 * Splits a type into the alternative shapes a caller may pass. `OptionalArgument<T>`
 * is `T | undefined`, and several argument types are unions of mutually exclusive
 * shapes (`chat.postMessage` accepts text *or* blocks *or* attachments). A union's
 * own `getProperties()` reports only the common subset, which would hide most
 * fields, so each branch is inspected separately.
 */
function branchesOf(type: Type): Type[] {
    if (!type.isUnion()) return [type];
    const branches: Type[] = [];
    for (const member of type.getUnionTypes()) {
        if (member.isUndefined() || member.isNull() || member.isNever()) continue;
        branches.push(...branchesOf(member));
    }
    return branches.length > 0 ? branches : [type];
}

/**
 * Uses the symbol's optionality flag rather than the declaration's `?` token:
 * mapped types such as `Partial<MarkdownText>` keep pointing at the original
 * (non-optional) declaration, so reading the token would mark those fields
 * required when they are not.
 */
function isRequiredProp(prop: TsSymbol): boolean {
    return !prop.isOptional();
}

/**
 * Reduces the cross-product of union branches to the genuinely distinct
 * either/or groups: fields required everywhere are subtracted (they are already
 * reported as `required`), and any group that merely adds fields on top of a
 * smaller group is dropped. `chat.postMessage` collapses from 16 branches to
 * `text | blocks | attachments | markdown_text`.
 */
function minimalRequirementGroups(requiredPerBranch: string[][], alwaysRequired: Set<string>): string[][] {
    const groups = requiredPerBranch
        .map((names) => names.filter((name) => !alwaysRequired.has(name)).sort())
        .filter((names) => names.length > 0);

    const unique = [...new Map(groups.map((names) => [names.join(' '), names])).values()];
    const minimal = unique.filter((names) => !unique.some((other) => other !== names && other.length < names.length && other.every((name) => names.includes(name))));

    return minimal.length > 1 ? minimal.sort((a, b) => a.join(' ').localeCompare(b.join(' '))) : [];
}

/**
 * Flattens an `*Arguments` type into a field list, following `extends` chains and
 * intersections so mixins like `TokenOverridable` and `CursorPaginationEnabled`
 * contribute their fields. A field counts as required only when every alternative
 * shape requires it; the per-branch requirements are reported separately as
 * `requiredOneOf` so callers can still see the either/or groups.
 */
function flattenArgs(type: Type): FlattenedArgs {
    const branches = branchesOf(type);
    const byName = new Map<string, { prop: TsSymbol; requiredEverywhere: boolean }>();
    const requiredPerBranch: string[][] = [];

    for (const branch of branches) {
        const requiredHere: string[] = [];
        for (const prop of branch.getProperties()) {
            const name = prop.getName();
            const required = isRequiredProp(prop);
            if (required) requiredHere.push(name);
            const existing = byName.get(name);
            if (existing) existing.requiredEverywhere &&= required;
            else byName.set(name, { prop, requiredEverywhere: required });
        }
        requiredPerBranch.push(requiredHere.sort());
    }

    // A field absent from some branch cannot be universally required.
    for (const [name, entry] of byName) {
        if (requiredPerBranch.some((names) => !names.includes(name))) entry.requiredEverywhere = false;
    }

    const args: CatalogArg[] = [];
    for (const [name, { prop, requiredEverywhere }] of byName) {
        const decl = prop.getDeclarations()[0];
        let typeText = 'unknown';
        if (decl) {
            try {
                typeText = simplifyType(prop.getTypeAtLocation(decl).getText(decl));
            } catch {
                typeText = 'unknown';
            }
        }
        const arg: CatalogArg = { name, type: typeText, required: requiredEverywhere };
        const description = decl ? describe(decl) : undefined;
        if (description) arg.description = description;
        args.push(arg);
    }

    args.sort((a, b) => (a.required === b.required ? a.name.localeCompare(b.name) : a.required ? -1 : 1));

    const alwaysRequired = new Set(args.filter((a) => a.required).map((a) => a.name));
    return { args, requiredOneOf: minimalRequirementGroups(requiredPerBranch, alwaysRequired) };
}

/** Resolves an `*Arguments` type name exported from the SDK's request types. */
const argTypeCache = new Map<string, FlattenedArgs>();
function argsForTypeName(typeName: string): FlattenedArgs {
    const cached = argTypeCache.get(typeName);
    if (cached) return cached;

    let resolved: FlattenedArgs = { args: [], requiredOneOf: [] };
    for (const sourceFile of project.getSourceFiles()) {
        if (!sourceFile.getFilePath().includes('/types/request/')) continue;
        const decl: InterfaceDeclaration | TypeAliasDeclaration | undefined = sourceFile.getInterface(typeName) ?? sourceFile.getTypeAlias(typeName);
        if (!decl) continue;
        resolved = flattenArgs(decl.getType());
        break;
    }

    argTypeCache.set(typeName, resolved);
    return resolved;
}

const methods: CatalogMethod[] = [];

/**
 * Walks the nested object literal type of a `Methods` member. Leaves are
 * `MethodWith{Required,Optional}Argument<XArguments, XResponse>` references.
 */
function walk(typeNode: Node | undefined, path: string[], declNode: Node): void {
    if (!typeNode) return;

    if (Node.isTypeReference(typeNode)) {
        const name = typeNode.getTypeName().getText();
        if (name !== 'MethodWithRequiredArgument' && name !== 'MethodWithOptionalArgument') return;

        const argTypeName = typeNode.getTypeArguments()[0]?.getText();
        const flattened = argTypeName ? argsForTypeName(argTypeName) : { args: [], requiredOneOf: [] };
        const entry: CatalogMethod = {
            method: path.join('.'),
            family: path[0] ?? path.join('.'),
            argsOptional: name === 'MethodWithOptionalArgument',
            cursorPaginated: flattened.args.some((a) => a.name === 'cursor'),
            args: flattened.args
        };
        if (flattened.requiredOneOf.length > 0) entry.requiredOneOf = flattened.requiredOneOf;

        const description = describe(declNode);
        if (description) entry.description = description;
        const docUrl = docUrlFrom(declNode);
        if (docUrl) entry.docUrl = docUrl;

        methods.push(entry);
        return;
    }

    if (Node.isTypeLiteral(typeNode)) {
        for (const member of typeNode.getMembers()) {
            if (!Node.isPropertySignature(member)) continue;
            walk(member.getTypeNode(), [...path, member.getName()], member);
        }
    }
}

for (const prop of methodsClass.getProperties()) {
    walk(prop.getTypeNode(), [prop.getName()], prop);
}

methods.sort((a, b) => a.method.localeCompare(b.method));

const catalog = {
    source: { package: '@slack/web-api', version: sdkVersion },
    methodCount: methods.length,
    families: [...new Set(methods.map((m) => m.family))].sort(),
    methods
};

const outPath = join(repoRoot, 'src', 'generated', 'catalog.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`);

const withoutArgs = methods.filter((m) => m.args.length === 0).map((m) => m.method);
console.error(`wrote ${outPath}`);
console.error(`  @slack/web-api@${sdkVersion} -> ${methods.length} methods, ${catalog.families.length} families`);
if (withoutArgs.length > 0) {
    console.error(`  note: ${withoutArgs.length} methods take no arguments: ${withoutArgs.join(', ')}`);
}
