// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ModelicaDropTextEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}

export interface IconCoordSys {
  extent?: [[number, number], [number, number]] | undefined;
  initialScale?: number | undefined;
}

const MODELICA_CLASS_QUALIFIERS = new Set([
  "encapsulated",
  "partial",
  "replaceable",
  "expandable",
  "operator",
  "impure",
  "pure",
]);
const MODELICA_CLASS_KEYWORDS = new Set(["model", "class", "block", "record", "package", "connector", "type"]);

function isWsChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function isIdentStartChar(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function isWordTokenChar(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return isIdentStartChar(ch) || (c >= 48 && c <= 57);
}

function isSimpleAsciiIdent(s: string): boolean {
  if (!s || !isIdentStartChar(s[0]!)) return false;
  for (let i = 1; i < s.length; i++) {
    if (!isWordTokenChar(s[i]!)) return false;
  }
  return true;
}

function tokenizeAsciiWords(text: string, fromIndex = 0, maxTokens = Number.MAX_SAFE_INTEGER): string[] {
  const tokens: string[] = [];
  let i = fromIndex;
  while (i < text.length && tokens.length < maxTokens) {
    while (i < text.length && !isWordTokenChar(text[i]!)) i++;
    if (i >= text.length) break;
    const start = i;
    while (i < text.length && isWordTokenChar(text[i]!)) i++;
    tokens.push(text.slice(start, i));
  }
  return tokens;
}

function matchModelicaClassHeaderIndent(line: string, targetClassName?: string): string | null {
  let i = 0;
  while (i < line.length && isWsChar(line[i]!)) i++;
  const baseIndent = line.slice(0, i);
  const tokens = tokenizeAsciiWords(line, i, 6);
  let tokIdx = 0;
  while (tokIdx < tokens.length && MODELICA_CLASS_QUALIFIERS.has(tokens[tokIdx]!)) {
    tokIdx++;
  }
  const kw = tokens[tokIdx];
  if (!kw) return null;
  const validKw = MODELICA_CLASS_KEYWORDS.has(kw) || (targetClassName !== undefined && kw === "function");
  if (!validKw) return null;
  const nameTok = tokens[tokIdx + 1];
  if (!nameTok) return null;
  if (targetClassName !== undefined) {
    return nameTok === targetClassName ? baseIndent : null;
  }
  return isSimpleAsciiIdent(nameTok) ? baseIndent : null;
}

function countUnescapedDoubleQuotes(line: string): number {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "\\" && i + 1 < line.length) {
      i++;
      continue;
    }
    if (ch === '"') count++;
  }
  return count;
}

function findModelicaClassHeaderEndLine(lines: string[], className?: string): { line: number; indent: string } | null {
  for (let i = 0; i < lines.length; i++) {
    const baseIndent = matchModelicaClassHeaderIndent(lines[i]!, className);
    if (baseIndent === null) continue;
    const bodyIndent = `${baseIndent}  `;
    let afterLine = i;
    if (i + 1 < lines.length && lines[i + 1]!.trimStart().startsWith('"')) {
      afterLine = i + 1;
      let quoteCount = countUnescapedDoubleQuotes(lines[afterLine]!);
      while (quoteCount % 2 === 1 && afterLine + 1 < lines.length) {
        afterLine++;
        quoteCount += countUnescapedDoubleQuotes(lines[afterLine]!);
      }
    }
    return { line: afterLine, indent: bodyIndent };
  }
  return null;
}

function indentMultiline(block: string, indent: string): string {
  return block
    .split("\n")
    .map((l) => (l.trim().length > 0 ? `${indent}${l}` : ""))
    .join("\n");
}

function findMatchingCloseParen(text: string, openIdx: number): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
    } else if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i + 2);
      if (nl === -1) break;
      i = nl;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 1;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Extracts `Icon(coordinateSystem(extent={{x1,y1},{x2,y2}}, initialScale=...))` from a Modelica class slice.
 */
