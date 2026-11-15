// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  isModelscriptLibraryPackageJson,
  type DiagramComponentSpec,
  type LibrarySymbolStub,
  type LoadedLibraryPackage,
  type ModelscriptLibraryManifest,
} from "@modelscript/runtime";
import type { PscadComponentSchema, PscadParameterSchema, PscadPortSchema } from "./master-library-schemas.js";

/**
 * Converts `PscadComponentSchema[]` into generic `@modelscript/runtime` `LibrarySymbolStub[]`
 * and `DiagramComponentSpec[]` payloads suitable for `package.json#modelscript` libraries.
 */
export function schemasToLibraryPayloads(schemas: PscadComponentSchema[]): {
  symbols: LibrarySymbolStub[];
  diagrams: DiagramComponentSpec[];
} {
  const symbols: LibrarySymbolStub[] = [];
  const diagrams: DiagramComponentSpec[] = [];

  for (const s of schemas) {
    const shortName = s.className.includes(":") ? s.className.split(":").pop()! : s.className;
    symbols.push({
      name: shortName,
      kind: "pscad_component",
      ruleName: "UserCmpDefn",
      namePath: s.className,
      exports: s.parameters.map((p) => p.key),
      inherits: [],
      metadata: {
        label: s.label,
        category: s.category,
        domain: s.domain,
        description: s.description,
        aliases: s.aliases,
        parameters: s.parameters,
      },
    });

    diagrams.push({
      namePath: s.className,
      aliases: s.aliases,
      label: s.label,
      category: s.category,
      domain: s.domain,
      width: s.defaultWidth,
      height: s.defaultHeight,
      ports: s.ports.map((p) => ({
        name: p.name,
        kind: p.kind,
        side: p.side,
        dx: p.offsetX,
        dy: p.offsetY,
      })),
    });
  }

  return { symbols, diagrams };
}

/**
 * Reconstructs `PscadComponentSchema[]` from all `pscad` `package.json#modelscript`
 * libraries currently registered in `globalLibraryRegistry`.
 */
export function getPscadSchemasFromLibraries(): PscadComponentSchema[] {
  ensureBuiltInPscadLibraryRegistered();
  const out: PscadComponentSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("pscad")) {
    const diagByPath = new Map<string, DiagramComponentSpec>();
    for (const d of pkg.diagrams) {
      diagByPath.set(d.namePath, d);
    }
    for (const sym of pkg.symbols) {
      const meta = (sym.metadata ?? {}) as Record<string, unknown>;
      const diag = diagByPath.get(sym.namePath);
      out.push({
        className: sym.namePath,
        aliases: Array.isArray(meta["aliases"]) ? (meta["aliases"] as string[]) : [],
        label: (meta["label"] as string) ?? diag?.label ?? sym.name,
        category: ((meta["category"] as PscadComponentSchema["category"]) ??
          "Sources & Rotating Machines") as PscadComponentSchema["category"],
        domain: ((meta["domain"] as PscadComponentSchema["domain"]) ?? "electrical") as PscadComponentSchema["domain"],
        description: (meta["description"] as string) ?? "",
        defaultWidth: diag?.width ?? 60,
        defaultHeight: diag?.height ?? 60,
        ports: (diag?.ports ?? []).map(
          (p): PscadPortSchema => ({
            name: p.name,
            kind: p.kind === "signal" ? "signal" : "electrical",
            side: p.side,
            offsetX: p.dx,
            offsetY: p.dy,
          }),
        ),
        parameters: Array.isArray(meta["parameters"]) ? (meta["parameters"] as PscadParameterSchema[]) : [],
      });
    }
  }
  return out;
}

/**
 * Auto-mounts the default clean-room `@modelscript/pscad-master-lib` asset package
 * into `globalLibraryRegistry` when running in Node (similar to Modelica/MSL auto-mount).
 */
