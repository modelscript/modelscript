// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Native `modelscript.yaml` manifest schema, strict YAML 1.2 parser, and
 * comment-preserving CST editor for ModelScript projects and packages.
 *
 * Replaces `package.json` / `node_modules` interop with a ModelScript-owned layout:
 * - Manifest: `modelscript.yaml` (YAML 1.2)
 * - Lockfile: `modelscript.lock` (deterministic sorted JSON)
 * - Packages: `.modelscript/packages/`
 */

import { isMap, parseDocument, Scalar, stringify, type Document } from "yaml";
import type { ModelscriptLibraryManifest } from "./library-manifest.js";

export const MANIFEST_FILENAME = "modelscript.yaml";
export const LOCKFILE_FILENAME = "modelscript.lock";
export const WORKSPACE_DIR = ".modelscript";
export const PACKAGES_DIR = ".modelscript/packages";
export const CONNECTORS_DIR = ".modelscript/connectors";
export const CACHE_DIR = ".modelscript/cache";
export const TMP_DIR = ".modelscript/tmp";

export type PushCapability = "verification" | "links" | "defects-on-fail" | "artifacts";

export type MaterializeFormat = "sysml2" | "modelscript" | "reqif";

export type KnownAlmProtocol = "oslc" | "jama" | "codebeamer" | "polarion" | "jira";

export interface RemoteDependencySpec {
  /** Protocol-prefixed URI, e.g. `oslc+https://...`, `jama+https://...`, `jira+https://...`. */
  source: string;
  /** Optional query filter (e.g., JQL for Jira, OSLC query, tracker filter). */
  query?: string | undefined;
  /** Optional baseline or configuration identifier (e.g., DOORS GC, Jama/Codebeamer/Polarion baseline). */
  baseline?: string | undefined;
  /** Optional working-set or branch template (e.g., `branch:${git.branch}` for Codebeamer / DOORS changeset). */
  workingSet?: string | undefined;
  /** Optional SVN/item revision pin (e.g., Polarion revision). */
  revision?: string | undefined;
  /** Materialized projection format (defaults to `"sysml2"`). */
  format?: MaterializeFormat | undefined;
  /**
   * Optional relative path in the Git working tree where projections are materialized
   * (e.g., `"requirements/jama"`). When omitted, projections are cached under `.modelscript/packages/<name>/`.
   */
  materialize?: string | undefined;
  /** Authorized outbound push capabilities. Defaults to read-only (`[]`). */
  push?: PushCapability[] | undefined;
  /** Optional explicit connector override (defaults to protocol prefix of `source`). */
  connector?: string | undefined;
  /** Optional custom headers or connector-specific options (never store secrets here). */
  options?: Record<string, string | number | boolean> | undefined;
}

/**
 * A dependency entry in `modelscript.yaml`:
 * - Semver range string (e.g. `"^4.0.0"`) -> ModelScript Hub
 * - Local archive/path string (`"file:./libs/thermal.zip"`) -> local package
 * - Protocol URI string (`"oslc+https://..."`, `"jira+https://..."`, etc.) -> read-only ALM remote
 * - Structured `RemoteDependencySpec` object -> configurable ALM remote
 */
export type DependencySpec = string | RemoteDependencySpec;

export interface ModelScriptManifest {
  name: string;
  version: string;
  description?: string | undefined;
  license?: string | undefined;
  main?: string | undefined;
  languages?: string[] | undefined;
  modelicaVersion?: string | undefined;
  artifacts?: string[] | undefined;
  dependencies?: Record<string, DependencySpec> | undefined;
  peerDependencies?: Record<string, string> | undefined;
  workspaces?: string[] | undefined;
  /** Optional pre-indexed library / standard-pack metadata (when this package is a library). */
  library?: ModelscriptLibraryManifest | undefined;
}

export interface ParsedProtocolUri {
  /** Protocol name before `+` (e.g., `"oslc"`, `"jama"`, `"codebeamer"`, `"polarion"`, `"jira"`). */
  protocol: string;
  /** Underlying transport URL (e.g., `"https://elm.corp.com/rm/..."`). */
  url: string;
  /** Hostname (e.g., `"elm.corp.com"`), used for host-scoped auth lookup. */
  host: string;
  /** Pathname component of the URL. */
  pathname: string;
  /** Parsed query parameters from the URI. */
  params: Record<string, string>;
}

