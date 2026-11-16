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

const SCAD_BUILTIN_NAMES = new Set([
  "module",
  "function",
  "include",
  "use",
  "if",
  "else",
  "for",
  "let",
  "each",
  "true",
  "false",
  "undef",
  "cube",
  "cylinder",
  "sphere",
  "polyhedron",
  "polygon",
  "circle",
  "square",
  "text",
  "surface",
  "import",
  "translate",
  "rotate",
  "scale",
  "resize",
  "mirror",
  "multmatrix",
  "color",
  "offset",
  "hull",
  "minkowski",
  "union",
  "difference",
  "intersection",
  "linear_extrude",
  "rotate_extrude",
  "projection",
  "render",
  "children",
  "echo",
  "assert",
  "tag_port",
  "fillet",
  "chamfer",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "abs",
  "ceil",
  "concat",
  "cross",
  "exp",
  "floor",
  "ln",
  "len",
  "log",
  "lookup",
  "max",
  "min",
  "norm",
  "pow",
  "rands",
  "round",
  "sign",
  "sqrt",
  "str",
  "chr",
  "ord",
  "search",
  "version",
  "version_num",
  "parent_module",
]);

/**
 * Declarative `indexing.indexFile` hook for OpenSCAD (`.scad`) models.
 *
 * Scans modules, functions, variables, `tag_port(...)` boundary ports, `include <...>` / `use <...>`
 * directives, and module/identifier references, storing per-file `ScadFileInfo` in `UnifiedWorkspace`.
 */
