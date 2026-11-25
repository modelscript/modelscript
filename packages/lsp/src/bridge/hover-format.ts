// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry } from "@modelscript/runtime";
import { type BridgeContext, getExportedChildren, getQualifiedName } from "./bridge-context.js";
import {
  collectClassAnnotationClauses,
  extractSysmlDocBlockFromCst,
  extractWithinPackageFromSource,
  findAncestorOrSelfByType,
  findElementModificationByName,
  findModelicaClassSpecNode,
  getNodeEndOffset,
  getNodeStartOffset,
  stripAnnotationClausesFromCst,
  stripModelicaAnnotations,
} from "./cst-helpers.js";
import { modelicaHtmlToMarkdown } from "./html-to-markdown.js";
import {
  assembleClassSignature,
  collapseWs,
  ensureTrailingSemicolon,
  extractLeadingCommentDoc,
  extractSysmlDocBlockContent,
  extractTrailingModelicaString,
  findWordOutsideStringsComments,
  matchNestedLongClassStart,
  matchTrailingEndClass,
  normalizeHeaderWhitespace,
  normalizeTrailingSemicolon,
  pushFormattedMemberLines,
  readIdentAt,
  skipModelicaConcatString,
  skipModelicaString,
  skipModelicaTrivia,
  skipWs,
  startsWithWordAt,
  stripOuterQuotes,
  stripSysmlDocBlocks,
  stripTrailingSemicolon,
  stripTrailingStringCommentAndSemi,
  unescapeModelicaString,
} from "./lexical-helpers.js";
import { resolveTypeOf } from "./resolution.js";
import {
  extractComponentClausePrefix,
  getEntryCstNode,
  getEntryFullSourceText,
  getEntrySourceSlice,
  getRootCstNode,
} from "./source-access.js";

/**
 * Formats a clean, IDE-grade Modelica class/model/block/connector/record/function/type/package
 * declaration signature from CST nodes when available (or its raw CST source span as fallback),
 * keeping the class header, public `extends` clauses, and public parameter/port/component declarations
 * while stripping `annotation(...)` blocks and `protected`/`equation`/`algorithm` implementation sections.
 */
