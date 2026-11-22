// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Virtual `modelscript.yaml` manifest projection from historical / native
 * language-specific package management manifests.
 *
 * When a project directory does not contain an explicit `modelscript.yaml`,
 * ModelScript inspects native language manifests (e.g., Modelica `package.mo`
 * `annotation(version="...", uses(...))`, Atopile `ato.yaml`, Fortran `fpm.toml`,
 * Python/PyPSA `pyproject.toml`, KiCad `sym-lib-table`/`fp-lib-table`,
 * COMBINE/OMEX `manifest.xml`, or legacy `modelscript.json`) and projects them
 * into a virtual `ModelScriptManifest` in memory without modifying the user's
 * repository.
 */

import { parse as parseYaml } from "yaml";
import { MANIFEST_FILENAME, parseModelScriptYaml, type DependencySpec, type ModelScriptManifest } from "./manifest.js";

export interface VirtualManifestProjection {
  /** The projected (or directly loaded) canonical ModelScript manifest. */
  manifest: ModelScriptManifest;
  /** `true` when synthesized from a historical/native language manifest rather than `modelscript.yaml`. */
  virtual: boolean;
  /** Identifier of the projector that produced this manifest (or `"modelscript.yaml"` when native). */
  projectorId: string;
  /** Language slug associated with the historical manifest (if projected). */
  language?: string | undefined;
  /** Relative filename of the source manifest that was read. */
  sourceFile: string;
}

export interface HistoricalManifestProjector {
  /** Unique identifier (e.g., `"modelica-package-mo"`). */
  id: string;
  /** Associated ModelScript language slug (e.g., `"modelica"`, `"atopile"`). */
  language: string;
  /** Candidate filenames checked in the project root, in order. */
  filenames: readonly string[];
  /** Project raw file text into a `ModelScriptManifest`, or return `null` if inapplicable. */
  project(content: string, context: { dirPath: string; dirName: string; filename: string }): ModelScriptManifest | null;
}

function stripModelicaComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Projects a Modelica `package.mo` (`package Name "desc" ... annotation(version="...", uses(...))`)
 * into a virtual `ModelScriptManifest`.
 */
export function projectModelicaPackageMo(content: string, dirName: string): ModelScriptManifest | null {
  const clean = stripModelicaComments(content);

  const declMatch = clean.match(
    /^\s*(?:within\s+[^;]*;\s*)?(?:encapsulated\s+|partial\s+)?(?:package|operator\s+record|record|model|class|block|connector|type|function)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+"([^"]*)")?/m,
  );
  const name = declMatch?.[1] ?? dirName;
  const description = declMatch?.[2] || undefined;

  const versionMatch = clean.match(/\bversion\s*=\s*"([^"]+)"/);
  const version = versionMatch?.[1] ?? "0.0.0";

  const dependencies: Record<string, DependencySpec> = {};
  const usesIdx = clean.search(/\buses\s*\(/i);
  if (usesIdx !== -1) {
    const startIdx = clean.indexOf("(", usesIdx) + 1;
    let depth = 1;
    let endIdx = startIdx;
    while (endIdx < clean.length && depth > 0) {
      if (clean[endIdx] === "(") depth++;
      else if (clean[endIdx] === ")") depth--;
      endIdx++;
    }
    const inner = clean.slice(startIdx, endIdx - 1);
    const depRegex = /([A-Za-z_][A-Za-z0-9_.]*)\s*\(\s*version\s*=\s*"([^"]+)"[^)]*\)/g;
    let m: RegExpExecArray | null;
    while ((m = depRegex.exec(inner)) !== null) {
      if (m[1] && m[2]) {
        dependencies[m[1]] = m[2];
      }
    }
  }

  return {
    name,
    version,
    ...(description ? { description } : {}),
    ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    languages: ["modelica"],
  };
}

/**
 * Projects an Atopile `ato.yaml` into a virtual `ModelScriptManifest`.
 */
