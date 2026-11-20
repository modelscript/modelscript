// SPDX-License-Identifier: AGPL-3.0-or-later

import { splitStepArgs } from "./occ.js";
import { parseStepReferences, scanStepEntities, STEP_SCHEMA } from "./schema.js";

function isWsCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function isDigitCode(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isUpperAsciiOrDigitOrUnderscore(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || code === 95;
}

function skipWs(text: string, start: number): number {
  let i = start;
  while (i < text.length && isWsCode(text.charCodeAt(i))) i++;
  return i;
}

function offsetToPos(text: string, offset: number): { line: number; character: number } {
  let line = 0;
  let lastNl = -1;
  const clamped = Math.max(0, Math.min(text.length, offset));
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastNl = i;
    }
  }
  return { line, character: clamped - lastNl - 1 };
}

function isStepEntityIdToken(token: string): boolean {
  if (token.length < 2 || token[0] !== "#") return false;
  for (let i = 1; i < token.length; i++) {
    if (!isDigitCode(token.charCodeAt(i))) return false;
  }
  return true;
}

function isUpperStepTypeToken(token: string): boolean {
  if (token.length < 2) return false;
  const c0 = token.charCodeAt(0);
  if (c0 < 65 || c0 > 90) return false;
  for (let i = 1; i < token.length; i++) {
    if (!isUpperAsciiOrDigitOrUnderscore(token.charCodeAt(i))) return false;
  }
  return true;
}

// ── STEP Hover ───────────────────────────────────────────────────────────────

export function getStepHover(offset: number, text: string, _uri?: string) {
  let start = offset;
  while (start > 0 && (isUpperAsciiOrDigitOrUnderscore(text.charCodeAt(start - 1)) || text[start - 1] === "#")) {
    start--;
  }
  let end = offset;
  while (end < text.length && isUpperAsciiOrDigitOrUnderscore(text.charCodeAt(end))) {
    end++;
  }

  const token = text.slice(start, end);

  if (isStepEntityIdToken(token)) {
    const entity = scanStepEntities(text).find((e) => e.id === token);
    if (entity) {
      return {
        contents: {
          kind: "markdown" as const,
          value: ["```step", text.slice(entity.startOffset, entity.endOffset).trim(), "```"].join("\n"),
        },
        range: {
          start: offsetToPos(text, start),
          end: offsetToPos(text, end),
        },
      };
    }
    return null;
  }

  if (isUpperStepTypeToken(token)) {
    const schema = STEP_SCHEMA[token];
    if (schema) {
      return {
        contents: {
          kind: "markdown" as const,
          value: [
            `**${token}**`,
            "",
            schema.description,
            "",
            "**Parameters:**",
            ...schema.parameters.map((p, i: number) => `${i + 1}. \`${p.name}\` — \`${p.type}\``),
          ].join("\n"),
        },
        range: {
          start: offsetToPos(text, start),
          end: offsetToPos(text, end),
        },
      };
    }
  }

  return null;
}

// ── STEP Signature Help ──────────────────────────────────────────────────────

function findEnclosingStepCall(textBefore: string): { entityName: string; argsStr: string } | undefined {
  let depth = 0;
  let inStr = false;
  for (let i = textBefore.length - 1; i >= 0; i--) {
    const ch = textBefore[i]!;
    if (ch === "'") {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === ")") {
      depth++;
    } else if (ch === "(") {
      if (depth > 0) {
        depth--;
        continue;
      }
      let nameEnd = i;
      while (nameEnd > 0 && isWsCode(textBefore.charCodeAt(nameEnd - 1))) nameEnd--;
      let nameStart = nameEnd;
      while (nameStart > 0 && isUpperAsciiOrDigitOrUnderscore(textBefore.charCodeAt(nameStart - 1))) nameStart--;
      if (nameStart < nameEnd) {
        const c0 = textBefore.charCodeAt(nameStart);
        if (c0 >= 65 && c0 <= 90) {
          return {
            entityName: textBefore.slice(nameStart, nameEnd),
            argsStr: textBefore.slice(i + 1),
          };
        }
      }
      return undefined;
    }
  }
  return undefined;
}

