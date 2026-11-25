// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "@modelscript/modelica/context";
import { UnifiedWorkspace } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { PolyglotHostLike, ServerContext } from "../types.js";

/**
 * Structural interface for a parsed CST node used when inspecting inline Modelica syntax trees.
 */
export interface ParsedCstNode {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  isMissing?: boolean | undefined;
  hasError?: (() => boolean) | boolean | undefined;
  children?: readonly ParsedCstNode[] | undefined;
  childForFieldName?: ((name: string) => ParsedCstNode | null | undefined) | undefined;
}

/**
 * Raw diagnostic object yielded by `QueryEngine.runAllLints()`.
 */
export interface RawLintEntry {
  symbolId?: number | null | undefined;
  file?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
  severity?: string | undefined;
  code?: string | number | undefined;
  lintName?: string | undefined;
  rule?: string | undefined;
  message?: string | undefined;
}

/**
 * Extended symbol entry shape with optional source line/column and metadata fields.
 */
export interface IndexedSymbolWithLocation {
  id?: number | undefined;
  name?: string | undefined;
  qualifiedName?: string | undefined;
  kind?: string | undefined;
  classRestriction?: string | undefined;
  language?: string | undefined;
  resourceId?: string | undefined;
  startLine?: number | undefined;
  line?: number | undefined;
  startColumn?: number | undefined;
  column?: number | undefined;
  metadata?:
    | {
        value?: unknown;
        defaultValue?: unknown;
        unit?: unknown;
      }
    | null
    | undefined;
}

/**
 * Wrapper or direct `UnifiedWorkspace` container stored on `ServerContext.workspace`.
 */
export interface WorkspaceHolder {
  unifiedWorkspace?: UnifiedWorkspace | undefined;
  getIndex?: ((options?: { eager?: boolean | undefined }) => ReturnType<UnifiedWorkspace["getIndex"]>) | undefined;
  polyglot?: PolyglotHostLike | undefined;
}

/**
 * Extracts a human-readable message from an unknown caught error value.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return String(err);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isPathInsideRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function findAllowedWorkspaceRoot(): string {
  const configured = process.env["MSX_MCP_WORKSPACE_ROOT"];
  if (configured && configured.trim() !== "") {
    return path.resolve(configured.trim());
  }
  const cwd = process.cwd();
  let dir = cwd;
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const raw = fs.readFileSync(pkgPath, "utf-8");
        const parsed = JSON.parse(raw) as { workspaces?: unknown };
        if (parsed.workspaces) {
          return dir;
        }
      } catch {
        // Ignore unreadable/malformed package.json while resolving root
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
}

export function resolveWorkspacePath(inputPath: string): string {
  if (!inputPath || inputPath.includes("\0")) {
    throw new Error("Invalid file path: path must be a non-empty string without null bytes.");
  }
  const allowedRoot = findAllowedWorkspaceRoot();
  const candidate = path.resolve(process.cwd(), inputPath);
  if (!isPathInsideRoot(allowedRoot, candidate)) {
    throw new Error(`Access denied: path '${inputPath}' resolves outside workspace root.`);
  }
  const realRoot = fs.existsSync(allowedRoot) ? fs.realpathSync(allowedRoot) : allowedRoot;
  if (fs.existsSync(candidate)) {
    const realTarget = fs.realpathSync(candidate);
    if (!isPathInsideRoot(realRoot, realTarget)) {
      throw new Error(`Access denied: path '${inputPath}' resolves outside workspace root via symlink.`);
    }
    return realTarget;
  }
  let probe = path.dirname(candidate);
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (fs.existsSync(probe)) {
    const realAncestor = fs.realpathSync(probe);
    if (!isPathInsideRoot(realRoot, realAncestor)) {
      throw new Error(`Access denied: path '${inputPath}' escapes workspace root via symlink ancestor.`);
    }
  }
  return candidate;
}

export function resolveSourceOrWorkspaceFile(source: string): string {
  if (!source || source.includes("\n") || source.trimStart().startsWith("<")) {
    return source;
  }
  const candidate = path.resolve(process.cwd(), source);
  const allowedRoot = findAllowedWorkspaceRoot();
  if ((path.isAbsolute(source) || source.includes("..")) && !isPathInsideRoot(allowedRoot, candidate)) {
    throw new Error(`Access denied: path '${source}' resolves outside workspace root.`);
  }
  if (fs.existsSync(candidate)) {
    const safePath = resolveWorkspacePath(source);
    return fs.readFileSync(safePath, "utf-8");
  }
  return source;
}

/**
 * Resolves the active `PolyglotHostLike` instance from `ServerContext`, if present.
 */
