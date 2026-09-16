// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export interface LanguageManifest {
  id: string;
  name: string;
  extensions: string[];
  wasmPath?: string | undefined;
  wrapperPath?: string | undefined;
  languageDefPath?: string | undefined;
  isBuiltIn?: boolean | undefined;
  registeredAt?: string | undefined;
  sourceDir?: string | undefined;
}

export interface FormatOptions {
  write?: boolean | undefined;
  check?: boolean | undefined;
  indentSize?: number | undefined;
  preserveFormatting?: boolean | undefined;
}

export interface ResolvedLanguage {
  manifest: LanguageManifest;
  loadParser(): Promise<{ parser: unknown; facade?: unknown; binding?: unknown }>;
  format(content: string, options?: FormatOptions): Promise<string>;
  unparse(content: string, options?: FormatOptions): Promise<string>;
}

export interface UserRegistryCatalog {
  version: string;
  languages: Record<string, LanguageManifest>;
}

// ---------------------------------------------------------------------------
// Well-known Registry Directory Path
// ---------------------------------------------------------------------------

export function getRegistryDir(): string {
  if (process.env.MODELSCRIPT_LANGUAGES_DIR) {
    return path.resolve(process.env.MODELSCRIPT_LANGUAGES_DIR);
  }
  return path.join(os.homedir(), ".modelscript", "languages");
}

function getRegistryJsonPath(): string {
  return path.join(getRegistryDir(), "registry.json");
}