export function getStepSignatureHelp(
  document: { getText: () => string; offsetAt: (pos: { line: number; character: number }) => number },
  position: { line: number; character: number },
) {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const searchStart = Math.max(0, offset - 2000);
  const textBefore = text.slice(searchStart, offset);
  const call = findEnclosingStepCall(textBefore);
  if (!call) return null;

  const { entityName, argsStr } = call;
  const schema = STEP_SCHEMA[entityName];
  if (!schema) return null;

  let activeParameter = 0;
  let depth = 0;
  let inStr = false;
  for (const ch of argsStr) {
    if (ch === "'") inStr = !inStr;
    else if (!inStr && ch === "(") depth++;
    else if (!inStr && ch === ")") depth--;
    else if (!inStr && depth === 0 && ch === ",") activeParameter++;
  }

  return {
    signatures: [
      {
        label: `${entityName}(${schema.parameters.map((p) => p.name).join(", ")})`,
        documentation: schema.description,
        parameters: schema.parameters.map((p) => ({
          label: p.name,
          documentation: `Type: ${p.type}`,
        })),
      },
    ],
    activeSignature: 0,
    activeParameter,
  };
}

// ── STEP Formatting ──────────────────────────────────────────────────────────

function formatStepArgsCompact(args: string): string {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < args.length) {
    const ch = args[i]!;
    if (ch === "'") {
      out += ch;
      if (inString && args[i + 1] === "'") {
        out += args[i + 1]!;
        i += 2;
        continue;
      }
      inString = !inString;
      i++;
      continue;
    }
    if (inString) {
      out += ch;
      i++;
      continue;
    }
    if (ch === "," || ch === "=") {
      while (out.length > 0 && isWsCode(out.charCodeAt(out.length - 1))) {
        out = out.slice(0, -1);
      }
      out += ch;
      i = skipWs(args, i + 1);
      continue;
    }
    if (ch === "(") {
      out += ch;
      i = skipWs(args, i + 1);
      continue;
    }
    if (ch === ")") {
      while (out.length > 0 && isWsCode(out.charCodeAt(out.length - 1))) {
        out = out.slice(0, -1);
      }
      out += ch;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out.trim();
}

const STEP_SECTION_PREFIXES = ["ISO-10303-21;", "END-ISO-10303-21;", "HEADER;", "ENDSEC;"];

function pushStepGapLines(segment: string, out: string[]): void {
  const pushLine = (trimmed: string) => {
    if (!trimmed) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      return;
    }
    out.push(trimmed);
  };

  for (const rawLine of segment.split("\n")) {
    let rem = rawLine.trim();
    if (!rem) {
      pushLine("");
      continue;
    }
    while (rem.length > 0) {
      let matchedSection = false;
      for (const kw of STEP_SECTION_PREFIXES) {
        if (rem.startsWith(kw)) {
          pushLine(kw);
          rem = rem.slice(kw.length).trimStart();
          matchedSection = true;
          break;
        }
      }
      if (matchedSection) continue;

      if (rem.startsWith("DATA")) {
        let p = skipWs(rem, 4);
        if (rem[p] === "(") {
          let depth = 0;
          let inStr = false;
          while (p < rem.length) {
            const c = rem[p]!;
            if (c === "'") {
              if (inStr && rem[p + 1] === "'") {
                p += 2;
                continue;
              }
              inStr = !inStr;
            } else if (!inStr) {
              if (c === "(") depth++;
              else if (c === ")" && --depth === 0) {
                p++;
                break;
              }
            }
            p++;
          }
          p = skipWs(rem, p);
        }
        if (rem[p] === ";") {
          pushLine(rem.slice(0, p + 1));
          rem = rem.slice(p + 1).trimStart();
          continue;
        }
      }

      let nextCut = rem.length;
      for (const kw of STEP_SECTION_PREFIXES) {
        const idx = rem.indexOf(kw);
        if (idx > 0 && idx < nextCut) nextCut = idx;
      }
      const dataIdx = rem.indexOf("DATA");
      if (dataIdx > 0 && dataIdx < nextCut) {
        const afterData = skipWs(rem, dataIdx + 4);
        if (rem[afterData] === ";" || rem[afterData] === "(") nextCut = dataIdx;
      }
      pushLine(rem.slice(0, nextCut).trim());
      rem = rem.slice(nextCut).trimStart();
    }
  }
}