const PROTOCOL_URI_RE = /^([a-z][a-z0-9._-]*)\+(https?:\/\/.+)$/i;

/**
 * Parses a protocol-prefixed remote URI such as `oslc+https://elm.corp.com/rm/...`.
 * Returns `null` if the string is not a protocol-prefixed HTTP(S) URI.
 */
export function parseProtocolUri(spec: string): ParsedProtocolUri | null {
  const match = PROTOCOL_URI_RE.exec(spec.trim());
  if (!match) return null;

  const protocol = match[1]!.toLowerCase();
  const rawUrl = match[2]!;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const params: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  return {
    protocol,
    url: rawUrl,
    host: parsed.host,
    pathname: parsed.pathname,
    params,
  };
}

/**
 * Returns true if a dependency value refers to an API/protocol-based remote source.
 */
export function isRemoteDependency(spec: DependencySpec): boolean {
  if (typeof spec === "string") {
    return parseProtocolUri(spec) !== null;
  }
  return (
    typeof spec === "object" &&
    spec !== null &&
    typeof spec.source === "string" &&
    parseProtocolUri(spec.source) !== null
  );
}

/**
 * Normalizes either a compact URI string or a structured `RemoteDependencySpec`
 * into a canonical `RemoteDependencySpec` with parsed URI metadata.
 */
export function normalizeRemoteDependency(
  spec: DependencySpec,
): (RemoteDependencySpec & { parsed: ParsedProtocolUri }) | null {
  if (typeof spec === "string") {
    const parsed = parseProtocolUri(spec);
    if (!parsed) return null;
    return {
      source: spec,
      connector: parsed.protocol,
      baseline: parsed.params["config"] ?? parsed.params["baseline"],
      revision: parsed.params["rev"] ?? parsed.params["revision"],
      workingSet: parsed.params["workingSet"],
      format: "sysml2",
      push: [],
      parsed,
    };
  }
  if (typeof spec === "object" && spec !== null && typeof spec.source === "string") {
    const parsed = parseProtocolUri(spec.source);
    if (!parsed) return null;
    return {
      ...spec,
      connector: spec.connector ?? parsed.protocol,
      baseline: spec.baseline ?? parsed.params["config"] ?? parsed.params["baseline"],
      revision: spec.revision ?? parsed.params["rev"] ?? parsed.params["revision"],
      workingSet: spec.workingSet ?? parsed.params["workingSet"],
      format: spec.format ?? "sysml2",
      push: spec.push ?? [],
      parsed,
    };
  }
  return null;
}

/**
 * Resolves template placeholders such as `${git.branch}` inside remote dependency fields.
 */
export function resolveRemoteTemplates(
  value: string | undefined,
  context: { gitBranch?: string | undefined; env?: Record<string, string | undefined> | undefined },
): string | undefined {
  if (!value) return value;
  return value.replace(/\$\{([^}]+)\}/g, (_full, expr: string) => {
    const key = expr.trim();
    if (key === "git.branch") {
      return context.gitBranch || "main";
    }
    if (key.startsWith("env.")) {
      const envKey = key.slice(4);
      return context.env?.[envKey] ?? "";
    }
    return `\${${key}}`;
  });
}

/**
 * Parses `modelscript.yaml` content using strict YAML 1.2 Core Schema.
 * Throws a descriptive Error if syntax or required fields are invalid.
 */