export function ensureBuiltInPscadLibraryRegistered(): LoadedLibraryPackage | undefined {
  const existing = globalLibraryRegistry
    .getPackagesForLanguage("pscad")
    .find((p) => p.packageName === "@modelscript/pscad-master-lib");
  if (existing) return existing;

  if (
    typeof process !== "undefined" &&
    typeof (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule === "function"
  ) {
    try {
      const getMod = (process as unknown as { getBuiltinModule: <T = Record<string, unknown>>(id: string) => T })
        .getBuiltinModule;
      const nodeFs = getMod<typeof import("node:fs")>("node:fs");
      const nodePath = getMod<typeof import("node:path")>("node:path");
      const nodeUrl = getMod<typeof import("node:url")>("node:url");
      const here = nodePath.dirname(nodeUrl.fileURLToPath(import.meta.url));
      const candidates = [
        nodePath.resolve(here, "../../assets/pscad-master-lib"),
        nodePath.resolve(here, "../../../assets/pscad-master-lib"),
        nodePath.resolve(process.cwd(), "languages/pscad/assets/pscad-master-lib"),
      ];
      for (const dir of candidates) {
        const pkgPath = nodePath.join(dir, "package.json");
        if (!nodeFs.existsSync(pkgPath)) continue;
        const pkgJson = JSON.parse(nodeFs.readFileSync(pkgPath, "utf-8"));
        if (!isModelscriptLibraryPackageJson(pkgJson)) continue;
        let symbols: LibrarySymbolStub[] = [];
        if (pkgJson.modelscript.symbols) {
          const symbolsPath = nodePath.resolve(dir, pkgJson.modelscript.symbols);
          if (nodeFs.existsSync(symbolsPath)) {
            symbols = JSON.parse(nodeFs.readFileSync(symbolsPath, "utf-8"));
          }
        }
        let diagrams: DiagramComponentSpec[] | undefined;
        if (pkgJson.modelscript.diagrams) {
          const diagPath = nodePath.resolve(dir, pkgJson.modelscript.diagrams);
          if (nodeFs.existsSync(diagPath)) {
            diagrams = JSON.parse(nodeFs.readFileSync(diagPath, "utf-8"));
          }
        }
        let wasmBytes: Uint8Array | undefined;
        if (pkgJson.modelscript.runtime?.wasm) {
          const wasmPath = nodePath.resolve(dir, pkgJson.modelscript.runtime.wasm);
          if (nodeFs.existsSync(wasmPath)) {
            wasmBytes = new Uint8Array(nodeFs.readFileSync(wasmPath));
          }
        }
        return globalLibraryRegistry.registerLibraryBundle(pkgJson, {
          symbols,
          diagrams,
          wasmBytes,
        });
      }
    } catch {
      // Browser or non-fs environment: Morsel registers bundles via registerPscadLibraryBundle()
    }
  }
  return undefined;
}

/**
 * Registers an external `package.json#modelscript` library bundle (e.g. mined clean-room
 * `symbols.json` + `diagrams.json` + optional `.wasm`) for PSCAD in Node or Browser/Morsel.
 */
export function registerPscadLibraryBundle(
  pkgJson: { name: string; version?: string; modelscript: ModelscriptLibraryManifest },
  payload: {
    symbols: LibrarySymbolStub[];
    diagrams?: DiagramComponentSpec[] | undefined;
    wasmBytes?: Uint8Array | undefined;
  },
): LoadedLibraryPackage {
  return globalLibraryRegistry.registerLibraryBundle(pkgJson, payload);
}

/**
 * Looks up a component's diagram/port specification from any registered `package.json#modelscript`
 * PSCAD library (including `@modelscript/pscad-master-lib` and user-loaded packs).
 */
export function getPscadDiagramSpecFromLibraries(defnOrAlias: string): DiagramComponentSpec | undefined {
  ensureBuiltInPscadLibraryRegistered();
  return globalLibraryRegistry.getDiagramSpec("pscad", defnOrAlias);
}

/**
 * Node.js helper: exports `PscadComponentSchema[]` (defaulting to loaded library schemas)
 * to a standalone `package.json` library directory (`package.json`, `dist/symbols.json`, `dist/diagrams.json`).
 */
export async function exportSchemasToLibraryPackageDir(
  outDir: string,
  options?: { name?: string; version?: string; schemas?: PscadComponentSchema[] },
): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const pkgName = options?.name ?? "@modelscript/pscad-master-lib";
  const version = options?.version ?? "0.1.0";
  const schemas = options?.schemas ?? getPscadSchemasFromLibraries();

  const { symbols, diagrams } = schemasToLibraryPayloads(schemas);
  const distDir = path.join(outDir, "dist");
  fs.mkdirSync(distDir, { recursive: true });

  const pkgJson = {
    name: pkgName,
    version,
    license: "AGPL-3.0-or-later",
    modelscript: {
      category: "library",
      language: "pscad",
      symbols: "./dist/symbols.json",
      diagrams: "./dist/diagrams.json",
    } satisfies ModelscriptLibraryManifest,
  };

  fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
  fs.writeFileSync(path.join(distDir, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
  fs.writeFileSync(path.join(distDir, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");
}
