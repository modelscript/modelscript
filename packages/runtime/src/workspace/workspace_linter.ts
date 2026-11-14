// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UnifiedWorkspace } from "./wasm_workspace.js";

/**
 * Supported inputs for multi-file workspace linters:
 * - A `UnifiedWorkspace` instance
 * - A `Map<uri, text>`
 * - A plain `Record<uri, text>`
 */
export type WorkspaceDocumentInput = UnifiedWorkspace | ReadonlyMap<string, string> | Readonly<Record<string, string>>;

export interface WorkspaceLintDiagnostic {
  uri: string;
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number | undefined;
  column?: number | undefined;
}

/**
 * Normalizes a `UnifiedWorkspace`, `Map<string, string>`, or `Record<string, string>`
 * into an ordered `Map<string, string>` of `uri -> sourceText`.
 */
export function collectWorkspaceDocuments(input: WorkspaceDocumentInput): Map<string, string> {
  const docs = new Map<string, string>();
  if (input instanceof Map) {
    for (const [uri, text] of input.entries()) {
      docs.set(uri, text);
    }
    return docs;
  }
  const maybeUnified = input as Partial<UnifiedWorkspace> & {
    getDocumentUris?: () => string[];
    getDocumentText?: (uri: string) => string | undefined;
    documents?: Map<string, { text?: string }>;
  };
  if (typeof maybeUnified.getDocumentUris === "function" && typeof maybeUnified.getDocumentText === "function") {
    for (const uri of maybeUnified.getDocumentUris()) {
      const text = maybeUnified.getDocumentText(uri);
      if (typeof text === "string") docs.set(uri, text);
    }
    return docs;
  }
  if (maybeUnified.documents instanceof Map) {
    for (const [uri, rec] of maybeUnified.documents.entries()) {
      if (typeof rec?.text === "string") docs.set(uri, rec.text);
    }
    return docs;
  }
  for (const [uri, text] of Object.entries(input as Record<string, string>)) {
    if (typeof text === "string") docs.set(uri, text);
  }
  return docs;
}

/**
 * Resolves a relative include/import path against a source document URI
 * and finds a matching key in `docs` (supporting exact, normalized POSIX, or basename fallback).
 */
export function resolveRelativeUri(
  fromUri: string,
  relPath: string,
  docs: ReadonlyMap<string, string>,
): string | undefined {
  const cleanRel = relPath
    .trim()
    .replace(/^["'<]+|["'>]+$/g, "")
    .replace(/\\/g, "/");
  if (!cleanRel) return undefined;
  if (docs.has(cleanRel)) return cleanRel;

  const normalizedFrom = fromUri.replace(/\\/g, "/");
  const slashIdx = normalizedFrom.lastIndexOf("/");
  const baseDir = slashIdx >= 0 ? normalizedFrom.slice(0, slashIdx + 1) : "";

  const joined = `${baseDir}${cleanRel}`;
  const parts: string[] = [];
  for (const seg of joined.split("/")) {
    if (seg === "" || seg === ".") {
      if (parts.length === 0 && joined.startsWith("/")) parts.push("");
      continue;
    }
    if (seg === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "") parts.pop();
    } else {
      parts.push(seg);
    }
  }
  const normalizedJoined = parts.join("/");
  if (docs.has(normalizedJoined)) return normalizedJoined;

  // Try matching by suffix or basename when URIs use file:// or virtual roots
  const targetSuffix = cleanRel.replace(/^\.\//, "");
  for (const candidate of docs.keys()) {
    const normCand = candidate.replace(/\\/g, "/");
    if (normCand === normalizedJoined || normCand.endsWith(`/${targetSuffix}`) || normCand === targetSuffix) {
      return candidate;
    }
  }
  const baseName = targetSuffix.split("/").pop();
  if (baseName) {
    for (const candidate of docs.keys()) {
      if (candidate.replace(/\\/g, "/").split("/").pop() === baseName) {
        return candidate;
      }
    }
  }
  return undefined;
}

/**
 * Detects if following include/import edges from `startUri` reaches a cycle.
 * Returns the cycle path `[start, ..., repeated]` if found, or `null`.
 */
export function findIncludeCycle(edges: ReadonlyMap<string, readonly string[]>, startUri: string): string[] | null {
  const stack: string[] = [];
  const onStack = new Set<string>();
  const visited = new Set<string>();

  function dfs(u: string): string[] | null {
    if (onStack.has(u)) {
      const idx = stack.indexOf(u);
      return [...stack.slice(idx), u];
    }
    if (visited.has(u)) return null;
    visited.add(u);
    onStack.add(u);
    stack.push(u);
    for (const next of edges.get(u) ?? []) {
      const cyc = dfs(next);
      if (cyc) return cyc;
    }
    stack.pop();
    onStack.delete(u);
    return null;
  }

  return dfs(startUri);
}