export function getPolyglotHost(ctx: ServerContext): PolyglotHostLike | undefined {
  if (ctx.polyglotHost && typeof ctx.polyglotHost === "object") {
    return ctx.polyglotHost as PolyglotHostLike;
  }
  const wsHolder = ctx.workspace as WorkspaceHolder | null | undefined;
  return wsHolder?.polyglot;
}

/**
 * Recursively collects all CST descendant nodes satisfying `predicate`.
 */
export function findDescendants(
  n: ParsedCstNode | null | undefined,
  predicate: (node: ParsedCstNode) => boolean,
  out: ParsedCstNode[] = [],
): ParsedCstNode[] {
  if (!n) return out;
  if (predicate(n)) out.push(n);
  for (const child of n.children || []) findDescendants(child, predicate, out);
  return out;
}

/**
 * Extracts the first top-level class definition name from Modelica code using the CST WASM parser.
 */
export function extractFirstClassNameFromCst(context: Context | null | undefined, code: string): string | undefined {
  if (!context || !code || !code.trim()) return undefined;
  try {
    const tree = context.parse(".mo", code);
    const root = tree.rootNode as unknown as ParsedCstNode;
    const classNode = root?.children?.find((c) => c.type === "class_definition");
    if (!classNode) return undefined;
    const spec =
      classNode.childForFieldName?.("class_specifier") ??
      classNode.children?.find(
        (c) => c.type === "class_specifier" || c.type === "long_class_specifier" || c.type === "short_class_specifier",
      );
    const idNode =
      spec?.childForFieldName?.("name") ?? spec?.children?.find((c) => c.type === "IDENT" || c.type === "identifier");
    if (idNode?.text) return idNode.text.trim();
  } catch {}
  return undefined;
}

/**
 * Extracts structural metrics (states from der(), parameters, variables, equations)
 * from Modelica code by traversing the CST WASM parse tree.
 */
export function extractModelicaMetricsFromCst(
  context: Context | null | undefined,
  code: string,
): {
  stateCount: number;
  parameterCount: number;
  totalVars: number;
  algebraicCount: number;
  equationCount: number;
} | null {
  if (!context || !code || !code.trim()) return null;
  try {
    const tree = context.parse(".mo", code);
    const root = tree.rootNode as unknown as ParsedCstNode;
    let derCalls = 0;
    let paramDecls = 0;
    let varDecls = 0;
    let eqCount = 0;

    const walk = (node: ParsedCstNode | null | undefined): void => {
      if (!node) return;
      if (node.type === "call_expression") {
        const fn = node.children?.[0]?.text;
        if (fn === "der") derCalls++;
      } else if (node.type === "component_declaration") {
        const pfx = node.children?.find((c) => c.type === "declaration_prefixes" || c.type === "type_prefix");
        if (pfx?.text && (pfx.text.includes("parameter") || pfx.text.includes("constant"))) {
          paramDecls++;
        } else {
          varDecls++;
        }
      } else if (node.type === "equation_section") {
        for (const child of node.children || []) {
          if (child.type && (child.type.includes("equation") || child.type === "connect_equation")) {
            eqCount++;
          }
        }
      }
      for (const child of node.children || []) walk(child);
    };
    walk(root);

    const stateCount = Math.max(1, derCalls);
    const totalVars = Math.max(stateCount, varDecls, eqCount > 0 ? eqCount : 1);
    const algebraicCount = Math.max(0, totalVars - stateCount);
    const equationCount = eqCount > 0 ? eqCount : totalVars;
    return { stateCount, parameterCount: paramDecls, totalVars, algebraicCount, equationCount };
  } catch {
    return null;
  }
}

/**
 * Extracts equation strings from a flattened Modelica class using CST WASM parsing.
 */
export function extractEquationsFromCst(context: Context | null | undefined, flatText: string): string[] {
  if (!context || !flatText || !flatText.trim()) return [];
  const equations: string[] = [];
  try {
    const tree = context.parse(".mo", flatText);
    const root = tree.rootNode as unknown as ParsedCstNode;
    const walk = (node: ParsedCstNode | null | undefined): void => {
      if (!node) return;
      if (node.type === "equation_section") {
        for (const child of node.children || []) {
          const t = child.text?.trim();
          if (t && child.type !== "equation" && t !== "equation" && !child.type.includes("comment")) {
            equations.push(t);
          }
        }
        return;
      }
      for (const child of node.children || []) walk(child);
    };
    walk(root);
  } catch {}
  return equations;
}