export function ensureRegistryDir(): void {
  const dir = getRegistryDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadUserCatalog(): UserRegistryCatalog {
  const regPath = getRegistryJsonPath();
  if (!fs.existsSync(regPath)) {
    return { version: "1.0.0", languages: {} };
  }
  try {
    const raw = fs.readFileSync(regPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { version: "1.0.0", languages: {} };
  }
}

export function saveUserCatalog(catalog: UserRegistryCatalog): void {
  ensureRegistryDir();
  fs.writeFileSync(getRegistryJsonPath(), JSON.stringify(catalog, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Built-in Language Definitions
// ---------------------------------------------------------------------------

export const BUILT_IN_LANGUAGES: LanguageManifest[] = [
  {
    id: "modelica",
    name: "Modelica",
    extensions: [".mo", ".mos", ".msim"],
    isBuiltIn: true,
  },
  {
    id: "sysml2",
    name: "SysML v2",
    extensions: [".sysml"],
    isBuiltIn: true,
  },
  {
    id: "scad",
    name: "OpenSCAD",
    extensions: [".scad"],
    isBuiltIn: true,
  },
  {
    id: "step",
    name: "STEP",
    extensions: [".step", ".stp", ".p21"],
    isBuiltIn: true,
  },
  {
    id: "owl2",
    name: "OWL2",
    extensions: [".owl", ".ttl", ".ofn", ".rdf"],
    isBuiltIn: true,
  },
  {
    id: "csv",
    name: "CSV",
    extensions: [".csv"],
    isBuiltIn: true,
  },
  {
    id: "ssp",
    name: "SSP",
    extensions: [".ssp"],
    isBuiltIn: true,
  },
];

/**
 * Resolves the WASM parser binary path for a built-in language.
 */
export function resolveBuiltInWasmPath(id: string): string | undefined {
  try {
    return require.resolve(`@modelscript/${id}/parser.wasm`);
  } catch {
    // ignore
  }

  try {
    return require.resolve(`@modelscript/${id}/dist/parser.wasm`);
  } catch {
    // ignore
  }

  // Monorepo relative fallback
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const monorepoPath = path.resolve(__dirname, `../../../../languages/${id}/dist/parser.wasm`);
  if (fs.existsSync(monorepoPath)) {
    return monorepoPath;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Language Registration Management
// ---------------------------------------------------------------------------

/**
 * Registers a language manifest into the user catalog (~/.modelscript/languages/).
 */
export function registerLanguage(manifest: LanguageManifest): void {
  ensureRegistryDir();
  const catalog = loadUserCatalog();
  const langDir = path.join(getRegistryDir(), manifest.id);
  if (!fs.existsSync(langDir)) {
    fs.mkdirSync(langDir, { recursive: true });
  }

  // Copy WASM binary if local file
  let storedWasmPath = manifest.wasmPath;
  if (manifest.wasmPath && fs.existsSync(manifest.wasmPath)) {
    const destWasm = path.join(langDir, "parser.wasm");
    if (path.resolve(manifest.wasmPath) !== path.resolve(destWasm)) {
      fs.copyFileSync(manifest.wasmPath, destWasm);
      storedWasmPath = destWasm;
    }
  }

  // Copy wrapper JS if exists
  let storedWrapperPath = manifest.wrapperPath;
  if (manifest.wrapperPath && fs.existsSync(manifest.wrapperPath)) {
    const destWrapper = path.join(langDir, "index.js");
    if (path.resolve(manifest.wrapperPath) !== path.resolve(destWrapper)) {
      fs.copyFileSync(manifest.wrapperPath, destWrapper);
      storedWrapperPath = destWrapper;
    }
  }

  const updatedManifest: LanguageManifest = {
    ...manifest,
    wasmPath: storedWasmPath,
    wrapperPath: storedWrapperPath,
    registeredAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(langDir, "manifest.json"), JSON.stringify(updatedManifest, null, 2), "utf-8");

  catalog.languages[manifest.id] = updatedManifest;
  saveUserCatalog(catalog);
}

/**
 * Unregisters a language from the user catalog.
 */
export function unregisterLanguage(id: string): boolean {
  const catalog = loadUserCatalog();
  const normId = id.toLowerCase();
  if (!catalog.languages[normId]) {
    return false;
  }
  Reflect.deleteProperty(catalog.languages, normId);
  saveUserCatalog(catalog);

  const langDir = path.join(getRegistryDir(), normId);
  if (fs.existsSync(langDir)) {
    try {
      fs.rmSync(langDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  return true;
}

/**
 * Lists all known languages: built-ins and user-registered.
 */
export function listAllLanguages(): { builtIn: LanguageManifest[]; userRegistered: LanguageManifest[] } {
  const catalog = loadUserCatalog();
  const userList = Object.values(catalog.languages);
  return {
    builtIn: BUILT_IN_LANGUAGES,
    userRegistered: userList,
  };
}

/**
 * Registers a language from a project directory containing language.ts or build/src-gen.
 */
export async function registerLanguageFromDirectory(dir: string): Promise<LanguageManifest> {
  const absDir = path.resolve(dir);
  const packageJsonPath = path.join(absDir, "package.json");
  let langId = path.basename(absDir).toLowerCase();
  let langName = path.basename(absDir);
  let extensions: string[] = [];

  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (pkg.name) {
        langId = pkg.name.split("/").pop() || langId;
        langName = langId;
      }
      if (pkg.modelscript?.extensions && Array.isArray(pkg.modelscript.extensions)) {
        extensions = pkg.modelscript.extensions;
      }
    } catch {
      // ignore
    }
  }

  // Look for language.ts to extract name and extension
  const langTsPaths = [path.join(absDir, "src", "language.ts"), path.join(absDir, "language.ts")];
  for (const p of langTsPaths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, "utf-8");
        const nameMatch = content.match(/name:\s*["']([^"']+)["']/);
        if (nameMatch && nameMatch[1]) {
          langId = nameMatch[1].toLowerCase();
          langName = nameMatch[1];
        }
        const extMatch = content.match(/fileExtension:\s*["']([^"']+)["']/);
        if (extMatch && extMatch[1]) {
          const ext = extMatch[1].startsWith(".") ? extMatch[1] : `.${extMatch[1]}`;
          if (!extensions.includes(ext)) extensions.push(ext);
        }
      } catch {
        // ignore
      }
      break;
    }
  }

  if (extensions.length === 0) {
    extensions = [`.${langId}`];
  }

  // Look for compiled WASM file
  const distDir = path.join(absDir, "dist");
  let wasmPath = "";
  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    const foundWasm = files.find((f) => f.endsWith(".wasm"));
    if (foundWasm) {
      wasmPath = path.join(distDir, foundWasm);
    }
  }

  // Look for JS wrapper
  let wrapperPath = "";
  const candidateWrappers = [
    path.join(absDir, "build", "src-gen", "index.js"),
    path.join(absDir, "src-gen", "bindings.js"),
    path.join(distDir, "index.js"),
  ];
  for (const cw of candidateWrappers) {
    if (fs.existsSync(cw)) {
      wrapperPath = cw;
      break;
    }
  }

  const manifest: LanguageManifest = {
    id: langId,
    name: langName,
    extensions,
    wasmPath: wasmPath || undefined,
    wrapperPath: wrapperPath || undefined,
    sourceDir: absDir,
  };

  registerLanguage(manifest);
  return manifest;
}

// ---------------------------------------------------------------------------
// Language Resolver & Operations Service
// ---------------------------------------------------------------------------

export const LanguageResolver = {
  /**
   * Resolves a language either by explicit override name or by file extension.
   */
  async resolve(fileOrExt?: string, languageOverride?: string, cwd: string = process.cwd()): Promise<ResolvedLanguage> {
    const catalog = loadUserCatalog();

    // 1. Language Override (e.g. -l modelica, --language sysml2)
    if (languageOverride) {
      const norm = languageOverride.toLowerCase().trim();

      // Check user-registered
      const userLang = catalog.languages[norm];
      if (userLang) {
        return createResolvedLanguage(userLang);
      }

      // Check built-ins
      const builtIn = BUILT_IN_LANGUAGES.find((l) => l.id === norm || l.name.toLowerCase() === norm);
      if (builtIn) {
        const wasm = resolveBuiltInWasmPath(builtIn.id);
        return createResolvedLanguage({ ...builtIn, wasmPath: wasm });
      }

      // Check local project in cwd
      const local = tryResolveLocalDirectory(cwd);
      if (local && (local.id === norm || local.name.toLowerCase() === norm)) {
        return createResolvedLanguage(local);
      }

      const available = [...BUILT_IN_LANGUAGES.map((l) => l.id), ...Object.keys(catalog.languages)].join(", ");
      throw new Error(`Language '${languageOverride}' not found. Available languages: ${available}`);
    }

    // 2. Resolve by File Extension
    if (fileOrExt) {
      let ext = fileOrExt;
      if (fileOrExt.includes(".") && !fileOrExt.startsWith(".")) {
        ext = path.extname(fileOrExt);
      }
      if (!ext.startsWith(".")) {
        ext = `.${ext}`;
      }
      const normExt = ext.toLowerCase();

      // Check user catalog first
      for (const lang of Object.values(catalog.languages)) {
        if (lang.extensions.some((e) => e.toLowerCase() === normExt)) {
          return createResolvedLanguage(lang);
        }
      }

      // Check built-in languages
      const builtIn = BUILT_IN_LANGUAGES.find((l) => l.extensions.some((e) => e.toLowerCase() === normExt));
      if (builtIn) {
        const wasm = resolveBuiltInWasmPath(builtIn.id);
        return createResolvedLanguage({ ...builtIn, wasmPath: wasm });
      }

      // Check local project in cwd
      const local = tryResolveLocalDirectory(cwd);
      if (local && local.extensions.some((e) => e.toLowerCase() === normExt)) {
        return createResolvedLanguage(local);
      }

      const allExts = LanguageResolver.getAllExtensions().join(", ");
      throw new Error(
        `Unknown file extension '${ext}' for file '${fileOrExt}'.\nSupported extensions: ${allExts}\nUse '--language <name>' to override.`,
      );
    }

    // 3. Fallback to Local Project in cwd
    const local = tryResolveLocalDirectory(cwd);
    if (local) {
      return createResolvedLanguage(local);
    }

    throw new Error("Could not determine language. Please provide a file path or use '--language <name>'.");
  },

  /**
   * Returns a deduplicated list of all recognized file extensions across built-in and user languages.
   */
  getAllExtensions(): string[] {
    const catalog = loadUserCatalog();
    const set = new Set<string>();
    for (const b of BUILT_IN_LANGUAGES) {
      for (const ext of b.extensions) set.add(ext.toLowerCase());
    }
    for (const u of Object.values(catalog.languages)) {
      for (const ext of u.extensions) set.add(ext.toLowerCase());
    }
    return Array.from(set);
  },
};

/**
 * Attempts to inspect cwd to see if it defines a ModelScript DSL.
 */
function tryResolveLocalDirectory(cwd: string): LanguageManifest | undefined {
  const wrapperPath = path.join(cwd, "build", "src-gen", "index.js");
  const distDir = path.join(cwd, "dist");
  let wasmPath: string | undefined;

  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    const foundWasm = files.find((f) => f.endsWith(".wasm"));
    if (foundWasm) {
      wasmPath = path.join(distDir, foundWasm);
    }
  }

  if (fs.existsSync(wrapperPath) || wasmPath) {
    const pkgPath = path.join(cwd, "package.json");
    let langId = path.basename(cwd).toLowerCase();
    let extensions: string[] = [];

    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.name) langId = pkg.name.split("/").pop() || langId;
        if (pkg.modelscript?.extensions) extensions = pkg.modelscript.extensions;
      } catch {
        // ignore
      }
    }

    if (extensions.length === 0) {
      extensions = [`.${langId}`];
    }

    return {
      id: langId,
      name: langId,
      extensions,
      wasmPath,
      wrapperPath: fs.existsSync(wrapperPath) ? wrapperPath : undefined,
      sourceDir: cwd,
    };
  }

  return undefined;
}

