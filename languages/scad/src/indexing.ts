// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, SymbolIndex, UnifiedWorkspace } from "@modelscript/runtime";

export interface ScadDependency {
  type: "include" | "use";
  targetPath: string;
  startOffset: number;
  endOffset: number;
}

export interface ScadFileInfo {
  uri: string;
  sourceText?: string | undefined;
  index: SymbolIndex;
  modules: Map<string, SymbolEntry>;
  functions: Map<string, SymbolEntry>;
  variables: Map<string, SymbolEntry>;
  dependencies: ScadDependency[];
}

export const SCAD_INFO_KEY = "scadInfo";

function isIdentStart(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36; // A-Z, a-z, _, $
}

function isIdentChar(c: number): boolean {
  return isIdentStart(c) || (c >= 48 && c <= 57); // 0-9
}

/**
 * Declarative `indexing.indexFile` hook for OpenSCAD (`.scad`) models.
 *
 * Scans top-level modules, functions, variables, and `include <...>` / `use <...>`
 * directives (stripping comments without regex hacks) and stores per-file `ScadFileInfo`
 * in `UnifiedWorkspace`.
 */
export function indexScadDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const fileIndex = ctx.getFileIndex();

  const modules = new Map<string, SymbolEntry>();
  const functions = new Map<string, SymbolEntry>();
  const variables = new Map<string, SymbolEntry>();
  const dependencies: ScadDependency[] = [];

  const fileName = uri.split("/").pop() || uri;
  const rootId = ctx.addSymbol(
    fileName,
    "Class",
    null,
    0,
    text.length,
    {},
    {
      ruleName: "scad_file",
      namePath: fileName,
      resourceId: uri,
    },
  );

  let i = 0;
  const len = text.length;

  while (i < len) {
    // Skip whitespace
    if (text.charCodeAt(i) <= 32) {
      i++;
      continue;
    }

    // Skip line comment
    if (text.charCodeAt(i) === 47 && text.charCodeAt(i + 1) === 47) {
      i += 2;
      while (i < len && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i++;
      continue;
    }

    // Skip block comment
    if (text.charCodeAt(i) === 47 && text.charCodeAt(i + 1) === 42) {
      i += 2;
      while (i < len - 1 && !(text.charCodeAt(i) === 42 && text.charCodeAt(i + 1) === 47)) i++;
      i += 2;
      continue;
    }

    // Check for include or use directive: `include <...>` or `use <...>`
    if (text.startsWith("include", i) && (text.charCodeAt(i + 7) <= 32 || text.charCodeAt(i + 7) === 60)) {
      const start = i;
      const openAngle = text.indexOf("<", i + 7);
      const closeAngle = openAngle !== -1 ? text.indexOf(">", openAngle) : -1;
      if (openAngle !== -1 && closeAngle !== -1) {
        const target = text.slice(openAngle + 1, closeAngle).trim();
        dependencies.push({ type: "include", targetPath: target, startOffset: start, endOffset: closeAngle + 1 });
        i = closeAngle + 1;
        continue;
      }
    }

    if (text.startsWith("use", i) && (text.charCodeAt(i + 3) <= 32 || text.charCodeAt(i + 3) === 60)) {
      const start = i;
      const openAngle = text.indexOf("<", i + 3);
      const closeAngle = openAngle !== -1 ? text.indexOf(">", openAngle) : -1;
      if (openAngle !== -1 && closeAngle !== -1) {
        const target = text.slice(openAngle + 1, closeAngle).trim();
        dependencies.push({ type: "use", targetPath: target, startOffset: start, endOffset: closeAngle + 1 });
        i = closeAngle + 1;
        continue;
      }
    }

    // Check for module declaration: `module name(...)`
    if (text.startsWith("module", i) && text.charCodeAt(i + 6) <= 32) {
      const start = i;
      i += 6;
      while (i < len && text.charCodeAt(i) <= 32) i++;
      const idStart = i;
      while (i < len && (isIdentChar(text.charCodeAt(i)) || (i === idStart && isIdentStart(text.charCodeAt(i))))) i++;
      const modName = text.slice(idStart, i).trim();
      if (modName) {
        const symId = ctx.addSymbol(
          modName,
          "Module",
          rootId,
          start,
          i,
          {},
          {
            ruleName: "module_declaration",
            namePath: `${fileName}.${modName}`,
            resourceId: uri,
          },
        );
        const entry = fileIndex.symbols.get(symId);
        if (entry) modules.set(modName, entry);
      }
      continue;
    }

    // Check for function declaration: `function name(...) =`
    if (text.startsWith("function", i) && text.charCodeAt(i + 8) <= 32) {
      const start = i;
      i += 8;
      while (i < len && text.charCodeAt(i) <= 32) i++;
      const idStart = i;
      while (i < len && (isIdentChar(text.charCodeAt(i)) || (i === idStart && isIdentStart(text.charCodeAt(i))))) i++;
      const fnName = text.slice(idStart, i).trim();
      if (fnName) {
        const symId = ctx.addSymbol(
          fnName,
          "Function",
          rootId,
          start,
          i,
          {},
          {
            ruleName: "function_declaration",
            namePath: `${fileName}.${fnName}`,
            resourceId: uri,
          },
        );
        const entry = fileIndex.symbols.get(symId);
        if (entry) functions.set(fnName, entry);
      }
      continue;
    }

    // Check for top-level variable assignment: `ident = expr;`
    if (isIdentStart(text.charCodeAt(i))) {
      const start = i;
      while (i < len && isIdentChar(text.charCodeAt(i))) i++;
      const varName = text.slice(start, i);
      let j = i;
      while (j < len && text.charCodeAt(j) <= 32) j++;
      if (j < len && text.charCodeAt(j) === 61 && text.charCodeAt(j + 1) !== 61) {
        const symId = ctx.addSymbol(
          varName,
          "Variable",
          rootId,
          start,
          j + 1,
          {},
          {
            ruleName: "variable_declaration",
            namePath: `${fileName}.${varName}`,
            resourceId: uri,
          },
        );
        const entry = fileIndex.symbols.get(symId);
        if (entry) variables.set(varName, entry);
        i = j + 1;
        continue;
      }
    }

    i++;
  }

  const info: ScadFileInfo = {
    uri,
    sourceText: text,
    index: fileIndex,
    modules,
    functions,
    variables,
    dependencies,
  };
  ctx.setParsedModel(info, SCAD_INFO_KEY);
}