export function parseModelScriptYaml(content: string, sourcePath?: string): ModelScriptManifest {
  const doc = parseDocument(content, {
    schema: "core",
    strict: true,
    uniqueKeys: true,
  });

  if (doc.errors.length > 0) {
    const loc = sourcePath ? ` in ${sourcePath}` : "";
    throw new Error(`Invalid YAML${loc}: ${doc.errors.map((e) => e.message).join("; ")}`);
  }

  const raw = doc.toJS() as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid ${MANIFEST_FILENAME}${sourcePath ? ` at ${sourcePath}` : ""}: expected a YAML mapping.`);
  }

  if (typeof raw["version"] === "number") {
    throw new Error(
      `Invalid ${MANIFEST_FILENAME}: 'version' must be a string (quote numeric versions like "${String(raw["version"])}").`,
    );
  }

  const name = typeof raw["name"] === "string" ? raw["name"].trim() : "";
  const version = typeof raw["version"] === "string" ? raw["version"].trim() : "0.0.0";
  if (!name) {
    throw new Error(
      `Invalid ${MANIFEST_FILENAME}${sourcePath ? ` at ${sourcePath}` : ""}: missing required 'name' field.`,
    );
  }

  return {
    ...(raw as unknown as ModelScriptManifest),
    name,
    version,
  };
}

/**
 * Serializes a `ModelScriptManifest` object to clean, deterministic YAML 1.2.
 */
export function stringifyModelScriptYaml(manifest: ModelScriptManifest): string {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(manifest)) {
    if (v !== undefined) {
      cleaned[k] = v;
    }
  }
  return stringify(cleaned, {
    schema: "core",
    indent: 2,
    lineWidth: 120,
  });
}

/**
 * Comment-preserving CST update: adds or replaces a single dependency in `modelscript.yaml`
 * while preserving all existing comments, key order, and formatting.
 */
export function upsertManifestDependency(yamlContent: string, depName: string, depSpec: DependencySpec): string {
  const doc: Document = parseDocument(yamlContent, {
    schema: "core",
    strict: true,
    keepSourceTokens: true,
  });

  if (doc.errors.length > 0) {
    throw new Error(`Cannot update ${MANIFEST_FILENAME}: ${doc.errors.map((e) => e.message).join("; ")}`);
  }

  if (!doc.contents || !isMap(doc.contents)) {
    doc.contents = doc.createNode({});
  }

  let depsNode = doc.get("dependencies", true);
  if (!depsNode || !isMap(depsNode)) {
    depsNode = doc.createNode({});
    doc.set("dependencies", depsNode);
  }

  const valueNode = typeof depSpec === "string" ? new Scalar(depSpec) : doc.createNode(depSpec);
  doc.setIn(["dependencies", depName], valueNode);
  return doc.toString({ lineWidth: 120 });
}

/**
 * Comment-preserving CST update: removes a dependency from `modelscript.yaml`.
 * Returns `{ content, removed }`.
 */
export function removeManifestDependency(yamlContent: string, depName: string): { content: string; removed: boolean } {
  const doc: Document = parseDocument(yamlContent, {
    schema: "core",
    strict: true,
    keepSourceTokens: true,
  });

  if (doc.errors.length > 0) {
    throw new Error(`Cannot update ${MANIFEST_FILENAME}: ${doc.errors.map((e) => e.message).join("; ")}`);
  }

  const removed = doc.deleteIn(["dependencies", depName]);
  return {
    content: doc.toString({ lineWidth: 120 }),
    removed,
  };
}

/**
 * Node.js helper: reads and parses `modelscript.yaml` from a project directory.
 * Returns `null` if `modelscript.yaml` does not exist.
 */
export async function readManifestFromDir(dirPath: string): Promise<ModelScriptManifest | null> {
  const fsId = "node:fs";
  const pathId = "node:path";
  const fs = await import(fsId);
  const path = await import(pathId);

  const manifestPath = path.join(dirPath, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return null;
  const raw = fs.readFileSync(manifestPath, "utf-8");
  return parseModelScriptYaml(raw, manifestPath);
}

/**
 * Node.js helper: writes `modelscript.yaml` to a project directory.
 */
export async function writeManifestToDir(dirPath: string, manifest: ModelScriptManifest): Promise<string> {
  const fsId = "node:fs";
  const pathId = "node:path";
  const fs = await import(fsId);
  const path = await import(pathId);

  const manifestPath = path.join(dirPath, MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, stringifyModelScriptYaml(manifest), "utf-8");
  return manifestPath;
}