export function parseIconCoordinateSystemFromSource(classSlice: string): IconCoordSys | null {
  if (!classSlice || !classSlice.includes("Icon")) return null;
  const iconRe = /\bIcon\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = iconRe.exec(classSlice)) !== null) {
    const openIdx = match.index + match[0].length - 1;
    const closeIdx = findMatchingCloseParen(classSlice, openIdx);
    if (closeIdx === -1) continue;
    const iconInner = classSlice.slice(openIdx + 1, closeIdx);
    const csRe = /\bcoordinateSystem\s*\(/g;
    const csMatch = csRe.exec(iconInner);
    if (!csMatch) continue;
    const csOpen = csMatch.index + csMatch[0].length - 1;
    const csClose = findMatchingCloseParen(iconInner, csOpen);
    if (csClose === -1) continue;
    const csInner = iconInner.slice(csOpen + 1, csClose);
    const extMatch = csInner.match(
      /extent\s*=\s*\{\s*\{\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*\}\s*,\s*\{\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*\}\s*\}/,
    );
    const scaleMatch = csInner.match(/initialScale\s*=\s*([-+]?\d*\.?\d+)/);
    const extent: [[number, number], [number, number]] | undefined = extMatch
      ? [
          [Number(extMatch[1]), Number(extMatch[2])],
          [Number(extMatch[3]), Number(extMatch[4])],
        ]
      : undefined;
    const initialScale = scaleMatch ? Number(scaleMatch[1]) : undefined;
    if (extent || (initialScale !== undefined && Number.isFinite(initialScale))) {
      return { extent, initialScale };
    }
  }
  return null;
}

function formatPlacementAnnotation(x: number, y: number, iconCoord?: IconCoordSys | null): string {
  const rx = Math.round(x);
  const ry = Math.round(y);
  const scale =
    iconCoord?.initialScale && Number.isFinite(iconCoord.initialScale) && iconCoord.initialScale > 0
      ? iconCoord.initialScale
      : 0.1;
  const extent = iconCoord?.extent;
  let width = 200;
  let height = 200;
  if (extent && extent.length >= 2 && extent[0] && extent[1]) {
    const extW = Math.abs(extent[1][0] - extent[0][0]);
    const extH = Math.abs(extent[1][1] - extent[0][1]);
    if (extW > 0 && Number.isFinite(extW)) width = extW;
    if (extH > 0 && Number.isFinite(extH)) height = extH;
  }
  const halfW = (width * scale) / 2;
  const halfH = (height * scale) / 2;
  return `annotation(Placement(transformation(origin={${rx},${ry}}, extent={{-${halfW},-${halfH}},{${halfW},${halfH}}})))`;
}

/**
 * Derives a valid Modelica identifier from a document URI for scaffolding empty `.mo` files.
 */
export function deriveModelNameFromUri(uri: string): string {
  const rawName = decodeURIComponent(uri.split("/").pop() || "Model");
  const strippedExt = rawName.toLowerCase().endsWith(".mo") ? rawName.slice(0, -3) : rawName;
  let fileName = "";
  for (let i = 0; i < strippedExt.length; i++) {
    const ch = strippedExt[i]!;
    fileName += isWordTokenChar(ch) ? ch : "_";
  }
  if (!fileName) return "Model";
  return isIdentStartChar(fileName[0]!) ? fileName : `M_${fileName}`;
}

export interface ModelicaDropBuildParams<T extends { name?: string | undefined } = { name?: string | undefined }> {
  docText: string;
  uri: string;
  x: number;
  y: number;
  classInstance: T | null | undefined;
  resolved: {
    className: string;
    baseName: string;
    importPath?: string | undefined;
    stubBlock?: string | undefined;
  };
  compName: string;
  effectiveIconCoord: IconCoordSys | null;
  hasImport: boolean;
  computeComponentInsert?:
    | ((
        ci: T,
        className: string,
        compName: string,
        x: number,
        y: number,
        docText: string,
        componentIconCoord?: IconCoordSys | null,
      ) => ModelicaDropTextEdit[])
    | undefined;
}

