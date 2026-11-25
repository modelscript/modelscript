// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Single-Source-of-Truth (SSOT) Example Catalog Compiler
 *
 * Reads canonical multi-file examples from `languages/<slug>/examples/<folder>/`
 * and compiles:
 *   1. `apps/web/src/pages/playground/generated/example-index.generated.json`
 *      (lightweight metadata-only index for instant search, counts, and difficulty filtering)
 *   2. `apps/web/src/pages/playground/generated/chunks/<slug>.json`
 *      (per-language lazy-loaded payloads containing full `code`, `files`, `activeFile`)
 *   3. `apps/web/src/pages/playground/generated/example-loader.ts`
 *      (typed Vite code-split lazy loader)
 *   4. `packages/editor/src/workbench/generated/language-defaults.generated.json`
 *      (verified `defaultCode`, `defaultFiles`, `defaultActiveFile` overrides per language)
 *   5. `packages/ide/src/templates/generated/example-templates.generated.json`
 *      (multi-file VS Code Web IDE workspace descriptors across all languages)
 *   6. `apps/docs/scripts/generated/language-examples-input.generated.json`
 *      (curated per-language docs example specs across all languages)
 *
 * Usage:
 *   npx tsx scripts/build/gen-example-catalog.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExampleDifficulty, LanguageExampleManifest } from "../lint/verify-examples.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

export interface CompiledExampleMetadata {
  id: string;
  lang: string;
  subFormats?: string[] | undefined;
  difficulty: ExampleDifficulty;
  title: string;
  description: string;
  category: string;
  tags: string[];
  activeFile: string;
  fileNames: string[];
  fileCount: number;
  isDefaultStarter?: boolean | undefined;
}

export interface CompiledExamplePayload extends CompiledExampleMetadata {
  code: string;
  files?: Record<string, string> | undefined;
}

export interface CompiledLanguageDefault {
  defaultCode: string;
  defaultFiles?: Record<string, string> | undefined;
  defaultActiveFile?: string | undefined;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function collectFilesRecursive(
  rootDir: string,
  baseDir = rootDir,
  out: Record<string, string> = {},
): Record<string, string> {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "example.json") continue;
    const abs = path.join(rootDir, entry.name);
    const rel = path.relative(baseDir, abs).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      collectFilesRecursive(abs, baseDir, out);
    } else if (entry.isFile()) {
      out[rel] = fs.readFileSync(abs, "utf-8");
    }
  }
  return out;
}

function sortFileNames(fileKeys: string[], activeFile: string, fileOrder?: string[]): string[] {
  const orderMap = new Map<string, number>();
  if (fileOrder) {
    fileOrder.forEach((f, idx) => orderMap.set(f, idx));
  }
  return [...fileKeys].sort((a, b) => {
    if (a === activeFile) return -1;
    if (b === activeFile) return 1;
    const oa = orderMap.get(a);
    const ob = orderMap.get(b);
    if (oa !== undefined && ob !== undefined) return oa - ob;
    if (oa !== undefined) return -1;
    if (ob !== undefined) return 1;
    return a.localeCompare(b);
  });
}