/**
 * Creates the ResolvedLanguage instance containing parser loading, formatting, and unparsing routines.
 */
function createResolvedLanguage(manifest: LanguageManifest): ResolvedLanguage {
  return {
    manifest,

    async loadParser() {
      const wasmPath = manifest.wasmPath || resolveBuiltInWasmPath(manifest.id);
      if (!wasmPath || !fs.existsSync(wasmPath)) {
        throw new Error(
          `Parser binary for language '${manifest.name}' not found at: ${wasmPath || "(unresolved)"}.\nRun 'msc build' to compile the parser.`,
        );
      }

      const { createWasmParser } = await import("@modelscript/dsl");
      return await createWasmParser(wasmPath);
    },

    async format(content: string, options?: FormatOptions): Promise<string> {
      const indentSize = options?.indentSize ?? 2;
      const preserveFormatting = options?.preserveFormatting ?? false;

      // 1. Modelica Specialization
      if (manifest.id === "modelica") {
        const { parser } = await this.loadParser();
        const tree = parser.parse(content);
        if (!tree) return content;
        try {
          const { formatModelicaTree } = await import("@modelscript/lsp/providers/formattingProvider.js");
          return formatModelicaTree(tree, content, indentSize);
        } catch {
          // Fallback below
        }
      }

      // 2. STEP Specialization
      if (manifest.id === "step") {
        try {
          const { formatStepDocument } = await import("@modelscript/lsp/providers/formattingProvider.js");
          const lines = content.split("\n");
          const edits = formatStepDocument({
            getText: () => content,
            lineCount: lines.length,
            offsetAt: (pos: { line: number; character?: number }) => {
              let off = 0;
              for (let i = 0; i < pos.line && i < lines.length; i++) {
                off += (lines[i]?.length ?? 0) + 1;
              }
              return off + (pos.character || 0);
            },
          });
          if (edits && edits.length > 0 && edits[0]?.newText) {
            return edits[0].newText;
          }
        } catch {
          // ignore
        }
      }

      // 3. SysML v2 Specialization (Brace-based + section alignment)
      if (manifest.id === "sysml2") {
        return formatBraceIndented(content, indentSize);
      }

      // 4. WASM Zero-GC Unparser / Formatter Engine
      try {
        const { facade, parser } = await this.loadParser();
        if (facade?.exports?.lsp_formatDocument && facade?.exports?.lsp_getBinaryBuffer) {
          const tree = parser.parse(content);
          if (tree) {
            const rootPtr = tree.rootNode?.getPtr ? tree.rootNode.getPtr() : 0;
            const numBytes = facade.exports.lsp_formatDocument(rootPtr, preserveFormatting ? 1 : 0);
            if (numBytes > 0) {
              const dirPtr = facade.exports.lsp_getBinaryBuffer();
              const mem = new Uint8Array(facade.exports.memory.buffer, dirPtr, numBytes);
              const formatted = new TextDecoder("utf-8").decode(mem);
              if (formatted && formatted.trim().length > 0) {
                return formatted;
              }
            }
          }
        }
      } catch {
        // Fall back to clean indentation formatting
      }

      // 5. Canonical fallback formatting
      return formatBraceIndented(content, indentSize);
    },

    async unparse(content: string, options?: FormatOptions): Promise<string> {
      // Re-synthesizes clean code from the syntax tree using the WASM unparser
      return await this.format(content, { ...options, preserveFormatting: false });
    },
  };
}