export function projectAtopileYaml(content: string, dirName: string): ModelScriptManifest | null {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const pkg = (obj["package"] && typeof obj["package"] === "object" ? obj["package"] : {}) as Record<string, unknown>;
  const name =
    (typeof pkg["identifier"] === "string" && pkg["identifier"].trim()) ||
    (typeof pkg["name"] === "string" && pkg["name"].trim()) ||
    dirName;
  const version = typeof pkg["version"] === "string" && pkg["version"].trim() ? pkg["version"].trim() : "0.0.0";
  const description = typeof pkg["summary"] === "string" ? pkg["summary"] : undefined;

  const dependencies: Record<string, DependencySpec> = {};
  const rawDeps = obj["dependencies"];
  if (Array.isArray(rawDeps)) {
    for (const item of rawDeps) {
      if (typeof item === "string") {
        const [depName, depVer] = item.split("@");
        if (depName) dependencies[depName.trim()] = depVer?.trim() || "*";
      } else if (item && typeof item === "object") {
        const d = item as Record<string, unknown>;
        const depName =
          (typeof d["identifier"] === "string" && d["identifier"]) || (typeof d["name"] === "string" && d["name"]);
        if (depName) {
          const ver =
            typeof d["release"] === "string" ? d["release"] : typeof d["version"] === "string" ? d["version"] : "*";
          dependencies[depName] = ver;
        }
      }
    }
  } else if (rawDeps && typeof rawDeps === "object") {
    for (const [k, v] of Object.entries(rawDeps as Record<string, unknown>)) {
      if (typeof v === "string") dependencies[k] = v;
    }
  }

  return {
    name,
    version,
    ...(description ? { description } : {}),
    ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    languages: ["atopile"],
  };
}

/**
 * Projects a Fortran Package Manager `fpm.toml` into a virtual `ModelScriptManifest`.
 */
export function projectFortranFpmToml(content: string, dirName: string): ModelScriptManifest | null {
  const name = content.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] ?? dirName;
  const version = content.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1] ?? "0.0.0";
  const description = content.match(/^\s*description\s*=\s*"([^"]+)"/m)?.[1];

  const dependencies: Record<string, DependencySpec> = {};
  const depSection = content.match(/^\s*\[dependencies\]\s*\r?\n([\s\S]*?)(?=\r?\n\s*\[|$(?![\s\S]))/m)?.[1];
  if (depSection) {
    for (const line of depSection.split(/\r?\n/)) {
      const m = line.match(
        /^\s*([A-Za-z0-9_.-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*tag\s*=\s*"([^"]+)"[^}]*\}|\{[^}]*git\s*=\s*"([^"]+)"[^}]*\})/,
      );
      if (m?.[1]) {
        dependencies[m[1]] = m[2] ?? m[3] ?? m[4] ?? "*";
      }
    }
  }

  return {
    name,
    version,
    ...(description ? { description } : {}),
    ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    languages: ["fortran"],
  };
}

/**
 * Projects a Python `pyproject.toml` (e.g. PyPSA / scientific Python projects) into a virtual `ModelScriptManifest`.
 */
export function projectPyProjectToml(content: string, dirName: string): ModelScriptManifest | null {
  const projectBlock = content.match(/^\s*\[project\]\s*\r?\n([\s\S]*?)(?=\r?\n\s*\[|$(?![\s\S]))/m)?.[1];
  if (!projectBlock) return null;

  const name = projectBlock.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] ?? dirName;
  const version = projectBlock.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1] ?? "0.0.0";
  const description = projectBlock.match(/^\s*description\s*=\s*"([^"]+)"/m)?.[1];

  const dependencies: Record<string, DependencySpec> = {};
  const depsArrayMatch = projectBlock.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (depsArrayMatch?.[1]) {
    const itemRegex = /"([^"]+)"|'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = itemRegex.exec(depsArrayMatch[1])) !== null) {
      const spec = (m[1] ?? m[2] ?? "").trim();
      const parsed = spec.match(/^([A-Za-z0-9_.-]+)\s*(.*)$/);
      if (parsed?.[1]) {
        dependencies[parsed[1]] = parsed[2]?.trim() || "*";
      }
    }
  }

  return {
    name,
    version,
    ...(description ? { description } : {}),
    ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    languages: ["pypsa"],
  };
}