export function indexScadDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const fileIndex = ctx.getFileIndex() as SymbolIndex;

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
  let braceDepth = 0;
  let currentModuleId: number | null = null;
  let currentModuleBraceDepth = -1;
  let pendingModuleId: number | null = null;

  while (i < len) {
    const chCode = text.charCodeAt(i);

    // Skip whitespace
    if (chCode <= 32) {
      i++;
      continue;
    }

    // Skip string literal
    if (chCode === 34) {
      i++;
      while (i < len) {
        if (text.charCodeAt(i) === 92) {
          i += 2;
          continue;
        }
        if (text.charCodeAt(i) === 34) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Skip line comment
    if (chCode === 47 && text.charCodeAt(i + 1) === 47) {
      i += 2;
      while (i < len && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i++;
      continue;
    }

    // Skip block comment
    if (chCode === 47 && text.charCodeAt(i + 1) === 42) {
      i += 2;
      while (i < len - 1 && !(text.charCodeAt(i) === 42 && text.charCodeAt(i + 1) === 47)) i++;
      i += 2;
      continue;
    }

    // Track module scope braces
    if (chCode === 123) {
      braceDepth++;
      if (pendingModuleId !== null) {
        currentModuleId = pendingModuleId;
        currentModuleBraceDepth = braceDepth;
        pendingModuleId = null;
      }
      i++;
      continue;
    }
    if (chCode === 125) {
      if (currentModuleId !== null && braceDepth === currentModuleBraceDepth) {
        currentModuleId = null;
        currentModuleBraceDepth = -1;
      }
      braceDepth = Math.max(0, braceDepth - 1);
      i++;
      continue;
    }
    if (chCode === 59 && pendingModuleId !== null) {
      pendingModuleId = null;
    }

    // Check for include or use directive: `include <...>` or `use <...>`
    if (
      text.startsWith("include", i) &&
      (i === 0 || !isIdentChar(text.charCodeAt(i - 1))) &&
      (text.charCodeAt(i + 7) <= 32 || text.charCodeAt(i + 7) === 60)
    ) {
      const start = i;
      const openAngle = text.indexOf("<", i + 7);
      const closeAngle = openAngle !== -1 ? text.indexOf(">", openAngle) : -1;
      if (openAngle !== -1 && closeAngle !== -1) {
        const target = text.slice(openAngle + 1, closeAngle).trim();
        dependencies.push({ type: "include", targetPath: target, startOffset: start, endOffset: closeAngle + 1 });
        ctx.addSymbol(
          target,
          "Import",
          rootId,
          start,
          closeAngle + 1,
          { dependencyType: "include", targetPath: target, language: "scad" },
          { ruleName: "scad_import", namePath: target, resourceId: uri },
        );
        i = closeAngle + 1;
        continue;
      }
    }

    if (
      text.startsWith("use", i) &&
      (i === 0 || !isIdentChar(text.charCodeAt(i - 1))) &&
      (text.charCodeAt(i + 3) <= 32 || text.charCodeAt(i + 3) === 60)
    ) {
      const start = i;
      const openAngle = text.indexOf("<", i + 3);
      const closeAngle = openAngle !== -1 ? text.indexOf(">", openAngle) : -1;
      if (openAngle !== -1 && closeAngle !== -1) {
        const target = text.slice(openAngle + 1, closeAngle).trim();
        dependencies.push({ type: "use", targetPath: target, startOffset: start, endOffset: closeAngle + 1 });
        ctx.addSymbol(
          target,
          "Import",
          rootId,
          start,
          closeAngle + 1,
          { dependencyType: "use", targetPath: target, language: "scad" },
          { ruleName: "scad_import", namePath: target, resourceId: uri },
        );
        i = closeAngle + 1;
        continue;
      }
    }

    // Check for module declaration: `module name(...)`
    if (
      text.startsWith("module", i) &&
      (i === 0 || !isIdentChar(text.charCodeAt(i - 1))) &&
      text.charCodeAt(i + 6) <= 32
    ) {
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
          { language: "scad" },
          {
            ruleName: "module_declaration",
            namePath: `${fileName}.${modName}`,
            resourceId: uri,
            fieldRanges: { name: { startOffset: idStart, endOffset: i } },
          },
        );
        const entry = fileIndex.symbols.get(symId);
        if (entry) modules.set(modName, entry);
        pendingModuleId = symId;
      }
      continue;
    }

    // Check for function declaration: `function name(...) =`
    if (
      text.startsWith("function", i) &&
      (i === 0 || !isIdentChar(text.charCodeAt(i - 1))) &&
      text.charCodeAt(i + 8) <= 32
    ) {
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
          { language: "scad" },
          {
            ruleName: "function_declaration",
            namePath: `${fileName}.${fnName}`,
            resourceId: uri,
            fieldRanges: { name: { startOffset: idStart, endOffset: i } },
          },
        );
        const entry = fileIndex.symbols.get(symId);
        if (entry) functions.set(fnName, entry);
      }
      continue;
    }

    // Check for identifiers: `tag_port("...")`, assignments `ident = expr;`, or module/variable references
    if (isIdentStart(chCode)) {
      const start = i;
      while (i < len && isIdentChar(text.charCodeAt(i))) i++;
      const identName = text.slice(start, i);
      let j = i;
      while (j < len && text.charCodeAt(j) <= 32) j++;

      // `tag_port("portName", ...)`
      if (identName === "tag_port" && j < len && text.charCodeAt(j) === 40) {
        const closeParen = text.indexOf(")", j + 1);
        if (closeParen !== -1) {
          const argSlice = text.slice(j + 1, closeParen).trim();
          const qMatch = /^["']([^"']+)["']/.exec(argSlice);
          const portName = qMatch ? qMatch[1]!.trim() : (argSlice.split(",")[0]?.trim() ?? "");
          if (portName) {
            ctx.addSymbol(
              portName,
              "TaggedPort",
              currentModuleId ?? rootId,
              start,
              closeParen + 1,
              { isTaggedPort: true, isConnectorPort: true, language: "scad" },
              {
                ruleName: "TagPortOp",
                namePath: `${fileName}.${portName}`,
                resourceId: uri,
              },
            );
          }
          i = closeParen + 1;
          continue;
        }
      }

      // Variable assignment (top-level or inside module body; skip named call arguments inside `(...)`)
      if (j < len && text.charCodeAt(j) === 61 && text.charCodeAt(j + 1) !== 61 && pendingModuleId === null) {
        // Ensure we are not inside a call argument list by checking preceding non-ws token isn't `(` or `,`
        let prevIdx = start - 1;
        while (prevIdx >= 0 && text.charCodeAt(prevIdx) <= 32) prevIdx--;
        const prevChar = prevIdx >= 0 ? text.charCodeAt(prevIdx) : 59;
        if (prevChar !== 40 && prevChar !== 44) {
          const ownerId = currentModuleId ?? rootId;
          const symId = ctx.addSymbol(
            identName,
            "Variable",
            ownerId,
            start,
            j + 1,
            { language: "scad" },
            {
              ruleName: "variable_declaration",
              namePath: `${fileName}.${identName}`,
              resourceId: uri,
              fieldRanges: { name: { startOffset: start, endOffset: i } },
            },
          );
          const entry = fileIndex.symbols.get(symId);
          if (entry && currentModuleId === null) variables.set(identName, entry);
          i = j + 1;
          continue;
        }
      }

      // Reference to a user module, function, or variable
      if (!SCAD_BUILTIN_NAMES.has(identName) && !identName.startsWith("$")) {
        ctx.addSymbol(
          identName,
          "Reference",
          currentModuleId ?? rootId,
          start,
          i,
          { isCall: j < len && text.charCodeAt(j) === 40, language: "scad" },
          {
            ruleName: j < len && text.charCodeAt(j) === 40 ? "ModuleInstantiation" : "IdentifierRef",
            namePath: identName,
            resourceId: uri,
          },
        );
      }
      continue;
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

export interface ScadLspLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

function scadOffsetToPosition(text: string, offset: number): { line: number; character: number } {
  const clamped = Math.max(0, Math.min(text.length, offset));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: clamped - lineStart };
}