/**
 * Robust brace and block-based indentation formatter for DSL code.
 */
function formatBraceIndented(content: string, indentSize = 2): string {
  const indent = " ".repeat(indentSize);
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const formatted: string[] = [];
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      // Preserve single empty line
      if (formatted.length > 0 && formatted[formatted.length - 1] !== "") {
        formatted.push("");
      }
      continue;
    }

    // Dedent leading closing braces or block ends
    if (trimmed.startsWith("}") || trimmed.startsWith("]") || trimmed.startsWith(")") || trimmed.startsWith("end ")) {
      depth = Math.max(0, depth - 1);
    }

    formatted.push(indent.repeat(depth) + trimmed);

    // Count open vs close delimiters
    const openBraces = (trimmed.match(/[{[(]/g) || []).length;
    const closeBraces = (trimmed.match(/[}\])]/g) || []).length;
    depth = Math.max(0, depth + openBraces - closeBraces);

    // If line ended with '}' and also started with '}', depth was already decremented
    if ((trimmed.startsWith("}") || trimmed.startsWith("]") || trimmed.startsWith(")")) && closeBraces > openBraces) {
      // already counted
    }
  }

  // Trim trailing empty lines
  while (formatted.length > 0 && formatted[formatted.length - 1] === "") {
    formatted.pop();
  }

  return formatted.join("\n") + "\n";
}