/**
 * Builds atomic Modelica TextEdits for scaffolding empty `.mo` files or inserting
 * imports, foreign black-box stubs, and component declarations with Placement annotations.
 */
export function buildModelicaComponentDropEdits<
  T extends { name?: string | undefined } = { name?: string | undefined },
>(params: ModelicaDropBuildParams<T>): ModelicaDropTextEdit[] {
  const {
    docText,
    uri,
    x,
    y,
    classInstance,
    resolved,
    compName,
    effectiveIconCoord,
    hasImport,
    computeComponentInsert,
  } = params;

  if (!docText || docText.trim().length === 0 || !classInstance) {
    const modelName = deriveModelNameFromUri(uri);
    const bodyLines: string[] = [];
    if (resolved.importPath && !hasImport) {
      bodyLines.push(`  import ${resolved.importPath};`);
    }
    if (resolved.stubBlock) {
      bodyLines.push(indentMultiline(resolved.stubBlock, "  "));
    }
    bodyLines.push(`  ${resolved.className} ${compName} ${formatPlacementAnnotation(x, y, effectiveIconCoord)};`);
    const scaffold = `model ${modelName}\n${bodyLines.join("\n")}\nequation\nend ${modelName};\n`;
    if (!docText || docText.trim().length === 0) {
      const pos = { line: 0, character: 0 };
      return [{ range: { start: pos, end: pos }, newText: scaffold }];
    }
    const lines = docText.split("\n");
    const lastLine = Math.max(0, lines.length - 1);
    const endPos = { line: lastLine, character: (lines[lastLine] ?? "").length };
    const prefix = docText.endsWith("\n") ? "" : "\n";
    return [{ range: { start: endPos, end: endPos }, newText: `${prefix}${scaffold}` }];
  }

  const compEdits: ModelicaDropTextEdit[] = computeComponentInsert
    ? computeComponentInsert(classInstance, resolved.className, compName, x, y, docText, effectiveIconCoord)
    : [];

  const needsImport = Boolean(resolved.importPath && !hasImport);
  const importLine = needsImport ? `import ${resolved.importPath};` : undefined;
  const preambleChunks: string[] = [];
  if (importLine) preambleChunks.push(importLine);
  if (resolved.stubBlock) preambleChunks.push(resolved.stubBlock);

  if (preambleChunks.length === 0) {
    return compEdits;
  }

  const lines = docText.split("\n");
  const headerPos = findModelicaClassHeaderEndLine(lines, classInstance?.name);
  if (!headerPos) {
    const topPreamble = preambleChunks.join("\n") + "\n";
    const pos = { line: 0, character: 0 };
    return [{ range: { start: pos, end: pos }, newText: topPreamble }, ...compEdits];
  }

  const preambleText = preambleChunks.map((c) => indentMultiline(c, headerPos.indent)).join("\n");
  const headerLine = headerPos.line;
  const conflictsWithCompEdit = compEdits.some(
    (e) => e.range.start.line <= headerLine && e.range.end.line >= headerLine,
  );

  if (!conflictsWithCompEdit) {
    const endCol = lines[headerLine]?.length ?? 0;
    const pos = { line: headerLine, character: endCol };
    return [{ range: { start: pos, end: pos }, newText: `\n${preambleText}` }, ...compEdits];
  }

  if (compEdits.length > 0) {
    const first = compEdits[0]!;
    return [{ range: first.range, newText: `${preambleText}\n${first.newText}` }, ...compEdits.slice(1)];
  }

  const endCol = lines[headerLine]?.length ?? 0;
  const pos = { line: headerLine, character: endCol };
  return [{ range: { start: pos, end: pos }, newText: `\n${preambleText}` }];
}
