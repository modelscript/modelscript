// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
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
  fileExtensions: string[];
  primaryExtension: string;
  wasm?: string | undefined;
  syntaxNames?: string[] | undefined;
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
  const dynamicImport = (m: string): Promise<any> => Function("m", "return import(m)")(m);
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

    let pkg: any = {};
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    } catch {
      continue;
    }

    const pkgName = pkg.name || `@modelscript/${dirent.name}`;
    let langDef: any = null;

    // 1. Try importing via package name
    try {
      const mod = await dynamicImport(`${pkgName}/language`);
      langDef =
        mod.default ||
        mod[`${dirent.name}Language`] ||
        Object.values(mod).find((v: any) => v && typeof v === "object" && v.name);
    } catch {
      // 2. Fallback to direct file paths
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
            langDef =
              mod.default ||
              mod[`${dirent.name}Language`] ||
              Object.values(mod).find((v: any) => v && typeof v === "object" && v.name);
            if (langDef) break;
          } catch {
            // continue
          }
        }
      }
    }

    if (!langDef) {
      // Fallback: construct basic descriptor if package declares language name
      langDef = {
        name: dirent.name,
        lsp: {
          fileExtensions: pkg.modelscript?.extensions || [`.${dirent.name}`],
        },
      };
    }

    const [normalized] = normalizeLanguages([langDef]);
    normalizedLangs.push(normalized);

    // 3. Discover native GLR parser.wasm
    const wasmCandidates = [
      path.join(langDir, "dist", "parser.wasm"),
      path.join(langDir, "parser.wasm"),
      path.join(langDir, "tree-sitter-modelica.wasm"),
    ];

    let wasmFileName: string | undefined;
    const foundWasm = wasmCandidates.find(fs.existsSync);
    if (foundWasm) {
      wasmFileName = `${normalized.id}.wasm`;
      wasmAssets.push({
        src: foundWasm,
        dest: `server/dist/${wasmFileName}`,
      });
      // Backward compatibility copies for legacy test references
      wasmAssets.push({
        src: foundWasm,
        dest: `server/dist/tree-sitter-${normalized.id}.wasm`,
      });
    }

    // 4. Discover native parser bindings.js & syntax names
    const bindingsCandidates = [
      path.join(langDir, "src-gen", "bindings.js"),
      path.join(langDir, "dist", "src-gen", "bindings.js"),
      path.join(langDir, "dist", "bindings.js"),
      path.join(langDir, "bindings.js"),
    ];

    let syntaxNames: string[] | undefined;
    const foundBindings = bindingsCandidates.find(fs.existsSync);
    if (foundBindings) {
      wasmAssets.push({
        src: foundBindings,
        dest: `server/dist/${normalized.id}.bindings.js`,
      });
      wasmAssets.push({
        src: foundBindings,
        dest: `server/dist/tree-sitter-${normalized.id}.bindings.js`,
      });
      try {
        const mod = await dynamicImport(foundBindings);
        if (mod && Array.isArray(mod.SYNTAX_NAMES) && mod.SYNTAX_NAMES.length > 0) {
          syntaxNames = mod.SYNTAX_NAMES;
        }
      } catch {
        try {
          const content = fs.readFileSync(foundBindings, "utf-8");
          const m = content.match(/SYNTAX_NAMES\s*=\s*(?:typeof\s*)?(\[[^\]]+\])/);
          if (m) {
            syntaxNames = JSON.parse(m[1]);
          }
        } catch {}
      }
    }

    manifest.push({
      id: normalized.id,
      name: normalized.name,
      displayName: normalized.displayName,
      fileExtensions: normalized.fileExtensions,
      primaryExtension: normalized.primaryExtension,
      wasm: wasmFileName,
      syntaxNames,
      lineComment: normalized.lineComment,
      blockComment: normalized.blockComment,
    });
  }

  return { languages: normalizedLangs, wasmAssets, manifest };
}