function scadSymbolUri(sym: SymbolEntry): string {
  return sym.resourceId || sym.documentUri || "";
}

function scadSymbolToLocation(sym: SymbolEntry, fallbackText?: string, workspace?: UnifiedWorkspace): ScadLspLocation {
  const symUri = scadSymbolUri(sym);
  const docText = workspace?.getDocument(symUri)?.text ?? fallbackText ?? "";
  const nameRange = sym.fieldRanges?.["name"];
  const startOff = nameRange?.startOffset ?? sym.startOffset ?? 0;
  const endOff = nameRange?.endOffset ?? sym.endOffset ?? startOff;
  return {
    uri: symUri,
    range: {
      start: scadOffsetToPosition(docText, startOff),
      end: scadOffsetToPosition(docText, Math.max(startOff, endOff)),
    },
  };
}

function extractScadIdentifierAtOffset(text: string, offset: number): string {
  if (offset < 0 || offset > text.length) return "";
  let start = offset;
  while (start > 0 && isIdentChar(text.charCodeAt(start - 1))) start--;
  let end = offset;
  while (end < text.length && isIdentChar(text.charCodeAt(end))) end++;
  return start < end && isIdentStart(text.charCodeAt(start)) ? text.slice(start, end) : "";
}

function collectCrossLanguageCounterparts(workspace: UnifiedWorkspace, symId: number): ScadLspLocation[] {
  const out: ScadLspLocation[] = [];
  const uIdx = workspace.getIndex();
  workspace.syncTggCorrespondences(uIdx);
  const peerIds = new Set<number>();

  const qe = workspace.getQueryEngine("scad") as { crossDomainBinding?: (id: number) => Set<number> } | undefined;
  if (qe?.crossDomainBinding) {
    for (const id of qe.crossDomainBinding(symId)) peerIds.add(id);
  }
  const indexer = workspace.tggCorrespondenceIndexer;
  for (const slot of indexer.getSlotsForSymbol(symId)) {
    const rec = indexer.hypergraph.getRecord(slot);
    if (!rec || rec.isRemoved) continue;
    for (const memberId of Object.values(rec.domainNodes)) {
      if (typeof memberId === "number" && memberId !== symId) peerIds.add(memberId);
    }
  }

  for (const peerId of peerIds) {
    const peer = uIdx.symbols.get(peerId);
    if (peer && scadSymbolUri(peer)) {
      out.push(scadSymbolToLocation(peer, undefined, workspace));
    }
  }
  return out;
}

/**
 * Resolves Go-to-Definition for OpenSCAD (`include`/`use` file jumps, local/imported modules,
 * functions, variables, `tag_port(...)` declarations, and TGG cross-language counterparts).
 */