export function formatModelicaClassSignature(ctx: BridgeContext, rawClassText: string, entry: SymbolEntry): string {
  const rawNode = getEntryCstNode(ctx, entry);
  const classNode = findAncestorOrSelfByType(
    rawNode,
    ["class_definition", "short_class_definition"],
    ["element_list", "stored_definition", "program"],
  );
  if (classNode && !classNode.hasError) {
    const specNode = findModelicaClassSpecNode(classNode);
    const specName = specNode?.childForFieldName("name")?.text.trim();
    if (specNode && (!specName || specName === entry.name)) {
      if (specNode.type === "short_class_specifier" || specNode.type === "der_class_specifier") {
        const stripped = stripAnnotationClausesFromCst(classNode, (s) => stripModelicaAnnotations(s));
        const normalized = collapseWs(stripped);
        const withSemi = rawClassText.trim().endsWith(";") && !normalized.endsWith(";") ? `${normalized};` : normalized;
        return normalizeTrailingSemicolon(withSemi);
      }

      if (specNode.type === "long_class_specifier") {
        const baseStart = getNodeStartOffset(classNode);
        const compNode = specNode.childForFieldName("composition");
        const headerEndNode =
          specNode.childForFieldName("description") ??
          specNode.childForFieldName("class_modification") ??
          specNode.childForFieldName("name") ??
          compNode;
        const headerRelEnd = headerEndNode
          ? headerEndNode === compNode
            ? getNodeStartOffset(compNode) - baseStart
            : getNodeEndOffset(headerEndNode) - baseStart
          : classNode.text.length;
        const clampedEnd = Math.max(0, Math.min(headerRelEnd, classNode.text.length));
        const header = normalizeHeaderWhitespace(classNode.text.slice(0, clampedEnd));

        const memberLines: string[] = [];
        if (compNode) {
          let inPublic = true;
          for (const child of compNode.children) {
            if (child.type === "public") {
              inPublic = true;
              continue;
            }
            if (child.type === "protected") {
              inPublic = false;
              continue;
            }
            if (
              child.type === "equation_section" ||
              child.type === "algorithm_section" ||
              child.type === "external_clause"
            ) {
              break;
            }
            if (child.type === "element_list" && inPublic) {
              for (const el of child.namedChildren) {
                if (el.type === "annotation_clause") continue;
                if (el.type === "element") {
                  if (el.childForFieldName("import_clause")) continue;
                  const nestedClass = el.childForFieldName("class_definition");
                  const isReplaceable = el.children.some(
                    (c) => c.type === "replaceable" || (!c.isNamed && c.text === "replaceable"),
                  );
                  if (nestedClass && !isReplaceable) {
                    const nestedSpec = findModelicaClassSpecNode(nestedClass);
                    if (nestedSpec?.type === "long_class_specifier") continue;
                  }
                }
                const stripped = stripAnnotationClausesFromCst(el, (s) => stripModelicaAnnotations(s));
                const cleanedStmt = ensureTrailingSemicolon(stripped);
                if (cleanedStmt && cleanedStmt !== ";" && !startsWithWordAt(cleanedStmt, 0, "import")) {
                  pushFormattedMemberLines(memberLines, cleanedStmt);
                }
              }
            }
          }
        }

        return assembleClassSignature(header, memberLines, entry.name);
      }
    }
  }

  const trimmed = rawClassText.trim().replaceAll("\r\n", "\n");
  const trailingEndIdx = matchTrailingEndClass(trimmed, entry.name);

  // 1. Short class definition (e.g. `type Voltage = ElectricPotential;` or `type V = Real(...) "...";`)
  if (trailingEndIdx === -1) {
    const cleaned = collapseWs(stripModelicaAnnotations(trimmed));
    return normalizeTrailingSemicolon(cleaned);
  }

  // 2. Long class definition (`model Name "..." ... end Name;`)
  const withoutEnd = trimmed.slice(0, trailingEndIdx).trimEnd();

  // Locate the end of the class header (`[prefixes] classKind Name ["description"]`)
  const nameIdx = findWordOutsideStringsComments(withoutEnd, entry.name);
  if (nameIdx === -1) {
    return `${entry.metadata?.["classPrefixes"] || entry.metadata?.["classKind"] || "class"} ${entry.name}`;
  }

  let pos = nameIdx + entry.name.length;
  const afterName = skipWs(withoutEnd, pos);
  if (withoutEnd[afterName] === '"') {
    pos = skipModelicaConcatString(withoutEnd, afterName);
  }

  const header = normalizeHeaderWhitespace(withoutEnd.slice(0, pos));
  const body = withoutEnd.slice(pos);

  // Scan top-level statements inside `body`
  const memberLines: string[] = [];
  let i = 0;
  const bLen = body.length;
  let inPublic = true;
  let stmtStart = 0;
  let parenDepth = 0;
  let nestedClassDepth = 0;
  let nestedClassTargetEnd: string | null = null;

  while (i < bLen) {
    const ch = body[i]!;
    // Strings
    if (ch === '"') {
      i = skipModelicaString(body, i);
      continue;
    }
    // Line or block comment
    if (ch === "/" && (body[i + 1] === "/" || body[i + 1] === "*")) {
      i = skipModelicaTrivia(body, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      parenDepth++;
      i++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      parenDepth = Math.max(0, parenDepth - 1);
      i++;
      continue;
    }

    if (parenDepth === 0) {
      // Track nested long classes inside packages/models
      if (nestedClassDepth > 0) {
        if (startsWithWordAt(body, i, "end")) {
          let j = skipWs(body, i + "end".length);
          const idTok = readIdentAt(body, j);
          if (idTok && (!nestedClassTargetEnd || idTok.ident === nestedClassTargetEnd)) {
            j = skipWs(body, idTok.end);
            if (body[j] === ";") j++;
            nestedClassDepth = 0;
            nestedClassTargetEnd = null;
            i = j;
            stmtStart = i;
            continue;
          }
        }
        i++;
        continue;
      }

      // Check for top-level section keywords at statement start
      const leadingSlice = body.slice(stmtStart, i).trim();
      if (leadingSlice === "") {
        if (startsWithWordAt(body, i, "public")) {
          inPublic = true;
          i += "public".length;
          stmtStart = i;
          continue;
        }
        if (startsWithWordAt(body, i, "protected")) {
          inPublic = false;
          i += "protected".length;
          stmtStart = i;
          continue;
        }
        if (
          startsWithWordAt(body, i, "equation") ||
          startsWithWordAt(body, i, "algorithm") ||
          startsWithWordAt(body, i, "external")
        ) {
          break;
        }
        if (startsWithWordAt(body, i, "initial")) {
          const afterInit = skipWs(body, i + "initial".length);
          if (
            afterInit > i + "initial".length &&
            (startsWithWordAt(body, afterInit, "equation") || startsWithWordAt(body, afterInit, "algorithm"))
          ) {
            break;
          }
        }
        // Check if a nested long class starts here
        const nestedStart = matchNestedLongClassStart(body, i);
        if (nestedStart) {
          nestedClassDepth = 1;
          nestedClassTargetEnd = nestedStart.name;
          i = nestedStart.end;
          continue;
        }
      }

      if (ch === ";") {
        const rawStmt = body.slice(stmtStart, i + 1);
        stmtStart = i + 1;
        if (inPublic) {
          // Strip leading comments from statement
          const withoutLeadingComments = rawStmt.slice(skipModelicaTrivia(rawStmt, 0)).trim();
          const cleanedStmt = normalizeTrailingSemicolon(stripModelicaAnnotations(withoutLeadingComments));
          if (cleanedStmt && cleanedStmt !== ";" && !startsWithWordAt(cleanedStmt, 0, "import")) {
            pushFormattedMemberLines(memberLines, cleanedStmt);
          }
        }
      }
    }
    i++;
  }

  return assembleClassSignature(header, memberLines, entry.name);
}

/**
 * Formats a human-readable code signature for a `SymbolEntry` suitable for fenced code blocks in hover cards.
 */
export function formatDeclaration(ctx: BridgeContext, entry: SymbolEntry): string {
  if (ctx.activeFormatIds.has(entry.id)) {
    return `${entry.kind.toLowerCase()} ${entry.name}`;
  }
  ctx.activeFormatIds.add(entry.id);
  try {
    const meta = entry.metadata;
    const lang = entry.language ?? (entry.resourceId?.endsWith(".sysml") ? "sysml" : "modelica");
    let declStr = "";

    if (meta?.["isPredefined"]) {
      const cKind = typeof meta["classKind"] === "string" ? meta["classKind"] : "type";
      declStr = `${cKind} ${entry.name}`;
      const attrs = meta["completionMembers"];
      if (Array.isArray(attrs) && attrs.length > 0) {
        declStr += `(\n`;
        const lines: string[] = [];
        for (const attr of attrs) {
          if (typeof attr === "string") {
            const val = meta[attr];
            if (val === "") {
              lines.push(`  ${attr}`);
            } else {
              const valStr = typeof val === "string" ? `"${val}"` : String(val);
              lines.push(`  ${attr} = ${valStr}`);
            }
          }
        }
        declStr += lines.join(",\n");
        declStr += `\n)`;
      }
      return declStr;
    }

    const entryStart = entry.startOffset ?? 0;
    const entryEnd = entry.endOffset ?? 0;
    const source = entryEnd > entryStart ? getEntrySourceSlice(ctx, entry, entryStart, entryEnd) : null;

    if (
      entry.kind === "Class" ||
      entry.kind === "Function" ||
      entry.kind === "Package" ||
      entry.kind === "Type" ||
      entry.kind === "Struct" ||
      entry.kind === "Interface"
    ) {
      if (source) {
        if (lang === "modelica") {
          return formatModelicaClassSignature(ctx, source, entry);
        }
        // For ModelScript / SysML v2 / OpenSCAD functions: extract signature up to `{`
        if (entry.kind === "Function") {
          const braceIdx = source.indexOf("{");
          if (braceIdx !== -1) {
            return source.slice(0, braceIdx).trim();
          }
        }
        // For SysML v2 / ModelScript definitions/structs: strip `doc /* ... */` blocks and cap lines
        const withoutDoc = stripSysmlDocBlocks(source).trim();
        const lines = withoutDoc
          .split("\n")
          .map((l) => l.trimEnd())
          .filter((l, idx, arr) => !(l.trim() === "" && idx > 0 && arr[idx - 1]!.trim() === ""));
        if (lines.length > 18) {
          return [...lines.slice(0, 16), "  // ...", lines[lines.length - 1]!].join("\n");
        }
        return lines.join("\n");
      }

      // Fallback when source text is unavailable: synthesize from metadata and indexed children
      const classPrefix =
        (meta && typeof meta["classPrefixes"] === "string" && meta["classPrefixes"]) ||
        (meta && typeof meta["classKind"] === "string" && meta["classKind"]) ||
        entry.kind.toLowerCase();
      const rawDesc = meta && typeof meta["description"] === "string" ? stripOuterQuotes(meta["description"]) : "";
      declStr = `${classPrefix} ${entry.name}${rawDesc ? ` "${rawDesc}"` : ""}`;

      const childLines: string[] = [];
      for (const child of getExportedChildren(ctx, entry.id)) {
        if (child.kind === "Extends") {
          const extType =
            (typeof child.metadata?.["typeSpecifier"] === "string" && child.metadata["typeSpecifier"]) || child.name;
          if (extType) childLines.push(`  extends ${extType};`);
        } else if (child.kind === "Component" || child.kind === "Variable") {
          childLines.push(`  ${formatDeclaration(ctx, child)};`);
        }
      }
      if (childLines.length > 0 && lang === "modelica") {
        const capped =
          childLines.length > 15
            ? [...childLines.slice(0, 15), `  // ... (${childLines.length - 15} more declarations)`]
            : childLines;
        return `${declStr}\n${capped.join("\n")}\nend ${entry.name};`;
      }
      return declStr;
    }

    // Component / Variable / Property / Field declaration
    if (source) {
      const declNode = lang === "modelica" ? getEntryCstNode(ctx, entry) : null;
      let cleaned = stripTrailingStringCommentAndSemi(
        stripSysmlDocBlocks(stripModelicaAnnotations(source, declNode ?? undefined)),
        declNode,
      );

      // In Modelica CST, `component_declaration` starts at the component name (`V(start=1)`)
      // while `parameter SI.Voltage` is on the parent `component_clause`.
      if (
        (entry.kind === "Component" || entry.kind === "Variable") &&
        (cleaned === entry.name ||
          cleaned.startsWith(`${entry.name}(`) ||
          cleaned.startsWith(`${entry.name}[`) ||
          cleaned.startsWith(`${entry.name} `) ||
          cleaned.startsWith(`${entry.name}=`))
      ) {
        const clausePrefix = extractComponentClausePrefix(ctx, entry);
        if (clausePrefix?.fullPrefix) {
          cleaned = `${clausePrefix.fullPrefix} ${cleaned}`;
        } else {
          let prefix = "";
          if (meta && typeof meta["typePrefix"] === "string" && meta["typePrefix"]) {
            prefix += `${meta["typePrefix"].trim()} `;
          } else {
            if (meta && typeof meta["causality"] === "string" && meta["causality"]) prefix += `${meta["causality"]} `;
            if (meta && typeof meta["variability"] === "string" && meta["variability"])
              prefix += `${meta["variability"]} `;
          }
          if (meta && typeof meta["typeSpecifier"] === "string" && meta["typeSpecifier"]) {
            prefix += `${meta["typeSpecifier"].trim()} `;
          }
          if (prefix) {
            cleaned = `${prefix}${cleaned}`;
          }
        }
      }
      return cleaned;
    }

    if (meta && typeof meta["typePrefix"] === "string" && meta["typePrefix"]) {
      declStr += `${meta["typePrefix"].trim()} `;
    } else {
      if (meta && typeof meta["causality"] === "string" && meta["causality"]) declStr += `${meta["causality"]} `;
      if (meta && typeof meta["variability"] === "string" && meta["variability"]) declStr += `${meta["variability"]} `;
    }
    if (meta && typeof meta["typeSpecifier"] === "string" && meta["typeSpecifier"])
      declStr += `${meta["typeSpecifier"]} `;
    declStr += entry.name;

    return declStr;
  } finally {
    ctx.activeFormatIds.delete(entry.id);
  }
}

/**
 * Extracts the `Documentation(info="...")` HTML string from a Modelica class via its CST
 * `annotation_clause` nodes, falling back to string/comment-aware lexical scanning.
 */
export function extractModelicaDocumentationInfo(
  ctx: BridgeContext,
  rawClassText: string,
  entry?: SymbolEntry,
): string | null {
  const rawNode = getEntryCstNode(ctx, entry);
  const classNode = findAncestorOrSelfByType(
    rawNode,
    ["class_definition", "short_class_definition"],
    ["element_list", "stored_definition", "program"],
  );
  if (classNode && !classNode.hasError) {
    const annNodes = collectClassAnnotationClauses(classNode);
    for (const annNode of annNodes) {
      const outerClassMod = annNode.namedChildren.find((c) => c.type === "class_modification") ?? null;
      const docMod = findElementModificationByName(outerClassMod, "documentation");
      if (!docMod) continue;
      const docClassMod = docMod.childForFieldName("modification")?.childForFieldName("class_modification") ?? null;
      const infoMod = findElementModificationByName(docClassMod, "info");
      if (!infoMod) continue;
      const modExpr = infoMod.childForFieldName("modification")?.childForFieldName("modification_expression");
      if (!modExpr) continue;
      const exprText = modExpr.text;
      const firstTokenIdx = skipModelicaTrivia(exprText, 0);
      if (exprText[firstTokenIdx] === '"') {
        return unescapeModelicaString(exprText.slice(firstTokenIdx));
      }
    }
    return null;
  }

  // Fallback when CST is unavailable (e.g. unit test mocks) or has syntax errors
  const len = rawClassText.length;
  let i = 0;
  while (i < len) {
    const ch = rawClassText[i]!;
    if (ch === '"') {
      i = skipModelicaString(rawClassText, i);
      continue;
    }
    if (ch === "/" && (rawClassText[i + 1] === "/" || rawClassText[i + 1] === "*")) {
      i = skipModelicaTrivia(rawClassText, i);
      continue;
    }
    if ((ch === "d" || ch === "D") && startsWithWordAt(rawClassText, i, "Documentation", true)) {
      let j = skipModelicaTrivia(rawClassText, i + "Documentation".length);
      if (rawClassText[j] === "(") {
        j++;
        let depth = 1;
        while (j < len && depth > 0) {
          const inner = rawClassText[j]!;
          if (inner === '"') {
            j = skipModelicaString(rawClassText, j);
            continue;
          }
          if (inner === "/" && (rawClassText[j + 1] === "/" || rawClassText[j + 1] === "*")) {
            j = skipModelicaTrivia(rawClassText, j);
            continue;
          }
          if (inner === "(") {
            depth++;
            j++;
            continue;
          }
          if (inner === ")") {
            depth--;
            j++;
            continue;
          }
          if (depth === 1 && (inner === "i" || inner === "I") && startsWithWordAt(rawClassText, j, "info", true)) {
            const afterInfo = skipModelicaTrivia(rawClassText, j + "info".length);
            if (rawClassText[afterInfo] === "=") {
              const strStart = skipModelicaTrivia(rawClassText, afterInfo + 1);
              if (rawClassText[strStart] === '"') {
                const strEnd = skipModelicaConcatString(rawClassText, strStart);
                return unescapeModelicaString(rawClassText.slice(strStart, strEnd));
              }
            }
          }
          j++;
        }
        i = j;
        continue;
      }
    }
    i++;
  }
  return null;
}

/**
 * Extracts the short description string (`"..."`) for a Modelica class or component.
 */
export function extractShortDescription(
  ctx: BridgeContext,
  entry: SymbolEntry,
  rawSpan?: string | null,
): string | null {
  const metaDesc = entry.metadata?.["description"];
  if (typeof metaDesc === "string" && metaDesc.trim()) {
    const cleaned = unescapeModelicaString(metaDesc);
    if (cleaned) return cleaned;
  }

  const rawNode = getEntryCstNode(ctx, entry);
  if (entry.kind === "Class" || entry.kind === "Function" || entry.kind === "Package" || entry.kind === "Type") {
    const classNode = findAncestorOrSelfByType(
      rawNode,
      ["class_definition", "short_class_definition"],
      ["element_list", "stored_definition", "program"],
    );
    if (classNode && !classNode.hasError) {
      const specNode = findModelicaClassSpecNode(classNode);
      if (specNode?.type === "long_class_specifier") {
        const descStr = specNode.childForFieldName("description");
        return descStr ? unescapeModelicaString(descStr.text) : null;
      }
      if (specNode?.type === "short_class_specifier" || specNode?.type === "der_class_specifier") {
        const descContainer = specNode.childForFieldName("description");
        const descStr = descContainer?.namedChildren.find((c) => c.type === "description_string") ?? null;
        return descStr ? unescapeModelicaString(descStr.text) : null;
      }
    }
  } else if (entry.kind === "Component" || entry.kind === "Variable") {
    const compNode = findAncestorOrSelfByType(
      rawNode,
      ["component_declaration", "component_declaration1"],
      ["component_list", "component_clause", "element_list", "class_definition"],
    );
    if (compNode && !compNode.hasError) {
      const descContainer = compNode.childForFieldName("description");
      const descStr = descContainer?.namedChildren.find((c) => c.type === "description_string") ?? null;
      return descStr ? unescapeModelicaString(descStr.text) : null;
    }
  }

  const span = rawSpan !== undefined ? rawSpan : getEntrySourceSlice(ctx, entry, entry.startOffset, entry.endOffset);
  if (!span) return null;

  if (entry.kind === "Class" || entry.kind === "Function" || entry.kind === "Package" || entry.kind === "Type") {
    const headerSlice = span.slice(0, 600);
    const nameIdx = findWordOutsideStringsComments(headerSlice, entry.name);
    if (nameIdx !== -1 && nameIdx < 200) {
      const afterName = skipModelicaTrivia(span, nameIdx + entry.name.length);
      if (span[afterName] === '"') {
        const strEnd = skipModelicaConcatString(span, afterName);
        return unescapeModelicaString(span.slice(afterName, strEnd));
      }
    }
    if (span.length < 2000 && matchTrailingEndClass(span, entry.name) === -1) {
      const strippedAnn = stripTrailingSemicolon(stripModelicaAnnotations(span));
      const trailStr = extractTrailingModelicaString(strippedAnn);
      if (trailStr) {
        return unescapeModelicaString(trailStr);
      }
    }
    return null;
  }

  if (entry.kind === "Component" || entry.kind === "Variable") {
    const strippedAnn = stripTrailingSemicolon(stripModelicaAnnotations(span));
    const trailStr = extractTrailingModelicaString(strippedAnn);
    if (trailStr) {
      return unescapeModelicaString(trailStr);
    }
  }

  return null;
}

/**
 * Extracts leading `/** ... * /`, `/* ... * /`, or contiguous `//` doc comments immediately
 * preceding `entry` in its source file, as well as SysML v2 `doc /* ... * /` comments inside `rawSpan`.
 */
export function extractDocComments(ctx: BridgeContext, entry: SymbolEntry, rawSpan?: string | null): string | null {
  const comments: string[] = [];

  // 1. Leading comments immediately preceding the declaration (or its component_clause)
  const fullText = getEntryFullSourceText(ctx, entry);
  if (fullText) {
    let declStart = entry.startOffset ?? 0;
    if (entry.kind === "Component" || entry.kind === "Variable") {
      const clausePrefix = extractComponentClausePrefix(ctx, entry);
      if (clausePrefix && clausePrefix.clauseStartOffset < declStart) {
        declStart = clausePrefix.clauseStartOffset;
      }
    }
    // Move back to the start of the line if only horizontal whitespace precedes `declStart`
    let lineStart = declStart;
    while (lineStart > 0 && (fullText[lineStart - 1] === " " || fullText[lineStart - 1] === "\t")) {
      lineStart--;
    }

    const beforeDecl = fullText.slice(Math.max(0, lineStart - 4000), lineStart);
    const leadingDoc = extractLeadingCommentDoc(beforeDecl);
    if (leadingDoc) {
      comments.push(leadingDoc);
    }
  }

  // 2. SysML v2 `doc /* ... */` inside the element body (CST first, lexical scan fallback)
  const entryNode = getEntryCstNode(ctx, entry);
  const cstDoc = extractSysmlDocBlockFromCst(entryNode);
  if (cstDoc) {
    if (!comments.includes(cstDoc)) {
      comments.push(cstDoc);
    }
  } else if (rawSpan) {
    const cleanedDoc = extractSysmlDocBlockContent(rawSpan);
    if (cleanedDoc && !comments.includes(cleanedDoc)) {
      comments.push(cleanedDoc);
    }
  }

  return comments.length > 0 ? comments.join("\n\n") : null;
}

/**
 * Determines the enclosing package/class qualified name for `entry` (from `parentId` or `within ...;`).
 */
export function getEnclosingScopeName(ctx: BridgeContext, entry: SymbolEntry): string | null {
  if (entry.parentId !== null) {
    const parent = ctx.index.symbols.get(entry.parentId);
    if (parent && parent.name && parent.name !== "<anonymous>" && parent.ruleName !== "SourceFile") {
      const sep = entry.language === "sysml" || entry.resourceId?.endsWith(".sysml") ? "::" : ".";
      return getQualifiedName(ctx, parent, sep);
    }
  }
  const fullText = getEntryFullSourceText(ctx, entry);
  const withinName = extractWithinPackageFromSource(fullText, getRootCstNode(ctx, entry.resourceId));
  if (withinName) {
    return withinName;
  }
  return null;
}

/**
 * Renders Markdown hover text for a resolved `SymbolEntry`, including its full declaration
 * signature, description string, leading/inline doc comments, and Modelica `Documentation(info=...)`.
 */
export function hoverEntry(ctx: BridgeContext, entry: SymbolEntry): string {
  if (ctx.activeHoverIds.has(entry.id)) {
    return `\`\`\`modelica\n${entry.kind.toLowerCase()} ${entry.name}\n\`\`\``;
  }
  ctx.activeHoverIds.add(entry.id);
  try {
    try {
      const hoverResult = ctx.engine.query<string>("hover", entry.id);
      if (hoverResult) return hoverResult;
    } catch {
      // No hover query defined — fall back to default
    }

    const lang = entry.language ?? (entry.resourceId?.endsWith(".sysml") ? "sysml" : "modelica");
    const declStr = formatDeclaration(ctx, entry);

    let md = `\`\`\`${lang}\n${declStr}\n\`\`\``;

    const entryStart = entry.startOffset ?? 0;
    const entryEnd = entry.endOffset ?? 0;
    const rawSpan = entryEnd > entryStart ? getEntrySourceSlice(ctx, entry, entryStart, entryEnd) : null;

    const docSections: string[] = [];

    // 1. Short description string (e.g. `"Sine voltage source"` or `"Amplitude of sine wave"`)
    const shortDesc = extractShortDescription(ctx, entry, rawSpan);
    if (shortDesc) {
      if (entry.kind === "Class" || entry.kind === "Function" || entry.kind === "Package" || entry.kind === "Type") {
        docSections.push(`**${shortDesc}**`);
      } else {
        docSections.push(shortDesc);
      }
    }

    // 2. Leading `/** ... */`, `/* ... */`, `//` doc comments, or SysML v2 `doc /* ... */`
    const docComments = extractDocComments(ctx, entry, rawSpan);
    if (docComments && docComments !== shortDesc) {
      docSections.push(docComments);
    }

    // 3. Modelica `annotation(Documentation(info="<html>...</html>"))`
    if (
      rawSpan &&
      (entry.kind === "Class" || entry.kind === "Function" || entry.kind === "Package" || entry.kind === "Type")
    ) {
      const docInfoHtml = extractModelicaDocumentationInfo(ctx, rawSpan, entry);
      if (docInfoHtml) {
        const docInfoMd = modelicaHtmlToMarkdown(docInfoHtml);
        if (docInfoMd && docInfoMd !== shortDesc) {
          docSections.push(docInfoMd);
        }
      }
    }

    // 4. For components/variables, include resolved type description & FQN when informative
    if (entry.kind === "Component" || entry.kind === "Variable") {
      const typeDecl = resolveTypeOf(ctx, entry);
      if (typeDecl && !typeDecl.metadata?.["isPredefined"]) {
        const sep = lang === "sysml" ? "::" : ".";
        const typeFqn = getQualifiedName(ctx, typeDecl, sep) || typeDecl.name;
        const typeDesc = extractShortDescription(ctx, typeDecl);
        if (typeDesc || typeFqn.includes(".") || typeFqn.includes("::")) {
          docSections.push(`*Type:* \`${typeFqn}\`${typeDesc ? ` — ${typeDesc}` : ""}`);
        }
      }
    }

    // 5. Enclosing package / class scope footer
    const enclosingScope = getEnclosingScopeName(ctx, entry);
    if (enclosingScope) {
      docSections.push(`*Defined in \`${enclosingScope}\`*`);
    }

    if (docSections.length > 0) {
      md += `\n\n---\n\n${docSections.join("\n\n")}`;
    }
    return md;
  } finally {
    ctx.activeHoverIds.delete(entry.id);
  }
}