export function formatStepDocument(document: {
  getText: () => string;
  lineCount: number;
  offsetAt: (pos: { line: number; character: number }) => number;
}) {
  const normalized = document.getText().replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const entities = scanStepEntities(normalized);
  const resultLines: string[] = [];

  let cursor = 0;
  for (const entity of entities) {
    if (entity.startOffset > cursor) {
      pushStepGapLines(normalized.slice(cursor, entity.startOffset), resultLines);
    }
    const typePrefix = entity.type === "COMPLEX_ENTITY" ? "" : entity.type;
    resultLines.push(`${entity.id}=${typePrefix}(${formatStepArgsCompact(entity.args)});`);
    cursor = entity.endOffset;
  }
  if (cursor < normalized.length) {
    pushStepGapLines(normalized.slice(cursor), resultLines);
  }

  while (resultLines.length > 0 && resultLines[0] === "") resultLines.shift();
  while (resultLines.length > 0 && resultLines[resultLines.length - 1] === "") resultLines.pop();

  const result = resultLines.join("\n") + "\n";

  const lastLine = document.lineCount - 1;
  const lastChar = document.getText().length - document.offsetAt({ line: lastLine, character: 0 });

  return [
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: lastLine, character: lastChar },
      },
      newText: result,
    },
  ];
}

export interface StepCodeLensContext {
  uri?: string | undefined;
  flags?: {
    showCadMetrics?: boolean | undefined;
    showDiagram?: boolean | undefined;
    showFileConversions?: boolean | undefined;
  };
  workspaceManager?: {
    getThreadsForUri?: (uri: string) => Array<{ domain?: string; meta?: { properties?: Record<string, unknown> } }>;
  };
}

function countStepEntities(text: string): number {
  let count = 0;
  let i = 0;
  while (i < text.length) {
    const hashIdx = text.indexOf("#", i);
    if (hashIdx === -1) break;
    let p = hashIdx + 1;
    const digitStart = p;
    while (p < text.length) {
      const code = text.charCodeAt(p);
      if (code < 48 || code > 57) break;
      p++;
    }
    if (p > digitStart) {
      while (p < text.length && (text[p] === " " || text[p] === "\t")) p++;
      if (text[p] === "=") count++;
    }
    i = Math.max(p, hashIdx + 1);
  }
  return count;
}

/**
 * Generates CodeLens actions for ISO-10303-21 STEP CAD documents.
 */