export function getScadDefinition(
  text: string,
  offset: number,
  uri: string,
  workspace?: UnifiedWorkspace,
): ScadLspLocation | null {
  if (workspace && !getScadFileInfo(workspace, uri)) {
    workspace.indexDocumentText(uri, text, "scad");
  }

  const fileInfo = workspace ? getScadFileInfo(workspace, uri) : undefined;
  if (workspace && fileInfo) {
    // 1. Check if cursor is inside an `include <...>` or `use <...>` directive
    for (const dep of fileInfo.dependencies) {
      if (offset >= dep.startOffset && offset <= dep.endOffset) {
        const targetUri = resolveScadDependencyUri(workspace, dep.targetPath, uri);
        if (targetUri) {
          return {
            uri: targetUri,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          };
        }
      }
    }

    // 2. Check if cursor is on a `tag_port("name", ...)` declaration -> jump to TGG counterpart if aligned
    for (const sym of fileInfo.index.symbols.values()) {
      if (sym.kind === "TaggedPort" && offset >= sym.startOffset && offset <= sym.endOffset) {
        const peers = collectCrossLanguageCounterparts(workspace, sym.id);
        if (peers.length > 0) return peers[0]!;
        return scadSymbolToLocation(sym, text, workspace);
      }
    }
  }

  const ident = extractScadIdentifierAtOffset(text, offset);
  if (!ident) return null;

  if (workspace) {
    const visible = resolveScadVisibleSymbol(workspace, ident, uri);
    if (visible) {
      const nameRange = visible.fieldRanges?.["name"];
      const visibleStart = nameRange?.startOffset ?? visible.startOffset;
      const visibleEnd = nameRange?.endOffset ?? visible.endOffset;
      const visibleUri = scadSymbolUri(visible);
      // When cursor is already on the declaration site, jump to TGG cross-language counterpart if available
      if (visibleUri === uri && offset >= visibleStart && offset <= visibleEnd) {
        const peers = collectCrossLanguageCounterparts(workspace, visible.id);
        if (peers.length > 0) return peers[0]!;
      }
      return scadSymbolToLocation(visible, visibleUri === uri ? text : undefined, workspace);
    }

    // Check cross-language top-level symbols compatible with SCAD via TggSymbolProjectionTable
    const uIdx = workspace.getIndex();
    for (const candidateId of uIdx.byName.get(ident) ?? []) {
      const candidate = uIdx.symbols.get(candidateId);
      if (!candidate || candidate.language === "scad") continue;
      if (workspace.tggProjectionTable.canResolveAs("scad", candidate)) {
        return scadSymbolToLocation(candidate, undefined, workspace);
      }
    }
  }

  return null;
}

/**
 * Finds all intra-file, inter-file (`include`/`use`), and TGG cross-language references
 * for an OpenSCAD module, function, variable, or `tag_port`.
 */
export function getScadReferences(
  text: string,
  offset: number,
  uri: string,
  workspace?: UnifiedWorkspace,
): ScadLspLocation[] {
  if (!workspace) return [];
  if (!getScadFileInfo(workspace, uri)) {
    workspace.indexDocumentText(uri, text, "scad");
  }

  const results: ScadLspLocation[] = [];
  const seen = new Set<string>();
  const pushLoc = (loc: ScadLspLocation) => {
    const key = `${loc.uri}:${loc.range.start.line}:${loc.range.start.character}:${loc.range.end.line}:${loc.range.end.character}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(loc);
    }
  };

  const fileInfo = getScadFileInfo(workspace, uri);
  if (fileInfo) {
    for (const sym of fileInfo.index.symbols.values()) {
      if (sym.kind === "TaggedPort" && offset >= sym.startOffset && offset <= sym.endOffset) {
        pushLoc(scadSymbolToLocation(sym, text, workspace));
        for (const peer of collectCrossLanguageCounterparts(workspace, sym.id)) pushLoc(peer);
        return results;
      }
    }
  }

  const ident = extractScadIdentifierAtOffset(text, offset);
  if (!ident) return results;

  const targetDecl = resolveScadVisibleSymbol(workspace, ident, uri);
  if (targetDecl) {
    const declUri = scadSymbolUri(targetDecl);
    pushLoc(scadSymbolToLocation(targetDecl, declUri === uri ? text : undefined, workspace));
  }

  const allInfos = workspace.getAllParsedModels<ScadFileInfo>(SCAD_INFO_KEY);
  for (const [docUri, info] of allInfos.entries()) {
    for (const sym of info.index.symbols.values()) {
      if (sym.name !== ident) continue;
      if (sym.kind === "Reference") {
        const resolved = resolveScadVisibleSymbol(workspace, ident, docUri);
        if (!targetDecl || !resolved || resolved.id === targetDecl.id) {
          pushLoc(scadSymbolToLocation(sym, docUri === uri ? text : info.sourceText, workspace));
        }
      } else if (targetDecl && sym.id === targetDecl.id) {
        pushLoc(scadSymbolToLocation(sym, docUri === uri ? text : info.sourceText, workspace));
      }
    }
  }

  if (targetDecl) {
    for (const peer of collectCrossLanguageCounterparts(workspace, targetDecl.id)) {
      pushLoc(peer);
    }
  }

  return results;
}