/** Retrieves the indexed `ScadFileInfo` for `uri` from `workspace`. */
export function getScadFileInfo(workspace: UnifiedWorkspace, uri: string): ScadFileInfo | undefined {
  return workspace.getParsedModel<ScadFileInfo>(uri, SCAD_INFO_KEY);
}

/** Retrieves the raw source text for `uri` from `workspace`. */
export function getScadFileSource(workspace: UnifiedWorkspace, uri: string): string | undefined {
  return workspace.getDocumentText(uri) ?? getScadFileInfo(workspace, uri)?.sourceText;
}

/** Retrieves `include <...>` / `use <...>` dependencies for `uri` from `workspace`. */
export function getScadDependencies(workspace: UnifiedWorkspace, uri: string): ScadDependency[] {
  return getScadFileInfo(workspace, uri)?.dependencies ?? [];
}

/**
 * Resolves an `include <targetPath>` or `use <targetPath>` path to a registered URI in `workspace`.
 */
export function resolveScadDependencyUri(
  workspace: UnifiedWorkspace,
  targetPath: string,
  fromUri?: string,
): string | undefined {
  const cleanTarget = targetPath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!cleanTarget) return undefined;

  const allInfos = workspace.getAllParsedModels<ScadFileInfo>(SCAD_INFO_KEY);

  if (fromUri) {
    const normalizedFrom = fromUri.replace(/\\/g, "/");
    const slashIdx = normalizedFrom.lastIndexOf("/");
    if (slashIdx !== -1) {
      const baseDir = normalizedFrom.slice(0, slashIdx + 1);
      const combined = `${baseDir}${cleanTarget}`;
      const protoMatch = combined.match(/^([a-zA-Z]+:\/\/)(.*)$/);
      const prefix = protoMatch ? protoMatch[1]! : "";
      const rest = protoMatch ? protoMatch[2]! : combined;
      const segments = rest.split("/");
      const resolvedSegments: string[] = [];
      for (const seg of segments) {
        if (seg === ".") continue;
        if (seg === "..") {
          if (resolvedSegments.length > 0 && resolvedSegments[resolvedSegments.length - 1] !== "") {
            resolvedSegments.pop();
          }
        } else {
          resolvedSegments.push(seg);
        }
      }
      const candidateUri = `${prefix}${resolvedSegments.join("/")}`;
      if (allInfos.has(candidateUri)) return candidateUri;
    }
  }

  const strippedTarget = cleanTarget.replace(/^(\.\.\/)+/, "");
  for (const otherUri of allInfos.keys()) {
    if (otherUri === fromUri) continue;
    if (
      otherUri === cleanTarget ||
      otherUri.endsWith(`/${cleanTarget}`) ||
      otherUri.endsWith(cleanTarget) ||
      (strippedTarget && (otherUri === strippedTarget || otherUri.endsWith(`/${strippedTarget}`)))
    ) {
      return otherUri;
    }
  }

  return undefined;
}