/**
 * Projects a KiCad `sym-lib-table` or `fp-lib-table` S-expression into a virtual `ModelScriptManifest`.
 */
export function projectKiCadLibTable(content: string, dirName: string): ModelScriptManifest | null {
  if (!/\((?:sym|fp)_lib_table\b/.test(content)) return null;
  const dependencies: Record<string, DependencySpec> = {};
  const libRegex = /\(lib\b[\s\S]*?\(name\s+"([^"]+)"\)[\s\S]*?\(uri\s+"([^"]+)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = libRegex.exec(content)) !== null) {
    if (m[1] && m[2]) {
      dependencies[m[1]] = m[2];
    }
  }
  return {
    name: dirName,
    version: "0.0.0",
    ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    languages: ["kicad"],
  };
}

/**
 * Projects a COMBINE / OMEX `manifest.xml` (SBML, CellML, SED-ML) into a virtual `ModelScriptManifest`.
 */
export function projectCombineOmexManifest(content: string, dirName: string): ModelScriptManifest | null {
  if (!/<omexManifest\b/i.test(content)) return null;
  const artifacts: string[] = [];
  const domains = new Set<string>();
  const contentRegex = /<content\b[^>]*location="([^"]+)"[^>]*format="([^"]*)"[^>]*\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = contentRegex.exec(content)) !== null) {
    const loc = m[1];
    const fmt = (m[2] ?? "").toLowerCase();
    if (loc && loc !== "." && loc !== "./manifest.xml") artifacts.push(loc.replace(/^\.\//, ""));
    if (fmt.includes("sbml")) domains.add("sbml");
    if (fmt.includes("cellml")) domains.add("cellml");
    if (fmt.includes("sed-ml") || fmt.includes("sedml")) domains.add("sedml");
  }
  return {
    name: dirName,
    version: "0.0.0",
    ...(artifacts.length > 0 ? { artifacts } : {}),
    languages: domains.size > 0 ? [...domains] : ["sbml", "sedml"],
  };
}

/**
 * Projects a legacy `modelscript.json` manifest into the canonical `ModelScriptManifest` structure.
 */
export function projectLegacyModelScriptJson(content: string, dirName: string): ModelScriptManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const name = typeof raw["name"] === "string" && raw["name"].trim() ? raw["name"].trim() : dirName;
  const version = typeof raw["version"] === "string" && raw["version"].trim() ? raw["version"].trim() : "0.0.0";
  const manifest: ModelScriptManifest = {
    name,
    version,
  };
  if (typeof raw["description"] === "string") manifest.description = raw["description"];
  if (typeof raw["license"] === "string") manifest.license = raw["license"];
  if (raw["dependencies"] && typeof raw["dependencies"] === "object") {
    manifest.dependencies = raw["dependencies"] as Record<string, DependencySpec>;
  }
  if (raw["peerDependencies"] && typeof raw["peerDependencies"] === "object") {
    manifest.peerDependencies = raw["peerDependencies"] as Record<string, string>;
  }
  if (Array.isArray(raw["files"])) {
    manifest.artifacts = raw["files"].filter((x): x is string => typeof x === "string");
  } else if (Array.isArray(raw["artifacts"])) {
    manifest.artifacts = raw["artifacts"].filter((x): x is string => typeof x === "string");
  }
  return manifest;
}

const BUILTIN_MANIFEST_PROJECTORS: HistoricalManifestProjector[] = [
  {
    id: "modelica-package-mo",
    language: "modelica",
    filenames: ["package.mo"],
    project: (content, ctx) => projectModelicaPackageMo(content, ctx.dirName),
  },
  {
    id: "atopile-ato-yaml",
    language: "atopile",
    filenames: ["ato.yaml"],
    project: (content, ctx) => projectAtopileYaml(content, ctx.dirName),
  },
  {
    id: "fortran-fpm-toml",
    language: "fortran",
    filenames: ["fpm.toml"],
    project: (content, ctx) => projectFortranFpmToml(content, ctx.dirName),
  },
  {
    id: "python-pyproject-toml",
    language: "pypsa",
    filenames: ["pyproject.toml"],
    project: (content, ctx) => projectPyProjectToml(content, ctx.dirName),
  },
  {
    id: "kicad-lib-table",
    language: "kicad",
    filenames: ["sym-lib-table", "fp-lib-table"],
    project: (content, ctx) => projectKiCadLibTable(content, ctx.dirName),
  },
  {
    id: "combine-omex-manifest",
    language: "sbml",
    filenames: ["manifest.xml"],
    project: (content, ctx) => projectCombineOmexManifest(content, ctx.dirName),
  },
  {
    id: "legacy-modelscript-json",
    language: "modelscript",
    filenames: ["modelscript.json"],
    project: (content, ctx) => projectLegacyModelScriptJson(content, ctx.dirName),
  },
];

const registeredProjectors: HistoricalManifestProjector[] = [...BUILTIN_MANIFEST_PROJECTORS];

/**
 * Register a custom historical manifest projector (for additional language ecosystems).
 */
export function registerManifestProjector(projector: HistoricalManifestProjector): void {
  const idx = registeredProjectors.findIndex((p) => p.id === projector.id);
  if (idx >= 0) {
    registeredProjectors[idx] = projector;
  } else {
    registeredProjectors.push(projector);
  }
}

/**
 * Returns all currently registered historical manifest projectors.
 */
export function listManifestProjectors(): readonly HistoricalManifestProjector[] {
  return registeredProjectors;
}

/**
 * Attempts to project a virtual `ModelScriptManifest` from any historical/native
 * language manifest present in `dirPath`.
 */
export async function projectVirtualManifestFromDir(dirPath: string): Promise<VirtualManifestProjection | null> {
  const fsId = "node:fs";
  const pathId = "node:path";
  const fs = await import(fsId);
  const path = await import(pathId);

  const dirName = path.basename(path.resolve(dirPath)) || "unnamed";

  for (const projector of registeredProjectors) {
    for (const filename of projector.filenames) {
      const candidate = path.join(dirPath, filename);
      if (!fs.existsSync(candidate)) continue;
      try {
        const content = fs.readFileSync(candidate, "utf-8");
        const manifest = projector.project(content, { dirPath, dirName, filename });
        if (manifest) {
          return {
            manifest,
            virtual: true,
            projectorId: projector.id,
            language: projector.language,
            sourceFile: filename,
          };
        }
      } catch {
        // Skip unreadable or malformed candidate and try next projector
      }
    }
  }

  return null;
}

/**
 * Resolves a project's `ModelScriptManifest` from `dirPath`:
 * 1. If `modelscript.yaml` exists, parses and returns it (`virtual: false`).
 * 2. Otherwise, projects a virtual `modelscript.yaml` from any recognized
 *    historical/native language manifest (`virtual: true`).
 * 3. Returns `null` if neither exists.
 */
export async function resolveManifestFromDir(dirPath: string): Promise<VirtualManifestProjection | null> {
  const fsId = "node:fs";
  const pathId = "node:path";
  const fs = await import(fsId);
  const path = await import(pathId);

  const manifestPath = path.join(dirPath, MANIFEST_FILENAME);
  if (fs.existsSync(manifestPath)) {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    return {
      manifest: parseModelScriptYaml(raw, manifestPath),
      virtual: false,
      projectorId: MANIFEST_FILENAME,
      sourceFile: MANIFEST_FILENAME,
    };
  }

  return projectVirtualManifestFromDir(dirPath);
}
