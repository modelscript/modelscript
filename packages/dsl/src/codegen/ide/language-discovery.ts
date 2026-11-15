// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as FsTypes from "node:fs";
import type * as PathTypes from "node:path";
import type { LanguageOptions } from "../../dsl/language.js";
import type { NormalizedLanguage } from "./extension-generator.js";
import { normalizeLanguages } from "./extension-generator.js";

export interface DiscoveredLanguageAsset {
  src: string;
  dest: string;
}

export interface DiscoveredLanguageManifestEntry {
  id: string;
  name: string;
  displayName: string;
  maturity: "stable" | "beta" | "experimental";
  fileExtensions: string[];
  primaryExtension: string;
  wasm?: string | undefined;
  syntaxNames?: string[] | undefined;
  fieldNames?: Record<string, number> | undefined;
  lineComment?: string | undefined;
  blockComment?: { open: string; close: string } | undefined;
}

export interface DiscoveredLanguagesResult {
  languages: NormalizedLanguage[];
  wasmAssets: DiscoveredLanguageAsset[];
  manifest: DiscoveredLanguageManifestEntry[];
}

/**
 * Automatically discovers all language packages from a target directory (e.g. languages/).
 * Inspects package.json, language.ts, and dist/parser.wasm for each subdirectory.
 */