/** Resolves an `include <targetPath>` or `use <targetPath>` directive to its `ScadFileInfo`. */
export function resolveScadDependencyInfo(
  workspace: UnifiedWorkspace,
  targetPath: string,
  fromUri?: string,
): ScadFileInfo | undefined {
  const uri = resolveScadDependencyUri(workspace, targetPath, fromUri);
  return uri ? getScadFileInfo(workspace, uri) : undefined;
}

/**
 * Resolves a module, function, or variable visible from `fromUri` in `workspace`,
 * taking `include <...>` and `use <...>` scoping rules into account.
 */
export function resolveScadVisibleSymbol(
  workspace: UnifiedWorkspace,
  name: string,
  fromUri: string,
): SymbolEntry | undefined {
  const fileInfo = getScadFileInfo(workspace, fromUri);
  if (!fileInfo) return undefined;

  // 1. Check local file symbols
  if (fileInfo.modules.has(name)) return fileInfo.modules.get(name);
  if (fileInfo.functions.has(name)) return fileInfo.functions.get(name);
  if (fileInfo.variables.has(name)) return fileInfo.variables.get(name);

  const allInfos = workspace.getAllParsedModels<ScadFileInfo>(SCAD_INFO_KEY);

  // 2. Check dependencies
  for (const dep of fileInfo.dependencies) {
    const resolvedDep = resolveScadDependencyInfo(workspace, dep.targetPath, fromUri);
    if (resolvedDep && resolvedDep.uri !== fromUri) {
      if (resolvedDep.modules.has(name)) return resolvedDep.modules.get(name);
      if (resolvedDep.functions.has(name)) return resolvedDep.functions.get(name);
      if (dep.type === "include" && resolvedDep.variables.has(name)) {
        return resolvedDep.variables.get(name);
      }
    }
    for (const [otherUri, otherInfo] of allInfos.entries()) {
      if (otherUri === fromUri) continue;
      if (otherUri.endsWith(dep.targetPath) || otherUri.endsWith(`/${dep.targetPath}`)) {
        if (otherInfo.modules.has(name)) return otherInfo.modules.get(name);
        if (otherInfo.functions.has(name)) return otherInfo.functions.get(name);
        if (dep.type === "include" && otherInfo.variables.has(name)) {
          return otherInfo.variables.get(name);
        }
      }
    }
  }

  return undefined;
}