export function getStepCodeLenses(
  text: string,
  uri: string,
  ctx: StepCodeLensContext = {},
): Array<{
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  command?: { title: string; command: string; arguments?: unknown[] };
}> {
  const lenses: Array<{
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    command?: { title: string; command: string; arguments?: unknown[] };
  }> = [];
  const headerRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  const showCadMetrics = ctx.flags?.showCadMetrics ?? false;
  const showDiagram = ctx.flags?.showDiagram ?? false;
  const showFileConversions = ctx.flags?.showFileConversions ?? false;

  if (showCadMetrics) {
    const entityCount = countStepEntities(text);
    const threadEntries = ctx.workspaceManager?.getThreadsForUri?.(uri) ?? [];
    const threadProps = threadEntries[0]?.meta?.properties;
    const nodes = threadProps?.["nodes"];
    const elements = threadProps?.["elements"];
    const stepTitle =
      nodes !== undefined && elements !== undefined
        ? `📐 3D B-Rep Solid Geometry: ${Number(nodes).toLocaleString()} Nodes, ${Number(elements).toLocaleString()} Elements`
        : `📐 3D B-Rep Solid Geometry (${entityCount} STEP Entities)`;
    lenses.push({
      range: headerRange,
      command: {
        title: stepTitle,
        command: "modelscript.openStepViewer",
        arguments: [uri],
      },
    });
  }
  if (showDiagram) {
    lenses.push({
      range: headerRange,
      command: {
        title: "⊞ Open Interactive Diagram",
        command: "modelscript.openDiagram",
        arguments: [uri],
      },
    });
  }
  if (showFileConversions) {
    lenses.push({
      range: headerRange,
      command: {
        title: "🕸️ Discretize CAD to FEA Mesh (.inp)",
        command: "modelscript.generateFeaMesh",
        arguments: [uri],
      },
    });
    lenses.push({
      range: headerRange,
      command: {
        title: "🌪️ Discretize CAD to CFD Mesh (.su2)",
        command: "modelscript.generateCfdMesh",
        arguments: [uri],
      },
    });
  }
  return lenses;
}

export interface StepLspDiagnostic {
  severity: 1 | 2 | 3 | 4;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  message: string;
  source: string;
}

/**
 * Validates STEP entity references and schema argument arity against STEP_SCHEMA.
 */
export function validateStepReferencesAndSchema(
  text: string,
  positionAt: (offset: number) => { line: number; character: number },
): StepLspDiagnostic[] {
  const diagnostics: StepLspDiagnostic[] = [];
  const { definitions, references } = parseStepReferences(text);

  for (const ref of references) {
    if (!definitions.has(ref.id)) {
      diagnostics.push({
        severity: 1,
        range: { start: positionAt(ref.startOffset), end: positionAt(ref.endOffset) },
        message: `Reference to undefined entity '${ref.id}'`,
        source: "step",
      });
    }
  }

  for (const [, def] of definitions.entries()) {
    const schema = STEP_SCHEMA[def.type];
    if (schema) {
      const typeMatchIndex = def.text.indexOf(def.type);
      const typeStartOffset = typeMatchIndex !== -1 ? def.startOffset + typeMatchIndex : def.startOffset;
      let i = typeStartOffset + def.type.length;
      while (i < def.endOffset && isWsCode(text.charCodeAt(i))) i++;
      if (text[i] === "(") {
        const argsStart = i;
        let depth = 0;
        let inStr = false;
        let argCount = 0;
        let hasContent = false;

        for (i = argsStart; i < text.length; i++) {
          const ch = text[i]!;
          if (ch === "'") {
            if (inStr && text[i + 1] === "'") {
              i++;
            } else {
              inStr = !inStr;
            }
            hasContent = true;
          } else if (!inStr && ch === "(") {
            if (depth > 0) hasContent = true;
            depth++;
          } else if (!inStr && ch === ")") {
            depth--;
            if (depth === 0) {
              if (hasContent || argCount > 0) argCount++;
              break;
            }
            hasContent = true;
          } else if (!inStr && depth === 1 && ch === ",") {
            argCount++;
            hasContent = false;
          } else if (depth > 0 && !isWsCode(ch.charCodeAt(0))) {
            hasContent = true;
          }
        }

        const minArgs = schema.minParameters ?? schema.parameters.length;
        const maxArgs = schema.parameters.length;
        if (argCount < minArgs || argCount > maxArgs) {
          const expectedLabel = minArgs === maxArgs ? `${maxArgs}` : `${minArgs}..${maxArgs}`;
          diagnostics.push({
            severity: 1,
            range: {
              start: positionAt(typeStartOffset),
              end: positionAt(typeStartOffset + def.type.length),
            },
            message: `Schema violation for ${def.type}: expected ${expectedLabel} arguments, got ${argCount}.`,
            source: "step",
          });
        }
      }
    } else if (def.type !== "COMPLEX_ENTITY") {
      const typeMatchIndex = def.text.indexOf(def.type);
      const typeStartOffset = typeMatchIndex !== -1 ? def.startOffset + typeMatchIndex : def.startOffset;
      diagnostics.push({
        severity: 1,
        range: {
          start: positionAt(typeStartOffset),
          end: positionAt(typeStartOffset + def.type.length),
        },
        message: `Undefined STEP entity type '${def.type}'`,
        source: "step",
      });
    }
  }

  return diagnostics;
}