export async function discoverWorkspaceLanguages(languagesDir: string): Promise<DiscoveredLanguagesResult> {
  const fsId = "node:fs";
  const pathId = "node:path";
  const fs = (await import(fsId)) as typeof FsTypes;
  const path = (await import(pathId)) as typeof PathTypes;
  const dynamicImport = (m: string): Promise<Record<string, unknown>> => import(m);
  const normalizedLangs: NormalizedLanguage[] = [];
  const wasmAssets: DiscoveredLanguageAsset[] = [];
  const manifest: DiscoveredLanguageManifestEntry[] = [];

  if (!fs.existsSync(languagesDir)) {
    return { languages: [], wasmAssets: [], manifest: [] };
  }

  const entries = fs.readdirSync(languagesDir, { withFileTypes: true });

  for (const dirent of entries) {
    if (!dirent.isDirectory()) continue;
    const langDir = path.join(languagesDir, dirent.name);
    const pkgPath = path.join(langDir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;

    let pkg: { name?: string; version?: string; [key: string]: unknown } = {};
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
        name?: string;
        version?: string;
        [key: string]: unknown;
      };
    } catch {
      continue;
    }

    const pkgName = pkg.name || `@modelscript/${dirent.name}`;
    let langDef: LanguageOptions | null = null;
    const isLangObj = (v: unknown): v is LanguageOptions => Boolean(v && typeof v === "object" && "name" in v);

    // 1. Try importing directly from workspace source files first (preserves recent edits under tsx)
    const fileCandidates = [
      path.join(langDir, "src", "language.ts"),
      path.join(langDir, "language.ts"),
      path.join(langDir, "dist", "src", "language.js"),
      path.join(langDir, "dist", "language.js"),
    ];
    for (const candidate of fileCandidates) {
      if (fs.existsSync(candidate)) {
        try {
          const mod = await dynamicImport(candidate);
          const candidateDef = mod["default"] || mod[`${dirent.name}Language`] || Object.values(mod).find(isLangObj);
          if (isLangObj(candidateDef)) {
            langDef = candidateDef;
            break;
          }
        } catch {
          // continue
        }
      }
    }

    // 2. Fallback to package import
    if (!langDef) {
      try {
        const mod = await dynamicImport(`${pkgName}/language`);
        const candidateDef = mod["default"] || mod[`${dirent.name}Language`] || Object.values(mod).find(isLangObj);
        if (isLangObj(candidateDef)) {
          langDef = candidateDef;
        }
      } catch {
        // continue
      }
    }

    if (!langDef) {
      // Fallback: construct basic descriptor if package declares language name
      const msMeta = pkg["modelscript"] as { extensions?: string[] } | undefined;
      langDef = {
        name: dirent.name,
        fileExtensions: msMeta?.extensions || [`.${dirent.name}`],
      };
    }

    const [normalized] = normalizeLanguages([langDef as Parameters<typeof normalizeLanguages>[0][number]]);
    normalizedLangs.push(normalized!);

    // 3. Discover native GLR parser.wasm
    const wasmCandidates = [
      path.join(langDir, "dist", "parser.wasm"),
      path.join(langDir, "parser.wasm"),
      path.join(langDir, ".cache", "parser.wasm"),
      path.join(langDir, "build", "parser.wasm"),
    ];

    let wasmFileName: string | undefined;
    const foundWasm = wasmCandidates.find(fs.existsSync);
    if (foundWasm) {
      wasmFileName = `${normalized!.id}.wasm`;
      wasmAssets.push({
        src: foundWasm,
        dest: `server/dist/${wasmFileName}`,
      });
      // Ensure dist/parser.wasm is synced if discovered from .cache
      const distWasm = path.join(langDir, "dist", "parser.wasm");
      if (!fs.existsSync(distWasm) && foundWasm !== distWasm) {
        try {
          fs.mkdirSync(path.dirname(distWasm), { recursive: true });
          fs.copyFileSync(foundWasm, distWasm);
        } catch {}
      }
    }

    // 4. Discover native parser bindings.js & syntax names
    const bindingsCandidates = [
      path.join(langDir, "src-gen", "bindings.js"),
      path.join(langDir, "dist", "src-gen", "bindings.js"),
      path.join(langDir, "dist", "bindings.js"),
      path.join(langDir, "bindings.js"),
      path.join(langDir, ".cache", "bindings.js"),
    ];

    let syntaxNames: string[] | undefined;
    let fieldNames: Record<string, number> | undefined;
    const foundBindings = bindingsCandidates.find(fs.existsSync);
    if (foundBindings) {
      wasmAssets.push({
        src: foundBindings,
        dest: `server/dist/${normalized!.id}.bindings.js`,
      });
      try {
        const fileUrl = path.isAbsolute(foundBindings) ? `file://${foundBindings}` : foundBindings;
        const mod = await dynamicImport(fileUrl);
        if (mod && Array.isArray(mod["SYNTAX_NAMES"]) && mod["SYNTAX_NAMES"].length > 0) {
          syntaxNames = mod["SYNTAX_NAMES"] as string[];
        }
        const rawFieldNames = mod?.["FIELD_NAMES"];
        if (rawFieldNames && typeof rawFieldNames === "object" && Object.keys(rawFieldNames).length > 0) {
          fieldNames = rawFieldNames as Record<string, number>;
        }
      } catch {
        // Fallback to regex extraction
      }
      if (!syntaxNames || !fieldNames) {
        try {
          const content = fs.readFileSync(foundBindings, "utf-8");
          if (!syntaxNames) {
            const m = content.match(/SYNTAX_NAMES\s*=\s*(?:typeof\s*)?(\[[^\]]+\])/);
            if (m) {
              syntaxNames = JSON.parse(m[1]!);
            }
          }
          if (!fieldNames) {
            const mf = content.match(/FIELD_NAMES\s*=\s*(?:typeof\s*)?(\{[\s\S]*?\})\s*!==/);
            if (mf) {
              fieldNames = JSON.parse(mf[1]!);
            }
          }
        } catch {}
      }
    }

    manifest.push({
      id: normalized!.id,
      name: normalized!.name,
      displayName: normalized!.displayName,
      maturity: normalized!.maturity,
      fileExtensions: normalized!.fileExtensions,
      primaryExtension: normalized!.primaryExtension,
      wasm: wasmFileName,
      syntaxNames,
      fieldNames,
      lineComment: normalized!.lineComment,
      blockComment: normalized!.blockComment,
    });
  }

  return { languages: normalizedLangs, wasmAssets, manifest };
}