function main(): void {
  const languagesDir = path.join(REPO_ROOT, "languages");
  const allLangs = fs
    .readdirSync(languagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(languagesDir, d.name, "package.json")))
    .map((d) => d.name)
    .sort();

  const webGenDir = path.join(REPO_ROOT, "apps/web/src/pages/playground/generated");
  const chunksDir = path.join(webGenDir, "chunks");
  const editorGenDir = path.join(REPO_ROOT, "packages/editor/src/workbench/generated");
  const ideGenDir = path.join(REPO_ROOT, "packages/ide/src/templates/generated");
  const docsGenDir = path.join(REPO_ROOT, "apps/docs/scripts/generated");

  ensureDir(chunksDir);
  ensureDir(editorGenDir);
  ensureDir(ideGenDir);
  ensureDir(docsGenDir);

  // Clean stale chunks
  for (const f of fs.readdirSync(chunksDir)) {
    if (f.endsWith(".json")) {
      fs.unlinkSync(path.join(chunksDir, f));
    }
  }

  const indexEntries: CompiledExampleMetadata[] = [];
  const defaultsMap: Record<string, CompiledLanguageDefault> = {};
  const ideTemplates: Array<{
    id: string;
    languageId: string;
    title: string;
    summary: string;
    difficulty: ExampleDifficulty;
    ext: string;
    primaryFile: string;
    files: Record<string, string>;
    tags: string[];
  }> = [];
  const docsInput: Record<
    string,
    {
      filename: string;
      title: string;
      description: string;
      code: string;
      files?: Record<string, string> | undefined;
    }
  > = {};

  let langsWithExamples = 0;
  let totalExamples = 0;
  let totalMultiFile = 0;

  for (const slug of allLangs) {
    const exDir = path.join(languagesDir, slug, "examples");
    if (!fs.existsSync(exDir)) continue;

    const folders = fs
      .readdirSync(exDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort();

    const langPayloads: CompiledExamplePayload[] = [];

    for (const folder of folders) {
      const folderPath = path.join(exDir, folder);
      const manifestPath = path.join(folderPath, "example.json");
      if (!fs.existsSync(manifestPath)) continue;

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as LanguageExampleManifest;
      const rawFiles = collectFilesRecursive(folderPath);
      const sortedNames = sortFileNames(Object.keys(rawFiles), manifest.activeFile, manifest.fileOrder);
      const orderedFiles: Record<string, string> = {};
      for (const name of sortedNames) {
        orderedFiles[name] = rawFiles[name]!;
      }

      const activeCode = orderedFiles[manifest.activeFile] ?? Object.values(orderedFiles)[0] ?? "";
      const isMultiFile = sortedNames.length > 1;
      if (isMultiFile) totalMultiFile++;

      const meta: CompiledExampleMetadata = {
        id: manifest.id,
        lang: slug,
        ...(manifest.subFormats && manifest.subFormats.length > 0 ? { subFormats: manifest.subFormats } : {}),
        difficulty: manifest.difficulty,
        title: manifest.title,
        description: manifest.description,
        category: manifest.category,
        tags: manifest.tags,
        activeFile: manifest.activeFile,
        fileNames: sortedNames,
        fileCount: sortedNames.length,
        ...(manifest.isDefaultStarter ? { isDefaultStarter: true } : {}),
      };

      const payload: CompiledExamplePayload = {
        ...meta,
        code: activeCode,
        ...(isMultiFile ? { files: orderedFiles } : {}),
      };

      indexEntries.push(meta);
      langPayloads.push(payload);
      totalExamples++;

      const ext = path.extname(manifest.activeFile) || `.${slug}`;
      ideTemplates.push({
        id: manifest.id,
        languageId: slug,
        title: manifest.title,
        summary: manifest.description,
        difficulty: manifest.difficulty,
        ext,
        primaryFile: manifest.activeFile,
        files: orderedFiles,
        tags: manifest.tags,
      });
    }

    if (langPayloads.length === 0) continue;
    langsWithExamples++;

    // Sort payloads by difficulty ascending, then id
    langPayloads.sort((a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id));

    // Write per-language lazy chunk
    fs.writeFileSync(path.join(chunksDir, `${slug}.json`), JSON.stringify(langPayloads, null, 2) + "\n", "utf-8");

    // Pick default starter for ALL_MORSEL_LANGUAGES (explicit isDefaultStarter, or L2/L1)
    const starter =
      langPayloads.find((p) => p.isDefaultStarter) ??
      langPayloads.find((p) => p.difficulty === 1) ??
      langPayloads[0]!;
    defaultsMap[slug] = {
      defaultCode: starter.code,
      ...(starter.files && Object.keys(starter.files).length > 1
        ? { defaultFiles: starter.files, defaultActiveFile: starter.activeFile }
        : {}),
    };

    // Pick docs showcase example (prefer L2 or L3 realistic model)
    const docsPick =
      langPayloads.find((p) => p.difficulty === 2) ??
      langPayloads.find((p) => p.difficulty === 3) ??
      langPayloads[0]!;
    docsInput[slug] = {
      filename: docsPick.activeFile,
      title: docsPick.title,
      description: docsPick.description,
      code: docsPick.code,
      ...(docsPick.files ? { files: docsPick.files } : {}),
    };
  }

  // Sort index deterministically by lang, then difficulty, then id
  indexEntries.sort((a, b) => a.lang.localeCompare(b.lang) || a.difficulty - b.difficulty || a.id.localeCompare(b.id));

  fs.writeFileSync(
    path.join(webGenDir, "example-index.generated.json"),
    JSON.stringify(indexEntries, null, 2) + "\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(webGenDir, "example-index.generated.ts"),
    `// SPDX-License-Identifier: AGPL-3.0-or-later\n// AUTO-GENERATED by scripts/build/gen-example-catalog.ts — do not edit manually.\n\nexport const EXAMPLE_INDEX_DATA = ${JSON.stringify(indexEntries, null, 2)} as const;\n`,
    "utf-8",
  );

  fs.writeFileSync(
    path.join(editorGenDir, "language-defaults.generated.json"),
    JSON.stringify(defaultsMap, null, 2) + "\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(editorGenDir, "language-defaults.generated.ts"),
    `// SPDX-License-Identifier: AGPL-3.0-or-later\n// AUTO-GENERATED by scripts/build/gen-example-catalog.ts — do not edit manually.\n\nexport interface GeneratedLanguageDefault {\n  defaultCode: string;\n  defaultFiles?: Record<string, string> | undefined;\n  defaultActiveFile?: string | undefined;\n}\n\nexport const GENERATED_LANGUAGE_DEFAULTS: Readonly<Record<string, GeneratedLanguageDefault>> = ${JSON.stringify(defaultsMap, null, 2)};\n`,
    "utf-8",
  );

  fs.writeFileSync(
    path.join(ideGenDir, "example-templates.generated.json"),
    JSON.stringify(ideTemplates, null, 2) + "\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(ideGenDir, "example-templates.generated.ts"),
    `// SPDX-License-Identifier: AGPL-3.0-or-later\n// AUTO-GENERATED by scripts/build/gen-example-catalog.ts — do not edit manually.\n\nexport interface GeneratedIdeTemplateEntry {\n  id: string;\n  languageId: string;\n  title: string;\n  summary: string;\n  difficulty: 1 | 2 | 3 | 4 | 5;\n  ext: string;\n  primaryFile: string;\n  files: Record<string, string>;\n  tags: string[];\n}\n\nexport const GENERATED_IDE_TEMPLATES: readonly GeneratedIdeTemplateEntry[] = ${JSON.stringify(ideTemplates, null, 2)};\n`,
    "utf-8",
  );

  fs.writeFileSync(
    path.join(docsGenDir, "language-examples-input.generated.json"),
    JSON.stringify(docsInput, null, 2) + "\n",
    "utf-8",
  );

  // Generate typed lazy loader for Vite + runtime
  const loaderSource = `// SPDX-License-Identifier: AGPL-3.0-or-later
// AUTO-GENERATED by scripts/build/gen-example-catalog.ts — do not edit manually.

import { EXAMPLE_INDEX_DATA } from "./example-index.generated";

export type ExampleDifficulty = 1 | 2 | 3 | 4 | 5;

export interface ExampleIndexEntry {
  id: string;
  lang: string;
  subFormats?: string[] | undefined;
  difficulty: ExampleDifficulty;
  title: string;
  description: string;
  category: string;
  tags: string[];
  activeFile: string;
  fileNames: string[];
  fileCount: number;
  isDefaultStarter?: boolean | undefined;
}

export interface LoadedLanguageExample extends ExampleIndexEntry {
  code: string;
  files?: Record<string, string> | undefined;
}

export const DIFFICULTY_LABELS: Readonly<Record<ExampleDifficulty, string>> = {
  1: "Easy",
  2: "Standard",
  3: "Intermediate",
  4: "Advanced",
  5: "Hard",
};

export const EXAMPLE_INDEX: readonly ExampleIndexEntry[] = EXAMPLE_INDEX_DATA as unknown as ExampleIndexEntry[];

export const EXAMPLE_INDEX_BY_LANG: ReadonlyMap<string, readonly ExampleIndexEntry[]> = (() => {
  const map = new Map<string, ExampleIndexEntry[]>();
  for (const entry of EXAMPLE_INDEX) {
    const key = entry.lang.toLowerCase();
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  return map;
})();

export const EXAMPLE_INDEX_BY_ID: ReadonlyMap<string, ExampleIndexEntry> = new Map(
  EXAMPLE_INDEX.map((e) => [e.id, e]),
);

const chunkLoaders: Record<string, () => Promise<{ default: LoadedLanguageExample[] }>> =
  typeof import.meta !== "undefined" && typeof (import.meta as unknown as { glob?: unknown }).glob === "function"
    ? (
        import.meta as unknown as {
          glob: (pattern: string) => Record<string, () => Promise<{ default: LoadedLanguageExample[] }>>;
        }
      ).glob("./chunks/*.json")
    : {};

const loadedLangCache = new Map<string, LoadedLanguageExample[]>();
const inflightLangCache = new Map<string, Promise<LoadedLanguageExample[]>>();

export function getCachedLanguageExamples(lang: string): LoadedLanguageExample[] | undefined {
  return loadedLangCache.get(lang.trim().toLowerCase());
}

export async function loadLanguageExamples(lang: string): Promise<LoadedLanguageExample[]> {
  const norm = lang.trim().toLowerCase();
  const cached = loadedLangCache.get(norm);
  if (cached) return cached;

  const existing = inflightLangCache.get(norm);
  if (existing) return existing;

  const loader = chunkLoaders[\`./chunks/\${norm}.json\`];
  if (!loader) {
    return [];
  }

  const promise = loader()
    .then((mod) => {
      const items = Array.isArray(mod?.default) ? mod.default : [];
      loadedLangCache.set(norm, items);
      inflightLangCache.delete(norm);
      return items;
    })
    .catch(() => {
      inflightLangCache.delete(norm);
      return [];
    });

  inflightLangCache.set(norm, promise);
  return promise;
}

export async function loadExampleById(id: string): Promise<LoadedLanguageExample | undefined> {
  const meta = EXAMPLE_INDEX_BY_ID.get(id);
  if (!meta) return undefined;
  const items = await loadLanguageExamples(meta.lang);
  return items.find((item) => item.id === id);
}
`;

  fs.writeFileSync(path.join(webGenDir, "example-loader.ts"), loaderSource, "utf-8");

  console.log(
    `[gen-example-catalog] Compiled ${totalExamples} examples (${totalMultiFile} multi-file) across ${langsWithExamples}/${allLangs.length} languages.`,
  );
}

main();