export function findStepEntityDefSpanInDocuments(
  stepDocs: ReadonlyArray<{ uri: string; text: string }>,
  currentUri: string,
  entityNum: string,
  targetFile?: string,
): { uri: string; text: string; startOffset: number; endOffset: number } | null {
  const sorted = targetFile
    ? [...stepDocs].sort((a, b) => (b.uri.includes(targetFile) ? 1 : 0) - (a.uri.includes(targetFile) ? 1 : 0))
    : stepDocs;
  const wantedId = entityNum.startsWith("#") ? entityNum : `#${entityNum}`;
  for (const sDoc of sorted) {
    if (sDoc.uri === currentUri) continue;
    const entity = scanStepEntities(sDoc.text).find((e) => e.id === wantedId);
    if (entity) {
      const eqIdx = sDoc.text.indexOf("=", entity.startOffset);
      const defEnd = eqIdx !== -1 ? eqIdx + 1 : entity.startOffset + wantedId.length;
      return { uri: sDoc.uri, text: sDoc.text, startOffset: entity.startOffset, endOffset: defEnd };
    }
  }
  return null;
}

export function findStepProductDefSpanInDocuments(
  stepDocs: ReadonlyArray<{ uri: string; text: string }>,
  currentUri: string,
  candidateName: string,
): { uri: string; text: string; startOffset: number; endOffset: number } | null {
  const candLower = candidateName.toLowerCase();
  for (const sDoc of stepDocs) {
    if (sDoc.uri === currentUri) continue;
    for (const entity of scanStepEntities(sDoc.text)) {
      if (entity.type.toUpperCase() !== "PRODUCT") continue;
      const firstArg = splitStepArgs(entity.args)[0]?.trim();
      if (!firstArg || !firstArg.startsWith("'") || !firstArg.endsWith("'")) continue;
      const productName = firstArg.slice(1, -1).replaceAll("''", "'");
      if (productName.toLowerCase() === candLower) {
        const quoteEnd = sDoc.text.indexOf(firstArg, entity.startOffset);
        const spanEnd = quoteEnd !== -1 ? quoteEnd + firstArg.length : entity.endOffset;
        const prodOffset = sDoc.text.toUpperCase().indexOf("PRODUCT", entity.startOffset);
        const spanStart = prodOffset !== -1 ? prodOffset : entity.startOffset;
        return { uri: sDoc.uri, text: sDoc.text, startOffset: spanStart, endOffset: spanEnd };
      }
    }
  }
  return null;
}

export function findStepLocalEntityDefSpan(text: string, offset: number): { start: number; end: number } | null {
  let start = offset;
  while (start > 0 && text.charCodeAt(start - 1) >= 48 && text.charCodeAt(start - 1) <= 57) start--;
  if (start > 0 && text[start - 1] === "#") start--;
  let end = offset;
  if (text[end] === "#") end++;
  while (end < text.length && text.charCodeAt(end) >= 48 && text.charCodeAt(end) <= 57) end++;
  const token = text.slice(start, end);
  if (!token.startsWith("#") || token.length <= 1) return null;
  const entity = scanStepEntities(text).find((e) => e.id === token);
  if (!entity) return null;
  const eqIdx = text.indexOf("=", entity.startOffset);
  const defEnd = eqIdx !== -1 ? eqIdx + 1 : entity.startOffset + token.length;
  return { start: entity.startOffset, end: defEnd };
}
